/**
 * GenerateScreen.ts — Memorb "Generate the daily journal" + "Review the
 * journal" screens (DESIGN.md v2 §9-§10, MVP priorities 9-10).
 *
 * OWNS: composing the day's journal from ONLY confirmed evidence — the
 * moments selected at Review Today (§7, `KeptTrace.includedInJournal`), each
 * one's label/OCR/emotion/reflection, plus the overall daily feeling chosen
 * at §8 (FeelScreen) — and displaying the result: a short title, a 60-90 word
 * paragraph, and one final reflection. Auto-fires on entering this screen
 * (there is no user choice to make first — Review Today and Feel already
 * made the choices this call uses); re-entering with an already-generated
 * journal (e.g. Back-then-forward) shows it directly instead of re-calling
 * Gemini. `GeminiService.generateJournal` is the one place that ever sees
 * this evidence — never the unselected moments (spec: "Gemini uses ONLY...").
 *
 * §10 review actions are a single horizontal row of icon buttons on the done
 * panel (2026-09-05, replaces the old "Revise" chooser): **back** (arrow → Feel),
 * **regenerate** (circular arrow → fresh generation, same evidence + whatever
 * style notes are active), **edit** (pen → dictate/type a full replacement
 * paragraph, no Gemini, the user's own words verbatim via the shared
 * ReflectionCapture helper), **save** (→ Orb §11, fold into a coloured sphere +
 * Keep Private / Place in Space). Make-Shorter / Change-Tone style notes are no
 * longer surfaced in the UI (the plumbing — `currentStyleHint` → `styleHint` —
 * remains for Regenerate to carry any note an autopilot/debug path sets).
 *
 * States: generating (animated loading panel) -> done (title + paragraph +
 * final reflection + Save/Revise/Back) or error (message + Try Again/Back).
 * "editing" is a sub-view of done, not its own GenPhase.
 *
 * Screen ROOT visibility is owned by ScreenRouter (enabled only on the
 * Generate state). Builds on wake / re-enable; tears down on disable.
 *
 * @input flowManager    - Save -> Orb (§11), Back -> Feel
 * @input geminiService  - the one generateJournal() call this screen makes
 * @input journalSession - reads keptTraces()+getEntry(), writes the result onto the entry
 * @input panelDistanceCm - local Z of the panel tree in front of the screen root
 * @input loadingText / errNetwork / errGen / saveLabel / reviseLabel / backLabel / tryAgainLabel - copy
 * @input forceKeyboard / asrErrorsBeforeFallback - Edit's text capture (shared with §4-§5)
 * @input debugAutopilot  - Preview-only: once generation succeeds, tap Save automatically
 *
 * MUST NOT: own the screen state machine or build Memory Cards.
 */

import { FlowManager, TraceScreen } from "./FlowManager";
import {
  GeminiService,
  TraceError,
  TraceErrorKind,
  JournalGenInput,
  JournalMomentInput,
} from "./GeminiService";
import { JournalSession, KeptTrace } from "./JournalSession";
import { JournalEntry, JournalEntryData } from "./JournalEntry";
import { PanelKit, TitledPanel } from "./PanelKit";
import { ReflectionCapture } from "./ReflectionCapture";
import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button";
import * as UITheme from "./UITheme";

type GenPhase = "idle" | "generating" | "done" | "error";

/** §10 "Change Tone" cycle. "" = the default style (no note sent at all). */
const TONES: { label: string; hint: string }[] = [
  { label: "Default", hint: "" },
  { label: "Warmer", hint: "Write it warmer and more personal in tone." },
  { label: "Plainer", hint: "Write it plainer and more matter-of-fact, less flowery." },
  { label: "Reflective", hint: "Write it more quietly reflective and unhurried in tone." },
];

const SHORTER_HINT = "Make it noticeably shorter, around 40-55 words instead of 60-90.";

/** Client-side backstop for a hung generateJournal transport (RSG's own
 *  deadline is ~30 s and the call retries once). */
const GEN_WATCHDOG_SEC = 55;

/** §10 review actions are icon buttons (2026-09-05: "replace the text with
 *  icons"). requireAsset() needs a string LITERAL, so each icon is a fixed
 *  case — same pattern as FeelScreen's iconTexture(). */
function iconTexture(name: "arrow_back" | "refresh" | "edit" | "save"): Texture | null {
  switch (name) {
    case "arrow_back":
      return requireAsset("../Icons/arrow_back.png") as Texture;
    case "refresh":
      return requireAsset("../Icons/refresh.png") as Texture;
    case "edit":
      return requireAsset("../Icons/edit.png") as Texture;
    case "save":
      return requireAsset("../Icons/save.png") as Texture;
    default:
      return null;
  }
}

@component
export class GenerateScreen extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">GenerateScreen — compose + review the daily journal (§9-§10)</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("FlowManager — Save -> Orb (§11), Back -> Feel.")
  flowManager!: FlowManager;
  @input
  @hint("GeminiService — the only generateJournal() call this screen makes.")
  geminiService!: GeminiService;
  @input
  @hint("JournalSession — reads keptTraces() (filtered to includedInJournal) + getEntry(), writes title/generatedJournalText/finalReflection onto the entry.")
  journalSession!: JournalSession;
  @input
  @hint('Scene "Camera Object" — read once per fresh entry to spawn the panel in front of the user (mirrors ReviewScreen/FeelScreen). Optional; falls back to this screen root\'s authored position if unwired.')
  @allowUndefined
  cameraObject!: SceneObject;
  @ui.group_end

  @ui.group_start("Copy")
  @input loadingText: string = "Composing your day";
  @input errNetwork: string = "I couldn't compose your journal right now.";
  @input errGen: string = "Something went wrong writing this up.";
  @input errNoMoments: string = "No moments were selected — go back to Review Today.";
  @input saveLabel: string = "Save";
  @input reviseLabel: string = "Revise";
  @input backLabel: string = "Back";
  @input tryAgainLabel: string = "Try Again";
  @input editSubCaption: string = "Say or type the new version.";
  @ui.group_end

  @ui.group_start("Settings")
  @input
  @hint("Local Z of the Generate panel tree relative to this screen root (cm, negative = in front).")
  panelDistanceCm: number = -100;
  @input
  @hint("Edit's text capture — skip ASR entirely and use the AR keyboard (ASR is device-only).")
  forceKeyboard: boolean = false;
  @input
  @hint("Edit's text capture — after this many ASR errors/empty results, auto-switch to the keyboard.")
  asrErrorsBeforeFallback: number = 2;
  @ui.group_end

  @ui.group_start("Debug")
  @input
  @hint("Preview-only: once generation succeeds, tap Save automatically after a short delay. Leave OFF for real use.")
  debugAutopilot: boolean = false;
  @ui.group_end

  private ready = false;
  private panel: TitledPanel | null = null;
  private chooser: TitledPanel | null = null;
  private phase: GenPhase = "idle";
  private errorMsg = "";
  private ellipsisT = 0;
  private ellipsisActive = false;
  private autopilotStep = 0;

  // §10 style state — persists across Regenerate/Change Tone taps on the same entry.
  private toneIdx = 0;
  private shorterActive = false;

  // §10 "Edit the words" sub-view.
  private editing = false;
  private editCapture: ReflectionCapture | null = null;
  private editPhase: "prompt" | "captured" = "prompt";
  private editText = "";
  private editSpeakButton: Button | null = null;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      this.ready = true;
      this.spawnInFrontOfUser();
      this.rebuild();
    });
    this.createEvent("OnEnableEvent").bind(() => {
      if (!this.ready) return;
      this.spawnInFrontOfUser();
      this.rebuild();
    });
    this.createEvent("OnDisableEvent").bind(() => this.teardown());
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  private onUpdate(): void {
    if (!this.ellipsisActive || !this.panel) return;
    this.ellipsisT += getDeltaTime();
    const dots = 1 + (Math.floor(this.ellipsisT * 2) % 3);
    this.panel.setTitle(this.loadingText + " " + ".".repeat(dots));
  }

  /** Move this screen's root to the camera's current position + yaw once per
   *  fresh entry, so the panel lands in front of the user (mirrors
   *  ReviewScreen / FeelScreen). Not billboarded — it does not follow after. */
  private spawnInFrontOfUser(): void {
    if (isNull(this.cameraObject)) return;
    const camT = this.cameraObject.getTransform();
    this.sceneObject.getTransform().setWorldPosition(camT.getWorldPosition());
    // Face where the camera looks, flattened to the horizon — via quat.lookAt on
    // the view vector, NOT a yaw euler (whose decomposition flips 180° when the
    // head is pitched, which spawned these panels behind the user).
    let f = camT.forward; // camera-object local +Z ≈ points behind the view = our +Z
    let flat = new vec3(f.x, 0, f.z);
    if (flat.length < 1e-4) flat = new vec3(0, 0, 1);
    this.sceneObject.getTransform().setWorldRotation(quat.lookAt(flat.normalize(), vec3.up()));
  }

  // --- build / teardown ---------------------------------------------------

  private teardown(): void {
    this.ellipsisActive = false;
    this.closeChooser();
    this.endEdit();
    if (this.panel) {
      try {
        this.panel.destroy();
      } catch (e) {
        /* already gone with its parent */
      }
      this.panel = null;
    }
  }

  private rebuild(): void {
    if (isNull(this.flowManager) || isNull(this.geminiService) || isNull(this.journalSession)) {
      console.log("[Generate] ERROR: required @inputs not wired — screen inert");
      return;
    }
    this.closeChooser();

    // Only stand up while actually on the Generate screen (the root can be
    // briefly enabled at scene start before ScreenRouter's first apply()
    // disables it — same guard as the other screens).
    if (this.flowManager.current !== TraceScreen.Generate) return;

    const entry = this.journalSession.getEntry();
    if (this.phase === "idle" && entry.generatedJournalText) {
      // Re-entering with an already-generated journal — show it, don't re-ask
      // Gemini (e.g. the user went Back to Feel and came straight back).
      this.phase = "done";
    }

    if (this.phase === "idle") {
      this.phase = "generating";
      this.buildLoadingPanel();
      this.runGeneration();
      return;
    }
    if (this.phase === "generating") {
      this.buildLoadingPanel();
      return;
    }
    if (this.phase === "error") {
      this.endEdit();
      this.buildErrorPanel();
      return;
    }
    if (this.editing) {
      this.buildEditPanel();
      return;
    }
    this.buildDonePanel();
  }

  private buildLoadingPanel(): void {
    this.destroyPanel();
    this.panel = PanelKit.create(this.sceneObject, {
      name: "GenerateLoading",
      title: this.loadingText + "…",
      body: "",
      widthCm: 42,
      heightCm: 22,
      // Sit where the previous ("Create Today's Journal") window was — a touch
      // below the sight line — so it doesn't read as popping up too high
      // (2026-09-06).
      localPosition: new vec3(0, -6, this.panelDistanceCm),
      // Drop the (top-anchored) title to the panel's vertical centre — with no
      // body it otherwise hugs the top edge (2026-09-05: "'composing your
      // day...' is not in the center").
      contentDropCm: 6,
    });
    this.ellipsisT = 0;
    this.ellipsisActive = true;
  }

  private buildErrorPanel(): void {
    this.destroyPanel();
    const panel = PanelKit.create(this.sceneObject, {
      name: "GenerateError",
      title: this.errorMsg || this.errGen,
      body: "Tap Try Again, or go back to change what's included.",
      widthCm: 46,
      heightCm: 30,
      localPosition: new vec3(0, -6, this.panelDistanceCm),
      buttonsVertical: true,
    });
    panel.addButton(this.tryAgainLabel, () => {
      this.phase = "idle";
      this.rebuild();
    });
    panel.addButton(this.backLabel, () => this.goBack());
    this.panel = panel;
  }

  /**
   * Layout budget computed explicitly (header / paragraph / reflection /
   * footer bands, each a known Y range) rather than fixed fractions of a
   * guessed panel height — fixed fractions is what caused a real bug here
   * (2026-09-04): adding the 3rd button (Revise, for §10) shifted the button
   * stack up without anyone recomputing where `finalReflection` should sit,
   * so it landed directly on top of the Save button. Same mirrored math as
   * ConfirmScreen/ReviewScreen's per-trace grid, adapted to one tall column.
   */
  private buildDonePanel(): void {
    this.destroyPanel();
    const entry = this.journalSession.getEntry();
    const W = 56;

    // Mirrors PanelKit's own constants for budget purposes only (PanelKit
    // doesn't export them) — BUTTON_HEIGHT/GAP/PAD/title band cap.
    const BTN_SCALE = 0.82; // 2026-09-05: "scale down the btns below a bit"
    const BTN_H = 10 * BTN_SCALE;
    const BTN_GAP = 1.8;
    const PAD = 2.6;
    const titleBandH = 9;

    // 2026-09-05: the title / paragraph / reflection blocks were reading far
    // apart — pull them together (smaller header gap + tighter boxes).
    const headerH = titleBandH + PAD; // title band + top inset (no extra gap)
    // One horizontal row of 4 icon buttons (back / regenerate / edit / save).
    const footerH = BTN_H + PAD + BTN_GAP;
    // Grow the text band for a long entry — e.g. one that's had "Add to Today's
    // Journal" run on it (original + · · · + addition) — so the paragraph can't
    // spill onto the reflection / buttons (2026-09-06).
    const jLen = (entry.generatedJournalText || "").length;
    const paragraphH = jLen > 620 ? Math.min(52, 26 + Math.ceil((jLen - 620) / 120) * 5) : 26;
    const reflectionH = entry.finalReflection ? 9 : 0;
    const contentGap = entry.finalReflection ? 1.5 : 0;

    const H = headerH + paragraphH + contentGap + reflectionH + footerH + 3;
    // Scale a tall (appended) panel down to fit, then anchor its TOP edge just
    // above the sight line — same as the loading ("Composing your day…") window
    // and the Review / Feel screens — instead of centring it (2026-09-06: "the
    // generated journal window is too high").
    const s = H > 60 ? 60 / H : 1;
    const HEADER_TOP_CM = 9;
    const panelY = HEADER_TOP_CM - (H / 2) * s;

    const panel = PanelKit.create(this.sceneObject, {
      name: "GenerateResult",
      title: entry.title || "Today",
      body: "",
      widthCm: W,
      heightCm: H,
      localPosition: new vec3(0, panelY, this.panelDistanceCm),
      buttonScale: BTN_SCALE,
    });
    if (s < 1) {
      panel.root.getTransform().setLocalScale(new vec3(s, s, s));
    }

    const topY = H / 2;
    const paragraphCenterY = topY - headerH - paragraphH / 2;
    this.addFreeText(panel, "Paragraph", entry.generatedJournalText, 70, W - 8, paragraphH, paragraphCenterY, new vec4(1, 1, 1, 1));

    if (entry.finalReflection) {
      const reflectionCenterY = paragraphCenterY - paragraphH / 2 - contentGap - reflectionH / 2;
      this.addFreeText(panel, "FinalReflection", "— " + entry.finalReflection, 60, W - 8, reflectionH, reflectionCenterY, new vec4(0.85, 0.9, 1, 1));
    }

    // Icon buttons, left -> right: back (arrow) / regenerate (circular arrow) /
    // edit (pen) / save (2026-09-05). Empty labels — decorateIcon centres a
    // Material icon on each.
    this.decorateIcon(panel.addButton("", () => this.goBack()).getSceneObject(), "arrow_back");
    this.decorateIcon(panel.addButton("", () => this.regenerate()).getSceneObject(), "refresh");
    this.decorateIcon(panel.addButton("", () => this.beginEdit()).getSceneObject(), "edit");
    this.decorateIcon(panel.addButton("", () => this.save()).getSceneObject(), "save");

    this.panel = panel;
    console.log(`[Generate] showing result — title="${entry.title}" paragraph words≈${this.wordCount(entry.generatedJournalText)} panelH=${H.toFixed(1)}`);
  }

  /** Centres a Material icon on a button, replacing its (empty) text label —
   *  mirrors MomentEmotionReflect.decorateIcon / FeelScreen's icon pattern. */
  private decorateIcon(btnSO: SceneObject, icon: "arrow_back" | "refresh" | "edit" | "save"): void {
    if (isNull(btnSO)) return;
    try {
      const tex = iconTexture(icon);
      if (!tex) return;
      const o = global.scene.createSceneObject("Icon_" + icon);
      o.setParent(btnSO);
      o.getTransform().setLocalPosition(new vec3(0, 0, 0.5));
      o.getTransform().setLocalScale(new vec3(5, 5, 1));
      const img = o.createComponent("Component.Image") as Image;
      const mat = (requireAsset("../Materials/ImageMaterial.mat") as Material).clone();
      img.clearMaterials();
      img.addMaterial(mat);
      (img.mainPass as any).baseTex = tex;
      (img.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
    } catch (e) {
      console.log(`[Generate] icon build failed for "${icon}": ` + e);
    }
  }

  private destroyPanel(): void {
    // Bug fixed 2026-09-04: this used to only live in teardown() (the
    // OnDisableEvent handler), so leaving "generating" for ANY other phase
    // left `ellipsisActive` true — onUpdate() then kept calling
    // `this.panel.setTitle(loadingText + "...")` on whatever panel replaced
    // it every frame, stomping the done/error panel's real title forever.
    this.ellipsisActive = false;
    if (this.panel) {
      try {
        this.panel.destroy();
      } catch (e) {
        /* ignore */
      }
      this.panel = null;
    }
  }

  /**
   * A free-form wrapped text block in the panel's content gap (not routed
   * through PanelKit's title/body bands — a 60-90 word paragraph needs far
   * more room than those budget for). Deliberately NOT `sizeToFit` +
   * `VerticalOverflow.Shrink` — that combo is PanelKit's own technique for
   * short one/two-line labels, but empirically renders BLANK on a long
   * multi-line paragraph (confirmed 2026-09-04: the Text component held the
   * correct string/properties but nothing drew — a shrink-to-fit edge case
   * on many wrapped lines, not something this codebase can fix upstream).
   * `sizeCap` here is a plain fixed size chosen to comfortably fit within
   * `heightCm` at 60-90 words, not a ceiling — Wrap handles the width,
   * `Overflow` (not Shrink) lets it run past the box only if the text is
   * unexpectedly long rather than risk blanking again.
   */
  private addFreeText(
    panel: TitledPanel,
    name: string,
    text: string,
    sizeCap: number,
    widthCm: number,
    heightCm: number,
    localY: number,
    color: vec4
  ): void {
    const o = global.scene.createSceneObject(name);
    o.setParent(panel.contentAnchor);
    o.getTransform().setLocalPosition(new vec3(0, localY, 0.15));
    const t = o.createComponent("Component.Text") as Text;
    t.text = text;
    t.size = sizeCap;
    t.depthTest = true;
    UITheme.applyParagraphFont(t); // journal paragraph + reflection = prose
    try {
      t.textFill.color = color;
      t.outlineSettings.enabled = UITheme.getTextOutlineEnabled();
      t.outlineSettings.fill.color = UITheme.getTextOutlineColor();
      t.outlineSettings.size = UITheme.getTextOutlineWidth();
      t.horizontalOverflow = HorizontalOverflow.Wrap;
      t.verticalOverflow = VerticalOverflow.Overflow;
      t.layoutRect = Rect.create(-widthCm / 2, widthCm / 2, -heightCm / 2, heightCm / 2);
    } catch (e) {
      /* older Text API — renders at `size`, unwrapped */
    }
  }

  private wordCount(s: string): number {
    return (s || "").trim().split(/\s+/).filter((w) => w.length > 0).length;
  }

  // --- §10 revise chooser -------------------------------------------------
  // 2026-09-05: the multi-option "Revise" chooser is gone — the done panel's
  // icon row exposes Regenerate and Edit directly. closeChooser() stays (a
  // no-op unless something else ever repopulates this.chooser) so teardown()
  // / rebuild() don't need a special case.

  private closeChooser(): void {
    if (!this.chooser) return;
    try {
      this.chooser.destroy();
    } catch (e) {
      /* already gone with its parent */
    }
    this.chooser = null;
  }

  private currentStyleHint(): string {
    const parts: string[] = [];
    const tone = TONES[this.toneIdx];
    if (tone.hint) parts.push(tone.hint);
    if (this.shorterActive) parts.push(SHORTER_HINT);
    return parts.join(" ");
  }

  private regenerate(): void {
    console.log(`[Generate] Regenerate — tone="${TONES[this.toneIdx].label}" shorter=${this.shorterActive}`);
    this.phase = "generating";
    this.buildLoadingPanel();
    // Regenerate is an explicit "redo the whole thing" — in append mode it folds
    // the already-saved day's moments in and writes ONE unified journal that
    // REPLACES the old text (2026-09-06: "generate a new journal combining both
    // captures, the old one gone"). The first auto-generation after "Add to
    // Today's Journal" still keeps the earlier entry + appends (see runGeneration).
    this.runGeneration(true);
  }

  // --- §10 "Edit the words" (verbatim, no Gemini — shared ReflectionCapture) ---

  private beginEdit(): void {
    this.editing = true;
    this.editPhase = "prompt";
    this.editText = "";
    this.editCapture = new ReflectionCapture(
      { forceKeyboard: this.forceKeyboard, asrErrorsBeforeFallback: this.asrErrorsBeforeFallback },
      {
        onPartial: (t) => {
          if (this.panel && this.editPhase === "prompt") this.panel.setBody(t.length ? t : this.editSubCaption);
        },
        onFinal: (t) => {
          this.editText = t;
          this.editPhase = "captured";
          this.buildEditPanel();
        },
        onStatus: (m) => {
          if (this.panel) this.panel.setBody(m);
        },
        onKeyboardMode: () => {
          if (this.editPhase === "prompt") this.buildEditPanel();
        },
      }
    );
    this.buildEditPanel();
  }

  private endEdit(): void {
    if (this.editCapture) {
      this.editCapture.dispose();
      this.editCapture = null;
    }
    this.editSpeakButton = null;
    this.editing = false;
  }

  private buildEditPanel(): void {
    this.destroyPanel();
    const entry = this.journalSession.getEntry();

    if (this.editPhase === "captured") {
      const shown = this.editText.trim().length > 0 ? this.editText.trim() : "(nothing captured)";
      const panel = PanelKit.create(this.sceneObject, {
        name: "GenerateEditCaptured",
        title: "New version",
        body: shown,
        widthCm: 50,
        // Taller + smaller buttons so the title / captured text / vertical
        // button stack stop overlapping (2026-09-06), sat below the sight line.
        heightCm: 56,
        localPosition: new vec3(0, -6, this.panelDistanceCm),
        buttonsVertical: true,
        buttonScale: 0.82,
      });
      panel.addButton("Confirm", () => {
        const t = this.editText.trim();
        if (t) {
          entry.generatedJournalText = t;
          console.log(`[Generate] Edit confirmed — ${this.wordCount(t)} word(s), verbatim (no Gemini)`);
        }
        this.endEdit();
        this.rebuild();
      });
      panel.addButton("Try Again", () => {
        this.editText = "";
        this.editPhase = "prompt";
        if (this.editCapture) this.editCapture.reset();
        this.buildEditPanel();
      });
      panel.addButton("Cancel", () => {
        this.endEdit();
        this.rebuild();
      });
      this.panel = panel;
      return;
    }

    const panel = PanelKit.create(this.sceneObject, {
      name: "GenerateEdit",
      title: "Edit the words",
      body: this.editSubCaption,
      widthCm: 50,
      // Taller + smaller buttons so the title / sub-caption / vertical button
      // stack stop overlapping (2026-09-06), sat below the sight line.
      heightCm: 54,
      localPosition: new vec3(0, -6, this.panelDistanceCm),
      buttonsVertical: true,
      buttonScale: 0.82,
    });
    this.panel = panel;

    if (this.editCapture && this.editCapture.usingKeyboard) {
      panel.addButton("Type", () => this.editCapture!.openKeyboard());
    } else if (this.editCapture) {
      this.editSpeakButton = panel.addButton("Hold to Speak", () => this.editCapture!.stopListening());
      this.editSpeakButton.onTriggerDown.add(() => this.editCapture!.startListening());
      panel.addButton("Type instead", () => {
        this.editCapture!.usingKeyboard = true;
        this.editCapture!.openKeyboard();
      });
    }
    panel.addButton("Cancel", () => {
      this.endEdit();
      this.rebuild();
    });
    console.log(`[Generate] edit panel (prompt) built — current text was ${this.wordCount(entry.generatedJournalText)} word(s)`);
  }

  // --- generation ---------------------------------------------------------

  /** ONLY the moments selected at Review Today (§7) — never the full kept list. */
  private selectedTraces(): KeptTrace[] {
    return this.journalSession.keptTraces().filter((t) => t.includedInJournal);
  }

  /** Confirmed OCR fragments win over the raw OCR blob when present. */
  private toMomentInput(t: KeptTrace): JournalMomentInput {
    return {
      label: t.label,
      ocrText: t.confirmedOcr && t.confirmedOcr.length > 0 ? t.confirmedOcr.join(" ") : t.ocrText,
      emotion: t.emotion || "",
      reflection: t.reflection || "",
    };
  }

  /**
   * Best-effort moment inputs for the ALREADY-SAVED part of the day. The raw
   * KeptTraces (images, per-moment emotion/reflection) are long gone once a day
   * is persisted — all that survives on `JournalEntryData` is the object
   * labels, the kept OCR fragments and the prose itself. We hand Gemini those
   * plus the earlier paragraph as context so a unify-regenerate can weave the
   * new moment(s) into one coherent entry rather than tacking them on.
   */
  private reconstructBaseMoments(base: JournalEntryData): JournalMomentInput[] {
    const out: JournalMomentInput[] = [];
    const labels = (base.objectLabels || []).filter((s) => !!s && s.trim().length > 0);
    const ocr = (base.keptOcrText || []).filter((s) => !!s && s.trim().length > 0);
    if (labels.length > 0 || ocr.length > 0) {
      out.push({
        label: labels.join(", ") || "earlier moments today",
        ocrText: ocr.join("  •  "),
        emotion: base.feeling || "",
        reflection: "",
      });
    }
    const priorProse = (base.generatedJournalText || "").trim();
    if (priorProse) {
      out.push({
        label: "the journal entry written earlier today",
        ocrText: priorProse,
        emotion: "",
        reflection: (base.finalReflection || "").trim(),
      });
    }
    return out;
  }

  /**
   * Fold the new moments' evidence into the entry alongside the saved day's, so
   * whatever we persist next carries the whole day. Recomputed from the stable
   * `base` (store) + `traces` (this session) every call — never by mutating the
   * entry's own arrays, so repeated Regenerates don't keep growing them.
   */
  private mergeAppendEvidence(
    entry: JournalEntry,
    base: JournalEntryData,
    traces: KeptTrace[],
    newIds: number[]
  ): void {
    const newLabels = traces.map((t) => t.label).filter((l) => !!l && l.trim().length > 0);
    const newOcr = traces
      .map((t) => (t.confirmedOcr && t.confirmedOcr.length > 0 ? t.confirmedOcr.join(" ") : t.ocrText))
      .filter((s) => !!s && s.trim().length > 0);
    const seen: { [k: string]: boolean } = {};
    entry.objectLabels = (base.objectLabels || [])
      .concat(newLabels)
      .filter((l) => l && !seen[l] && (seen[l] = true));
    entry.keptOcrText = (base.keptOcrText || []).concat(newOcr);
    entry.selectedMomentIds = (base.selectedMomentIds || []).concat(newIds);
  }

  /**
   * @param unifyAppend  append mode only: when true, fold the ALREADY-SAVED
   *   day's moments in with the new ones and write ONE unified journal that
   *   replaces the old text. When false (the auto-fire on screen entry), keep
   *   the earlier journal verbatim and join the new moment(s) on as a
   *   continuation. Ignored when not appending.
   */
  private runGeneration(unifyAppend: boolean = false): void {
    const traces = this.selectedTraces();
    if (traces.length === 0) {
      console.log("[Generate] no included moments — nothing to generate");
      this.errorMsg = this.errNoMoments;
      this.phase = "error";
      this.rebuild();
      return;
    }
    const newMoments = traces.map((t) => this.toMomentInput(t));

    const entry = this.journalSession.getEntry();
    const newIds = traces.map((t) => t.order);
    entry.selectedMomentIds = newIds;

    const appendBase = this.journalSession.isAppending()
      ? this.journalSession.getAppendBase()
      : null;
    // On a unify-regenerate, hand Gemini the whole day (saved moments + new
    // ones) so it composes a single coherent entry, not new-only.
    const moments =
      appendBase && unifyAppend
        ? this.reconstructBaseMoments(appendBase).concat(newMoments)
        : newMoments;

    const styleHint = this.currentStyleHint();
    const payload: JournalGenInput = {
      moments,
      confirmedLocation: entry.confirmedLocation,
      date: entry.date,
      dayFeeling: entry.feeling,
      styleHint,
    };

    const t0 = getTime();
    console.log(
      `[Generate] generateJournal start — ${moments.length} moment(s), dayFeeling="${entry.feeling}"` +
        (styleHint ? ` styleHint="${styleHint}"` : "")
    );

    // Watchdog: RSG has a ~30 s deadline and generateJournal retries once, so a
    // real call settles well inside this. If the promise never settles (a hung
    // transport), fall to the error panel instead of trapping the user on the
    // loading spinner forever (§14 fallback).
    let settled = false;
    const watchdog = this.createEvent("DelayedCallbackEvent");
    watchdog.bind(() => {
      if (settled || this.phase !== "generating") return;
      console.log(`[Generate] generateJournal watchdog fired after ${GEN_WATCHDOG_SEC}s — no response`);
      this.errorMsg = this.errNetwork;
      this.phase = "error";
      this.rebuild();
    });
    watchdog.reset(GEN_WATCHDOG_SEC);

    this.geminiService
      .generateJournal(payload)
      .then((result) => {
        settled = true;
        if (this.phase !== "generating") return; // watchdog already showed the error / user left
        console.log(
          `[Generate] generateJournal OK in ${(getTime() - t0).toFixed(2)}s :: title="${result.title}"`
        );
        const base = appendBase;
        if (base && unifyAppend) {
          // Regenerate in append mode — ONE unified journal for the whole day
          // (saved moments + new ones), REPLACING the old text entirely
          // (2026-09-06: "the old one gone").
          entry.title = result.title || base.title || "";
          entry.generatedJournalText = result.paragraph;
          entry.finalReflection = result.finalReflection || base.finalReflection || "";
          this.mergeAppendEvidence(entry, base, traces, newIds);
        } else if (base) {
          // First auto-generation after "Add to Today's Journal" — keep the
          // ORIGINAL journal verbatim and join the new moment(s) on as a
          // continuation. Built from the saved base each time, so a Regenerate
          // (which takes the unify branch above) cleanly replaces this.
          entry.title = base.title || result.title;
          const prior = (base.generatedJournalText || "").trim();
          entry.generatedJournalText = prior
            ? `${prior}\n\n·  ·  ·\n\n${result.paragraph.trim()}`
            : result.paragraph;
          entry.finalReflection = result.finalReflection || base.finalReflection || "";
          this.mergeAppendEvidence(entry, base, traces, newIds);
        } else {
          entry.title = result.title;
          entry.generatedJournalText = result.paragraph;
          entry.finalReflection = result.finalReflection;
        }
        this.phase = "done";
        this.journalSession.logContents();
        this.rebuild();
        this.maybeAutopilotContinue();
      })
      .catch((e) => {
        settled = true;
        if (this.phase !== "generating") return;
        const kind = e instanceof TraceError ? e.kind : TraceErrorKind.NetworkFail;
        console.log(`[Generate] generateJournal FAILED in ${(getTime() - t0).toFixed(2)}s :: ${kind} :: ${e}`);
        this.errorMsg = kind === TraceErrorKind.NetworkFail ? this.errNetwork : this.errGen;
        this.phase = "error";
        this.rebuild();
      });
  }

  // --- actions --------------------------------------------------------

  private goBack(): void {
    console.log("[Generate] Back -> Feel");
    this.flowManager.goTo(TraceScreen.Feel);
  }

  /** §10 Save -> §11 (Orb: fold into a coloured sphere, Keep Private / Place in Space). */
  private save(): void {
    console.log("[Generate] Save -> Orb");
    this.flowManager.goTo(TraceScreen.Orb);
  }

  // --- debug autopilot (Preview verification without hand taps) ------

  /** Called after EVERY successful generation (initial + any regenerate).
   *  Step 0 -> 1: exercise §10's Make Shorter (real regenerate with a
   *  styleHint) before saving, so autopilot verifies more than the bare
   *  happy path. Step 1 -> done: Save -> Orb. */
  private maybeAutopilotContinue(): void {
    if (!this.debugAutopilot) return;
    if (this.autopilotStep === 0) {
      this.autopilotStep = 1;
      this.delay(1.2, () => {
        console.log("[Generate][Autopilot] step 1: Make Shorter -> regenerate");
        this.shorterActive = true;
        this.regenerate();
      });
      return;
    }
    if (this.autopilotStep === 1) {
      this.autopilotStep = 2;
      this.delay(1.2, () => {
        console.log("[Generate][Autopilot] step 2: Save -> Orb");
        this.save();
      });
    }
  }

  private delay(sec: number, fn: () => void): void {
    const e = this.createEvent("DelayedCallbackEvent");
    e.bind(() => fn());
    e.reset(sec);
  }
}
