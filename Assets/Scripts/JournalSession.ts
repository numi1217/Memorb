/**
 * JournalSession.ts — Memorb Phase 2 live session state (DESIGN.md §3).
 *
 * OWNS: the in-progress JournalEntry for TODAY plus the ordered list of KEPT
 * trace records. This is the single source of truth for "what evidence has the
 * user confirmed so far". MemoryCardSpawner drives it from the card buttons;
 * later phases (Confirm §4, Generate §8) read `getEntry()` / `keptTraces()`.
 *
 * A KeptTrace keeps everything the Confirm screen (§4) needs: the chosen label,
 * the alternative labels Gemini offered, the raw OCR text, any detected date /
 * location Gemini read, the thumbnail texture, the internal scan order
 * (recorded, never displayed), whether this trace is the primary memory, and —
 * after confirmation — the OCR fragments the user chose to keep. The first trace
 * kept becomes primary; if it is later removed the next kept trace is promoted.
 *
 * @input verbose — log every session mutation + a full dump on change.
 *
 * PUBLIC API
 *   keep(order, label, altLabels, ocrText, thumb?, date?, location?, box01?, polygon01?)
 *                                                     -> record / update a kept trace
 *   unkeep(order)                                    -> drop a kept trace (promotes primary if needed)
 *   relabel(order, newLabel)                         -> change a trace's label (updates entry if kept)
 *   setPrimary(order)                                -> re-pick the primary memory (spec §4)
 *   setMomentEmotion(order, emotion, colorHex)       -> §4: emotion chosen for ONE moment
 *   setMomentReflection(order, text)                 -> §5: verbatim answer for ONE moment
 *   updateThumbShape(order, box01?, polygon01?)      -> mirror a post-Keep segmentation upgrade
 *                                                      onto the trace's thumbnail shape (§3/§7)
 *   setIncluded(order, included) / includedOrders()  -> §7: which kept moments join today's journal
 *   applyConfirmation(input)                         -> Phase 3: write the user-confirmed evidence
 *                                                      (per-trace label + kept OCR fragments,
 *                                                      opt-in location / date) onto the entry
 *   isKept(order) / keptCount() / keptTraces()       -> queries
 *   getEntry()                                       -> the live JournalEntry (rebuilt arrays)
 *   logContents()                                    -> console dump of the session
 *   onKeptChanged: Event<number>                     -> fires with keptCount() after keep/unkeep
 *
 * Also exports the pure helper `splitOcrFragments(text)` (by newline, else by
 * sentence) so the Confirm screen and this module agree on fragment boundaries.
 *
 * MUST NOT: touch the scene graph, build UI, call Gemini, or drive FlowManager.
 */

import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { findSavedById } from "./DayStore";
import { JournalEntry, JournalEntryData } from "./JournalEntry";

export interface KeptTrace {
  /** 1-based scan order — recorded internally, never shown to the user (spec §3). */
  order: number;
  label: string;
  altLabels: string[];
  /** OCR fragment for this trace ("" when none was read). */
  ocrText: string;
  /** Frozen still for this trace, if the caller passed one. */
  thumb: Texture | null;
  /** The first kept trace is the primary memory (spec §4); re-pickable in Phase 3. */
  isPrimary: boolean;
  /** A date Gemini read from the trace, if any (spec §4 — opt-in only at confirmation). */
  date?: string;
  /** A place Gemini read from the trace, if any (spec §4 — opt-in only at confirmation). */
  location?: string;
  /** Phase 3: the OCR fragments the user chose to keep at the Confirm screen. When
   *  set, rebuildEntry() uses these instead of splitting the whole ocrText string. */
  confirmedOcr?: string[];

  // --- per-moment emotion + reflection (DESIGN.md §4-§5) ------------------
  // Captured immediately after Keep, PER moment — not once per day. The
  // DAY-level entry.feeling / entry.orbColor stay separate (§8, set later).
  /** Lower-case emotion id chosen for this moment (happy/peaceful/…). */
  emotion?: string;
  /** Hex colour for the chosen emotion, e.g. "#5B8DEF". */
  emotionColor?: string;
  /** The user's verbatim answer to the emotion-specific question ("" = skipped). */
  reflection?: string;
  /** Wall-clock time the moment was kept (getTime()*1000-ish ms since load, or Date). */
  captureTimeMs?: number;
  /** Human "HH:MM" string for the capture time, when available. */
  captureTimeStr?: string;
  /** DESIGN.md §7 — set at Review Today. Whether this moment is one of the
   *  1-5 selected for today's journal. Defaults true for the first 5 kept
   *  moments (a reasonable starting point most days won't exceed), false
   *  after that — Review Today lets the user change any of it. */
  includedInJournal?: boolean;

  // --- thumbnail shape (mirrors whichever tier MemoryCardSpawner is CURRENTLY
  // showing on the card, so Review Today can rebuild the same background-
  // removed look instead of falling back to the raw `thumb` still) ----------
  /** Normalized (0..1, top-left origin) crop rect — set when the card is on
   *  the bbox tier. Cleared (undefined) once a polygon cutout supersedes it. */
  thumbBox?: { x: number; y: number; w: number; h: number };
  /** Normalized (0..1, top-left origin) segmentation polygon — set when the
   *  card is on the cutout tier (the highest tier, wins over thumbBox). */
  thumbPolygon?: { x: number; y: number }[];
}

/** One trace's user-confirmed state, produced by the Confirm screen (spec §4). */
export interface TraceConfirmation {
  order: number;
  /** Final label (possibly re-picked from altLabels). */
  label: string;
  /** OCR fragments the user chose to keep for this trace. */
  keptOcr: string[];
}

export interface ConfirmationInput {
  perTrace: TraceConfirmation[];
  /** Which trace the user marked primary (null = leave as-is). */
  primaryOrder?: number | null;
  /** Location string ONLY if the user explicitly opted in, else "". */
  confirmedLocation: string;
  /** Detected date the user explicitly opted in to, else "" (keep the entry's own date). */
  confirmedDate: string;
}

/** Best-effort wall clock for a moment's capture time (DESIGN.md §4/§6). */
function nowStamp(): { ms: number; hhmm: string } {
  try {
    const d = new Date();
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    return { ms: Date.now(), hhmm: `${hh}:${mm}` };
  } catch (e) {
    return { ms: Date.now ? Date.now() : 0, hhmm: "" };
  }
}

/**
 * Split an OCR blob into confirmable fragments: by newline when present,
 * otherwise into sentence-ish chunks. Always returns [] for empty input and
 * never an array with empty strings.
 */
export function splitOcrFragments(text: string): string[] {
  const raw = (text || "").trim();
  if (!raw) return [];
  if (raw.indexOf("\n") >= 0) {
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  const m = raw.match(/[^.!?]+[.!?]*/g);
  const parts = (m || [raw]).map((s) => s.trim()).filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [raw];
}

@component
export class JournalSession extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">JournalSession — live evidence for today</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Log every session mutation and dump the full session on change.")
  verbose: boolean = true;
  @ui.group_end

  /** Fires after keep()/unkeep() with the new keptCount(). */
  public readonly onKeptChanged: Event<number> = new Event<number>();

  private entry: JournalEntry = new JournalEntry();
  private kept: KeptTrace[] = [];
  /** Today's already-saved entry, when the user chose "Add to Today's Journal"
   *  — the new moments this session APPEND to it instead of starting a fresh
   *  entry (2026-09-06). null = normal (new) journal. */
  private appendBase: JournalEntryData | null = null;

  onAwake(): void {
    // Fresh entry for today. Phase 8 will hydrate an existing entry here instead.
    this.entry = new JournalEntry();
    if (this.verbose) {
      console.log(
        `[Session] started entry id=${this.entry.id} date=${this.entry.date}`
      );
    }
  }

  /**
   * Adopt today's already-saved entry so this session's new moments APPEND to
   * it (same id -> persistEntry upserts, not appends a 2nd entry for the day).
   * The OLD moments' textures are gone; only the new moments carry thumbnails.
   * GenerateScreen merges the new journal text onto `appendBase`'s.
   */
  hydrateForAppend(data: JournalEntryData): void {
    if (!data || !data.id) return;
    this.appendBase = data;
    this.entry.id = data.id;
    this.entry.date = data.date || this.entry.date;
    this.entry.feeling = data.feeling || this.entry.feeling;
    this.entry.orbColor = data.orbColor || this.entry.orbColor;
    this.entry.confirmedLocation = data.confirmedLocation || "";
    if (this.verbose) console.log(`[Session] hydrateForAppend -> adopting saved entry ${data.id}`);
  }

  isAppending(): boolean {
    return this.appendBase !== null;
  }

  /** The entry the new moments append onto — re-read from the store each call so
   *  a SECOND "Add" this session builds on the FIRST add's saved text, not the
   *  original. Falls back to the cached snapshot if the store read misses. */
  getAppendBase(): JournalEntryData | null {
    if (!this.appendBase) return null;
    const fresh = findSavedById(this.appendBase.id);
    return fresh || this.appendBase;
  }

  // --- mutations ----------------------------------------------------------

  /** Record a kept trace (or refresh an existing one). First kept -> primary.
   *  `box01`/`polygon01` mirror whichever thumbnail tier MemoryCardSpawner is
   *  showing on the card at Keep-time (§3) — see `updateThumbShape` for how a
   *  later segmentation upgrade reaches an already-kept trace. */
  keep(
    order: number,
    label: string,
    altLabels: string[],
    ocrText: string,
    thumb?: Texture,
    date?: string,
    location?: string,
    box01?: { x: number; y: number; w: number; h: number },
    polygon01?: { x: number; y: number }[]
  ): void {
    let rec = this.kept.find((k) => k.order === order);
    if (rec) {
      rec.label = label;
      rec.altLabels = altLabels.slice();
      rec.ocrText = ocrText;
      if (thumb) rec.thumb = thumb;
      if (date !== undefined) rec.date = date;
      if (location !== undefined) rec.location = location;
      if (box01 !== undefined || polygon01 !== undefined) {
        rec.thumbBox = box01;
        rec.thumbPolygon = polygon01;
      }
    } else {
      const now = nowStamp();
      rec = {
        order,
        label,
        altLabels: altLabels.slice(),
        ocrText: ocrText,
        thumb: thumb ?? null,
        isPrimary: this.kept.length === 0,
        date: date,
        location: location,
        captureTimeMs: now.ms,
        captureTimeStr: now.hhmm,
        // Pre-select the first 5 kept moments for today's journal (§7); the
        // user can change any of it at Review Today.
        includedInJournal: this.kept.length < 5,
        thumbBox: box01,
        thumbPolygon: polygon01,
      };
      this.kept.push(rec);
      this.kept.sort((a, b) => a.order - b.order);
    }
    this.ensurePrimary();
    this.rebuildEntry();
    if (this.verbose) console.log(`[Session] kept #${order} "${label}" (primary=${rec.isPrimary})`);
    this.emitChange();
  }

  /** Drop a kept trace. If it was primary, promote the next kept trace. */
  unkeep(order: number): void {
    const idx = this.kept.findIndex((k) => k.order === order);
    if (idx < 0) {
      if (this.verbose) console.log(`[Session] unkeep #${order} — was not kept, ignoring`);
      return;
    }
    const wasPrimary = this.kept[idx].isPrimary;
    this.kept.splice(idx, 1);
    if (wasPrimary && this.kept.length > 0) this.kept[0].isPrimary = true;
    this.ensurePrimary();
    this.rebuildEntry();
    if (this.verbose) {
      console.log(
        `[Session] unkept #${order}${wasPrimary ? " (was primary -> promoted next)" : ""}`
      );
    }
    this.emitChange();
  }

  /** Change a trace's label. Updates the entry only if the trace is currently kept. */
  relabel(order: number, newLabel: string): void {
    const rec = this.kept.find((k) => k.order === order);
    if (!rec) {
      if (this.verbose) console.log(`[Session] relabel #${order} "${newLabel}" — not kept, card-only change`);
      return;
    }
    rec.label = newLabel;
    this.rebuildEntry();
    if (this.verbose) console.log(`[Session] relabelled #${order} -> "${newLabel}"`);
    this.emitChange();
  }

  /**
   * DESIGN.md §3 — a card can be Kept before its segmentation result arrives;
   * MemoryCardSpawner calls this to mirror a later thumbnail-tier upgrade
   * (bbox crop -> polygon cutout) onto the already-kept trace, so Review
   * Today (§7) shows the same background-removed look the card ends up with.
   * No-op (logged) if this trace was never kept.
   */
  updateThumbShape(
    order: number,
    box01: { x: number; y: number; w: number; h: number } | undefined,
    polygon01: { x: number; y: number }[] | undefined
  ): void {
    const rec = this.kept.find((k) => k.order === order);
    if (!rec) {
      if (this.verbose) console.log(`[Session] updateThumbShape #${order} — not kept, ignoring`);
      return;
    }
    rec.thumbBox = box01;
    rec.thumbPolygon = polygon01;
    if (this.verbose) {
      console.log(
        `[Session] moment #${order} thumb shape -> ${polygon01 ? `polygon(${polygon01.length}pts)` : box01 ? "box" : "none"}`
      );
    }
  }

  /** Phase 3 hook: let the user pick a different primary memory (spec §4). */
  setPrimary(order: number): void {
    let found = false;
    for (const k of this.kept) {
      k.isPrimary = k.order === order;
      if (k.isPrimary) found = true;
    }
    if (!found) this.ensurePrimary();
    if (this.verbose) console.log(`[Session] primary -> #${order}`);
    this.emitChange();
  }

  /**
   * Phase 3 (DESIGN.md §4): write the evidence the user confirmed on the Confirm
   * screen onto today's entry. The Confirm UI owns the interaction; this owns the
   * data. Per trace we take the (possibly re-picked) label and only the OCR
   * fragments the user kept. Location and detected date are written ONLY when the
   * user explicitly opted in (spec: "Dates and locations must require explicit
   * confirmation"); otherwise confirmedLocation is "" and the entry keeps its own
   * date (today).
   */
  applyConfirmation(input: ConfirmationInput): void {
    for (const c of input.perTrace) {
      const rec = this.kept.find((k) => k.order === c.order);
      if (!rec) continue;
      if (c.label && c.label.trim().length > 0) rec.label = c.label.trim();
      rec.confirmedOcr = (c.keptOcr || [])
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    if (
      input.primaryOrder != null &&
      this.kept.some((k) => k.order === input.primaryOrder)
    ) {
      for (const k of this.kept) k.isPrimary = k.order === input.primaryOrder;
    }
    this.ensurePrimary();
    this.rebuildEntry();

    this.entry.confirmedLocation = (input.confirmedLocation || "").trim();
    const d = (input.confirmedDate || "").trim();
    if (d.length > 0) this.entry.date = d;

    if (this.verbose) {
      console.log(
        `[Session] applyConfirmation -> labels=[${this.entry.objectLabels.join(", ")}] ` +
          `ocrFrags=${this.entry.keptOcrText.length} ` +
          `location="${this.entry.confirmedLocation}" date="${this.entry.date}" ` +
          `primary=#${this.primaryOrder()}`
      );
    }
    this.emitChange();
  }

  /**
   * DESIGN.md §4 — record the emotion the user picked for ONE moment, right
   * after Keep. Writes onto that KeptTrace only; does NOT touch the day-level
   * entry.feeling / entry.orbColor (§8, chosen separately at the end).
   */
  setMomentEmotion(order: number, emotion: string, colorHex: string): void {
    const rec = this.kept.find((k) => k.order === order);
    if (!rec) {
      if (this.verbose) console.log(`[Session] setMomentEmotion #${order} — not kept, ignoring`);
      return;
    }
    rec.emotion = (emotion || "").trim().toLowerCase();
    rec.emotionColor = (colorHex || "").trim();
    if (this.verbose) {
      console.log(`[Session] moment #${order} emotion="${rec.emotion}" colour="${rec.emotionColor}"`);
    }
    this.emitChange();
  }

  /**
   * DESIGN.md §5 — store the user's VERBATIM answer to the emotion-specific
   * question for ONE moment. No processing, no Gemini. "" = the user skipped.
   */
  setMomentReflection(order: number, text: string): void {
    const rec = this.kept.find((k) => k.order === order);
    if (!rec) {
      if (this.verbose) console.log(`[Session] setMomentReflection #${order} — not kept, ignoring`);
      return;
    }
    rec.reflection = text ?? "";
    if (this.verbose) {
      console.log(`[Session] moment #${order} reflection="${rec.reflection}"`);
    }
    this.emitChange();
  }

  /**
   * DESIGN.md §7 — Review Today sets which kept moments belong in today's
   * journal (1-5). Refuses to turn a 6th moment on (returns false, no
   * mutation) so the cap is enforced in one place; turning one off always
   * succeeds. Returns false (no-op) if `order` isn't kept.
   */
  setIncluded(order: number, included: boolean): boolean {
    const rec = this.kept.find((k) => k.order === order);
    if (!rec) {
      if (this.verbose) console.log(`[Session] setIncluded #${order} — not kept, ignoring`);
      return false;
    }
    if (included && !rec.includedInJournal) {
      const count = this.kept.filter((k) => k.includedInJournal).length;
      if (count >= 5) {
        if (this.verbose) console.log(`[Session] setIncluded #${order} -> blocked, 5 already selected`);
        return false;
      }
    }
    rec.includedInJournal = included;
    if (this.verbose) console.log(`[Session] moment #${order} includedInJournal=${included}`);
    this.emitChange();
    return true;
  }

  /** Orders of the kept moments currently selected for today's journal (§7). */
  includedOrders(): number[] {
    return this.kept.filter((k) => k.includedInJournal).map((k) => k.order);
  }

  // --- queries ----------------------------------------------------------

  isKept(order: number): boolean {
    return this.kept.some((k) => k.order === order);
  }

  keptCount(): number {
    return this.kept.length;
  }

  keptTraces(): KeptTrace[] {
    return this.kept.slice();
  }

  primaryOrder(): number | null {
    const p = this.kept.find((k) => k.isPrimary);
    return p ? p.order : null;
  }

  getEntry(): JournalEntry {
    return this.entry;
  }

  logContents(): void {
    const lines = this.kept.map(
      (k) =>
        `    #${k.order}${k.isPrimary ? " *primary*" : ""}${k.includedInJournal ? " [included]" : ""} label="${k.label}" ` +
        `ocr="${k.ocrText}" alts=[${k.altLabels.join(", ")}]\n` +
        `        emotion="${k.emotion ?? ""}" emotionColor="${k.emotionColor ?? ""}" ` +
        `reflection="${k.reflection ?? ""}" captureTime="${k.captureTimeStr ?? ""}" (${k.captureTimeMs ?? 0})`
    );
    console.log(
      `[Session] === today's journal (${this.entry.date}) ===\n` +
        `  id: ${this.entry.id}\n` +
        `  kept traces: ${this.kept.length}\n` +
        (lines.length ? lines.join("\n") + "\n" : "    (none)\n") +
        `  objectLabels: [${this.entry.objectLabels.join(", ")}]\n` +
        `  keptOcrText:  [${this.entry.keptOcrText.map((t) => `"${t}"`).join(", ")}]\n` +
        `  confirmedLocation: "${this.entry.confirmedLocation}"\n` +
        `  reflection: "${this.entry.reflection}"\n` +
        `  feeling: "${this.entry.feeling}"  orbColor: "${this.entry.orbColor}"\n` +
        `  ====================================`
    );
  }

  // --- internals ------------------------------------------------------

  private ensurePrimary(): void {
    if (this.kept.length === 0) return;
    if (!this.kept.some((k) => k.isPrimary)) this.kept[0].isPrimary = true;
    // Guard against >1 primary after edits.
    let seen = false;
    for (const k of this.kept) {
      if (k.isPrimary && seen) k.isPrimary = false;
      if (k.isPrimary) seen = true;
    }
  }

  private rebuildEntry(): void {
    this.entry.objectLabels = this.kept
      .map((k) => k.label)
      .filter((l) => l.length > 0);

    // Once a trace has been through the Confirm screen, its `confirmedOcr` is the
    // authoritative fragment list; before that, fall back to the whole ocrText.
    const ocr: string[] = [];
    for (const k of this.kept) {
      if (k.confirmedOcr) {
        for (const f of k.confirmedOcr) {
          const t = f.trim();
          if (t.length > 0) ocr.push(t);
        }
      } else {
        const t = k.ocrText.trim();
        if (t.length > 0) ocr.push(t);
      }
    }
    this.entry.keptOcrText = ocr;
  }

  private emitChange(): void {
    this.onKeptChanged.invoke(this.kept.length);
    if (this.verbose) this.logContents();
  }
}
