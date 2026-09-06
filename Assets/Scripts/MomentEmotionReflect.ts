/**
 * MomentEmotionReflect.ts — the per-MOMENT sub-flow that runs immediately after
 * the user taps **Keep** on an object card (DESIGN.md v2 §4 → §5 → §6).
 *
 * FLOW (all transient head-locked PanelKit panels, ONE visible at a time):
 *   1. §4  "What feeling sits with you here?" — single-select from 10 emotions laid
 *          out as a 5×2 emoji grid (2026-09-05; each button is JUST the emoji —
 *          no text, no swatch; the colour still travels via
 *          setMomentEmotion). Writes JournalSession.setMomentEmotion(order,…).
 *   2. §5  one emotion-specific reflective question ("A few words are enough.")
 *          answered by voice (ASR, device-only) or the AR keyboard
 *          (Preview-testable). Confirm → JournalSession.setMomentReflection;
 *          Try Again → re-capture; Skip → reflection stays "".
 *   3. §6  "Moment saved for today." — Capture Another (→ Scan) / Finish for Now
 *          (→ Home/Launch) / Create Today's Journal (→ Review + logContents()).
 *
 * This REPLACES the old "Your traces" action panel that MemoryCardSpawner used
 * to show after the first Keep — MemoryCardSpawner now just calls
 * `momentFlow.begin(order)` from its Keep handler.
 *
 * The panels live under a scaled content root parented to the Camera Object so
 * they stay in front of the user. The reflective-question capture reuses the
 * shared `ReflectionCapture` helper (same ASR + AR-keyboard code as
 * ReflectScreen) — no duplicated transcription plumbing.
 *
 * @input flowManager   - Capture Another / Finish / Create Journal transitions
 * @input journalSession - setMomentEmotion / setMomentReflection on the kept moment
 * @input cameraObject   - panels are parented here (head-locked)
 * @input panelYCm / panelDistanceCm / contentScale - placement of the panel root
 * @input forceKeyboard / asrErrorsBeforeFallback - reflective-question capture
 * @input subCaption     - the "A few words are enough." line (copy)
 * @input debugAutopilot / debugReflectionText - Preview-only self-drive
 *
 * MUST NOT: call Gemini, own the screen state machine, or hold journal data.
 */

import { todaysSavedEntry } from "./DayStore";
import { FlowManager, TraceScreen } from "./FlowManager";
import { JournalSession, KeptTrace } from "./JournalSession";
import { PanelKit, TitledPanel } from "./PanelKit";
import { makePolygonCutout, ThumbOutline } from "./TraceGizmos";

const KEPT_THUMB_OUTLINE: ThumbOutline = { color: new vec4(1, 1, 1, 1), widthCm: 0.6 };
import { ReflectionCapture } from "./ReflectionCapture";
import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button";

interface EmotionDef {
  id: string;
  label: string;
  /** Single-emoji stand-in for the text label on the emotion-pick button
   *  (2026-09-05: "pick a feeling right now", one emoji per emotion). */
  emoji: string;
  hex: string;
  /** DESIGN.md §5 table — the question shown once this emotion is chosen. */
  question: string;
}

/** 10 emotions — laid out as a 5×2 emoji grid (2026-09-05). The first 4 are
 *  §4's core set; the rest round it out to a full two rows. */
const EMOTIONS: EmotionDef[] = [
  { id: "happy", label: "Happy", emoji: "😊", hex: "#F2C94C", question: "What made this moment feel good?" },
  { id: "peaceful", label: "Peaceful", emoji: "😌", hex: "#5B8DEF", question: "What would you like to remember about this feeling?" },
  { id: "difficult", label: "Difficult", emoji: "😔", hex: "#9B59B6", question: "What do you need right now?" },
  { id: "surprising", label: "Surprising", emoji: "😲", hex: "#E67E22", question: "What was unexpected about this moment?" },
  { id: "nostalgic", label: "Nostalgic", emoji: "💭", hex: "#C98BD9", question: "What memory does this bring back?" },
  { id: "excited", label: "Excited", emoji: "🤩", hex: "#F2994A", question: "What are you looking forward to?" },
  { id: "grateful", label: "Grateful", emoji: "🙏", hex: "#27AE60", question: "What are you thankful for here?" },
  { id: "tired", label: "Tired", emoji: "😴", hex: "#7F8C8D", question: "What would help you rest?" },
  { id: "proud", label: "Proud", emoji: "💪", hex: "#2D9CDB", question: "What did you do well?" },
  { id: "unsure", label: "Unsure", emoji: "🤔", hex: "#9AA0A6", question: "What's on your mind about this?" },
];

/** requireAsset() needs a string LITERAL (build-time dependency), so each icon
 *  is a fixed case, same pattern as FeelScreen's iconTexture(). */
function iconTexture(name: "mic" | "keyboard"): Texture | null {
  switch (name) {
    case "mic":
      return requireAsset("../Icons/mic.png") as Texture;
    case "keyboard":
      return requireAsset("../Icons/keyboard.png") as Texture;
    default:
      return null;
  }
}

type QPhase = "prompt" | "captured";

@component
export class MomentEmotionReflect extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MomentEmotionReflect — per-moment emotion + question (§4-§6)</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("FlowManager — Capture Another → Scan, Finish for Now → Launch, Create Today's Journal → Review.")
  flowManager!: FlowManager;
  @input
  @hint("JournalSession — setMomentEmotion(order,…) / setMomentReflection(order,…) on the just-kept moment.")
  journalSession!: JournalSession;
  @input
  @hint('Scene "Camera Object" — the sub-flow panels are parented here so they stay head-locked.')
  cameraObject!: SceneObject;
  @ui.group_end

  @ui.group_start("Settings")
  @input
  @hint("Local Y of the panel root relative to the camera (cm, negative = below eye line).")
  panelYCm: number = -4;
  @input
  @hint("Local Z of the panel root relative to the camera (cm, negative = in front).")
  panelDistanceCm: number = -95;
  @input
  @hint("Uniform scale of the panel root — the 7-row emotion panel is tall, so it is shrunk to fit.")
  contentScale: number = 0.48;
  @input
  @hint("The sub-caption under the reflective question (DESIGN.md §5).")
  subCaption: string = "A few words are enough.";
  @input
  @hint("Skip ASR and use the AR keyboard directly. ASR is device-only, so this is the Preview-testable path.")
  forceKeyboard: boolean = false;
  @input
  @hint("After this many ASR errors / empty results, auto-switch to the keyboard fallback.")
  asrErrorsBeforeFallback: number = 2;
  @ui.group_end

  @ui.group_start("Debug")
  @input
  @hint("Preview-only: once begin() runs, auto pick Peaceful → type an answer → Confirm → land on 'Moment saved'. Leave OFF for real use.")
  debugAutopilot: boolean = false;
  @input
  @hint("The text the autopilot 'types' as the moment reflection.")
  debugReflectionText: string = "The street was quiet and the air smelled like rain.";
  @ui.group_end

  private ready = false;
  private activeOrder = -1;
  private root: SceneObject | null = null;
  private panel: TitledPanel | null = null;

  private emotion: EmotionDef | null = null;
  private qPhase: QPhase = "prompt";
  private reflectionText = "";
  private capture: ReflectionCapture | null = null;
  private speakButton: Button | null = null;
  private autopilotRan = false;

  // Each panel this sub-flow builds pops in smoothly (2026-09-05) instead of
  // snapping to full size — same tween-array + onUpdate idiom used across
  // this project (MemoryCardSpawner/OrbScreen), driven by PanelKit.popInTween.
  private tweens: { obj: SceneObject; t0: number; dur: number; step: (eased: number) => void }[] = [];

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      this.ready = true;
      if (isNull(this.flowManager) || isNull(this.journalSession) || isNull(this.cameraObject)) {
        console.log("[MomentFlow] ERROR: flowManager / journalSession / cameraObject not wired — sub-flow inert");
        return;
      }
      // Any screen change ends the sub-flow — its panels only make sense on Card.
      this.flowManager.onScreenChanged.add(() => {
        if (this.activeOrder >= 0) this.end();
      });
    });
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
    this.createEvent("OnDisableEvent").bind(() => this.end());
  }

  // --- public entry ---------------------------------------------------

  /** Called by MemoryCardSpawner right after JournalSession.keep() on a card. */
  begin(order: number): void {
    if (!this.ready || isNull(this.flowManager) || isNull(this.journalSession) || isNull(this.cameraObject)) {
      console.log("[MomentFlow] begin() ignored — not ready / not wired");
      return;
    }
    console.log(`[MomentFlow] begin(order=${order}) → emotion pick`);
    this.end();
    this.activeOrder = order;
    this.emotion = null;
    this.qPhase = "prompt";
    this.reflectionText = "";
    this.capture = new ReflectionCapture(
      { forceKeyboard: this.forceKeyboard, asrErrorsBeforeFallback: this.asrErrorsBeforeFallback },
      {
        onPartial: (t) => {
          if (this.panel && this.qPhase === "prompt") this.panel.setBody(t.length ? t : this.subCaption);
        },
        onFinal: (t) => {
          this.reflectionText = t;
          this.qPhase = "captured";
          this.buildQuestionPanel();
        },
        onStatus: (m) => {
          if (this.panel) this.panel.setBody(m);
        },
        onKeyboardMode: () => {
          if (this.qPhase === "prompt") this.buildQuestionPanel();
        },
      }
    );

    const r = global.scene.createSceneObject("MomentFlowRoot");
    r.setParent(this.cameraObject);
    r.getTransform().setLocalPosition(new vec3(0, this.panelYCm, this.panelDistanceCm));
    const s = this.contentScale;
    r.getTransform().setLocalScale(new vec3(s, s, s));
    this.root = r;

    this.buildEmotionPanel();
    this.maybeAutopilot();
  }

  /** Tear down every panel + the root. Safe to call repeatedly. */
  end(): void {
    if (this.capture) {
      this.capture.dispose();
      this.capture = null;
    }
    this.speakButton = null;
    this.clearPanel();
    if (this.root && !isNull(this.root)) {
      try {
        this.root.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    this.root = null;
    this.activeOrder = -1;
    this.tweens = [];
  }

  private clearPanel(): void {
    if (this.panel) {
      try {
        this.panel.destroy();
      } catch (e) {
        /* already gone with the root */
      }
      this.panel = null;
    }
  }

  private onUpdate(): void {
    if (this.tweens.length === 0) return;
    const now = getTime();
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      if (isNull(tw.obj)) {
        this.tweens.splice(i, 1);
        continue;
      }
      const k = (now - tw.t0) / tw.dur;
      const c = Math.max(0, Math.min(1, k));
      tw.step(1 - Math.pow(1 - c, 3)); // ease-out cubic, same curve as the rest of this project
      if (k >= 1) this.tweens.splice(i, 1);
    }
  }

  /** Every panel this sub-flow builds pops in smoothly instead of snapping to
   *  full size — call right after PanelKit.create(). */
  private popIn(p: TitledPanel): void {
    this.tweens.push(PanelKit.popInTween(p.root));
  }

  // --- §4 emotion pick ---------------------------------------------

  private buildEmotionPanel(): void {
    if (!this.root || isNull(this.root)) return;
    this.clearPanel();

    const panel = PanelKit.create(this.root, {
      name: "MomentEmotion",
      // Gentle, unhurried phrasing (2026-09-05) — this app guides softly, it
      // doesn't instruct. (was "Pick a feeling right now.")
      title: "What feeling sits with you here?",
      body: "",
      widthCm: 54,
      heightCm: 44,
      localPosition: new vec3(0, 0, 0),
      buttonGridCols: 5, // 10 emoji -> 5 across, 2 rows (2026-09-05)
      // No button frame / gradient fill — just the bare emoji glyph, still a
      // full-slot tap target (2026-09-05: "only display emoji itself").
      buttonsFrameless: true,
      contentDropCm: 5, // drop the title toward centre (2026-09-05)
    });
    this.panel = panel;
    this.popIn(panel);

    for (const e of EMOTIONS) {
      // Emoji only (2026-09-05) — no text label, no colour swatch, no frame.
      // The emotion's colour still travels via setMomentEmotion(id, hex) to
      // the Review/Orb screens; it's just not shown on this button any more.
      panel.addButton(e.emoji, () => this.chooseEmotion(e));
    }
    console.log(`[MomentFlow] emotion panel built (${EMOTIONS.length} options, 5x2 grid, frameless)`);
  }

  private chooseEmotion(e: EmotionDef): void {
    this.emotion = e;
    this.journalSession.setMomentEmotion(this.activeOrder, e.id, e.hex);
    console.log(`[MomentFlow] emotion="${e.id}" → question`);
    this.qPhase = "prompt";
    this.reflectionText = "";
    if (this.capture) this.capture.reset();
    this.buildQuestionPanel();
  }

  // --- §5 emotion-specific question ------------------------------

  private buildQuestionPanel(): void {
    if (!this.root || isNull(this.root) || !this.emotion) return;
    this.clearPanel();
    this.speakButton = null;

    if (this.qPhase === "captured") {
      const shown = this.reflectionText.trim().length > 0 ? this.reflectionText.trim() : "(nothing captured)";
      const panel = PanelKit.create(this.root, {
        name: "MomentQuestionCaptured",
        title: this.emotion.question,
        body: shown,
        widthCm: 46,
        heightCm: 44,
        localPosition: new vec3(0, 0, 0),
        buttonsVertical: false, // 2026-09-05: horizontal, just Back / Confirm
      });
      this.panel = panel;
      this.popIn(panel);
      panel.addButton("Back", () => this.tryAgain());
      panel.addButton("Confirm", () => this.confirmReflection());
      console.log("[MomentFlow] question panel (captured) built");
      return;
    }

    // Horizontal row (2026-09-05): Hold to Speak / Type instead are icon-only
    // (mic / keyboard) — Skip stays a text button. heightCm 46 -> 38 (same
    // day): with only a title + one caption line above them, the buttons sat
    // ~12cm below the text — a shorter panel brings the (bottom-anchored)
    // button row up closer without moving the (top-anchored) text at all.
    const panel = PanelKit.create(this.root, {
      name: "MomentQuestion",
      title: this.emotion.question,
      body: this.subCaption,
      widthCm: 46,
      heightCm: 38,
      localPosition: new vec3(0, 0, 0),
      buttonsVertical: false,
    });
    this.panel = panel;
    this.popIn(panel);

    if (this.capture && this.capture.usingKeyboard) {
      this.decorateIcon(panel.addButton("", () => this.capture!.openKeyboard()).getSceneObject(), "keyboard");
    } else if (this.capture) {
      this.speakButton = panel.addButton("", () => this.capture!.stopListening());
      this.speakButton.onTriggerDown.add(() => this.capture!.startListening());
      this.decorateIcon(this.speakButton.getSceneObject(), "mic");
      const typeBtn = panel.addButton("", () => {
        this.capture!.usingKeyboard = true;
        this.capture!.openKeyboard();
      });
      this.decorateIcon(typeBtn.getSceneObject(), "keyboard");
    }
    panel.addButton("Skip", () => this.skipReflection());
    console.log(`[MomentFlow] question panel (prompt) built — "${this.emotion.question}"`);
  }

  /** Centers a Material icon on a button, replacing its (empty) text label —
   *  used for Hold to Speak (mic) / Type instead (keyboard). Mirrors
   *  FeelScreen's icon pattern; falls back to the empty label silently if the
   *  icon fails to load. */
  private decorateIcon(btnSO: SceneObject, icon: "mic" | "keyboard"): void {
    if (isNull(btnSO)) return;
    try {
      const tex = iconTexture(icon);
      if (!tex) return;
      const o = global.scene.createSceneObject("Icon_" + icon);
      o.setParent(btnSO);
      o.getTransform().setLocalPosition(new vec3(0, 0, 0.15));
      o.getTransform().setLocalScale(new vec3(5.5, 5.5, 1));
      const img = o.createComponent("Component.Image") as Image;
      const mat = (requireAsset("../Materials/ImageMaterial.mat") as Material).clone();
      img.clearMaterials();
      img.addMaterial(mat);
      (img.mainPass as any).baseTex = tex;
      (img.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
    } catch (e) {
      console.log(`[MomentFlow] icon build failed for "${icon}": ` + e);
    }
  }

  private tryAgain(): void {
    console.log("[MomentFlow] Try Again — clear + re-capture");
    this.reflectionText = "";
    this.qPhase = "prompt";
    if (this.capture) this.capture.reset();
    this.buildQuestionPanel();
    if (this.capture && this.capture.usingKeyboard) this.capture.openKeyboard();
    else if (this.panel) this.panel.setBody("Hold to Speak and talk again.");
  }

  private confirmReflection(): void {
    const r = this.reflectionText.trim();
    this.journalSession.setMomentReflection(this.activeOrder, r);
    console.log(`[MomentFlow] Confirm → reflection="${r}" → moment saved`);
    this.buildSavedPanel();
  }

  private skipReflection(): void {
    this.journalSession.setMomentReflection(this.activeOrder, "");
    console.log('[MomentFlow] Skip → reflection="" → moment saved');
    this.buildSavedPanel();
  }

  // --- §6 moment saved -----------------------------------------

  private buildSavedPanel(): void {
    if (!this.root || isNull(this.root)) return;
    this.clearPanel();
    if (this.capture) {
      this.capture.dispose();
      this.capture = null;
    }
    this.speakButton = null;

    const panel = PanelKit.create(this.root, {
      name: "MomentSaved",
      title: "Moment saved for today.",
      // Tall enough for the 1.5x kept-object thumbnails between the title and
      // the buttons. 2026-09-05: buttons were spilling past the bottom edge —
      // scaled down (`buttonScale`) and the extra `buttonDropCm` removed so the
      // 3-button stack sits inside the box.
      body: "",
      widthCm: 46,
      heightCm: 62,
      localPosition: new vec3(0, 0, 0),
      buttonsVertical: true,
      buttonScale: 0.82,
      buttonDropCm: 1,
    });
    this.panel = panel;
    this.popIn(panel);
    this.buildKeptThumbsRow(panel);

    panel.addButton("Capture Another", () => {
      console.log("[MomentFlow] Capture Another → Scan");
      this.flowManager.goTo(TraceScreen.Scan);
    });
    panel.addButton("Finish for Now", () => {
      console.log("[MomentFlow] Finish for Now → Launch (Home)");
      this.flowManager.goTo(TraceScreen.Launch);
    });

    // If today's journal already exists (and this session hasn't already been
    // adopted onto it), the primary action ADDS these new moments to it rather
    // than starting a second entry for the day (2026-09-06).
    const saved = this.journalSession.isAppending() ? null : todaysSavedEntry();
    if (saved) {
      panel.addButton("Add to Today's Journal", () => {
        console.log(`[MomentFlow] Add to Today's Journal → Review (append to ${saved.id})`);
        this.journalSession.hydrateForAppend(saved);
        this.journalSession.logContents();
        this.flowManager.goTo(TraceScreen.Review);
      });
    } else {
      panel.addButton(this.journalSession.isAppending() ? "Add to Today's Journal" : "Create Today's Journal", () => {
        console.log("[MomentFlow] Create/Add Today's Journal → Review");
        this.journalSession.logContents();
        this.flowManager.goTo(TraceScreen.Review);
      });
    }
    console.log("[MomentFlow] moment-saved panel built");
  }

  /**
   * Shows every moment kept so far today (bg-removed thumbnail — same tiered
   * cutout-mesh/bbox-crop/full-frame ladder ReviewScreen's own buildThumb
   * uses on the SAME frozen still, just laid out as one small horizontal row
   * here) in the gap between the title and the button stack (2026-09-05).
   * `centerY`/`h` are hand-tuned to THIS panel's heightCm=62 + buttonDropCm=4
   * layout (see buildSavedPanel) — re-tune if that height ever changes.
   */
  private buildKeptThumbsRow(panel: TitledPanel): void {
    const traces = this.journalSession.keptTraces().slice(-5); // defensive cap
    if (traces.length === 0) return;

    const h = 9; // cm — thumbnail height (1.5x, 2026-09-05)
    const slotW = 11.25; // cm — per-thumbnail slot (1.5x)
    const gap = 1.6;
    const centerY = 10; // see class doc above — coupled to heightCm=62
    const rowW = traces.length * slotW + (traces.length - 1) * gap;
    let cx = -rowW / 2 + slotW / 2;

    for (const t of traces) {
      this.buildOneKeptThumb(panel, t, h, new vec3(cx, centerY, 0.3));
      cx += slotW + gap;
    }
  }

  private buildOneKeptThumb(panel: TitledPanel, t: KeptTrace, h: number, localPos: vec3): void {
    if (!t.thumb) return;
    const thumb = t.thumb;

    if (t.thumbPolygon && t.thumbPolygon.length >= 3) {
      try {
        const mat = (requireAsset("../Materials/ImageMaterial.mat") as Material).clone();
        (mat.mainPass as any).baseTex = thumb;
        (mat.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
        const cutout = makePolygonCutout(panel.contentAnchor, mat, t.thumbPolygon, h, localPos, KEPT_THUMB_OUTLINE);
        if (cutout) return;
        console.log("[MomentFlow] moment-saved thumb: polygon cutout failed — falling back to box/full frame");
      } catch (e) {
        console.log("[MomentFlow] moment-saved thumb: cutout material bind failed — " + e);
      }
    }

    const imgObj = global.scene.createSceneObject("KeptThumb_" + t.order);
    imgObj.setParent(panel.contentAnchor);
    imgObj.getTransform().setLocalPosition(localPos);
    const img = imgObj.createComponent("Component.Image") as Image;
    const box = t.thumbBox;
    const hasBox = !!box && box.w > 0.03 && box.h > 0.03 && box.w <= 1 && box.h <= 1;
    let cropped = false;
    try {
      const mat = (requireAsset("../Materials/ImageMaterial.mat") as Material).clone();
      img.clearMaterials();
      img.addMaterial(mat);
      (img.mainPass as any).baseTex = thumb;
      (img.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
      if (hasBox && box) {
        const sx = Math.max(0.03, Math.min(1, box.w));
        const sy = Math.max(0.03, Math.min(1, box.h));
        const ox = Math.max(0, Math.min(1 - sx, box.x));
        const oy = Math.max(0, Math.min(1 - sy, 1 - box.y - sy)); // top-left -> bottom-up V
        (img.mainPass as any).baseTexUvScale = new vec2(sx, sy);
        (img.mainPass as any).baseTexUvOffset = new vec2(ox, oy);
        cropped = true;
      }
    } catch (e) {
      console.log("[MomentFlow] moment-saved thumb bind failed: " + e);
      return;
    }
    const frameAspect = thumb.getHeight() > 0 ? thumb.getWidth() / thumb.getHeight() : 1.333;
    const aspect = cropped && box ? frameAspect * (box.w / box.h) : frameAspect;
    imgObj.getTransform().setLocalScale(new vec3(h * aspect, h, 1));
    // No border on this tier (see ReviewScreen.buildThumb) — the sticker
    // outline is only on the true background-removed cut-out.
  }

  // --- debug autopilot (Preview verification without hand taps) ---

  private delay(sec: number, fn: () => void): void {
    const e = this.createEvent("DelayedCallbackEvent");
    e.bind(() => fn());
    e.reset(sec);
  }

  private maybeAutopilot(): void {
    if (!this.debugAutopilot || this.autopilotRan || this.activeOrder < 0) return;
    this.autopilotRan = true;
    console.log("[MomentFlow][Autopilot] start");

    this.delay(1.2, () => {
      console.log("[MomentFlow][Autopilot] step 1: choose Peaceful");
      this.chooseEmotion(EMOTIONS[1]);
    });
    this.delay(2.6, () => {
      console.log("[MomentFlow][Autopilot] step 2: type an answer → captured");
      this.reflectionText = this.debugReflectionText;
      this.qPhase = "captured";
      this.buildQuestionPanel();
    });
    this.delay(4.0, () => {
      console.log("[MomentFlow][Autopilot] step 3: Confirm → moment saved");
      this.confirmReflection();
    });
    this.delay(5.4, () => {
      console.log("[MomentFlow][Autopilot] done — 'Moment saved' panel is up; logContents():");
      this.journalSession.logContents();
    });
    // Preview interaction against nested panel buttons can hit a "Blocked by
    // Collider" targeting quirk (same class of issue every other screen here
    // works around with its own debugAutopilot) — step further and drive
    // Create Today's Journal directly so the chain can be verified end to end.
    this.delay(6.8, () => {
      const saved = this.journalSession.isAppending() ? null : todaysSavedEntry();
      if (saved) {
        console.log("[MomentFlow][Autopilot] step 5: Add to Today's Journal -> Review");
        this.journalSession.hydrateForAppend(saved);
      } else {
        console.log("[MomentFlow][Autopilot] step 5: Create Today's Journal -> Review");
      }
      this.flowManager.goTo(TraceScreen.Review);
    });
  }
}
