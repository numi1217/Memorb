/**
 * ReviewScreen.ts — Memorest "Review Today" screen (DESIGN.md v2 §7,
 * MVP priority 7).
 *
 * OWNS: the wireframe world-space UI listing every kept moment from today in
 * chronological order (KeptTrace.order already sorts this way — spec: "Do not
 * display scan order", so the number itself stays internal, only the ordering
 * is used). Each moment row shows: its cut-out/frozen thumbnail, label, the
 * emotion colour + label picked at Keep-time (§4), and a short reflection
 * snippet (§5). Heading: "These are the moments you captured today. Which
 * ones belong in your journal?" (title rendered smaller than this app's
 * other panel titles — see `titleSize` on the header, 2026-09-05).
 *
 * CHOOSING (2026-09-05, replaces the old Include/Change label/Remove
 * buttons): the whole moment panel is one tap target
 * (`PanelKit.setPanelTappable`) — pinch the card to toggle it in/out of the
 * journal. Chosen -> green outline + a "✓" glyph; not chosen -> the panel's
 * normal look. Editing the label or removing a moment entirely is no longer
 * reachable from this screen at all (no replacement — removing them was the
 * ask; both are still possible earlier, on the Memory Card itself).
 *
 * Selection is capped at 1-5 (JournalSession.setIncluded enforces the cap;
 * this screen just reflects it). The footer ("Ready?") is exactly two
 * buttons, laid out horizontally: Back and Create Journal (renamed from
 * "Continue" — same destination, Feel §8 overall daily emotion, already
 * built and reused as-is for the DAY level). Create Journal is dimmed until
 * the selected count is in range.
 *
 * INTERACTION MODEL: same as ConfirmScreen/FeelScreen — PanelKit buttons
 * can't be relabelled, so every toggle mutates a local view-model and
 * rebuilds the panel tree.
 *
 * PLACEMENT (2026-09-05): this screen is most often entered right after
 * "Create Today's Journal" (MomentEmotionReflect's §6 panel), by which point
 * the user may have walked/looked anywhere while journaling. Rather than a
 * fixed authored world spot (would feel randomly placed) or parenting to the
 * camera (billboard — would follow the user's head continuously), this
 * screen's OWN root is moved to match the camera's CURRENT position + yaw
 * ONCE, every fresh entry (see spawnInFrontOfUser()) — "spawn in front of the
 * user" without following them afterward.
 *
 * @input flowManager    - screen transitions (Back -> Launch, Continue -> Feel)
 * @input journalSession  - reads keptTraces(), writes setIncluded() on tap-to-choose
 * @input cameraObject    - read once per fresh entry to spawn in front of the user
 * @input panelDistanceCm - local Z of the panel tree in front of the screen root
 * @input headingText / subheadingText / backLabel / continueLabel - copy
 * @input debugAutopilot  - Preview-only: build then Continue with the default selection
 *
 * MUST NOT: call Gemini, own the screen state machine, or hold journal data
 * itself (that is JournalSession).
 */

import { FlowManager, TraceScreen } from "./FlowManager";
import { JournalEntry, JournalEntryData } from "./JournalEntry";
import { JournalSession, KeptTrace } from "./JournalSession";
import { PanelKit, TitledPanel } from "./PanelKit";
import { makeRectFrame, makePolygonCutout, ThumbOutline } from "./TraceGizmos";
import { applyFont } from "./UITheme";

const UI_LINE_MAT = requireAsset("../Materials/UILine.mat") as Material;
const DAYS_KEY = "traceJournal.days";
// Soft green — same "chosen"/"kept" colour MemoryCardSpawner's KEPT_COLOR
// uses, so a moment reads consistently once picked, screen to screen.
const CHOSEN_COLOR = new vec4(0.55, 1.0, 0.7, 1.0);

interface MomentVM {
  order: number;
  label: string;
  altLabels: string[];
  labelIdx: number;
  thumb: Texture | null;
  /** Whichever thumbnail shape the card ended up showing (§3) — cutout wins
   *  over box when both are somehow present. Undefined = full frame. */
  thumbBox?: { x: number; y: number; w: number; h: number };
  thumbPolygon?: { x: number; y: number }[];
  emotion: string;
  emotionColor: string;
  reflection: string;
  captureTimeStr: string;
  included: boolean;
}

function short(s: string, n: number): string {
  const t = (s || "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function hexToVec4(hex: string): vec4 {
  const h = (hex || "").replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return new vec4(isNaN(r) ? 1 : r, isNaN(g) ? 1 : g, isNaN(b) ? 1 : b, 1);
}

@component
export class ReviewScreen extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">ReviewScreen — Review Today, select 1-5 (§7)</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("FlowManager — Back -> Launch (Home), Continue -> Feel (§8 overall daily emotion).")
  flowManager!: FlowManager;
  @input
  @hint("JournalSession — reads keptTraces(), writes setIncluded() (pinch a moment to toggle it).")
  journalSession!: JournalSession;
  @input
  @hint('Scene "Camera Object" — read ONCE, each time this screen is freshly entered, to spawn the panel tree in front of wherever the user currently is (2026-09-05: "spawn in front of the user, but not billboard"). Optional; falls back to this screen root\'s own authored position if unwired.')
  @allowUndefined
  cameraObject!: SceneObject;
  @ui.group_end

  @ui.group_start("Copy")
  @input headingText: string = "These are the moments you captured today.";
  @input subheadingText: string = "Which ones belong in your journal?";
  @input backLabel: string = "Back to Home";
  @input continueLabel: string = "Create Journal";
  @ui.group_end

  @ui.group_start("Settings")
  @input
  @hint("Local Z of the Review panel tree relative to this screen root (cm, negative = in front).")
  panelDistanceCm: number = -100;
  @ui.group_end

  @ui.group_start("Debug")
  @input
  @hint("Preview-only: once the screen builds with >=1 moment, auto-run Continue with the default selection. Leave OFF for real use.")
  debugAutopilot: boolean = false;
  @input
  @hint("Preview-only: if the session has 0 kept moments when this screen starts, seed 3 with varied label/emotion/reflection so the layout is screenshot-able without a real capture. Leave OFF for real use.")
  debugSeedMoments: boolean = false;
  @ui.group_end

  private ready = false;
  private content: SceneObject | null = null;
  private panels: TitledPanel[] = [];
  private vms: MomentVM[] = [];
  private footer: TitledPanel | null = null;
  /** Transient "pick 1 to 5" style message — shown in the HEADER body (the
   *  frameless footer is now just the two buttons, too short for a text band).
   *  Set on a rejected tap, cleared on the next successful toggle. */
  private hintMsg = "";
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
      this.spawnInFrontOfUser();
      this.rebuild();
      this.maybeAutopilot();
    });
    this.createEvent("OnDisableEvent").bind(() => this.teardown());
  }

  /**
   * Placed ONCE per fresh screen-entry (OnStartEvent / OnEnableEvent) — NOT
   * inside rebuild(), which also re-runs on every Include/Exclude/relabel
   * toggle and would otherwise re-snap the whole panel to the user's current
   * head position on every tap (that IS a billboard, just a stuttery one).
   * Moves this screen's own root to the camera's CURRENT position, matching
   * its yaw only (pitch/roll stripped so the panel doesn't tilt if the user's
   * head was tilted up/down) — the panel content's own local -Z offset
   * (`panelDistanceCm`) then lands exactly in front of wherever the user is
   * standing/facing right now, same as the original static setup already did
   * for a user who never moved from the scene's default camera pose.
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

  // --- build / teardown ---------------------------------------------------

  private teardown(): void {
    for (const p of this.panels) {
      try {
        p.destroy();
      } catch (e) {
        /* already gone with its parent */
      }
    }
    this.panels = [];
    this.footer = null;
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
      console.log("[Review] ERROR: flowManager / journalSession not wired — screen inert");
      return;
    }
    this.teardown();

    // Only stand up the panel tree when actually on the Review screen (the
    // root can be briefly enabled at scene start before ScreenRouter's first
    // apply() disables it — same guard as ConfirmScreen/FeelScreen).
    if (this.flowManager.current !== TraceScreen.Review) return;

    this.maybeSeedDebugMoments();

    const traces = this.journalSession.keptTraces(); // already order-ascending == chronological
    this.syncVms(traces);

    const content = global.scene.createSceneObject("ReviewContent");
    content.setParent(this.sceneObject);
    content.getTransform().setLocalPosition(new vec3(0, 0, this.panelDistanceCm));
    this.content = content;

    const N = this.vms.length;
    const includedCount = this.vms.filter((v) => v.included).length;

    // --- layout budget (same shape as ConfirmScreen's trace grid) --------
    const panelW = N <= 1 ? 40 : N === 2 ? 36 : Math.max(22, Math.min(30, Math.floor(96 / N) - 4));
    const gap = 4;
    // Shorter (was 62) so title + details + thumbnail fill the card instead
    // of hugging the top with a big empty lower half (2026-09-05).
    const traceH = N > 0 ? 44 : 6;
    const rowW = N > 0 ? N * panelW + (N - 1) * gap : 0;

    const headerH = 14;
    const vGap = 11;
    // Frameless footer is now just the button row — short. Place it so the
    // button row sits ~one button-height (BTN_H) below the moment-card bottoms
    // (2026-09-05). BTN_H / PANEL_PAD mirror PanelKit's own internal constants
    // (it doesn't export them) — same technique GenerateScreen.buildDonePanel
    // already uses for its budget math.
    const BTN_H = 10;
    const PANEL_PAD = 2.6;
    const footerH = 16;
    const footerBtnLocalY = -footerH / 2 + PANEL_PAD + BTN_H / 2; // where PanelKit bottom-anchors the row
    const footerBtnRowWorldY = -(traceH / 2 + BTN_H + BTN_H / 2); // one btn-height gap under the cards
    const footerCY = footerBtnRowWorldY - footerBtnLocalY;

    const headerCY = traceH / 2 + vGap + headerH / 2;
    const spanV = headerCY + headerH / 2 - (footerCY - footerH / 2);
    const spanH = Math.max(rowW, 50);
    // 0.55 overall (2026-09-06 — "the window is too high" x3): the fit math
    // caps the tree to the FOV, then everything is taken down so the whole
    // header+cards+footer stack is short enough to sit near the sight line
    // instead of towering above it.
    const scale = 0.55 * Math.min(1, 112 / spanV, 150 / spanH);
    content.getTransform().setLocalScale(new vec3(scale, scale, scale));
    // Anchor the TOP of the header just above the sight line so the user's gaze
    // lands on the panel where the previous ("Create Today's Journal") window
    // was — not 20 cm higher. content-local Y=0 is the moment-card row; the
    // header top sits `headerCY + headerH/2` above that (2026-09-06).
    const HEADER_TOP_CM = 9; // how far above eye level the header's top edge sits
    const headerTopLocal = headerCY + headerH / 2;
    const contentY = HEADER_TOP_CM - headerTopLocal * scale;
    content.getTransform().setLocalPosition(new vec3(0, contentY, this.panelDistanceCm));

    // --- header ------------------------------------------------------
    // When "Add to Today's Journal" adopted this session onto the saved entry,
    // Review behaves like a normal create — just for the NEW moments.
    const appending = !isNull(this.journalSession) && this.journalSession.isAppending();
    const headerBody =
      appending
        ? `Which of these to add to today's journal?  (${includedCount}/5)`
        : this.todayAlreadySaved()
        ? "Today's journal is already saved."
        : N === 0
        ? "No moments captured today."
        : this.hintMsg
        ? this.hintMsg
        : `${this.subheadingText}  (${includedCount}/5 selected)`;
    const header = PanelKit.create(content, {
      name: "ReviewHeader",
      title: this.headingText,
      body: headerBody,
      widthCm: Math.max(rowW, 50),
      heightCm: headerH,
      localPosition: new vec3(0, headerCY, 0),
      titleSize: 130, // smaller (2026-09-05) — was UITheme's global size, read as too loud here
    });
    this.panels.push(header);

    // --- one panel per kept moment ------------------------------------
    for (let i = 0; i < N; i++) {
      const v = this.vms[i];
      const cx = -rowW / 2 + panelW / 2 + i * (panelW + gap);
      this.buildMomentPanel(content, v, panelW, traceH, new vec3(cx, 0, 0));
    }

    // --- footer: just the two buttons, no "Ready?" text, no outline, sitting
    //     one button-height below the moment cards (2026-09-05). The rejected-
    //     tap hint now lives in the header body (this panel is too short for a
    //     text band). --------------------------------------------------------
    const canContinue = includedCount >= 1 && includedCount <= 5;
    // Today already has a saved journal (§13 store) — "Create Journal" would
    // make a second entry for the same day, so it's replaced with a route into
    // the Jar to reread the one that exists (2026-09-06).
    const alreadySaved = this.todayAlreadySaved() && !appending;
    const footer = PanelKit.create(content, {
      name: "ReviewFooter",
      title: "",
      body: "",
      widthCm: 44,
      heightCm: footerH,
      localPosition: new vec3(0, footerCY, 0),
      buttonsVertical: false,
      frameless: true,
    });
    footer.addButton(this.backLabel, () => this.goHome());
    if (alreadySaved) {
      footer.addButton("Revisit the Month", () => {
        console.log("[Review] today already saved -> Jar");
        this.flowManager.goTo(TraceScreen.Jar);
      });
    } else if (N > 0) {
      footer.addButton(appending ? "Add to Journal" : this.continueLabel, () => this.continueToFeel(), {
        dim: !canContinue,
      });
    }
    this.panels.push(footer);
    this.footer = footer;

    console.log(`[Review] built — ${N} moment(s), ${includedCount} included, scale=${scale.toFixed(2)}`);
  }

  /**
   * No buttons any more (2026-09-05: "delete change label and remove...
   * pinch to choose instead") — the whole card is one tap target
   * (`setPanelTappable`) that toggles inclusion. Chosen -> green outline +
   * a "✓" glyph; not chosen -> the panel's normal default look. Edit-label
   * and Remove are gone entirely (no replacement — they were the only way
   * those actions were reachable here, and removing them was the ask).
   */
  private buildMomentPanel(
    parent: SceneObject,
    v: MomentVM,
    widthCm: number,
    heightCm: number,
    localPos: vec3
  ): void {
    // Time + emotion share one row (2026-09-05); the reflection snippet is the
    // second row.
    const row1: string[] = [];
    if (v.captureTimeStr) row1.push(v.captureTimeStr);
    row1.push(v.emotion ? v.emotion : "no feeling recorded");
    const bodyBits: string[] = [row1.join("   ·   ")];
    bodyBits.push(v.reflection ? `"${short(v.reflection, 40)}"` : "no reflection");

    const panel = PanelKit.create(parent, {
      name: "ReviewMoment_" + v.order,
      title: short(v.label, 16),
      body: bodyBits.join("\n"),
      widthCm: widthCm,
      heightCm: heightCm,
      localPosition: localPos,
      contentDropCm: 5, // push text down so title/body + thumbnail sit centred, not top-hugging (2026-09-05)
    });

    if (v.thumb) this.buildThumb(panel, v);
    if (v.emotionColor) this.decorateSwatch(panel, v.emotionColor);
    if (v.included) {
      panel.setSurfaceColor(CHOSEN_COLOR);
      this.decorateTick(panel);
    }

    panel.setPanelTappable(() => {
      const choosing = !v.included;
      const ok = this.journalSession.setIncluded(v.order, choosing);
      if (!ok && choosing) {
        this.hintMsg = "You can include up to 5 moments.";
        this.rebuild();
        return;
      }
      this.hintMsg = "";
      v.included = choosing;
      this.rebuild();
    });

    this.panels.push(panel);
  }

  /** Top-right "✓" on a chosen moment's panel — pairs with the green outline. */
  private decorateTick(panel: TitledPanel): void {
    try {
      const o = global.scene.createSceneObject("Tick");
      o.setParent(panel.contentAnchor);
      o.getTransform().setLocalPosition(new vec3(panel.halfWidthCm - 4.5, panel.halfHeightCm - 4.5, 0.3));
      const t = o.createComponent("Component.Text") as Text;
      t.text = "✓";
      t.size = 90;
      t.depthTest = true;
      applyFont(t);
      t.textFill.color = CHOSEN_COLOR;
    } catch (e) {
      console.log("[Review] tick glyph build failed: " + e);
    }
  }

  /**
   * Rebuilds whichever thumbnail tier the card ended up showing (§3), sampling
   * the SAME frozen still (KeptTrace.thumb) the card used — not a separate
   * baked texture, just the same UV-crop / mesh-cutout technique
   * MemoryCardSpawner.buildThumb / buildPolygonThumb use:
   *   1. polygon present -> triangulated cut-out mesh (TraceGizmos.makePolygonCutout)
   *   2. box present      -> UV-cropped Image quad
   *   3. neither          -> full frame
   */
  private buildThumb(panel: TitledPanel, v: MomentVM): void {
    const thumb = v.thumb!;
    const box = v.thumbBox;
    const hasBox = !!box && box.w > 0.03 && box.h > 0.03 && box.w <= 1 && box.h <= 1;
    const frameAspect = thumb.getHeight() > 0 ? thumb.getWidth() / thumb.getHeight() : 1.333;

    // Aspect actually shown (cropped region vs full frame).
    let aspect = frameAspect;
    if (v.thumbPolygon && v.thumbPolygon.length >= 3) {
      // polygon bbox aspect
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (const p of v.thumbPolygon) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      aspect = Math.max(0.2, (maxX - minX) / Math.max(0.01, maxY - minY));
    } else if (hasBox && box) {
      aspect = frameAspect * (box.w / box.h);
    }

    // Fit inside the card: cap height, and cap width to the inner panel width
    // so a wide cut-out can't spill past the outline (2026-09-05).
    const maxW = panel.halfWidthCm * 2 - 6;
    const maxH = panel.halfHeightCm * 0.55;
    let h = maxH;
    if (h * aspect > maxW) h = maxW / aspect;
    const wCm = h * aspect;

    // Sit low in the card, clear of the (dropped) text block above — the image
    // was overlapping the reflection line (2026-09-05, was -0.38 * halfHeight).
    const localPos = new vec3(0, -panel.halfHeightCm * 0.48, 0.3);
    const outline: ThumbOutline = { color: new vec4(1, 1, 1, 1), widthCm: 0.5 };

    if (v.thumbPolygon && v.thumbPolygon.length >= 3) {
      try {
        const mat = (requireAsset("../Materials/ImageMaterial.mat") as Material).clone();
        (mat.mainPass as any).baseTex = thumb;
        (mat.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
        const cutout = makePolygonCutout(panel.contentAnchor, mat, v.thumbPolygon, h, localPos, outline);
        if (cutout) return;
        console.log("[Review] polygon cutout mesh failed — falling back to box/full frame");
      } catch (e) {
        console.log("[Review] cutout material bind failed — " + e);
      }
    }

    const imgObj = global.scene.createSceneObject("Thumbnail");
    imgObj.setParent(panel.contentAnchor);
    imgObj.getTransform().setLocalPosition(localPos);
    const img = imgObj.createComponent("Component.Image") as Image;
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
      }
    } catch (e) {
      console.log("[Review] thumbnail bind failed: " + e);
      return;
    }
    imgObj.getTransform().setLocalScale(new vec3(wCm, h, 1));
    // NOTE: no border here — the bbox-crop / full-frame tiers still contain
    // the background, so a rectangular outline would be "outline on the
    // original thumbnail". The white sticker outline is only added on the
    // real background-removed polygon cut-out (see makePolygonCutout).
  }

  /** Small solid-colour square in the panel's top-left, same technique as
   *  MomentEmotionReflect's emotion-picker swatches. */
  private decorateSwatch(panel: TitledPanel, hex: string): void {
    try {
      makeRectFrame(panel.contentAnchor, UI_LINE_MAT, {
        name: "EmotionSwatch",
        widthCm: 3,
        heightCm: 3,
        thicknessCm: 1.5,
        cornerFraction: 0.4,
        color: hexToVec4(hex),
        localPosition: new vec3(-panel.halfWidthCm + 3.5, panel.halfHeightCm - 3.5, 0.25),
      });
    } catch (e) {
      console.log("[Review] swatch build failed: " + e);
    }
  }

  /** Preview-only: seed 3 varied moments so the layout can be screenshotted
   *  without walking the whole capture flow. No-op once keptCount() > 0. */
  private maybeSeedDebugMoments(): void {
    if (!this.debugSeedMoments || this.journalSession.keptCount() > 0) return;
    console.log("[Review] debugSeedMoments -> seeding 3 moments");
    const seeds: [number, string, string, string, string][] = [
      [91, "ceramic mug", "happy", "#F2C94C", "The chip in the handle still makes me smile."],
      [92, "library book", "peaceful", "#5B8DEF", "Quiet corner, afternoon light."],
      [93, "train ticket", "surprising", "#E67E22", ""],
    ];
    for (const [order, label, emotion, hex, reflection] of seeds) {
      this.journalSession.keep(order, label, [label, "object"], "");
      this.journalSession.setMomentEmotion(order, emotion, hex);
      this.journalSession.setMomentReflection(order, reflection);
    }
    // If today's journal already exists, exercise the "Add to Today's Journal"
    // append path with the seeded moments (Preview verification only).
    const saved = this.todaySavedEntryFull();
    if (saved && !this.journalSession.isAppending()) {
      console.log("[Review] debugSeedMoments -> today already saved, hydrating for APPEND");
      this.journalSession.hydrateForAppend(saved);
    }
  }

  private todaySavedEntryFull(): JournalEntryData | null {
    try {
      const raw = global.persistentStorageSystem.store.getString(DAYS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const today = JournalEntry.today();
      const hit = (parsed as JournalEntryData[]).filter((e) => !!e && (e.date || "").slice(0, 10) === today);
      return hit.length > 0 ? hit[0] : null;
    } catch (e) {
      return null;
    }
  }

  // --- view-model ----------------------------------------------------

  private syncVms(traces: KeptTrace[]): void {
    this.vms = traces.map((t) => ({
      order: t.order,
      label: t.label,
      altLabels: [t.label, ...(t.altLabels || [])].filter(
        (l, i, arr) => l && arr.indexOf(l) === i
      ),
      labelIdx: 0,
      thumb: t.thumb,
      thumbBox: t.thumbBox,
      thumbPolygon: t.thumbPolygon,
      emotion: t.emotion ? t.emotion.charAt(0).toUpperCase() + t.emotion.slice(1) : "",
      emotionColor: t.emotionColor || "",
      reflection: t.reflection || "",
      captureTimeStr: t.captureTimeStr || "",
      included: !!t.includedInJournal,
    }));
  }

  /** True when the §13 store already holds an entry dated today — used to hide
   *  "Create Journal" so "Review Today" can't spawn a second entry for the same
   *  day (2026-09-06). */
  private todayAlreadySaved(): boolean {
    try {
      const raw = global.persistentStorageSystem.store.getString(DAYS_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return false;
      const today = JournalEntry.today();
      return (parsed as JournalEntryData[]).some((e) => !!e && (e.date || "").slice(0, 10) === today);
    } catch (e) {
      return false;
    }
  }

  // --- actions ---------------------------------------------------------

  private goHome(): void {
    console.log("[Review] Back -> Launch (Home)");
    this.flowManager.goTo(TraceScreen.Launch);
  }

  private continueToFeel(): void {
    const n = this.journalSession.includedOrders().length;
    if (n < 1 || n > 5) {
      this.hintMsg = "Select 1 to 5 moments to continue.";
      this.rebuild();
      console.log(`[Review] Continue blocked — ${n} moments selected`);
      return;
    }
    this.journalSession.logContents();
    console.log(`[Review] Continue -> Feel (${n} moment(s) selected)`);
    this.flowManager.goTo(TraceScreen.Feel);
  }

  // --- debug autopilot (Preview verification without hand taps) ------

  private delay(sec: number, fn: () => void): void {
    const e = this.createEvent("DelayedCallbackEvent");
    e.bind(() => fn());
    e.reset(sec);
  }

  private maybeAutopilot(): void {
    if (!this.debugAutopilot || this.autopilotRan || this.vms.length === 0) return;
    this.autopilotRan = true;
    console.log("[Review][Autopilot] start");

    this.delay(1.2, () => {
      console.log("[Review][Autopilot] step 1: Continue with the default selection");
      this.continueToFeel();
    });

    this.delay(2.4, () => console.log("[Review][Autopilot] done"));
  }
}
