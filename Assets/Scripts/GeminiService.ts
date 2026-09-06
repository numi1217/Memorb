/**
 * GeminiService.ts — Memorb's wrapper around Gemini Flash via the
 * Remote Service Gateway (Phase 0 spine + Spike B).
 *
 * OWNS: every call to Gemini, all prompt strings, response parsing, retry, and
 * the typed error taxonomy the UI reacts to.
 *
 * PUBLIC API
 *   analyzeTrace(imageTexture)  -> Promise<TraceResult>
 *       Vision + OCR on a captured still. Returns { label, confidence, text,
 *       date?, location?, altLabels }.
 *   generateJournal(payload)    -> Promise<JournalGenResult>
 *       DESIGN.md §9 — turns the SELECTED moments' confirmed label/OCR + their
 *       per-moment emotion + reflection, plus the day's overall feeling, into
 *       { title, paragraph, finalReflection }. Never sees unselected moments.
 *       §10's optional `styleHint` (Make Shorter / Change Tone) changes HOW
 *       it's written without adding to WHAT it's grounded in.
 *
 * ERRORS (all thrown as TraceError with a .kind):
 *   Unrecognized  - model could not name the object with any confidence
 *   LowOcr        - object named, but little/no readable text extracted
 *   NetworkFail   - RSG/transport failure, or empty response after retry
 *   GenFail       - response arrived but could not be parsed as valid JSON
 *
 * @input model            - Gemini model id (default gemini-2.5-flash)
 * @input lowOcrMinChars   - below this many OCR chars -> LowOcr
 * @input minConfidence    - below this -> Unrecognized
 * @input enableLogging    - verbose request/response logging
 *
 * REQUIRES: RemoteServiceGateway package (>=2.0) installed, and the
 * RemoteServiceGatewayCredentials component in the scene populated with a
 * Google token (see RemoteServiceGatewayExamples prefab). Without a token every
 * call fails with NetworkFail.
 *
 * MUST NOT: touch the scene, hold journal state, or build UI.
 */

import { Gemini } from "RemoteServiceGateway.lspkg/HostedExternal/Gemini";
import { GeminiTypes } from "RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes";

export enum TraceErrorKind {
  Unrecognized = "Unrecognized",
  LowOcr = "LowOcr",
  NetworkFail = "NetworkFail",
  GenFail = "GenFail",
}

export class TraceError extends Error {
  constructor(public readonly kind: TraceErrorKind, message: string) {
    super(message);
    this.name = "TraceError";
  }
}

export interface TraceResult {
  /** Best single object name, lower-case, e.g. "train ticket". */
  label: string;
  /** 0..1 self-reported confidence in `label`. */
  confidence: number;
  /** OCR transcription of any readable text in the image ("" if none). */
  text: string;
  /** A date the model read from the trace, ISO-ish, if any. */
  date?: string;
  /** A place/venue the model read from the trace, if any. */
  location?: string;
  /** Alternative object names, best first. */
  altLabels: string[];
  /** Soft hint: some text was read but it is short/uncertain (spec §14). Never blocks the card. */
  ocrUncertain?: boolean;
  /**
   * Tight normalized bounding box of the primary object in the still, origin
   * top-left, all components 0..1 (x,y = top-left corner; w,h = size).
   * `undefined` when the model did not return a usable box. Design v2 §3 first
   * step toward a background-removed cut-out — the card crops the thumbnail to
   * this box; a real segmentation mask comes later.
   */
  box?: { x: number; y: number; w: number; h: number };
}

/**
 * One primary-object segmentation from Gemini (DESIGN.md v2 §3). Asks for a
 * POLYGON outline, not a base64 PNG mask: a raster mask made Gemini emit an
 * inline image (thousands of base64 tokens) and consistently missed the
 * Remote Service Gateway's ~30s request deadline (confirmed: 2/2 attempts,
 * 30.06s / 30.07s, unaffected by `thinkingBudget: 0`). A polygon is a
 * few dozen coordinate pairs — the card triangulates it into an actual cut-out
 * MESH (TraceGizmos.makePolygonCutout) sampling the still directly, so there is
 * no raster mask to request, decode, or composite at all.
 */
export interface SegmentResult {
  /** Primary object box, normalized 0..1, origin TOP-LEFT (converted from Gemini's
   *  0-1000 `box_2d` = [y0, x0, y1, x1]). */
  box01: { x: number; y: number; w: number; h: number };
  /** Segmentation outline, normalized 0..1, origin TOP-LEFT, same coordinate
   *  space as `box01` (converted from Gemini's 0-1000 `[[x,y],...]`). Empty
   *  when the model returned no usable polygon — caller falls back to the
   *  bbox crop. */
  polygon: { x: number; y: number }[];
  /** The model's text label for the segmented object (lower-case). */
  label: string;
}

/** One SELECTED moment's evidence for journal generation (DESIGN.md §9). */
export interface JournalMomentInput {
  label: string;
  /** Confirmed OCR text for this moment ("" if none). */
  ocrText: string;
  /** Emotion chosen for this moment at Keep-time (§4), lower-case ("" if unset). */
  emotion: string;
  /** Verbatim per-moment reflection (§5), "" if the user skipped it. */
  reflection: string;
}

export interface JournalGenInput {
  /** ONLY the 1-5 moments selected at Review Today (§7) — never the full kept list. */
  moments: JournalMomentInput[];
  confirmedLocation?: string;
  date?: string;
  /** Overall daily emotion chosen at §8 — separate from any per-moment emotion. */
  dayFeeling: string;
  /** DESIGN.md §10 — an optional style note from Make Shorter / Change Tone /
   *  Regenerate ("" or omitted = the default 60-90-word first-person style).
   *  Still bound by the same evidence — a style note can change HOW it's
   *  written, never invent WHAT it's about. */
  styleHint?: string;
}

export interface JournalGenResult {
  title: string;
  paragraph: string;
  finalReflection: string;
}

// ---------------------------------------------------------------------------
// Prompt strings — centralised here on purpose. Tune these, not the callers.
// ---------------------------------------------------------------------------

const ANALYZE_SYSTEM =
  "You are the vision component of a spatial journaling app. The user has just " +
  "captured a photo of a small real-world object, receipt, ticket, or handwritten note. " +
  "Identify the single most likely object and transcribe any readable text exactly. " +
  "Reply with ONLY a compact JSON object, no markdown, no commentary.";

const ANALYZE_USER =
  'Return JSON with this exact shape:\n' +
  '{"label": string, "confidence": number 0..1, "text": string (verbatim OCR, "" if none), ' +
  '"date": string ("" if none), "location": string ("" if none), "altLabels": string[] (up to 3), ' +
  '"box": {"x": number, "y": number, "w": number, "h": number} or null}\n' +
  "label must be lower-case and 1-4 words. Do not invent text that is not visibly present.\n" +
  'box is a TIGHT bounding box around the single primary object only, normalized 0..1 with the ' +
  "origin at the top-left of the image: x,y = top-left corner, w,h = width and height. " +
  "Use null if you cannot localize one clear primary object.";

const SEGMENT_SYSTEM = "Identify the main object in the centre of the image.";

/** segmentPrimary runs on the main `model` @input (same as analyzeTrace /
 *  generateJournal) — this is only a hard fallback if that field is ever blank. */
const SEGMENT_MODEL = "gemini-3.5-flash";

/** The pre-2026-09-06 prompt, restored 2026-09-06 at the user's request: ask for
 *  the object outline as a POLYGON (12-30 [x,y] points, 0-1000). With this shape
 *  `gemini-3.5-flash` returns a real ~70-pt polygon in ~6s and `parsePolygonMask`
 *  builds the cut-out mesh directly (crisp). Do NOT switch this to asking for a
 *  raster "mask": that made 3.5-flash hang past RSG's 30s deadline, and the
 *  models that answer fast then send a coarse 256px PNG. If a model does return a
 *  PNG anyway, `maskPngToPolygon` traces it as a fallback. */
const SEGMENT_USER =
  "Return only valid JSON:\n\n" +
  '{"label": "short object name", "box_2d": [ymin, xmin, ymax, xmax], ' +
  '"mask": [[x1, y1], [x2, y2], [x3, y3]]}\n\n' +
  "Coordinates must be normalized from 0 to 1000. The mask must closely follow the visible " +
  "boundary of the object as a polygon outline (12-30 points). Ignore background objects.";

const JOURNAL_SYSTEM =
  "You are the writing component of a gentle spatial journaling app. The user selected a few " +
  "objects they noticed today; each carries an emotion they picked and, sometimes, a short " +
  "spoken reflection in their own words. They also described how the day felt overall. Using " +
  "ONLY this evidence, write a brief, warm journal page in the user's own first-person voice. " +
  "Never exaggerate, and never invent objects, events, locations, relationships, or emotions " +
  "that are not present in the evidence given. Reply with ONLY a compact JSON object, no " +
  "markdown, no commentary.";

const JOURNAL_USER =
  'Return JSON with this exact shape:\n' +
  '{"title": string (<= 6 words), "paragraph": string (60-90 words, first person), ' +
  '"finalReflection": string (1 sentence, a small forward-looking thought)}';

// ---------------------------------------------------------------------------

@component
export class GeminiService extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">GeminiService — Gemini Flash via RSG</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Gemini model id — used for analyzeTrace, generateJournal AND the card cut-out (segmentPrimary). RSG-verified here: gemini-3.5-flash (returns a real segmentation polygon in ~6s — best cut-outs), gemini-3-flash-preview, gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.5-pro. NOT available: gemini-2.0-flash, gemini-3-pro-preview, gemini-3.5-flash-preview (404).")
  model: string = "gemini-3.5-flash";

  @input
  @hint("OCR results shorter than this many characters raise a LowOcr error.")
  lowOcrMinChars: number = 3;

  @input
  @hint("analyzeTrace confidence below this raises an Unrecognized error.")
  minConfidence: number = 0.3;

  @input
  @hint("Log full request/response payloads.")
  enableLogging: boolean = false;
  @ui.group_end

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Vision + OCR on a captured still.
   *
   * `opts` lets the Scan screen's latency probe (Phase 1) A/B different models
   * and toggle the JSON response-mime without editing this file. When omitted,
   * the Inspector `model` input and `responseMimeType: application/json` are used.
   */
  async analyzeTrace(
    imageTexture: Texture,
    opts?: { model?: string; jsonMime?: boolean }
  ): Promise<TraceResult> {
    if (isNull(imageTexture)) {
      throw new TraceError(TraceErrorKind.NetworkFail, "analyzeTrace: null texture");
    }

    const model = opts && opts.model ? opts.model : this.model;
    const useJsonMime = !opts || opts.jsonMime !== false;

    const b64 = await this.encodeJpg(imageTexture);
    const generationConfig: any = { temperature: 0.2 };
    if (useJsonMime) generationConfig.responseMimeType = "application/json";

    const req: GeminiTypes.Models.GenerateContentRequest = {
      model: model,
      type: "generateContent",
      body: {
        systemInstruction: { parts: [{ text: ANALYZE_SYSTEM }] },
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: b64 } },
              { text: ANALYZE_USER },
            ],
          },
        ],
        generationConfig: generationConfig,
      },
    };

    const parsed = await this.callAndParse(req, "analyzeTrace");

    const result: TraceResult = {
      label: String(parsed.label ?? "").trim().toLowerCase(),
      confidence: clamp01(Number(parsed.confidence)),
      text: String(parsed.text ?? "").trim(),
      date: nonEmpty(parsed.date),
      location: nonEmpty(parsed.location),
      altLabels: toStringArray(parsed.altLabels),
      box: parseBox(parsed.box),
    };

    if (this.enableLogging) {
      console.log("[GeminiService] analyzeTrace result: " + JSON.stringify(result));
    }

    if (!result.label || result.label === "unknown" || result.confidence < this.minConfidence) {
      throw new TraceError(
        TraceErrorKind.Unrecognized,
        `analyzeTrace: low confidence (${result.confidence}) / no label`
      );
    }
    // A trace with no readable text is a perfectly valid result (spec: OCR text is
    // optional, "if present"). We do NOT error on short/empty text here. OCR-quality
    // handling ("I found some text, but it may not be accurate" — spec §14) belongs to
    // the evidence-confirmation screen, per fragment. `ocrUncertain` is a soft hint the
    // Card/Confirm screens can surface; it never blocks card creation.
    result.ocrUncertain = result.text.length > 0 && result.text.length < this.lowOcrMinChars;
    return result;
  }

  /**
   * DESIGN.md v2 §3 — real object segmentation for the background-removed card
   * thumbnail. A FOCUSED prompt kept separate from analyzeTrace: segmentation
   * likes low temperature and a narrow instruction, and a failed/absent mask must
   * never break labelling. `ScanScreen` calls analyzeTrace first (drives the
   * card), then fires this and upgrades the thumbnail when it resolves.
   *
   * Returns null on any transport / parse / bad-box failure — the caller then
   * keeps the analyzeTrace bbox crop (or the full frame).
   */
  async segmentPrimary(imageTexture: Texture): Promise<SegmentResult | null> {
    if (isNull(imageTexture)) {
      console.log("[GeminiService] segmentPrimary: null texture");
      return null;
    }

    let b64: string;
    try {
      b64 = await this.encodeJpg(imageTexture);
    } catch (e) {
      console.log("[GeminiService] segmentPrimary: JPEG encode failed: " + e);
      return null;
    }

    const segModel = (this.model || "").trim() || SEGMENT_MODEL;
    const req: GeminiTypes.Models.GenerateContentRequest = {
      model: segModel,
      type: "generateContent",
      body: {
        systemInstruction: { parts: [{ text: SEGMENT_SYSTEM }] },
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: b64 } },
              { text: SEGMENT_USER },
            ],
          },
        ],
        // thinkingBudget: 0 skips the model's internal reasoning step — kept as
        // a free latency win even though it alone did not fix the PNG-mask
        // deadline issue (the polygon ask below is the actual fix: a coordinate
        // list is a tiny response vs. an inline base64 PNG).
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
    };

    // Segmentation is a heavier ask than analyzeTrace and times out ("Deadline
    // Exceeded") more often — retry once before giving up, same as callAndParse
    // does for the other calls (this method can't reuse callAndParse verbatim:
    // it parses a JSON ARRAY, not callAndParse's object-shaped lenientJsonParse).
    let response: GeminiTypes.Models.GenerateContentResponse | null = null;
    let raw = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const t0 = getTime();
      try {
        response = await Gemini.models(req);
      } catch (e) {
        console.log(
          `[GeminiService] segmentPrimary attempt ${attempt} transport error after ${(getTime() - t0).toFixed(2)}s: ${e}`
        );
        continue;
      }
      console.log(`[GeminiService] segmentPrimary (${segModel}) attempt ${attempt} responded in ${(getTime() - t0).toFixed(2)}s`);
      raw = GeminiService.extractText(response);
      if (raw) break;
      console.log(`[GeminiService] segmentPrimary attempt ${attempt}: empty response body`);
    }
    if (!raw) {
      console.log("[GeminiService] segmentPrimary: no usable response after retry");
      return null;
    }
    if (this.enableLogging) {
      console.log("[GeminiService] segmentPrimary raw (first 300): " + raw.slice(0, 300));
    }

    // Response is a single JSON object (not the old array-of-one), per the
    // {label, box_2d, mask} prompt above — plain lenientJsonParse handles it.
    const entry = GeminiService.lenientJsonParse(raw);
    if (!entry) {
      console.log("[GeminiService] segmentPrimary: unparseable response — " + raw.slice(0, 200));
      return null;
    }

    const box01 = parseBox2d(entry.box_2d);
    if (!box01) {
      console.log("[GeminiService] segmentPrimary: unusable box_2d — " + JSON.stringify(entry.box_2d));
      return null;
    }

    const label = String(entry.label ?? "").trim().toLowerCase();

    // Two shapes come back depending on the model:
    //  - a real (or stringified) polygon vertex list -> parsePolygonMask
    //  - a base64 PNG segmentation mask ("data:image/png;base64,...") -> trace
    //    its outline into a polygon here, so the whole downstream cut-out +
    //    persistence path (which is polygon-shaped) keeps working.
    let polygon = parsePolygonMask(entry.mask);
    let maskPath = "polygon";
    if (
      polygon.length === 0 &&
      typeof entry.mask === "string" &&
      entry.mask.indexOf("base64,") >= 0
    ) {
      maskPath = "png-trace";
      try {
        polygon = await this.maskPngToPolygon(entry.mask, box01);
      } catch (e) {
        console.log("[GeminiService] segmentPrimary: mask PNG trace threw — " + e);
        polygon = [];
      }
    }
    if (polygon.length === 0) {
      const sample =
        typeof entry.mask === "string"
          ? `"${entry.mask.slice(0, 90)}"`
          : String(JSON.stringify(entry.mask)).slice(0, 90);
      console.log(
        `[GeminiService] segmentPrimary: no usable polygon (path=${maskPath} type=${typeof entry.mask}) ` +
          `sample=${sample} — caller falls back to the bbox crop`
      );
    }

    console.log(
      `[GeminiService] segmentPrimary OK label="${label}" path=${maskPath} ` +
        `box01=${box01.x.toFixed(2)},${box01.y.toFixed(2)} ${box01.w.toFixed(2)}x${box01.h.toFixed(2)} ` +
        `polygonPts=${polygon.length}`
    );
    return { box01, polygon, label };
  }

  /**
   * Decode a base64 PNG segmentation mask and trace its outline into an
   * image-space polygon (0..1, top-left origin) that the card cut-out consumes.
   * `box01` is the mask's placement in the full frame — the mask itself covers
   * only that sub-rect, so its local 0..1 coords are remapped through the box.
   * Returns [] on any failure (caller then uses the bbox crop).
   */
  private maskPngToPolygon(
    maskStr: string,
    box01: { x: number; y: number; w: number; h: number }
  ): Promise<{ x: number; y: number }[]> {
    return new Promise((resolve) => {
      let raw = maskStr;
      const comma = raw.indexOf("base64,");
      if (comma >= 0) raw = raw.slice(comma + 7);
      raw = raw.trim();

      let settled = false;
      const done = (pts: { x: number; y: number }[]) => {
        if (settled) return;
        settled = true;
        resolve(pts);
      };
      // Guard against a decode that never calls back.
      const wd = this.createEvent("DelayedCallbackEvent");
      wd.bind(() => done([]));
      wd.reset(4);

      try {
        Base64.decodeTextureAsync(
          raw,
          (tex: Texture) => {
            try {
              const w = tex.getWidth();
              const h = tex.getHeight();
              if (!(w > 4) || !(h > 4) || w * h > 640 * 640) {
                done([]);
                return;
              }
              const pt = ProceduralTextureProvider.createFromTexture(tex);
              const ctrl = pt.control as ProceduralTextureProvider;
              const buf = new Uint8Array(w * h * 4);
              ctrl.getPixels(0, 0, w, h, buf);

              const contour = traceMaskContour(buf, w, h);
              if (contour.length < 6) {
                done([]);
                return;
              }
              // Remap mask-local 0..1 -> full-image 0..1 through the box.
              const pts = contour.map((p) => ({
                x: clamp01(box01.x + (p.x / (w - 1)) * box01.w),
                y: clamp01(box01.y + (p.y / (h - 1)) * box01.h),
              }));
              console.log(
                `[GeminiService] mask PNG ${w}x${h} traced -> ${pts.length} outline pts`
              );
              done(pts);
            } catch (e) {
              console.log("[GeminiService] mask PNG read/trace failed — " + e);
              done([]);
            }
          },
          () => {
            console.log("[GeminiService] mask PNG decode failed");
            done([]);
          }
        );
      } catch (e) {
        console.log("[GeminiService] mask PNG decodeTextureAsync threw — " + e);
        done([]);
      }
    });
  }

  /**
   * Compose a short journal page from the SELECTED moments' evidence + the
   * day's feeling (§9). `payload.styleHint` (§10 — Make Shorter / Change
   * Tone / Regenerate) asks for a different HOW, never a different WHAT: it
   * rides along as its own instruction, not folded into the evidence blob,
   * so it can never be mistaken for something the user said.
   */
  async generateJournal(payload: JournalGenInput): Promise<JournalGenResult> {
    const evidence = {
      moments: (payload.moments ?? []).map((m) => ({
        label: m.label,
        ocrText: m.ocrText || "",
        emotion: m.emotion || "",
        reflection: m.reflection || "",
      })),
      confirmedLocation: payload.confirmedLocation ?? "",
      date: payload.date ?? "",
      dayFeeling: payload.dayFeeling ?? "",
    };

    const parts: { text: string }[] = [
      { text: JOURNAL_USER },
      { text: "Evidence:\n" + JSON.stringify(evidence) },
    ];
    const hint = (payload.styleHint || "").trim();
    if (hint) {
      parts.push({
        text:
          "Style note (changes HOW you write it, not WHAT it's about — still only the " +
          "evidence above): " + hint,
      });
    }

    const req: GeminiTypes.Models.GenerateContentRequest = {
      model: this.model,
      type: "generateContent",
      body: {
        systemInstruction: { parts: [{ text: JOURNAL_SYSTEM }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
        },
      },
    };

    let parsed: any;
    try {
      parsed = await this.callAndParse(req, "generateJournal");
    } catch (e) {
      // Re-map: a parse failure in journal generation is GenFail, not analyze's taxonomy.
      if (e instanceof TraceError && e.kind === TraceErrorKind.GenFail) throw e;
      if (e instanceof TraceError && e.kind === TraceErrorKind.NetworkFail) throw e;
      throw new TraceError(TraceErrorKind.GenFail, "generateJournal: " + String(e));
    }

    const out: JournalGenResult = {
      title: String(parsed.title ?? "").trim(),
      paragraph: String(parsed.paragraph ?? "").trim(),
      finalReflection: String(parsed.finalReflection ?? "").trim(),
    };
    if (!out.paragraph) {
      throw new TraceError(TraceErrorKind.GenFail, "generateJournal: empty paragraph");
    }
    if (this.enableLogging) {
      console.log("[GeminiService] generateJournal result: " + JSON.stringify(out));
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** One request + one retry. Returns the parsed JSON object or throws TraceError. */
  private async callAndParse(
    req: GeminiTypes.Models.GenerateContentRequest,
    tag: string
  ): Promise<any> {
    let lastErr: string = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      let response: GeminiTypes.Models.GenerateContentResponse;
      try {
        response = await Gemini.models(req);
      } catch (e) {
        lastErr = "transport: " + String(e);
        console.log(`[GeminiService] ${tag} attempt ${attempt} transport error: ${lastErr}`);
        continue;
      }

      const raw = GeminiService.extractText(response);
      if (this.enableLogging) {
        console.log(`[GeminiService] ${tag} attempt ${attempt} raw: ${raw}`);
      }
      if (!raw) {
        lastErr = "empty response body";
        continue;
      }
      const obj = GeminiService.lenientJsonParse(raw);
      if (obj) return obj;
      lastErr = "unparseable JSON: " + raw.slice(0, 200);
      console.log(`[GeminiService] ${tag} attempt ${attempt} parse failed`);
    }

    if (lastErr.indexOf("transport") === 0 || lastErr.indexOf("empty") === 0) {
      throw new TraceError(TraceErrorKind.NetworkFail, `${tag}: ${lastErr}`);
    }
    throw new TraceError(TraceErrorKind.GenFail, `${tag}: ${lastErr}`);
  }

  /** Pull the first text part out of a Gemini response, tolerating shape drift. */
  static extractText(response: GeminiTypes.Models.GenerateContentResponse): string {
    try {
      const cand = response?.candidates?.[0];
      const parts = cand?.content?.parts ?? [];
      for (const p of parts) {
        if (p && typeof p.text === "string" && p.text.length > 0) return p.text;
      }
    } catch (e) {
      /* fall through */
    }
    return "";
  }

  /**
   * Lenient JSON parse: strips ```json fences and grabs the outermost {...}
   * before parsing. Returns null on failure.
   */
  static lenientJsonParse(raw: string): any | null {
    if (!raw) return null;
    let s = raw.trim();
    // strip code fences
    s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    // narrow to the first balanced-looking object
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) {
      s = s.slice(first, last + 1);
    }
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  private encodeJpg(texture: Texture, quality: CompressionQuality = CompressionQuality.HighQuality): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      Base64.encodeTextureAsync(
        texture,
        (s: string) => resolve(s),
        () => reject(new TraceError(TraceErrorKind.NetworkFail, "JPEG encode failed")),
        quality,
        EncodingType.Jpg
      );
    });
  }
}

// --- small pure helpers ----------------------------------------------------

function clamp01(n: number): number {
  if (isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function nonEmpty(v: any): string | undefined {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : undefined;
}

function toStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((x) => x.length > 0).slice(0, 3);
}

/**
 * Parse Gemini's optional `box` into a sane normalized rect, or undefined.
 * Accepts {x,y,w,h}; clamps to 0..1, drops boxes that are empty, degenerate,
 * or effectively the whole frame (nothing to crop).
 */
function parseBox(
  v: any
): { x: number; y: number; w: number; h: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const n = (k: string) => {
    const f = Number(v[k]);
    return isNaN(f) ? NaN : f;
  };
  let x = n("x");
  let y = n("y");
  let w = n("w");
  let h = n("h");
  if ([x, y, w, h].some((f) => isNaN(f))) return undefined;
  x = clamp01(x);
  y = clamp01(y);
  w = clamp01(w);
  h = clamp01(h);
  if (w < 0.03 || h < 0.03) return undefined; // degenerate
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  if (w < 0.03 || h < 0.03) return undefined;
  if (w > 0.97 && h > 0.97) return undefined; // whole frame — no crop to do
  return { x, y, w, h };
}

/**
 * Gemini segmentation `box_2d` is [y0, x0, y1, x1] with integers normalized
 * 0-1000, origin top-left. Convert to the same {x, y, w, h} 0..1 rect the card
 * cropper uses. Rejects degenerate / whole-frame boxes.
 */
function parseBox2d(
  v: any
): { x: number; y: number; w: number; h: number } | undefined {
  if (!Array.isArray(v) || v.length < 4) return undefined;
  let y0 = Number(v[0]);
  let x0 = Number(v[1]);
  let y1 = Number(v[2]);
  let x1 = Number(v[3]);
  if ([y0, x0, y1, x1].some((n) => isNaN(n))) return undefined;
  y0 = clamp01(y0 / 1000);
  x0 = clamp01(x0 / 1000);
  y1 = clamp01(y1 / 1000);
  x1 = clamp01(x1 / 1000);
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (w < 0.03 || h < 0.03) return undefined;
  if (w > 0.99 && h > 0.99) return undefined;
  return { x, y, w, h };
}

/**
 * Gemini's segmentation `mask` is a list of point pairs, integers normalized
 * 0-1000, top-left-origin. Despite the prompt labelling them "x1, y1", a live
 * response (2026-09-04) confirmed the model actually emits them **[y, x]** —
 * the same order as `box_2d`'s `[ymin, xmin, ymax, xmax]` — not `[x, y]`.
 * Reading them as `[x, y]` silently produced a valid-looking-but-garbled
 * polygon (a self-intersecting "bowtie" instead of the object's outline),
 * since every point lands mirrored across the diagonal. Returns [] (not
 * undefined) on anything unusable so the caller's `.length === 0` check reads
 * naturally.
 */
function parsePolygonMask(v: any): { x: number; y: number }[] {
  // Some models return the polygon as a STRINGIFIED array ("[[y,x],...]") rather
  // than a real JSON array — recover it before giving up. (A base64 PNG-mask
  // string, which flash-lite emits, still won't parse here — that's expected;
  // the caller then uses the bbox crop.)
  if (typeof v === "string") {
    const s = v.trim();
    if (s.charAt(0) === "[") {
      try {
        v = JSON.parse(s);
      } catch (e) {
        return [];
      }
    } else {
      return [];
    }
  }
  if (!Array.isArray(v) || v.length < 3) return [];
  const pts: { x: number; y: number }[] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const y = Number(p[0]);
    const x = Number(p[1]);
    if (isNaN(x) || isNaN(y)) continue;
    pts.push({ x: clamp01(x / 1000), y: clamp01(y / 1000) });
  }
  return pts.length >= 3 ? pts : [];
}

/**
 * Trace the outer outline of a decoded segmentation-mask bitmap (RGBA8, `w`x`h`)
 * into an ordered list of pixel-space points: Moore-neighbour boundary follow
 * from the first foreground pixel in scan order, then Douglas-Peucker simplify
 * (drops the collinear staircase, keeps corners) + Chaikin smoothing (rounds
 * the remaining stair-steps). Returns [] on a degenerate mask (almost empty /
 * almost full / no contour).
 */
function traceMaskContour(
  buf: Uint8Array,
  w: number,
  h: number
): { x: number; y: number }[] {
  const n = w * h;
  // Pick the channel that actually carries the mask: R for a white-on-black
  // mask, A for an alpha mask. Sample a grid to find each channel's spread.
  let rMin = 255,
    rMax = 0,
    aMin = 255,
    aMax = 0;
  const stepS = Math.max(1, Math.floor(Math.sqrt(n) / 64));
  for (let y = 0; y < h; y += stepS) {
    for (let x = 0; x < w; x += stepS) {
      const i = (y * w + x) * 4;
      const r = buf[i];
      const a = buf[i + 3];
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
      if (a < aMin) aMin = a;
      if (a > aMax) aMax = a;
    }
  }
  const useAlpha = rMax - rMin < 40 && aMax - aMin >= 40;
  const lo = useAlpha ? aMin : rMin;
  const hi = useAlpha ? aMax : rMax;
  if (hi - lo < 24) return []; // flat mask — nothing to trace
  const thresh = Math.max(48, Math.min(208, (lo + hi) / 2));
  const chan = useAlpha ? 3 : 0;

  const fgAt = (x: number, y: number): boolean => {
    if (x < 0 || x >= w || y < 0 || y >= h) return false;
    return buf[(y * w + x) * 4 + chan] > thresh;
  };

  let count = 0;
  let sx = -1,
    sy = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (buf[(y * w + x) * 4 + chan] > thresh) {
        count++;
        if (sx < 0) {
          sx = x;
          sy = y;
        }
      }
    }
  }
  if (sx < 0) return [];
  const frac = count / n;
  if (frac < 0.004 || frac > 0.99) return [];

  // Clockwise 8-neighbour offsets: E, SE, S, SW, W, NW, N, NE.
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];
  const contour: { x: number; y: number }[] = [];
  let cx = sx,
    cy = sy;
  let bdir = 4; // entered the start pixel from the west
  const maxIter = 8 * (w + h) + 4 * Math.floor(Math.sqrt(count) + 1);
  let iter = 0;
  do {
    contour.push({ x: cx, y: cy });
    let found = false;
    const start = (bdir + 1) % 8;
    for (let k = 0; k < 8; k++) {
      const d = (start + k) % 8;
      const nx = cx + dx[d];
      const ny = cy + dy[d];
      if (fgAt(nx, ny)) {
        cx = nx;
        cy = ny;
        bdir = (d + 4) % 8; // resume search from behind the step we just took
        found = true;
        break;
      }
    }
    if (!found) break; // isolated pixel
    iter++;
  } while (!(cx === sx && cy === sy) && iter < maxIter);

  if (contour.length < 6) return [];

  // The raw Moore trace is a jagged 8-connected staircase with hundreds of
  // points. Douglas-Peucker drops the redundant collinear runs while keeping
  // real corners (adaptive — a boxy object stays ~8 pts, a curvy one keeps
  // more), then Chaikin rounds the remaining stair-steps so the cut-out edge
  // reads smooth instead of pixelated.
  const eps = Math.max(0.8, Math.min(w, h) / 200);
  let simplified = simplifyClosed(contour, eps);
  if (simplified.length < 6) simplified = contour;
  let smooth = chaikinClosed(simplified, 2);
  // Ear-clipping downstream is happy with plenty of points, but keep a ceiling.
  const CAP = 96;
  if (smooth.length > CAP) {
    const step = smooth.length / CAP;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < CAP; i++) out.push(smooth[Math.floor(i * step)]);
    smooth = out;
  }
  return smooth;
}

/** Perpendicular distance from p to the line through a-b. */
function perpDist(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Douglas-Peucker on an OPEN polyline (endpoints kept). Iterative stack. */
function simplifyOpen(
  pts: { x: number; y: number }[],
  eps: number
): { x: number; y: number }[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: number[][] = [[0, pts.length - 1]];
  while (stack.length) {
    const seg = stack.pop() as number[];
    const lo = seg[0];
    const hi = seg[1];
    let maxD = -1;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist(pts[i], pts[lo], pts[hi]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx > lo) {
      keep[idx] = 1;
      stack.push([lo, idx]);
      stack.push([idx, hi]);
    }
  }
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** Douglas-Peucker on a CLOSED contour: split at the two farthest-apart points
 *  so neither "end" of the DP polyline is an arbitrary trace start. */
function simplifyClosed(
  pts: { x: number; y: number }[],
  eps: number
): { x: number; y: number }[] {
  const n = pts.length;
  if (n < 6) return pts.slice();
  // farthest point from pts[0]
  let iFar = 0;
  let dFar = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
    if (d > dFar) {
      dFar = d;
      iFar = i;
    }
  }
  const a = simplifyOpen(pts.slice(0, iFar + 1), eps);
  const b = simplifyOpen(pts.slice(iFar), eps);
  // b ends at pts[n-1]; the loop closes back to pts[0] implicitly.
  const out = a.concat(b.slice(1, b.length - 1));
  return out.length >= 3 ? out : pts.slice();
}

/** Chaikin corner-cutting on a CLOSED polygon; `iters` passes. */
function chaikinClosed(
  pts: { x: number; y: number }[],
  iters: number
): { x: number; y: number }[] {
  let cur = pts;
  for (let k = 0; k < iters; k++) {
    if (cur.length < 4) break;
    const next: { x: number; y: number }[] = [];
    for (let i = 0; i < cur.length; i++) {
      const p = cur[i];
      const q = cur[(i + 1) % cur.length];
      next.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
      next.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
    }
    cur = next;
  }
  return cur;
}
