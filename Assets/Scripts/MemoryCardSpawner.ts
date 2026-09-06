/**
 * MemoryCardSpawner.ts — Memorest Memory Card + card actions (DESIGN.md §3).
 *
 * OWNS: turning one TraceResult + frozen thumbnail + marker point into a spatial
 * Memory Card (background-cropped thumbnail, object name, "Here's what I found.
 * Is it correct?" prompt, labelled extracted-text line, Keep / Retake / Remove
 * row, white marker sphere, connector line), AND the behaviour behind those
 * buttons (DESIGN.md v2 §3):
 *
 *   Keep   -> JournalSession.keep(...) + brighten the card to its "kept" state,
 *             then hand off to MomentEmotionReflect.begin(order) for the
 *             per-moment emotion + reflective-question + "Moment saved" sub-flow
 *             (DESIGN.md v2 §4-§6).
 *   Retake -> discard THIS card (destroy card / marker / line, splice, unkeep if
 *             it was kept) and goTo(Scan) for a fresh capture.
 *   Remove -> JournalSession.unkeep(...) + destroy card / marker / line, splice.
 *             Removing the last card drops back to the Scan screen. unkeep()
 *             also drops that moment's emotion / reflection (they live on the
 *             spliced KeptTrace).
 *
 * The object label stays editable: the card TITLE is tappable (PanelKit
 * setTitleTappable + a "✎" affordance) and opens a transient chooser — Gemini
 * altLabels (<=3) and "Something Else" (a short list of general categories, no
 * keyboard, per §3).
 *
 * The old "Your traces" action panel (Add Another Trace / Create Today's
 * Journal) is GONE — its replacement is MomentEmotionReflect's §6 "Moment saved
 * for today." panel (Capture Another / Finish for Now / Create Today's Journal).
 *
 * Scan order is recorded internally (spec: "Do not display scan order, but
 * record it internally") and NEVER rendered.
 *
 * @input flowManager    - screen transitions for Scan Again / Add Another / Create Journal
 * @input journalSession  - live evidence store the card buttons mutate
 * @input cameraObject    - cards billboard to face this; action panel is parented here
 * @input card / thumb / line tunables - layout + colour
 *
 * MUST NOT: call Gemini, own the screen state machine, or hold journal data
 * itself (that is JournalSession).
 */

import { PanelKit, TitledPanel } from "./PanelKit";
import { TraceResult, SegmentResult } from "./GeminiService";
import { makeGlowLine, makeMarker, makePolygonCutout, ThumbOutline, GlowLine } from "./TraceGizmos";
import { FlowManager, TraceScreen } from "./FlowManager";
import { JournalSession } from "./JournalSession";
import { MomentEmotionReflect } from "./MomentEmotionReflect";
import { applyFont } from "./UITheme";

interface SpawnedCard {
  order: number;
  root: SceneObject;
  marker: SceneObject | null;
  line: GlowLine | null;
  result: TraceResult;
  panel: TitledPanel;
  thumb: Texture;
  /** The current thumbnail SceneObject — replaced when segmentation upgrades it. */
  thumbObj: SceneObject | null;
  /** Highest thumbnail tier applied so far (frame < bbox < cutout) — a slower
   *  segmentation result never downgrades a better one already shown. */
  thumbTier: number;
  /** Whichever crop rect is behind the CURRENT thumbnail (THUMB_BBOX tier),
   *  mirrored onto JournalSession at Keep-time (and refreshed on a later
   *  segmentation upgrade) so Review Today can rebuild the same look. */
  thumbBox?: { x: number; y: number; w: number; h: number };
  /** The polygon behind the CURRENT thumbnail (THUMB_CUTOUT tier), same
   *  mirroring as thumbBox. */
  thumbPolygon?: { x: number; y: number }[];
  label: string;
  kept: boolean;
  /** World position of this card's marker sphere — the point Keep/Retake/
   *  Remove shrink the card toward (2026-09-05). Set once at spawn. */
  spherePos: vec3;
  /** The shared plane's normal at spawn — reused so the connector line can
   *  keep drawing correctly while it collapses during the shrink-out. */
  planeNormal: vec3;
  /** True from the moment Keep/Retake/Remove is pressed until the shrink-out
   *  finishes and the card is torn down — guards against a double-tap firing
   *  a second action (or the label chooser) mid-animation. */
  shrinking: boolean;
}

const THUMB_FRAME = 0;
const THUMB_BBOX = 1;
const THUMB_CUTOUT = 2;

interface Tween {
  /** Target this tween is animating — lets onUpdate drop a tween whose
   *  object was destroyed out from under it instead of dereferencing null
   *  (same guard OrbScreen's pop-in tween needed after a real crash there). */
  obj: SceneObject;
  t0: number;
  dur: number;
  step: (eased: number) => void;
  /** Runs once, right after the tween's last step (before it's spliced out). */
  onComplete?: () => void;
}

const THUMB_OUTLINE: ThumbOutline = { color: new vec4(1, 1, 1, 1), widthCm: 0.5 }; // white sticker border on bg-removed thumbs (2026-09-05)

const OCR_TEXT_SIZE = 30;
const OCR_MUTED = new vec4(0.6, 0.64, 0.7, 1);
const OCR_HINT = new vec4(0.95, 0.75, 0.4, 1);
const POP_SEC = 0.42; // memory-card pop-up duration
const SHRINK_SEC = 0.28; // Keep/Retake/Remove — card shrinks back toward its sphere (2026-09-05)
const KEEP_FLASH_SEC = 3.0; // Keep only — the card holds its green "Kept" state this long, then closes (2026-09-05)
const MARKER_DIAMETER_CM = 2;

const KEPT_COLOR = new vec4(0.55, 1.0, 0.7, 1.0); // soft green — brightened "kept" outline

const GENERAL_CATEGORIES = ["object", "receipt", "ticket", "note", "packaging"];

function lerpVec(a: vec3, b: vec3, t: number): vec3 {
  return a.add(b.sub(a).uniformScale(t));
}
function easeOutCubic(k: number): number {
  const c = Math.max(0, Math.min(1, k));
  return 1 - Math.pow(1 - c, 3);
}

@component
export class MemoryCardSpawner extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MemoryCardSpawner — spatial Memory Cards + card actions</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("FlowManager — screen transitions for Scan Again / Add Another Trace / Create Today's Journal.")
  flowManager!: FlowManager;
  @input
  @hint("JournalSession — live evidence store the Keep / Retake / Remove buttons and the tap-to-edit-label chooser mutate.")
  journalSession!: JournalSession;
  @input
  @hint('Scene "Camera Object" — cards billboard to face it at spawn.')
  cameraObject!: SceneObject;
  @input
  @hint("MomentEmotionReflect — Keep hands off to its begin(order) for the per-moment emotion + question + 'Moment saved' sub-flow (§4-§6).")
  momentFlow!: MomentEmotionReflect;
  @input
  @hint("Marker sphere mesh (wire to MarkerSphereMesh.mesh).")
  markerMesh!: RenderMesh;
  @input
  @hint("Base material for the marker + luminous line (wire to MarkerWhite.mat).")
  markerMat!: Material;
  @ui.group_end

  @ui.group_start("Copy")
  @input
  @hint('Shown on the card under the title. Empty by default (2026-09-05 — the "is it correct?" prompt was removed).')
  confirmPrompt: string = "";
  @input
  @hint('Replaces the confirm prompt once the moment is kept.')
  keptNote: string = "Kept for today.";
  @input
  @hint('Caption in front of the extracted-text line.')
  ocrCaption: string = "Extracted text:";
  @ui.group_end

  @ui.group_start("Settings")
  @input cardWidthCm: number = 34;
  @input cardHeightCm: number = 72;
  @input
  @hint("Card offset from the marker toward the camera (cm).")
  cardTowardCameraCm: number = 26;
  @input
  @hint("Card offset above the marker (cm).")
  cardUpCm: number = 34;
  @input
  @hint("Gap (cm) between the marker sphere and the bottom edge of the card, along the shared plane.")
  cardGapCm: number = 7;
  @input
  @hint("Thumbnail height inside the card (cm).")
  thumbHeightCm: number = 10;
  @ui.group_end

  @ui.group_start("Debug")
  @input
  @hint("Debug: after the first card spawns, auto-run Keep -> Change Label -> pick alternative on it (no hand taps needed in Preview). Leave OFF for real use.")
  debugAutopilot: boolean = false;
  @input
  @hint("Debug: after the first card spawns, just tap Keep on it (→ hands off to the §4-§6 moment sub-flow). Use with MomentEmotionReflect.debugAutopilot to verify §4-§6 in Preview. Leave OFF for real use.")
  debugAutoKeepFirstCard: boolean = false;
  @input
  @hint("Debug: when debugAutopilot is on, also Remove the card at the end (exercises marker/line teardown + return-to-Scan).")
  debugAutopilotRemove: boolean = false;
  @input
  @hint("Debug: on start, seed JournalSession with two synthetic kept traces and jump Launch -> Card -> Confirm (no capture / Gemini needed) so the Confirm screen can be exercised in Preview. Leave OFF for real use.")
  debugSeedConfirm: boolean = false;
  @input
  @hint("Debug: with debugSeedConfirm on, give synthetic trace #1 a detected date + location so the opt-in path can be tested. OFF = neither seeded trace has a date/location (tests the empty path).")
  debugSeedWithDateLoc: boolean = false;
  @ui.group_end

  private cards: SpawnedCard[] = [];
  private tweens: Tween[] = [];

  private chooser: { order: number; panel: TitledPanel } | null = null;
  private wired = false;

  onAwake(): void {
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    if (isNull(this.flowManager) || isNull(this.journalSession)) {
      console.log("[MemoryCard] ERROR: flowManager / journalSession not wired — card actions inert");
      return;
    }
    this.wired = true;
    if (isNull(this.momentFlow)) {
      console.log("[MemoryCard] WARN: momentFlow not wired — Keep will skip the §4-§6 sub-flow");
    }
    this.flowManager.onScreenChanged.add(() => this.syncCardVisibility());

    // Deferred so it runs after FlowManager's own onStart lands on debugStartState
    // and after ScreenRouter has subscribed to onScreenChanged.
    if (this.debugSeedConfirm) this.delay(0.2, () => this.seedConfirmForDebug());
  }

  /** Cards + their markers/lines belong to the Scan/Card flow. On Confirm and
   *  later screens they must not float behind the confirmation panels. */
  private syncCardVisibility(): void {
    const s = this.flowManager.current;
    const vis = s === TraceScreen.Scan || s === TraceScreen.Card;
    for (const c of this.cards) {
      if (!isNull(c.root)) c.root.enabled = vis;
      if (c.marker && !isNull(c.marker)) c.marker.enabled = vis;
      if (c.line && !isNull(c.line.root)) c.line.root.enabled = vis;
    }
  }

  /** Debug-only: stand up two kept traces and drop straight onto the Confirm
   *  screen so it can be verified in Preview without hand taps / Gemini. */
  private seedConfirmForDebug(): void {
    const withDL = this.debugSeedWithDateLoc;
    console.log(
      `[MemoryCard] debugSeedConfirm -> seeding 2 synthetic traces (dateLoc=${withDL}) + jump to Confirm`
    );
    this.journalSession.keep(
      1,
      "train ticket",
      ["ticket", "receipt", "boarding pass"],
      "London to Brighton\n09:42 platform 4",
      undefined,
      withDL ? "2026-09-04" : undefined,
      withDL ? "Brighton" : undefined
    );
    this.journalSession.keep(
      2,
      "coffee cup",
      ["cup", "mug", "takeaway cup"],
      "Flat white. Oat milk.",
      undefined,
      undefined,
      undefined
    );
    this.flowManager.goTo(TraceScreen.Card);
    this.flowManager.goTo(TraceScreen.Confirm);
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
      tw.step(easeOutCubic(k));
      if (k >= 1) {
        this.tweens.splice(i, 1);
        if (tw.onComplete) tw.onComplete();
      }
    }
  }

  /** How many cards exist. ScanScreen owns the real cap; this is for reporting. */
  count(): number {
    return this.cards.length;
  }

  /**
   * @param result   Gemini vision result
   * @param thumb    frozen still texture
   * @param markerPos world point where the trace was collected
   * @param order    1-based scan order (recorded, never displayed)
   */
  spawn(result: TraceResult, thumb: Texture, markerPos: vec3, order: number): void {
    if (isNull(this.cameraObject)) {
      console.log("[MemoryCard] ERROR: cameraObject not wired");
      return;
    }

    const camPos = this.cameraObject.getTransform().getWorldPosition();

    // Shared plane: passes through the marker sphere, faces the camera. The
    // sphere, connector line and card all live in this plane so they read as one
    // flat diagram.
    const spherePos = markerPos;
    let normal = camPos.sub(spherePos).normalize();
    let planeRight = normal.cross(vec3.up());
    if (planeRight.length < 0.01) planeRight = normal.cross(vec3.right());
    planeRight = planeRight.normalize();
    const planeUp = planeRight.cross(normal).normalize();

    // Card sits directly "above" the sphere within the plane.
    const upOffset =
      MARKER_DIAMETER_CM / 2 + this.cardGapCm + this.cardHeightCm / 2;
    const cardPos = spherePos.add(planeUp.uniformScale(upOffset));

    const root = global.scene.createSceneObject("MemoryCard_" + order);
    root.setParent(this.sceneObject);
    root.getTransform().setWorldRotation(quat.lookAt(normal, planeUp));
    root.getTransform().setWorldPosition(spherePos); // starts at the sphere; tween moves it out

    const panel = PanelKit.create(root, {
      name: "MemoryCardPanel",
      title: result.label || "unlabelled trace",
      body: this.confirmPrompt,
      widthCm: this.cardWidthCm,
      heightCm: this.cardHeightCm,
      localPosition: new vec3(0, 0, 0),
      buttonsVertical: true,
    });

    this.addOcrLine(panel, result);

    const card: SpawnedCard = {
      order,
      root,
      marker: null,
      line: null,
      result,
      panel,
      thumb,
      thumbObj: null,
      thumbTier: -1,
      label: result.label || "unlabelled trace",
      kept: false,
      spherePos,
      planeNormal: normal,
      shrinking: false,
    };

    // First pass: analyzeTrace's bbox (or full frame). ScanScreen fires
    // segmentPrimary() next and calls applySegmentation() to upgrade to a
    // real background-removed cut-out when the mask resolves (DESIGN.md v2 §3).
    const hasBox = !!result.box && result.box.w > 0.03 && result.box.h > 0.03;
    card.thumbObj = this.buildThumb(panel, thumb, result.box);
    card.thumbTier = hasBox ? THUMB_BBOX : THUMB_FRAME;
    card.thumbBox = hasBox ? result.box : undefined;

    panel.addButton("Keep", () => this.onKeep(card));
    panel.addButton("Retake", () => this.onRetake(card));
    panel.addButton("Remove", () => this.onRemove(card));

    // Label stays editable via a tap on the card title (DESIGN.md v2 §3 —
    // the dedicated "Change Label" button is gone).
    panel.setTitleTappable(() => this.onChangeLabel(card));

    if (!isNull(this.markerMat) && !isNull(this.markerMesh)) {
      card.marker = makeMarker(
        this.sceneObject, spherePos, this.markerMesh, this.markerMat, MARKER_DIAMETER_CM
      );
      card.line = makeGlowLine(this.sceneObject, this.markerMat); // white, in-plane
    } else {
      console.log("[MemoryCard] markerMesh/markerMat not wired — no marker or line drawn");
    }

    const cardT = root.getTransform();
    const lineRef = card.line;
    this.tweens.push({
      obj: root,
      t0: getTime(),
      dur: POP_SEC,
      step: (e: number) => {
        const s = 0.06 + 0.94 * e;
        const p = lerpVec(spherePos, cardPos, e);
        cardT.setWorldPosition(p);
        cardT.setLocalScale(new vec3(s, s, s));
        if (lineRef) {
          const bottomNow = p.sub(planeUp.uniformScale((this.cardHeightCm / 2) * s));
          lineRef.set(spherePos, bottomNow, normal);
        }
      },
    });

    this.cards.push(card);
    console.log(
      `[MemoryCard #${order}] spawned at ${cardPos} (label="${result.label}", textLen=${result.text.length})`
    );

    if (this.debugAutopilot && !this.autopilotRan) {
      this.autopilotRan = true;
      this.runAutopilot(card);
    } else if (this.debugAutoKeepFirstCard && !this.autopilotRan) {
      this.autopilotRan = true;
      this.delay(1.5, () => {
        console.log("[Autopilot] debugAutoKeepFirstCard: Keep (→ §4-§6 sub-flow)");
        this.onKeep(card);
      });
    }
  }

  // --- debug autopilot (Preview verification without hand taps) ---------

  private autopilotRan = false;

  private delay(sec: number, fn: () => void): void {
    const e = this.createEvent("DelayedCallbackEvent");
    e.bind(() => fn());
    e.reset(sec);
  }

  /**
   * NOTE (2026-09-05): reordered to Change Label -> pick alternative -> Keep
   * (or Remove). Keep now shrinks the card away and hands off to
   * MomentEmotionReflect's own sub-flow (§4-§6 — verified separately by ITS
   * OWN `debugAutopilot`), so there's no longer a live card left afterward to
   * Change Label on or to send through "Create Today's Journal" from here.
   */
  private runAutopilot(card: SpawnedCard): void {
    console.log("[Autopilot] start — Change Label / pick alternative / " +
      (this.debugAutopilotRemove ? "Remove" : "Keep"));
    this.delay(1.0, () => {
      console.log("[Autopilot] step 1: Change Label (open chooser)");
      this.onChangeLabel(card);
    });
    this.delay(2.0, () => {
      const alt = card.result.altLabels[0];
      if (alt) {
        console.log(`[Autopilot] step 2: pick alternative "${alt}"`);
        this.applyLabel(card, alt);
      } else {
        console.log("[Autopilot] step 2: no alternatives — open Something Else");
        this.openSomethingElse(card);
      }
      this.closeChooser();
    });
    this.delay(3.2, () => {
      if (!card.result.altLabels[0]) {
        console.log('[Autopilot] step 2b: pick category "note"');
        this.applyLabel(card, "note");
        this.closeChooser();
      }
      this.journalSession.logContents();
    });
    this.delay(4.2, () => {
      if (this.debugAutopilotRemove) {
        console.log("[Autopilot] step 3: Remove (expect shrink-out + marker/line teardown + return to Scan)");
        this.onRemove(card);
      } else {
        console.log("[Autopilot] step 3: Keep (expect shrink-out + hand off to §4-§6 sub-flow)");
        this.onKeep(card);
      }
    });
    this.delay(6.0, () => console.log("[Autopilot] done"));
  }

  // --- card actions -----------------------------------------------------

  /**
   * Shared by Keep/Retake/Remove (2026-09-05): shrinks the card — and its
   * marker + connector line — back toward the sphere point over SHRINK_SEC,
   * then destroys the whole card and only THEN runs `after()`. This is what
   * gates the next window (the §4-§6 sub-flow, or Scan reappearing) behind
   * the disappear animation actually finishing, instead of popping up
   * underneath/over a card that's still mid-animation.
   */
  private beginShrinkAndThen(card: SpawnedCard, after: () => void): void {
    if (card.shrinking) return;
    card.shrinking = true;
    this.closeChooser();

    const rootT = card.root.getTransform();
    const startPos = rootT.getWorldPosition();
    const startScale = rootT.getLocalScale().x || 1;
    const target = card.spherePos;

    const markerT = card.marker && !isNull(card.marker) ? card.marker.getTransform() : null;
    const markerStartScale = markerT ? markerT.getLocalScale().x || 1 : 0;
    const lineRef = card.line;
    const normal = card.planeNormal;

    this.tweens.push({
      obj: card.root,
      t0: getTime(),
      dur: SHRINK_SEC,
      step: (e: number) => {
        const p = lerpVec(startPos, target, e);
        const s = Math.max(0.001, startScale * (1 - e));
        rootT.setWorldPosition(p);
        rootT.setLocalScale(new vec3(s, s, s));
        if (markerT) {
          const ms = Math.max(0.001, markerStartScale * (1 - e));
          markerT.setLocalScale(new vec3(ms, ms, ms));
        }
        if (lineRef) lineRef.set(target, p, normal); // collapses to a point in lockstep with the card
      },
      onComplete: () => {
        this.destroyCard(card);
        after();
      },
    });
  }

  private onKeep(card: SpawnedCard): void {
    if (!this.wired || card.shrinking) {
      console.log(`[MemoryCard #${card.order}] Keep ignored — session not wired / already shrinking`);
      return;
    }
    card.kept = true;
    this.journalSession.keep(
      card.order, card.label, card.result.altLabels, card.result.text, card.thumb,
      card.result.date, card.result.location, card.thumbBox, card.thumbPolygon
    );
    this.applyKeptVisual(card);
    console.log(`[MemoryCard #${card.order}] Keep -> kept (session now ${this.journalSession.keptCount()})`);
    this.closeChooser();

    // A short beat to actually see the green "Kept" state before the card
    // shrinks away — then shrink, THEN hand off to the per-moment emotion +
    // reflective-question + "Moment saved" sub-flow (DESIGN.md v2 §4-§6).
    this.delay(KEEP_FLASH_SEC, () => {
      this.beginShrinkAndThen(card, () => {
        if (!isNull(this.momentFlow)) {
          this.momentFlow.begin(card.order);
        } else {
          console.log(`[MemoryCard #${card.order}] momentFlow not wired — §4-§6 sub-flow skipped`);
        }
      });
    });
  }

  private onRemove(card: SpawnedCard): void {
    if (card.shrinking) return;
    console.log(`[MemoryCard #${card.order}] Remove`);
    if (this.wired && this.journalSession.isKept(card.order)) {
      this.journalSession.unkeep(card.order);
    }
    this.beginShrinkAndThen(card, () => {
      if (this.cards.length === 0 && this.wired) {
        console.log("[MemoryCard] last card removed — returning to Scan");
        this.flowManager.goTo(TraceScreen.Scan);
      }
    });
  }

  private onChangeLabel(card: SpawnedCard): void {
    if (card.shrinking) return;
    console.log(
      `[MemoryCard #${card.order}] Change Label — altLabels: [${card.result.altLabels.join(", ")}]`
    );
    this.openChooser(card, "Change label", this.chooserOptions(card));
  }

  /**
   * Build the option list for the edit-label chooser (DESIGN.md v2 §3). Each
   * `run` is fully responsible for its own outcome — closing the chooser (alt /
   * category picks) or replacing it (Something Else). The button wrapper does
   * NOT auto-close. (Re-capture now lives on the card's own "Retake" button.)
   */
  private chooserOptions(card: SpawnedCard): { label: string; run: () => void }[] {
    const opts: { label: string; run: () => void }[] = [];
    for (const alt of card.result.altLabels.slice(0, 3)) {
      opts.push({ label: alt, run: () => { this.applyLabel(card, alt); this.closeChooser(); } });
    }
    opts.push({ label: "Something Else", run: () => this.openSomethingElse(card) });
    return opts;
  }

  private openSomethingElse(card: SpawnedCard): void {
    this.openChooser(
      card,
      "Choose a category",
      GENERAL_CATEGORIES.map((c) => ({
        label: c,
        run: () => { this.applyLabel(card, c); this.closeChooser(); },
      }))
    );
  }

  /** One chooser at a time; parented to the card so it sits right beside it. */
  private openChooser(
    card: SpawnedCard,
    title: string,
    options: { label: string; run: () => void }[]
  ): void {
    this.closeChooser();

    const panel = PanelKit.create(card.root, {
      name: "LabelChooser",
      title: title,
      body: "",
      widthCm: 30,
      heightCm: 14 + options.length * 12,
      localPosition: new vec3(this.cardWidthCm * 0.92, 0, 2),
      buttonsVertical: true,
    });
    for (const o of options) {
      panel.addButton(o.label, () => o.run());
    }
    this.chooser = { order: card.order, panel };
  }

  private closeChooser(): void {
    if (!this.chooser) return;
    try {
      this.chooser.panel.destroy();
    } catch (e) {
      /* already gone with its parent card */
    }
    this.chooser = null;
  }

  private applyLabel(card: SpawnedCard, newLabel: string): void {
    card.label = newLabel;
    card.result.label = newLabel;
    card.panel.setTitle((card.kept ? "✓ " : "") + newLabel);
    if (this.wired && this.journalSession.isKept(card.order)) {
      this.journalSession.relabel(card.order, newLabel);
    }
    console.log(`[MemoryCard #${card.order}] label -> "${newLabel}"`);
  }

  /** Retake (DESIGN.md v2 §3): discard THIS card and go back to Scan for a fresh
   *  capture. Replaces the old "Scan Again" chooser path. */
  private onRetake(card: SpawnedCard): void {
    if (card.shrinking) return;
    console.log(`[MemoryCard #${card.order}] Retake — discarding card, back to Scan`);
    if (this.wired && this.journalSession.isKept(card.order)) {
      this.journalSession.unkeep(card.order);
    }
    this.beginShrinkAndThen(card, () => {
      if (this.wired) this.flowManager.goTo(TraceScreen.Scan);
    });
  }

  private applyKeptVisual(card: SpawnedCard): void {
    card.panel.setSurfaceColor(KEPT_COLOR);
    card.panel.setTitleColor(KEPT_COLOR);
    card.panel.setTitle("✓ " + card.label);
    card.panel.setBody(this.keptNote);
  }

  private destroyCard(card: SpawnedCard): void {
    if (this.chooser && this.chooser.order === card.order) this.closeChooser();
    if (card.line) {
      try { card.line.destroy(); } catch (e) { /* ignore */ }
    }
    if (card.marker && !isNull(card.marker)) {
      try { card.marker.destroy(); } catch (e) { /* ignore */ }
    }
    try { card.root.destroy(); } catch (e) { /* ignore */ }
    const i = this.cards.indexOf(card);
    if (i >= 0) this.cards.splice(i, 1);
  }

  // --- card content ---------------------------------------------------

  /** Locate a still-alive spawned card by scan order. */
  private findCard(order: number): SpawnedCard | null {
    for (const c of this.cards) if (c.order === order) return c;
    return null;
  }

  /**
   * DESIGN.md v2 §3 — upgrade a card's thumbnail once Gemini segmentation
   * resolves. Called by ScanScreen. Fallback ladder (each step logged):
   *   1. polygon present -> triangulated cut-out MESH sampling the still directly
   *      (no raster mask: TraceGizmos.makePolygonCutout)
   *   2. polygon absent / degenerate, but a good box -> tighter bbox crop
   *   3. nothing usable -> leave the analyzeTrace thumbnail as-is
   */
  applySegmentation(order: number, seg: SegmentResult | null, frozen: Texture): void {
    const card = this.findCard(order);
    if (!card) {
      console.log(`[MemoryCard #${order}] applySegmentation — card gone, skipping`);
      return;
    }
    if (!seg) {
      console.log(`[MemoryCard #${order}] thumbnail path: KEEP (no segmentation result)`);
      return;
    }

    if (seg.polygon.length >= 3) {
      const cutoutObj = this.buildPolygonThumb(card.panel, frozen, seg.polygon);
      if (cutoutObj) {
        if (card.thumbTier < THUMB_CUTOUT) {
          this.swapThumb(card, cutoutObj);
          card.thumbTier = THUMB_CUTOUT;
          card.thumbBox = undefined;
          card.thumbPolygon = seg.polygon;
          this.syncKeptThumbShape(order, undefined, seg.polygon);
          console.log(
            `[MemoryCard #${order}] thumbnail path: CUTOUT (polygon, ${seg.polygon.length} pts)`
          );
        } else {
          cutoutObj.destroy(); // a slower response can't downgrade an already-better thumbnail
        }
        return;
      }
      console.log(`[MemoryCard #${order}] polygon cutout mesh failed — falling back to bbox crop`);
    }

    console.log(`[MemoryCard #${order}] thumbnail path: BBOX (no usable polygon)`);
    this.recropToBox(order, frozen, seg.box01);
  }

  /** Keep JournalSession's copy of the thumbnail shape in sync with whatever
   *  the card is CURRENTLY showing — a card can be Kept before segmentation
   *  resolves, so the upgrade has to reach the already-kept trace too (mirrors
   *  how `relabel()` reaches an already-kept trace after the fact). No-op if
   *  this trace was never kept. */
  private syncKeptThumbShape(
    order: number,
    box01: { x: number; y: number; w: number; h: number } | undefined,
    polygon01: { x: number; y: number }[] | undefined
  ): void {
    if (this.wired && this.journalSession.isKept(order)) {
      this.journalSession.updateThumbShape(order, box01, polygon01);
    }
  }

  /** Triangulate the polygon into an actual cut-out mesh sampling `thumb`
   *  directly at each vertex's own UV — no mask texture needed at all. */
  private buildPolygonThumb(
    panel: TitledPanel,
    thumb: Texture,
    polygon01: { x: number; y: number }[]
  ): SceneObject | null {
    let mat: Material;
    try {
      mat = (requireAsset("../Materials/ImageMaterial.mat") as Material).clone();
      (mat.mainPass as any).baseTex = thumb;
      (mat.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
    } catch (e) {
      console.log("[MemoryCard] polygon cutout: material bind failed — " + e);
      return null;
    }
    const cutout = makePolygonCutout(
      panel.contentAnchor,
      mat,
      polygon01,
      this.thumbHeightCm,
      new vec3(0, 11, 0.3),
      THUMB_OUTLINE
    );
    return cutout ? cutout.root : null;
  }

  private recropToBox(
    order: number,
    thumb: Texture,
    box: { x: number; y: number; w: number; h: number }
  ): void {
    const c = this.findCard(order);
    if (!c || c.thumbTier >= THUMB_BBOX) return;
    this.swapThumb(c, this.buildThumb(c.panel, thumb, box));
    c.thumbTier = THUMB_BBOX;
    c.thumbBox = box;
    c.thumbPolygon = undefined;
    this.syncKeptThumbShape(order, box, undefined);
  }

  private swapThumb(card: SpawnedCard, next: SceneObject): void {
    if (card.thumbObj && !isNull(card.thumbObj)) {
      try {
        card.thumbObj.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    card.thumbObj = next;
  }

  /**
   * Build one plain (non-cut-out) thumbnail SceneObject under the card — the
   * full frame, or cropped to `box` when given. The real cut-out path is
   * `buildPolygonThumb` (a shaped mesh, no crop rect involved).
   *
   * @param box optional normalized (0..1, top-left origin) crop rect for the
   *            base still. When set, baseTex UVs are scaled/offset to it.
   */
  private buildThumb(
    panel: TitledPanel,
    thumb: Texture,
    box: { x: number; y: number; w: number; h: number } | undefined
  ): SceneObject {
    const imgObj = global.scene.createSceneObject("Thumbnail");
    imgObj.setParent(panel.contentAnchor);
    imgObj.getTransform().setLocalPosition(new vec3(0, 11, 0.3));

    const img = imgObj.createComponent("Component.Image") as Image;
    const mat = (requireAsset("../Materials/ImageMaterial.mat") as Material).clone();
    img.clearMaterials();
    img.addMaterial(mat);

    const hasBox = !!box && box.w > 0.03 && box.h > 0.03 && box.w <= 1 && box.h <= 1;
    let cropped = false;

    try {
      (img.mainPass as any).baseTex = thumb;
      (img.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
      if (hasBox && box) {
        const sx = Math.max(0.03, Math.min(1, box.w));
        const sy = Math.max(0.03, Math.min(1, box.h));
        const ox = Math.max(0, Math.min(1 - sx, box.x));
        // Gemini's box origin is top-left; texture V runs bottom-up, so flip.
        const oy = Math.max(0, Math.min(1 - sy, 1 - box.y - sy));
        try {
          (img.mainPass as any).baseTexUvScale = new vec2(sx, sy);
          (img.mainPass as any).baseTexUvOffset = new vec2(ox, oy);
          cropped = true;
        } catch (e) {
          /* material has no UV scale/offset uniform */
        }
      }
    } catch (e) {
      console.log("[MemoryCard] thumbnail bind failed: " + e);
    }

    // Size the quad to the aspect actually shown (cropped region vs full frame).
    const frameAspect = thumb.getHeight() > 0 ? thumb.getWidth() / thumb.getHeight() : 1.333;
    const aspect = cropped && box ? frameAspect * (box.w / box.h) : frameAspect;
    // No border on this tier — a bbox crop / full frame still has its
    // background, so a rectangular outline would sit on the "original"
    // thumbnail. The white sticker outline is only on the real
    // background-removed cut-out (buildPolygonThumb -> makePolygonCutout).
    imgObj.getTransform().setLocalScale(new vec3(this.thumbHeightCm * aspect, this.thumbHeightCm, 1));

    console.log(
      `[MemoryCard] thumbnail built — ${cropped ? "bbox crop" : "full frame"}` +
        (hasBox ? ` box ${box!.x.toFixed(2)},${box!.y.toFixed(2)} ${box!.w.toFixed(2)}x${box!.h.toFixed(2)}` : "")
    );
    return imgObj;
  }

  private addOcrLine(panel: TitledPanel, result: TraceResult): void {
    const o = global.scene.createSceneObject("OcrText");
    o.setParent(panel.contentAnchor);
    o.getTransform().setLocalPosition(new vec3(0, 2, 0.3));
    const t = o.createComponent("Component.Text") as Text;
    t.size = OCR_TEXT_SIZE;
    t.depthTest = true;
    applyFont(t);

    // DESIGN.md v2 §3: the extracted text is meant to be editable. Full keyboard
    // editing is a later pass — for now the line is just clearly labelled.
    const cap = this.ocrCaption ? this.ocrCaption + " " : "";
    if (!result.text || result.text.length === 0) {
      t.text = cap + "none found";
      t.textFill.color = OCR_MUTED;
    } else if (result.ocrUncertain) {
      t.text = cap + result.text + "\n(text may be inaccurate)";
      t.textFill.color = OCR_HINT;
    } else {
      t.text = cap + result.text;
      t.textFill.color = new vec4(1, 1, 1, 1);
    }
  }
}
