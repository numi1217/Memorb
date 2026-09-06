/**
 * FeelScreen.ts — Memorest "Choose the overall feeling" screen
 * (DESIGN.md v2 §8, MVP priority 8).
 *
 * OWNS: the wireframe world-space UI for picking ONE overall feeling for the
 * DAY — deliberately separate from any PER-MOMENT emotion (§4, picked earlier
 * on each object card / MomentEmotionReflect): "Because several objects may
 * carry different emotions" the spec asks the user to choose explicitly
 * rather than have it auto-computed from the moments. Prompt "Looking back,
 * how would you describe today overall?" + five selectable options, each a
 * text label + a colour swatch + (best-effort) a Material icon:
 *
 *   Happy — yellow · Peaceful — blue · Difficult — purple ·
 *   Surprising — orange · Ordinary — soft grey
 *
 * Single-select. Selecting writes JournalSession.getEntry().feeling (lower-case
 * label) and .orbColor (hex) — the colour the Memory Orb folds into (§11) —
 * then advances to Generate (§9) immediately + JournalSession.logContents()
 * (2026-09-05: no confirm/nav panel; there is no Back from here). The screen
 * root is placed once in front of the user on entry (spawnInFrontOfUser(),
 * mirrors ReviewScreen) rather than at a fixed authored spot.
 *
 * Screen ROOT visibility is owned by ScreenRouter (enables this component's
 * SceneObject only on the Feel state). Builds on wake / re-enable when
 * FlowManager.current === Feel; tears down on disable. PanelKit buttons cannot
 * be relabelled, so a selection change rebuilds the panel tree (as ConfirmScreen).
 *
 * @input flowManager    - Continue -> Generate, Back -> Review
 * @input journalSession  - writes getEntry().feeling / .orbColor on select
 * @input panelDistanceCm - local Z of the panel tree in front of the screen root
 * @input promptText / continueLabel / backLabel - copy
 * @input showIcons       - render the Material icons (off => swatch + label only)
 * @input debugAutopilot  - Preview-only: pick Happy -> switch to Peaceful -> Continue
 *
 * MUST NOT: call Gemini, own the screen state machine, or hold journal data.
 */

import { FlowManager, TraceScreen } from "./FlowManager";
import { JournalSession } from "./JournalSession";
import { PanelKit, TitledPanel } from "./PanelKit";
import { makeRectFrame } from "./TraceGizmos";

interface FeelingDef {
  id: string;
  label: string;
  hex: string;
  /** Icon file under Assets/Icons/ (imported in Phase 4). */
  icon: string;
}

/** The five feelings (spec §6). Colours are distinct and roughly match the
 *  spec's names; orbColor is written as the hex string. */
const FEELINGS: FeelingDef[] = [
  { id: "happy", label: "Happy", hex: "#F2C94C", icon: "sentiment_very_satisfied" },
  { id: "peaceful", label: "Peaceful", hex: "#5B8DEF", icon: "spa" },
  { id: "difficult", label: "Difficult", hex: "#9B59B6", icon: "sentiment_dissatisfied" },
  { id: "surprising", label: "Surprising", hex: "#E67E22", icon: "celebration" },
  { id: "ordinary", label: "Ordinary", hex: "#9AA0A6", icon: "sentiment_neutral" },
];

function hexToVec4(hex: string): vec4 {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return new vec4(
    isNaN(r) ? 1 : r,
    isNaN(g) ? 1 : g,
    isNaN(b) ? 1 : b,
    1
  );
}

const UI_LINE_MAT = requireAsset("../Materials/UILine.mat") as Material;

/** requireAsset() needs a string LITERAL (it is a build-time dependency), so each
 *  icon is a fixed case — a concatenated path fails to resolve. Returns null for
 *  an unknown name so the row falls back to swatch + label. */
function iconTexture(name: string): Texture | null {
  switch (name) {
    case "sentiment_very_satisfied":
      return requireAsset("../Icons/sentiment_very_satisfied.png") as Texture;
    case "spa":
      return requireAsset("../Icons/spa.png") as Texture;
    case "sentiment_dissatisfied":
      return requireAsset("../Icons/sentiment_dissatisfied.png") as Texture;
    case "celebration":
      return requireAsset("../Icons/celebration.png") as Texture;
    case "sentiment_neutral":
      return requireAsset("../Icons/sentiment_neutral.png") as Texture;
    default:
      return null;
  }
}

@component
export class FeelScreen extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">FeelScreen — choose how the day felt (§6)</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("FlowManager — Continue advances to Generate (Phase 5), Back returns to Review.")
  flowManager!: FlowManager;
  @input
  @hint("JournalSession — selecting a feeling writes getEntry().feeling and .orbColor.")
  journalSession!: JournalSession;
  @input
  @hint('Scene "Camera Object" — read ONCE per fresh entry to spawn the panel in front of wherever the user currently is (not billboarded afterward). Optional; falls back to this screen root\'s authored position if unwired.')
  @allowUndefined
  cameraObject!: SceneObject;
  @ui.group_end

  @ui.group_start("Settings")
  @input
  @hint("Local Z of the Feel panel tree relative to this screen root (cm, negative = in front).")
  panelDistanceCm: number = -100;
  @input
  promptText: string = "Looking back, how would you describe today overall?";
  @input
  continueLabel: string = "Continue";
  @input
  backLabel: string = "Back";
  @input
  @hint("Render the Material icon on each feeling row. Off = colour swatch + label only.")
  showIcons: boolean = true;
  @ui.group_end

  @ui.group_start("Debug")
  @input
  @hint("Preview-only: once the screen builds, pick Happy, switch to Peaceful (verifies single-select), then Continue -> Generate. Leave OFF for real use.")
  debugAutopilot: boolean = false;
  @ui.group_end

  private ready = false;
  private content: SceneObject | null = null;
  private panels: TitledPanel[] = [];
  private selectedId: string | null = null;
  private autopilotRan = false;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      this.ready = true;
      this.spawnInFrontOfUser();
      this.rebuild();
      this.maybeAutopilot();
    });
    this.createEvent("OnEnableEvent").bind(() => {
      if (!this.ready) return;
      // Reflect the entry's current feeling if one was already chosen.
      const f = this.journalSession && !isNull(this.journalSession)
        ? this.journalSession.getEntry().feeling
        : "";
      this.selectedId = f && FEELINGS.some((x) => x.id === f) ? f : this.selectedId;
      this.spawnInFrontOfUser();
      this.rebuild();
      this.maybeAutopilot();
    });
    this.createEvent("OnDisableEvent").bind(() => this.teardown());
  }

  /**
   * Placed ONCE per fresh screen-entry (not inside rebuild()) — moves this
   * screen's own root to the camera's CURRENT position + yaw only, so the
   * panel's local -Z offset lands in front of wherever the user is now
   * (2026-09-05: "spawn the pop-up window in front of player"). Yaw only, so
   * the panel doesn't tilt with the user's head; it does NOT follow afterward.
   * Mirrors ReviewScreen.spawnInFrontOfUser().
   */
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

  // --- build / teardown ---------------------------------------------

  private teardown(): void {
    for (const p of this.panels) {
      try {
        p.destroy();
      } catch (e) {
        /* gone with parent */
      }
    }
    this.panels = [];
    if (this.content && !isNull(this.content)) {
      try {
        this.content.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    this.content = null;
  }

  private rebuild(): void {
    if (isNull(this.flowManager) || isNull(this.journalSession)) {
      console.log("[Feel] ERROR: flowManager / journalSession not wired — screen inert");
      return;
    }
    this.teardown();

    if (this.flowManager.current !== TraceScreen.Feel) return;

    const feelingsH = 90; // 5 buttons (10 + 1.8 gap) + title band + insets + clearance
    const feelingsW = 50;

    // Down-scale so the tall single panel doesn't fill the whole FOV at
    // panelDistanceCm (the removed nav panel used to pull this factor down —
    // 2026-09-05; taken down further 2026-09-06 — "the window is too high").
    const scale = Math.min(1, 50 / feelingsH, 150 / feelingsW);

    const content = global.scene.createSceneObject("FeelContent");
    content.setParent(this.sceneObject);
    // Anchor the panel's TOP edge just above the sight line so it appears where
    // the previous window sat, not ~10 cm higher (2026-09-06).
    const contentY = 12 - (feelingsH / 2) * scale;
    content.getTransform().setLocalPosition(new vec3(0, contentY, this.panelDistanceCm));
    content.getTransform().setLocalScale(new vec3(scale, scale, scale));
    this.content = content;

    // --- feelings panel (the ONLY panel now — 2026-09-05: "remove the
    //     'choose the feeling' [nav] and the two btns; once the player picks a
    //     feeling, head to the next step immediately") ------------------
    const panel = PanelKit.create(content, {
      title: this.promptText,
      name: "FeelOptions",
      body: "",
      widthCm: feelingsW,
      heightCm: feelingsH,
      localPosition: new vec3(0, 0, 0),
      buttonsVertical: true,
      // 2026-09-05: lift the option stack up a little, and run this screen's
      // button gradient right-to-left.
      buttonDropCm: -4,
      buttonGradientFlip: true,
    });
    this.panels.push(panel);

    for (const f of FEELINGS) {
      // No "✓" — picking a feeling navigates straight to Generate, so there is
      // never a selected-but-still-here state to mark.
      const btn = panel.addButton(f.label, () => this.select(f));
      this.decorateRow(btn.getSceneObject(), f, false);
    }

    console.log(`[Feel] built — ${FEELINGS.length} feelings, scale=${scale.toFixed(2)}`);
  }

  /** Colour swatch + optional Material icon on the left of a feeling button. */
  private decorateRow(btnSO: SceneObject, f: FeelingDef, selected: boolean): void {
    if (isNull(btnSO)) return;
    const color = hexToVec4(f.hex);

    // Solid-ish rounded colour chip (thick ring, no UITheme-driven fill so the
    // colour stays crisp regardless of the background-opacity slider).
    try {
      makeRectFrame(btnSO, UI_LINE_MAT, {
        name: "Swatch_" + f.id,
        widthCm: selected ? 4.0 : 3.4,
        heightCm: selected ? 4.0 : 3.4,
        thicknessCm: 1.6,
        cornerFraction: 0.4,
        color: color,
        localPosition: new vec3(-18, 0, 0.25),
      });
    } catch (e) {
      console.log("[Feel] swatch build failed for " + f.id + ": " + e);
    }

    if (!this.showIcons) return;
    try {
      const tex = iconTexture(f.icon);
      if (!tex) return;
      const o = global.scene.createSceneObject("Icon_" + f.id);
      o.setParent(btnSO);
      o.getTransform().setLocalPosition(new vec3(-13, 0, 0.3));
      o.getTransform().setLocalScale(new vec3(4.2, 4.2, 1));
      const img = o.createComponent("Component.Image") as Image;
      const mat = (requireAsset("../Materials/ImageMaterial.mat") as Material).clone();
      img.clearMaterials();
      img.addMaterial(mat);
      (img.mainPass as any).baseTex = tex;
      (img.mainPass as any).baseColor = color;
    } catch (e) {
      console.log("[Feel] icon build failed for " + f.id + " (swatch+label only): " + e);
    }
  }

  // --- selection / actions --------------------------------------

  /** Picking a feeling writes it onto the entry and advances immediately —
   *  there is no confirm step any more (2026-09-05). */
  private select(f: FeelingDef): void {
    this.selectedId = f.id;
    const e = this.journalSession.getEntry();
    e.feeling = f.id;
    e.orbColor = f.hex;
    console.log(`[Feel] selected "${f.id}" -> feeling="${f.id}" orbColor="${f.hex}" -> Generate`);
    this.journalSession.logContents();
    this.flowManager.goTo(TraceScreen.Generate);
  }

  // --- debug autopilot (Preview verification without hand taps) ---

  private delay(sec: number, fn: () => void): void {
    const e = this.createEvent("DelayedCallbackEvent");
    e.bind(() => fn());
    e.reset(sec);
  }

  private maybeAutopilot(): void {
    if (!this.debugAutopilot || this.autopilotRan) return;
    if (this.flowManager.current !== TraceScreen.Feel) return;
    this.autopilotRan = true;
    console.log("[Feel][Autopilot] start");

    this.delay(1.2, () => {
      console.log("[Feel][Autopilot] step 1: pick Peaceful -> Generate (immediate)");
      this.select(FEELINGS[1]);
    });
  }
}
