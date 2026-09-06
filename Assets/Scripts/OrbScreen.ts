/**
 * OrbScreen.ts — Memorest "Save the day" screen (DESIGN.md v2 §11,
 * MVP priority 11).
 *
 * OWNS: folding the finished journal into ONE coloured sphere (colour =
 * `JournalEntry.orbColor`, the overall daily emotion chosen at §8) and the
 * privacy choice: **Keep Private** (default — the sphere is tucked away,
 * nothing stays floating in the world) or **Place in Space** (the sphere
 * stays visible where it was created). Either way the entry is written to
 * `global.persistentStorageSystem.store` as a small JSON array under one key
 * — the natural extension of `TraceJournalSpikeD_Persistence`'s single-entry
 * proof to the real multi-day list §12's monthly container will read later.
 * Real spatial anchoring for "Place in Space" (surviving a Lens restart in
 * the same physical spot) is explicitly deferred (DESIGN.md: "exact
 * same-room spatial persistence" is not MVP) — for now Placed just means the
 * sphere stays visible for the rest of this session instead of being torn
 * down immediately.
 *
 * PLACE IN SPACE — surface-follow -> pinch-release -> Confirm/Reset on the ball
 * (2026-09-05 rework; 2026-09-06 rebuilt on the Asset Library **WorldQueryHit**
 * package): tapping "Place in Space" does not save immediately and no
 * instruction window appears. The sphere detaches and, every frame, the World
 * Query module casts `hitTest(interactor.startPoint, interactor.endPoint, …)`
 * along the SIK hand-ray interactor at the real room mesh; the sphere rests ON
 * the surface it hits (hit + surface-normal * radius). A "Pinch to place"
 * billboard label rides above it and a VISIBLE line trace joins the hand
 * (`interactor.startPoint`) to the ball. When the ray leaves every surface the
 * ball holds the last good spot; before the first hit (and in the Editor, which
 * has no depth or hands) it hovers `placeDistanceCm` along the ray. RELEASING
 * the pinch (`InteractorTriggerType` -> None edge, the WorldQueryHit example's
 * drop gesture) freezes the ball and swaps the label for a horizontal
 * **Confirm / Reset** pair. Confirm reparents the sphere to the always-on
 * holder (world transform preserved) and runs the save path; Reset discards the
 * spot and resumes following. Editor/Preview: the mouse cursor (unprojected
 * through the camera) drives the follow and a screen tap is the drop.
 *
 * THE ORB MATERIAL (2026-09-05): the sphere uses the asset-library **Vertex
 * Distortion** graph shader (`Vertex Distortion.lspkg/Vertex Distortion.mat`)
 * — it wobbles the actual sphere vertices with animated noise (a real "wavy"
 * surface, not a normal-map fake) and exposes a plain albedo colour port.
 * `OrbLook.applyOrbLook(mat, entry.orbColor)` writes that port so each orb
 * takes the colour of the day's chosen feeling (§8), plus the shared wave
 * sliders (strength / speed / noise scale) + a matte roughness.
 *
 * THE FACE + GLOW (2026-09-06): `buildOrbGlow()` lays a camera-facing quad
 * textured with a baked radial white->transparent gradient over the orb, so it
 * reads white at the centre and the chosen colour at the rim — a view-radial
 * gradient without editing the graph shader. `buildOrbEyes()` adds two dark
 * vertical strokes ("|   |" Text, depth-test off) billboarded onto the orb's
 * camera-facing side with a gentle bob / glance / blink, so it reads as a
 * small creature. Both are torn down with the sphere / on placement.
 *
 * States: sphere (pop-in + Keep Private/Place in Space) -> saved
 * (confirmation + Done -> Home). Re-entering after already saving this
 * session goes straight to "saved" (idempotent — no double-write).
 *
 * Screen ROOT visibility is owned by ScreenRouter (enabled only on the Orb
 * state). Builds on wake / re-enable; tears down its PANEL (not the sphere,
 * if Placed) on disable. The root is placed in front of the user (yaw-only,
 * `spawnInFrontOfUser()`) on every entry, so the created-ball window AND the
 * saved-confirmation window both appear where the user is looking.
 *
 * @input flowManager    - Done -> Launch (Home)
 * @input journalSession - reads getEntry() to fold + reads/writes nothing else
 * @input orbMesh / orbMat - sphere geometry (wire to MarkerSphereMesh.mesh /
 *        Vertex Distortion.mat — the SAME assets OrbLook's own @inputs point at.
 *        requireAsset() cannot resolve these, so they come in as @inputs)
 * @input cameraObject   - the scene "Camera Object". Editor/Preview placement-ray
 *        fallback only (mirrors CaptureController) — device placement uses the
 *        dominant hand's own targeting ray, not the camera.
 * @input panelDistanceCm / sphereDiameterCm / placeDistanceCm - layout
 *
 * The orb look (wave strength/speed/noiseScale/rotationSpeedDegPerSec) and its
 * live real-time debug preview live on `OrbLook.ts`, attached to the ALWAYS-ON
 * `OrbSpawner` object — NOT here — because a disabled SceneObject's UpdateEvent
 * never fires, and this screen's root is disabled whenever the Orb screen
 * isn't active (see OrbLook.ts's class doc). This screen just calls
 * `applyOrbLook(mat, entry.orbColor)` + `getRotationSpeedDegPerSec()` when it
 * builds the real orb, so tuning in OrbLook and seeing it here on Save is the
 * same one look.
 * @input debugAutopilot - Preview-only: pop the sphere then tap Keep Private, then Done
 *
 * MUST NOT: call Gemini or own the screen state machine.
 */

import { FlowManager, TraceScreen } from "./FlowManager";
import { JournalSession } from "./JournalSession";
import { JournalEntry, JournalEntryData, EntryPrivacy } from "./JournalEntry";
import { PanelKit, TitledPanel } from "./PanelKit";
import { applyOrbLook, getRotationSpeedDegPerSec } from "./OrbLook";
import { buildSapling, dayOrbSapling, momentCountToStage, Sapling, sessionOrbStage } from "./Sapling";
import { findSavedById } from "./DayStore";
import { recordPlacement } from "./PlacedOrbStore";
import { persistStickers } from "./StickerStore";
import { applyFont } from "./UITheme";
import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import { SIK } from "SpectaclesInteractionKit.lspkg/SIK";
import { Interactor, InteractorTriggerType } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";

const DAYS_KEY = "traceJournal.days";

/** dayId -> the sphere left in the room by "Place in Space" THIS session (its
 *  world position isn't persisted, so this only holds the current run's placed
 *  orbs). JarScreen reads it to let you revisit the actual placed balls. */
export const sessionPlacedOrbs = new Map<string, SceneObject>();

const EYE_COLOR = new vec4(0.1, 0.11, 0.14, 1); // near-black slate

/** Tiny solid dark texture — the eye strokes are shaped by their mesh, this
 *  just fills them a flat near-black through the alpha-blended ImageMaterial. */
let _eyeTex: Texture | null = null;
export function eyeTexture(): Texture | null {
  if (_eyeTex) return _eyeTex;
  try {
    const tex = ProceduralTextureProvider.createWithFormat(4, 4, TextureFormat.RGBA8Unorm);
    const ctrl = tex.control as ProceduralTextureProvider;
    const d = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.round(EYE_COLOR.x * 255);
      d[i + 1] = Math.round(EYE_COLOR.y * 255);
      d[i + 2] = Math.round(EYE_COLOR.z * 255);
      d[i + 3] = 255;
    }
    ctrl.setPixels(0, 0, 4, 4, d);
    _eyeTex = tex;
    return tex;
  } catch (e) {
    return null;
  }
}

/** Alpha-blended textured material for the camera-facing "white core" glow disc
 *  that sits over the coloured orb (2026-09-06: white centre -> colour edge,
 *  view-radial — the graph-shader Fresnel this approximates). */
const GLOW_MAT_BASE = requireAsset("../Materials/ImageMaterial.mat") as Material;
/** White line material for the placement "tether" curve (renders white — same
 *  asset the reticle/gizmos use). */
const LINE_MAT_BASE = requireAsset("../Materials/UILine.mat") as Material;

/** Placement follow: never let the ball sit closer than this to the hand, and
 *  cast the surface ray this far. */
const PLACE_MIN_CM = 25;
const PLACE_MAX_CM = 320;
/** Length of the straight line trace drawn from the pinch point toward the ball
 *  during placement (2026-09-06: "a 20 cm long line trace between the player's
 *  gesture and the ball"). Stops short of the ball when it's nearer than this. */
const PLACE_TETHER_CM = 20;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Baked once: 128px RGBA, white with alpha 1 at the centre fading to 0 at the
 *  rim — laid over the coloured orb it reads as a soft white core. */
let _radialGlowTex: Texture | null = null;
export function radialGlowTexture(): Texture | null {
  if (_radialGlowTex) return _radialGlowTex;
  try {
    const N = 128;
    const tex = ProceduralTextureProvider.createWithFormat(N, N, TextureFormat.RGBA8Unorm);
    const ctrl = tex.control as ProceduralTextureProvider;
    const data = new Uint8Array(N * N * 4);
    const c = (N - 1) / 2;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x - c) / c;
        const dy = (y - c) / c;
        const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        // Tight bright core, then a long fade so the coloured orb reads over
        // most of the surface and only the very centre goes white. Peak dialled
        // 0.92 -> 0.85 and the innermost few px eased back so the dark eyes
        // (which sit dead-centre) keep their contrast (2026-09-06).
        let a = 1 - smoothstep(0.04, 0.82, d);
        a = Math.pow(a, 1.9) * 0.85;
        if (d < 0.16) a *= 0.6 + 0.4 * (d / 0.16); // soft dip right at the centre

        const i = (y * N + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(a * 255);
      }
    }
    ctrl.setPixels(0, 0, N, N, data);
    _radialGlowTex = tex;
    return tex;
  } catch (e) {
    console.log("[Orb] radialGlowTexture bake failed — " + e);
    return null;
  }
}

/**
 * The view-radial ORB GRADIENT (2026-09-06): a camera-facing disc textured
 * white at the very centre, ramping through a BRIGHT band of the day's feeling
 * colour, and fading to transparent at the rim. Laid over the (matte) sphere it
 * gives the "white core -> saturated colour edge" look a real Fresnel node
 * would — without a graph-shader edit (which can't be authored safely here).
 * One bake per distinct colour, cached.
 */
/** Overall strength of the orb's view-radial glow disc, 0..1
 *  (2026-09-06: "scale down the glowing effect to 50%"). */
const GLOW_ALPHA_SCALE = 0.5;
const _orbGradientCache: { [hex: string]: Texture } = {};
export function tintedOrbGradient(colorHex: string): Texture | null {
  const key = (colorHex || "#9AA0A6").toLowerCase();
  if (_orbGradientCache[key]) return _orbGradientCache[key];
  try {
    const h = key.replace("#", "");
    const R = parseInt(h.substring(0, 2), 16);
    const G = parseInt(h.substring(2, 4), 16);
    const B = parseInt(h.substring(4, 6), 16);
    const cr = isNaN(R) ? 154 : R;
    const cg = isNaN(G) ? 160 : G;
    const cb = isNaN(B) ? 166 : B;
    // Push the mid-band colour brighter so the ring reads as *glowing*, not
    // just the base sphere showing through.
    const gr = Math.min(255, cr * 1.22 + 22);
    const gg = Math.min(255, cg * 1.22 + 22);
    const gb = Math.min(255, cb * 1.22 + 22);

    const N = 128;
    const tex = ProceduralTextureProvider.createWithFormat(N, N, TextureFormat.RGBA8Unorm);
    const ctrl = tex.control as ProceduralTextureProvider;
    const data = new Uint8Array(N * N * 4);
    const c = (N - 1) / 2;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x - c) / c;
        const dy = (y - c) / c;
        const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));

        // white (d~0) -> day colour (by d~0.42), held out to the rim fade
        const mix = smoothstep(0.0, 0.42, d);
        const rr = Math.round(255 * (1 - mix) + gr * mix);
        const rg = Math.round(255 * (1 - mix) + gg * mix);
        const rb = Math.round(255 * (1 - mix) + gb * mix);

        // opaque through the core + colour band, soft fade at the rim
        let a = 1 - smoothstep(0.5, 0.94, d);
        a = Math.pow(a, 1.35);
        if (d < 0.14) a *= 0.55 + 0.45 * (d / 0.14); // dip so the dark eyes keep contrast
        a *= GLOW_ALPHA_SCALE;

        const i = (y * N + x) * 4;
        data[i] = rr;
        data[i + 1] = rg;
        data[i + 2] = rb;
        data[i + 3] = Math.round(a * 255);
      }
    }
    ctrl.setPixels(0, 0, N, N, data);
    _orbGradientCache[key] = tex;
    return tex;
  } catch (e) {
    console.log("[Orb] tintedOrbGradient bake failed — " + e);
    return null;
  }
}

function easeOutCubic(k: number): number {
  const c = Math.max(0, Math.min(1, k));
  return 1 - Math.pow(1 - c, 3);
}

@component
export class OrbScreen extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">OrbScreen — fold into a glowing sphere, save the day (§11)</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("FlowManager — Done -> Launch (Home).")
  flowManager!: FlowManager;
  @input
  @hint("JournalSession — reads getEntry() to fold into the sphere + persist.")
  journalSession!: JournalSession;
  @input
  @hint("Sphere mesh (wire to MarkerSphereMesh.mesh).")
  orbMesh!: RenderMesh;
  @input
  @hint("Orb shader material — cloned + tinted per entry (wire to Materials/OrbGlass.mat). A real shader graph (UberPBR) with Fresnel rim-light + normal-map features toggled on — see class doc.")
  orbMat!: Material;
  @input
  @hint("ALWAYS-ON holder a 'Placed' sphere is parented to — this script's own SceneObject is the toggled OrbRoot (ScreenRouter disables it off-screen), so a sphere left there would vanish instead of staying visible. Wire to an always-enabled object (e.g. CardSpawner's/OrbSpawner). Falls back to this.sceneObject (and so still vanishes/hides) if unwired.")
  @allowUndefined
  sphereParent!: SceneObject;
  @input
  @hint('The scene "Camera Object". Editor/Preview placement-ray fallback only — device placement uses the dominant hand\'s own targeting ray. Optional; the "Drop Here (Preview)" button just won\'t work in Preview if unwired.')
  @allowUndefined
  cameraObject!: SceneObject;
  @ui.group_end

  @ui.group_start("Copy")
  @input savedPrompt: string = "Today is folded away.";
  @input keepPrivateLabel: string = "Keep Private";
  @input placeLabel: string = "Place in Space";
  @input doneLabel: string = "Okay";
  @input
  @hint("Shown ON the floating sphere while it follows your hand (2026-09-05 — replaces the old instruction panel).")
  placeHintLabel: string = "Pinch to place";
  @input placeConfirmLabel: string = "Confirm";
  @input placeResetLabel: string = "Reset";
  @ui.group_end

  @ui.group_start("Settings")
  @input
  @hint("Local Z of the Orb panel relative to this screen root (cm, negative = in front).")
  panelDistanceCm: number = -100;
  @input
  @hint("Sphere diameter in cm.")
  sphereDiameterCm: number = 18;
  @input
  @hint("Distance (cm) out along the hand's/camera's forward ray the sphere floats while choosing where to place it.")
  @widget(new SliderWidget(20, 150, 1))
  placeDistanceCm: number = 60;
  @ui.group_end

  @ui.group_start("Debug")
  @input
  @hint("Preview-only: once the sphere pops in, tap Keep Private then Done automatically. Leave OFF for real use.")
  debugAutopilot: boolean = false;
  @input
  @hint("Preview-only: once the sphere pops in, begin placement, finalize it (stand-in for a pinch — Editor/Preview has no hand tracking) then Done automatically. Ignored if debugAutopilot is also on. Leave OFF for real use.")
  debugAutopilotPlace: boolean = false;
  @ui.group_end

  private ready = false;
  private panel: TitledPanel | null = null;
  private sphere: SceneObject | null = null;
  private saved = false;
  /** How many moments the entry had the last time saveDay() ran. If the entry
   *  later GROWS (an "Add to Today's Journal" append + regenerate), re-entering
   *  the Orb screen re-opens the sphere flow instead of the folded-away panel,
   *  so the sapling gets to grow for the added moment(s). */
  private savedMomentCount = -1;
  private savedPrivacy: EntryPrivacy | "" = "";
  /** Where the ball was parked (world) + its world radius — so the "Today is
   *  folded away" panel can sit just above it instead of dead-ahead (2026-09-06). */
  private lastPlacedWorldPos: vec3 | null = null;
  private lastPlacedRadiusCm = 0;
  private autopilotRan = false;
  private store = global.persistentStorageSystem.store;

  // --- placing (hand-follow -> pinch -> Confirm/Reset on the sphere) ------
  /** true = sphere follows the aim ray, "Pinch to place" shown. */
  private placing = false;
  /** true = sphere frozen at the pinch spot, Confirm/Reset shown on it. */
  private awaitingConfirm = false;
  private worldQuery = require("LensStudio:WorldQueryModule") as WorldQueryModule;
  private placeHitSession: HitTestSession | null = null;
  /** getTime() when placement started — a short arm delay so the pinch that
   *  pressed "Place in Space" doesn't immediately count as the drop gesture. */
  private placeArmedT = 0;
  /** true once we've seen the interactor's trigger held during placement, so a
   *  release only counts after a real fresh pinch. */
  private placeSawTrigger = false;
  /** getTime() of the last placement diagnostic log (throttled). */
  private placeDiagT = 0;
  /** Latest WorldQuery surface hit this frame while following (async, ~5 Hz) —
   *  null = the ray missed every real surface this frame. */
  private placeHitPos: vec3 | null = null;
  /** The most recent VALID surface hit — kept so that when the aim ray briefly
   *  leaves a surface the preview ball stays parked on the last real spot
   *  ("it can only be placed on the surface") instead of snapping out to a
   *  mid-air fallback distance. */
  private placeLastGoodHit: vec3 | null = null;
  /** Smoothed world position the sphere is easing toward while following. */
  private followPos: vec3 | null = null;
  /** The curved "tether" line drawn from the pinch/hand to the floating ball. */
  private placeTraceObj: SceneObject | null = null;
  private placeTapEvent: TapEvent | null = null;
  private placeHintObj: SceneObject | null = null;
  private placeConfirmPanel: TitledPanel | null = null;
  private placeConfirmHolder: SceneObject | null = null;
  /** The "Today is folded away." panel over a placed ball + its world anchor —
   *  billboarded to the camera every frame while it's up. */
  private savedPanelRoot: SceneObject | null = null;
  private savedPanelAnchor: vec3 | null = null;
  /** Editor/Preview only: latest mouse-cursor screen position (normalised, top-
   *  left origin). Drives the placement preview when there's no tracked hand,
   *  so the ball follows the cursor at `placeDistanceCm` (device has no mouse
   *  and uses the real hand). */
  private editorCursor: vec2 = new vec2(0.5, 0.5);
  /** Two vertical eye strokes that ride on the orb's camera-facing side so it
   *  reads as a small creature (2026-09-05). Billboarded + blinking + a gentle
   *  "alive" bob, each frame. */
  private orbEyes: SceneObject | null = null;
  private orbEyeL: SceneObject | null = null;
  private orbEyeR: SceneObject | null = null;
  private eyeGap = 6;
  /** Camera-facing white-core glow disc laid over the orb. */
  private orbGlow: SceneObject | null = null;
  /** The little plant on top of the orb — grows with the day's moment count. */
  private orbSapling: Sapling | null = null;
  /** dayId + target stage for the live sapling; committed to `sessionOrbStage`
   *  only once the grow tween settles (see onUpdate). */
  private orbSaplingEid = "";
  private orbSaplingStage = 0;
  private eyeBlinkTimer = 2.2; // seconds until the next blink
  private eyeBlink = 0; // 0 open .. 1 closed
  private eyeBlinkDir = 0; // -1 opening, 0 idle, +1 closing
  private eyeLiveT = 0;

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
    this.createEvent("OnDisableEvent").bind(() => {
      // Leaving the screen mid-placement — tear down the follow + pinch
      // listener + on-sphere UI so nothing dangles.
      if (this.placing || this.awaitingConfirm) this.endPlacement();
      this.teardownPanel();
    });
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());

    // Editor/Preview: track the mouse cursor so the placement preview can
    // follow it (there's no hand tracking or WorldQuery depth in the Editor).
    if (global.deviceInfoSystem.isEditor()) {
      const onCursor = (ev: { getTouchPosition: () => vec2 }) => {
        try {
          this.editorCursor = ev.getTouchPosition();
        } catch (e) {
          /* ignore */
        }
      };
      (this.createEvent("TouchMoveEvent") as any).bind(onCursor);
      (this.createEvent("TouchStartEvent") as any).bind(onCursor);
    }
  }

  // --- build / teardown ---------------------------------------------------

  private teardownPanel(): void {
    if (this.panel) {
      try {
        this.panel.destroy();
      } catch (e) {
        /* already gone with its parent */
      }
      this.panel = null;
    }
    this.savedPanelRoot = null;
    this.savedPanelAnchor = null;
  }

  /** Move this screen's root to the camera's position, facing the way the
   *  camera looks (flattened to the horizon). Panels are children at local -Z,
   *  so this puts them IN FRONT of the user. Uses `quat.lookAt` on the flattened
   *  view vector rather than a yaw euler — euler decomposition flips 180° when
   *  the head is pitched, which is what put these panels BEHIND the user. */
  private spawnInFrontOfUser(): void {
    if (isNull(this.cameraObject)) return;
    const camT = this.cameraObject.getTransform();
    this.sceneObject.getTransform().setWorldPosition(camT.getWorldPosition());
    // camT.forward points BEHIND the view; that's exactly the root's local +Z
    // (so local -Z = view direction). Flatten to the horizon.
    let f = camT.forward;
    let flat = new vec3(f.x, 0, f.z);
    if (flat.length < 1e-4) flat = new vec3(0, 0, 1);
    this.sceneObject.getTransform().setWorldRotation(quat.lookAt(flat.normalize(), vec3.up()));
  }

  /** Only the sphere itself is torn down when leaving — NOT on every screen
   *  disable, since a "Placed" sphere is meant to stay visible. Called
   *  explicitly by Keep Private and on a fresh rebuild() before a new one. */
  private destroySphere(): void {
    if (this.sphere && !isNull(this.sphere)) {
      try {
        this.sphere.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    this.sphere = null;
    this.destroyOrbEyes();
    this.destroyOrbGlow();
    this.destroyOrbSapling();
  }

  /** Build the plant for today's orb. It animates from the stage the day was
   *  ALREADY at — the count last shown this session, or (for a journal from an
   *  earlier session) the count saved on disk — up to today's new moment count,
   *  so adding captures to an existing journal visibly grows the sapling by the
   *  number of moments added. A brand-new journal grows 0 -> N. */
  private buildOrbSapling(entry: { id: string; selectedMomentIds: number[] }): void {
    this.destroyOrbSapling();
    const moments = (entry.selectedMomentIds || []).length;
    const stage = momentCountToStage(moments);
    const eid = entry.id || "";
    // The persisted entry still holds the PRE-append moment count here (DayStore
    // isn't rewritten until saveDay() later), so it's the right "before" value
    // for a journal carried over from a previous session.
    const savedPrev = eid
      ? momentCountToStage(((findSavedById(eid) || ({} as any)).selectedMomentIds || []).length)
      : 0;
    const sessionPrev =
      eid && sessionOrbStage.has(eid) ? (sessionOrbStage.get(eid) as number) : 0;
    const prev = Math.min(stage, Math.max(savedPrev, sessionPrev));
    const sap = buildSapling(this.sceneObject, this.sphereDiameterCm);
    sap.snapToStage(prev);
    sap.setStage(stage);
    this.orbSapling = sap;
    // Remember the target, but DON'T commit it to sessionOrbStage yet — only
    // once the grow tween has actually played out (onUpdate). Committing here
    // meant a second rebuild() in the same screen entry saw sessionPrev===stage
    // and skipped the animation entirely (the "I didn't see it grow" bug).
    this.orbSaplingEid = eid;
    this.orbSaplingStage = stage;
    console.log(
      `[Orb] sapling — stage ${prev} -> ${stage} (moments=${moments}, savedPrev=${savedPrev}, sessionPrev=${sessionPrev})`
    );
  }

  private destroyOrbSapling(): void {
    if (this.orbSapling) {
      try {
        this.orbSapling.destroy();
      } catch (e) {
        /* ignore */
      }
      this.orbSapling = null;
    }
  }

  private rebuild(): void {
    if (isNull(this.flowManager) || isNull(this.journalSession)) {
      console.log("[Orb] ERROR: required @inputs not wired — screen inert");
      return;
    }
    this.teardownPanel();

    // Only stand up while actually on the Orb screen (the root can be
    // briefly enabled at scene start before ScreenRouter's first apply()
    // disables it — same guard as the other screens).
    if (this.flowManager.current !== TraceScreen.Orb) return;

    // An "Add to Today's Journal" append grew the entry after it was already
    // saved this session. Don't re-run Keep Private / Place in Space (that reads
    // as a second journal / a second ball) — show the day's sphere growing its
    // plant, re-persist the SAME entry, and bump the room ball's plant to match.
    if (this.saved && this.savedMomentCount >= 0) {
      const liveCount = (this.journalSession.getEntry().selectedMomentIds || []).length;
      if (liveCount !== this.savedMomentCount) {
        console.log(
          `[Orb] entry moved ${this.savedMomentCount} -> ${liveCount} moments — revise-in-place`
        );
        this.buildAppendRevisePanel();
        return;
      }
    }

    if (this.saved) {
      this.buildSavedPanel();
      return;
    }
    this.buildSpherePanel();
  }

  private buildSpherePanel(): void {
    const entry = this.journalSession.getEntry();
    this.destroySphere();

    // Sphere raised (2026-09-05) so the whole sphere-over-panel stack reads
    // centred in view instead of the panel hanging off the bottom.
    const sphereLocalY = 14;

    if (!isNull(this.orbMesh) && !isNull(this.orbMat)) {
      const holder = this.sceneObject;
      const obj = this.buildOrb(holder, new vec3(0, sphereLocalY, this.panelDistanceCm + 6), entry.orbColor || "#9AA0A6");
      this.sphere = obj;
      this.buildOrbSapling(entry);

      const d = this.sphereDiameterCm;
      this.tweens.push({
        obj,
        t0: getTime(),
        dur: 0.5,
        step: (e: number) => {
          const s = d * (0.05 + 0.95 * e);
          obj.getTransform().setLocalScale(new vec3(s, s, s));
        },
      });
    } else {
      console.log("[Orb] orbMesh/orbMat not wired — sphere skipped, panel still shown");
    }

    // 2026-09-05: the panel sits BELOW the sphere (its top edge clears the
    // sphere's bottom) instead of overlapping it; no surface outline; the two
    // choices are a horizontal row scaled down so the button row is about as
    // wide as the title text rather than a full 44cm bar.
    const panelH = 32;
    const panelGap = 4;
    const panelCY = sphereLocalY - this.sphereDiameterCm / 2 - panelGap - panelH / 2;
    const panel = PanelKit.create(this.sceneObject, {
      name: "OrbPanel",
      title: entry.title || "One day, one sphere.",
      body: `Feeling: ${entry.feeling || "—"}`,
      widthCm: 38,
      heightCm: panelH,
      localPosition: new vec3(0, panelCY, this.panelDistanceCm),
      buttonsVertical: false,
      frameless: true,
    });
    panel.addButton(this.keepPrivateLabel, () => this.saveDay("private"));
    panel.addButton(this.placeLabel, () => this.beginPlacement());
    this.panel = panel;

    console.log(`[Orb] sphere built — colour=${entry.orbColor || "(none)"} feeling="${entry.feeling}"`);
    this.maybeAutopilot();
  }

  /** "Add to Today's Journal" landed on the Orb screen after the day was already
   *  saved this session. Show the day's sphere growing its plant by the added
   *  moment(s), then on Done re-persist the SAME entry (upsert by id — one
   *  journal per day) + its stickers and snap the room ball's plant to match.
   *  No Keep Private / Place in Space, no new ball, no re-placement. */
  private buildAppendRevisePanel(): void {
    this.spawnInFrontOfUser();
    const entry = this.journalSession.getEntry();
    const eid = entry.id || "";
    const newCount = (entry.selectedMomentIds || []).length;
    const newStage = momentCountToStage(newCount);

    this.destroySphere();
    const sphereLocalY = 14;
    if (!isNull(this.orbMesh) && !isNull(this.orbMat)) {
      const obj = this.buildOrb(
        this.sceneObject,
        new vec3(0, sphereLocalY, this.panelDistanceCm + 6),
        entry.orbColor || "#9AA0A6"
      );
      this.sphere = obj;
      this.buildOrbSapling(entry); // animates savedPrev -> newStage where the user is looking
      const d = this.sphereDiameterCm;
      this.tweens.push({
        obj,
        t0: getTime(),
        dur: 0.5,
        step: (e: number) => {
          const s = d * (0.05 + 0.95 * e);
          obj.getTransform().setLocalScale(new vec3(s, s, s));
        },
      });
    }

    const panelH = 34;
    const panelGap = 4;
    const panelCY = sphereLocalY - this.sphereDiameterCm / 2 - panelGap - panelH / 2;
    const panel = PanelKit.create(this.sceneObject, {
      name: "OrbRevise",
      title: "Added to today.",
      body: "Your sphere grew a little.",
      widthCm: 40,
      heightCm: panelH,
      localPosition: new vec3(0, panelCY, this.panelDistanceCm),
      buttonsVertical: true,
      titleSize: 110,
    });
    panel.addButton(this.doneLabel, () => this.finishRevise(entry, eid, newCount, newStage));
    this.panel = panel;

    console.log(`[Orb] append-revise — sphere growth to ${newCount} moment(s) (stage ${newStage})`);

    if (this.debugAutopilot && !this.autopilotRan) {
      this.autopilotRan = true;
      this.delay(2.0, () => {
        console.log("[Orb][Autopilot] append-revise: Done");
        this.finishRevise(entry, eid, newCount, newStage);
      });
    }
  }

  private finishRevise(
    entry: JournalEntry,
    eid: string,
    newCount: number,
    newStage: number
  ): void {
    if (this.savedPrivacy) entry.privacy = this.savedPrivacy;
    this.persistEntry(entry.toData()); // upsert by id — still ONE journal for today
    try {
      const sel = entry.selectedMomentIds || [];
      const traces = this.journalSession
        .keptTraces()
        .filter((t) => (sel.length ? sel.indexOf(t.order) >= 0 : !!t.includedInJournal));
      persistStickers(entry.id, traces, true);
    } catch (e) {
      console.log("[Orb] revise persistStickers failed — " + e);
    }
    const roomSap = eid ? dayOrbSapling.get(eid) : undefined;
    if (roomSap) roomSap.snapToStage(newStage); // the already-placed ball, grown in place
    this.savedMomentCount = newCount;
    if (this.orbSaplingEid) sessionOrbStage.set(this.orbSaplingEid, this.orbSaplingStage);
    this.destroySphere();
    console.log(`[Orb] revised ${eid} -> ${newCount} moment(s); room ball plant -> stage ${newStage}`);
    this.flowManager.goTo(TraceScreen.Launch);
  }

  /**
   * Builds one orb mesh + Vertex-Distortion material clone at `localPos` under
   * `parent`, colouring it `colorHex` (the day's feeling) via OrbLook's
   * `applyOrbLook` and registering it for the slow continuous spin every orb
   * gets. The real-time debug preview lives entirely in OrbLook.ts — this
   * builds only the real, saved orb.
   */
  private buildOrb(parent: SceneObject, localPos: vec3, colorHex: string): SceneObject {
    const obj = global.scene.createSceneObject("MemoryOrb");
    obj.setParent(parent);
    obj.getTransform().setLocalPosition(localPos);
    obj.getTransform().setLocalScale(new vec3(0.05, 0.05, 0.05));
    const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    rmv.mesh = this.orbMesh;
    const mat = this.orbMat.clone();
    applyOrbLook(mat, colorHex);
    rmv.clearMaterials();
    rmv.addMaterial(mat);
    this.spinners.push({ obj, degPerSec: getRotationSpeedDegPerSec(), angle: 0 });
    this.buildOrbGlow(colorHex);
    this.buildOrbEyes(); // eyes last so they read on top of the glow
    return obj;
  }

  /** A camera-facing quad textured with the white-core -> day-colour -> clear
   *  radial gradient, laid over the orb so it reads as a glowing gem — the
   *  view-radial gradient a Fresnel node would give, without a graph edit. */
  private buildOrbGlow(colorHex?: string): void {
    this.destroyOrbGlow();
    const tex = tintedOrbGradient(colorHex || "#9AA0A6") || radialGlowTexture();
    if (!tex) return;
    const o = global.scene.createSceneObject("OrbGlow");
    o.setParent(this.sceneObject);
    const rmv = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const mb = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    mb.topology = MeshTopology.Triangles;
    mb.indexType = MeshIndexType.UInt16;
    const s = this.sphereDiameterCm * 0.8; // half-size; disc ~1.6x the orb
    mb.appendVerticesInterleaved([
      -s, -s, 0, 0, 0,
      s, -s, 0, 1, 0,
      s, s, 0, 1, 1,
      -s, s, 0, 0, 1,
    ]);
    mb.appendIndices([0, 1, 2, 0, 2, 3]);
    rmv.mesh = mb.getMesh();
    mb.updateMesh();
    const m = GLOW_MAT_BASE.clone();
    try {
      (m.mainPass as any).baseTex = tex;
      (m.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
      (m.mainPass as any).depthTest = false; // always composite over the wobbling orb
      (m.mainPass as any).depthWrite = false;
      (m.mainPass as any).twoSided = true;
    } catch (e) {
      /* ignore */
    }
    rmv.clearMaterials();
    rmv.addMaterial(m);
    this.orbGlow = o;
  }

  private destroyOrbGlow(): void {
    if (this.orbGlow && !isNull(this.orbGlow)) {
      try {
        this.orbGlow.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    this.orbGlow = null;
  }

  /** Two dark VERTICAL eye strokes with ROUNDED ends (stadium meshes) on a
   *  holder parented to this screen root (NOT the orb — the orb spins). Each
   *  bar is its own child so it can be bobbed / squashed (blink) without
   *  disturbing the holder's billboard. depthTest off so they always read on
   *  the wobbling orb. updateOrbEyes() billboards + animates them each frame. */
  private buildOrbEyes(): void {
    this.destroyOrbEyes();
    const d = this.sphereDiameterCm;
    const holder = global.scene.createSceneObject("OrbEyes");
    holder.setParent(this.sceneObject);

    const halfLen = d * 0.08; // stroke half-length (2026-09-06: halved — was 0.16)
    const r = Math.max(0.2, d * 0.025); // half-thickness = cap radius (round ends)
    this.eyeGap = d * 0.17; // halved from 0.34
    this.orbEyeL = this.makeEyeBar(holder, -this.eyeGap * 0.5, halfLen, r);
    this.orbEyeR = this.makeEyeBar(holder, this.eyeGap * 0.5, halfLen, r);

    this.eyeBlink = 0;
    this.eyeBlinkDir = 0;
    this.eyeBlinkTimer = 2.0 + Math.random() * 2.5;
    this.eyeLiveT = 0;
    this.orbEyes = holder;
  }

  /** One vertical stadium (rectangle + semicircle caps) at local X. */
  private makeEyeBar(parent: SceneObject, x: number, halfLen: number, r: number): SceneObject {
    const o = global.scene.createSceneObject("Eye");
    o.setParent(parent);
    o.getTransform().setLocalPosition(new vec3(x, 0, 0));
    const rmv = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const mb = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    mb.topology = MeshTopology.Triangles;
    mb.indexType = MeshIndexType.UInt16;
    const verts: number[] = [0, 0, 0, 0.5, 0.5];
    const idx: number[] = [];
    const perim: number[] = [];
    const push = (px: number, py: number) => {
      perim.push(verts.length / 5);
      verts.push(px, py, 0, 0.5, 0.5);
    };
    const CAP = 7;
    push(r, -halfLen);
    push(r, halfLen);
    for (let i = 1; i < CAP; i++) {
      const a = (i / CAP) * Math.PI; // top round cap
      push(Math.cos(a) * r, halfLen + Math.sin(a) * r);
    }
    push(-r, halfLen);
    push(-r, -halfLen);
    for (let i = 1; i < CAP; i++) {
      const a = Math.PI + (i / CAP) * Math.PI; // bottom round cap
      push(Math.cos(a) * r, -halfLen + Math.sin(a) * r);
    }
    for (let i = 0; i < perim.length; i++) {
      idx.push(0, perim[i], perim[(i + 1) % perim.length]);
    }
    mb.appendVerticesInterleaved(verts);
    mb.appendIndices(idx);
    rmv.mesh = mb.getMesh();
    mb.updateMesh();
    const m = GLOW_MAT_BASE.clone();
    const tex = eyeTexture();
    try {
      if (tex) (m.mainPass as any).baseTex = tex;
      (m.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
      (m.mainPass as any).twoSided = true;
      (m.mainPass as any).depthTest = false;
      (m.mainPass as any).depthWrite = false;
    } catch (e) {
      /* ignore */
    }
    rmv.clearMaterials();
    rmv.addMaterial(m);
    return o;
  }

  private destroyOrbEyes(): void {
    if (this.orbEyes && !isNull(this.orbEyes)) {
      try {
        this.orbEyes.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    this.orbEyes = null;
    this.orbEyeL = null;
    this.orbEyeR = null;
  }

  /** Each frame while the orb exists: billboard the eye holder onto the orb's
   *  camera-facing surface, run a gentle "alive" bob, and drive the blink. */
  private updateOrbEyes(): void {
    if (!this.orbEyes || isNull(this.orbEyes) || !this.sphere || isNull(this.sphere)) return;
    if (isNull(this.cameraObject)) return;
    const dt = getDeltaTime();
    this.eyeLiveT += dt;

    const spherePos = this.sphere.getTransform().getWorldPosition();
    const camPos = this.cameraObject.getTransform().getWorldPosition();
    let toCam = camPos.sub(spherePos);
    if (toCam.length < 1e-3) toCam = new vec3(0, 0, 1);
    toCam = toCam.normalize();
    const radius = (this.sphere.getTransform().getWorldScale().x || this.sphereDiameterCm) * 0.5;

    const faceRot = quat.lookAt(toCam, vec3.up()); // local +Z -> toward camera

    if (this.orbGlow && !isNull(this.orbGlow)) {
      const g = this.orbGlow.getTransform();
      g.setWorldPosition(spherePos.add(toCam.uniformScale(radius * 1.0)));
      g.setWorldRotation(faceRot);
    }

    const t = this.orbEyes.getTransform();
    t.setWorldPosition(spherePos.add(toCam.uniformScale(radius * 1.03)));
    t.setWorldRotation(faceRot);

    // "Alive": a small vertical bob + a slow side-to-side glance, applied per
    // eye bar (NOT the holder — that would break the billboard).
    const bob = Math.sin(this.eyeLiveT * 2.1) * (radius * 0.05);
    const glance = Math.sin(this.eyeLiveT * 0.7) * (radius * 0.06);

    // Blink: count down, snap closed (squash Y), then re-open.
    if (this.eyeBlinkDir === 0) {
      this.eyeBlinkTimer -= dt;
      if (this.eyeBlinkTimer <= 0) this.eyeBlinkDir = 1;
    } else if (this.eyeBlinkDir === 1) {
      this.eyeBlink = Math.min(1, this.eyeBlink + dt / 0.09);
      if (this.eyeBlink >= 1) this.eyeBlinkDir = -1;
    } else {
      this.eyeBlink = Math.max(0, this.eyeBlink - dt / 0.12);
      if (this.eyeBlink <= 0) {
        this.eyeBlinkDir = 0;
        this.eyeBlinkTimer = 2.0 + Math.random() * 3.5;
      }
    }
    const openY = 1 - 0.9 * this.eyeBlink;
    if (this.orbEyeL && !isNull(this.orbEyeL))
      this.setEyeBar(this.orbEyeL, -this.eyeGap * 0.5 + glance, bob, openY);
    if (this.orbEyeR && !isNull(this.orbEyeR))
      this.setEyeBar(this.orbEyeR, this.eyeGap * 0.5 + glance, bob, openY);
  }

  private setEyeBar(o: SceneObject, x: number, y: number, openY: number): void {
    const t = o.getTransform();
    t.setLocalPosition(new vec3(x, y, 0.05));
    t.setLocalScale(new vec3(1, openY, 1));
  }

  private buildSavedPanel(): void {
    this.spawnInFrontOfUser(); // covers the kept-private case + a fallback

    const placedNearBall =
      this.savedPrivacy === "placed" &&
      this.lastPlacedWorldPos !== null &&
      !isNull(this.cameraObject);

    const savedH = 36;
    const panel = PanelKit.create(this.sceneObject, {
      name: "OrbSaved",
      title: this.savedPrompt,
      body: this.savedPrivacy === "placed" ? "Placed in space." : "Kept private.",
      widthCm: 40,
      heightCm: savedH, // title/body/Okay were overlapping at 26
      localPosition: new vec3(0, placedNearBall ? 0 : 9 - savedH / 2, this.panelDistanceCm),
      buttonsVertical: true,
      titleSize: 110, // fit "Today is folded away." on one line
    });
    panel.addButton(this.doneLabel, () => {
      console.log("[Orb] Okay -> Launch (Home)");
      this.flowManager.goTo(TraceScreen.Launch);
    });
    this.panel = panel;

    // "Placed": float "Today is folded away." just ABOVE the parked ball and
    // keep it facing the user every frame (onUpdate). `faceCameraFlat` uses
    // `quat.lookAt` (robust) rather than a yaw euler, so it can't flip behind.
    if (placedNearBall) {
      const ballPos = this.lastPlacedWorldPos as vec3;
      const gap = this.lastPlacedRadiusCm + panel.halfHeightCm + 4;
      this.savedPanelAnchor = ballPos.add(new vec3(0, gap, 0));
      this.savedPanelRoot = panel.root;
      this.faceCameraFlat(panel.root.getTransform(), this.savedPanelAnchor);
      console.log(`[Orb] "Today is folded away" anchored above the ball at ${this.savedPanelAnchor}`);
    } else {
      this.savedPanelAnchor = null;
      this.savedPanelRoot = null;
    }
  }

  // --- §11 save ------------------------------------------------------

  private saveDay(privacy: EntryPrivacy): void {
    if (this.saved) return; // idempotent — a second tap (e.g. debug/dup) can't double-write
    const entry = this.journalSession.getEntry();
    entry.privacy = privacy;
    this.persistEntry(entry.toData());

    // Persist the included moments' cut-out stills so the Memory Jar can still
    // show the day's stickers after the Lens is closed and reopened (the live
    // JournalSession textures don't survive a restart).
    try {
      const appending = !isNull(this.journalSession) && this.journalSession.isAppending();
      const sel = entry.selectedMomentIds || [];
      const traces = this.journalSession
        .keptTraces()
        .filter((t) => (sel.length ? sel.indexOf(t.order) >= 0 : !!t.includedInJournal));
      persistStickers(entry.id, traces, appending);
    } catch (e) {
      console.log("[Orb] persistStickers failed — " + e);
    }

    if (privacy === "private") {
      // Tucked away — nothing stays floating in the world.
      this.destroySphere();
    }
    // "placed": by the time this runs, finalizePlacement() has already
    // reparented the sphere (world transform preserved, so no jump) to the
    // always-on holder and nulled `this.sphere` — nothing left to do here.

    this.saved = true;
    this.savedMomentCount = (entry.selectedMomentIds || []).length;
    this.savedPrivacy = privacy;
    console.log(`[Orb] saved — privacy="${privacy}" id=${entry.id} moments=${this.savedMomentCount}`);
    this.rebuild();
  }

  // --- placing: hand-follow -> pinch -> Confirm/Reset on the sphere ------

  /**
   * "Place in Space" (2026-09-06 rework, built on the Asset Library
   * **WorldQueryHit** package's pattern): the sphere detaches and every frame is
   * cast onto the real room mesh with the **World Query module** along the
   * SIK hand-ray interactor's `startPoint → endPoint`, and rested ON the surface
   * it hits (position + surface-normal * radius). A "Pinch to place" label rides
   * above it and a VISIBLE line trace connects the hand (`interactor.startPoint`)
   * to the ball. Releasing the pinch (`InteractorTriggerType` None edge — the
   * same drop gesture the WorldQueryHit example uses) freezes the sphere and
   * swaps the label for a horizontal Confirm / Reset pair. Editor/Preview has no
   * hand or depth, so a screen tap stands in for the drop and the mouse cursor
   * (unprojected through the camera) drives the follow.
   */
  private beginPlacement(): void {
    if (this.placing || this.awaitingConfirm) return;
    if (isNull(this.sphere)) {
      console.log("[Orb] Place in Space: no sphere built — saving directly");
      this.saveDay("placed");
      return;
    }
    this.placing = true;
    this.awaitingConfirm = false;
    this.followPos = null;
    this.placeHitPos = null;
    this.placeLastGoodHit = null;
    this.placeArmedT = getTime();
    this.placeSawTrigger = false;
    this.teardownPanel(); // hide Keep Private / Place in Space
    this.ensurePlaceHitSession();
    this.showPlaceHint();
    this.buildPlaceTrace();
    this.subscribePlaceTap();
    console.log("[Orb] placing — World Query surface follow along the SIK hand ray; release the pinch (or tap in Preview) to drop it");
  }

  /** Editor/Preview only: a screen TapEvent stands in for the pinch-release
   *  drop gesture. On device the drop is the interactor trigger-release edge,
   *  handled in updatePlacementFollow(). */
  private subscribePlaceTap(): void {
    this.unsubscribePlaceTap();
    if (global.deviceInfoSystem.isEditor()) {
      this.placeTapEvent = this.createEvent("TapEvent");
      this.placeTapEvent.bind(() => this.onPlacePinch());
    }
  }

  private unsubscribePlaceTap(): void {
    if (this.placeTapEvent) {
      try {
        this.removeEvent(this.placeTapEvent);
      } catch (e) {
        /* already gone */
      }
      this.placeTapEvent = null;
    }
  }

  /** WorldQueryHit-style session: filtered (smoothed) hit results. */
  private ensurePlaceHitSession(): void {
    if (this.placeHitSession || global.deviceInfoSystem.isEditor()) return;
    try {
      const opts = HitTestSessionOptions.create();
      opts.filter = true;
      this.placeHitSession = this.worldQuery.createHitTestSessionWithOptions(opts);
      this.placeHitSession.start();
      console.log("[Orb] WorldQuery hit-test session started (filtered) — placement uses the World Query module + SIK hand ray");
    } catch (e) {
      try {
        this.placeHitSession = this.worldQuery.createHitTestSession();
        this.placeHitSession.start();
        console.log("[Orb] WorldQuery hit-test session started (unfiltered fallback)");
      } catch (e2) {
        console.log("[Orb] WorldQuery hit session unavailable — ball floats on the ray only: " + e2);
        this.placeHitSession = null;
      }
    }
  }

  /** The SIK interactor that's currently targeting: the HandInteractor's hand
   *  ray on device, the MouseInteractor's cursor ray in Preview (SIK only
   *  registers the mouse one in the Editor). Null if none is ready. Mirrors the
   *  WorldQueryHit example. */
  private getPlaceInteractor(): Interactor | null {
    try {
      const list = SIK.InteractionManager.getTargetingInteractors();
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (it && it.isActive() && it.isTargeting() && it.startPoint && it.endPoint) return it;
      }
    } catch (e) {
      /* SIK not ready */
    }
    return null;
  }

  /** Pinch (device) / tap (Preview) while following — freeze the sphere here
   *  and offer Confirm / Reset on it. Ignored once already awaiting confirm. */
  private onPlacePinch(): void {
    if (!this.placing || this.awaitingConfirm) return;
    this.placing = false;
    this.awaitingConfirm = true;
    this.hidePlaceHint();
    this.hidePlaceTrace();
    this.buildPlaceConfirmUI();
    console.log("[Orb] placing — spot chosen, awaiting Confirm/Reset");
  }

  /** Confirm — commit the sphere where it sits and run the normal save path.
   *  2026-09-06: the creature FACE + glow now stay ON the placed orb (frozen in
   *  their last camera-facing orientation) so the parked ball keeps its look,
   *  and the orb is registered in `sessionPlacedOrbs` so JarScreen can revisit
   *  the real placed balls. */
  private finalizePlacement(): void {
    if (!this.placing && !this.awaitingConfirm) return;
    this.endPlacement();

    if (this.sphere && !isNull(this.sphere)) {
      // this script's own SceneObject IS the toggled OrbRoot — ScreenRouter
      // disables it the moment the user leaves this screen, so a sphere left
      // parented here would vanish. Reparent to an always-on holder, world
      // transform preserved so it doesn't jump.
      const holder = !isNull(this.sphereParent) ? this.sphereParent : this.sceneObject;
      this.sphere.setParentPreserveWorldTransform(holder);
      // Move the glow + face onto the placed orb (world transform preserved) so
      // they travel with it and stay visible in the room. GLOW FIRST so the
      // eyes end up the later sibling and render ON TOP of the white core —
      // otherwise the glow's bright centre washes the eyes out (2026-09-06).
      if (this.orbGlow && !isNull(this.orbGlow)) this.orbGlow.setParentPreserveWorldTransform(this.sphere);
      if (this.orbEyes && !isNull(this.orbEyes)) this.orbEyes.setParentPreserveWorldTransform(this.sphere);
      // The plant travels with the parked orb too — frozen at its last grown
      // state (world transform preserved so it doesn't jump or rescale).
      if (this.orbSapling && !isNull(this.orbSapling.root)) {
        this.orbSapling.root.setParentPreserveWorldTransform(this.sphere);
      }
      // Stop the slow spin so the frozen face doesn't rotate away.
      this.spinners = this.spinners.filter((s) => s.obj !== this.sphere);
      const eid = !isNull(this.journalSession) ? this.journalSession.getEntry().id : "";
      if (eid) {
        // Re-placing today's orb (e.g. "Add to Today's Journal") — retire the
        // previous ball for this day so there's only one.
        const prev = sessionPlacedOrbs.get(eid);
        if (prev && prev !== this.sphere && !isNull(prev)) {
          try {
            prev.destroy();
          } catch (e) {
            /* ignore */
          }
        }
        sessionPlacedOrbs.set(eid, this.sphere);
        // Register the plant so "Add to Today's Journal" grows it in place
        // (no re-placement, no second ball).
        if (this.orbSapling) dayOrbSapling.set(eid, this.orbSapling);
      }
      this.lastPlacedWorldPos = this.sphere.getTransform().getWorldPosition();
      this.lastPlacedRadiusCm = (this.sphere.getTransform().getWorldScale().x || this.sphereDiameterCm) * 0.5;
      // Persist the spot so the ball reappears here next session (PlacedOrbs
      // rebuilds it on launch). 2026-09-06.
      if (eid) {
        const colorHex = !isNull(this.journalSession) ? this.journalSession.getEntry().orbColor : "";
        recordPlacement(eid, this.lastPlacedWorldPos, this.lastPlacedRadiusCm * 2, colorHex || "#9AA0A6");
      }
      console.log(`[Orb] placed at ${this.lastPlacedWorldPos}, reparented to "${holder.name}"`);
      this.orbEyes = null;
      this.orbEyeL = null;
      this.orbEyeR = null;
      this.orbGlow = null;
      // The placed orb is committed at this stage — a later re-open shows it
      // static, no re-grow, unless another moment is added.
      if (this.orbSaplingEid) sessionOrbStage.set(this.orbSaplingEid, this.orbSaplingStage);
      this.orbSapling = null; // now a frozen child of the placed sphere
      this.sphere = null;
    }

    this.saveDay("placed");
  }

  /** Reset — discard this spot, resume following. */
  private resetPlacement(): void {
    if (!this.awaitingConfirm) return;
    this.destroyPlaceConfirmUI();
    this.awaitingConfirm = false;
    this.placing = true;
    this.followPos = null;
    this.placeHitPos = null;
    this.placeLastGoodHit = null;
    this.showPlaceHint();
    this.buildPlaceTrace();
    console.log("[Orb] placing — spot reset, following again");
  }

  /** Full teardown of the placement mode (follow + pinch listener + on-sphere
   *  UI). Does NOT touch the sphere itself. */
  private endPlacement(): void {
    this.placing = false;
    this.awaitingConfirm = false;
    this.unsubscribePlaceTap();
    this.hidePlaceHint();
    this.hidePlaceTrace();
    this.destroyPlaceConfirmUI();
  }

  // --- on-sphere placement UI ---------------------------------------------

  private showPlaceHint(): void {
    if (this.placeHintObj && !isNull(this.placeHintObj)) return;
    const o = global.scene.createSceneObject("PlaceHint");
    o.setParent(this.sceneObject);
    const t = o.createComponent("Component.Text") as Text;
    t.text = this.placeHintLabel;
    t.size = 52;
    t.depthTest = true;
    applyFont(t);
    try {
      (t as any).horizontalAlignment = HorizontalAlignment.Center;
      (t as any).verticalAlignment = VerticalAlignment.Center;
    } catch (e) {
      /* older Text API */
    }
    this.placeHintObj = o;
  }

  private hidePlaceHint(): void {
    if (this.placeHintObj && !isNull(this.placeHintObj)) {
      try {
        this.placeHintObj.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    this.placeHintObj = null;
  }

  /** A small frameless Confirm / Reset row placed on the (now frozen) sphere,
   *  facing the camera. */
  private buildPlaceConfirmUI(): void {
    this.destroyPlaceConfirmUI();
    if (isNull(this.sphere)) return;

    const holder = global.scene.createSceneObject("PlaceConfirm");
    holder.setParent(this.sceneObject);
    this.placeConfirmHolder = holder;
    this.orientConfirmHolder(); // position below the ball + face the camera (also runs every frame)

    const panel = PanelKit.create(holder, {
      name: "PlaceConfirmPanel",
      title: "",
      body: "",
      widthCm: 28,
      heightCm: 13,
      localPosition: new vec3(0, 0, 0),
      buttonsVertical: false,
      frameless: true,
      buttonScale: 0.7,
    });
    panel.addButton(this.placeConfirmLabel, () => this.finalizePlacement());
    panel.addButton(this.placeResetLabel, () => this.resetPlacement());
    this.placeConfirmPanel = panel;
  }

  private destroyPlaceConfirmUI(): void {
    if (this.placeConfirmPanel) {
      try {
        this.placeConfirmPanel.destroy();
      } catch (e) {
        /* ignore */
      }
      this.placeConfirmPanel = null;
    }
    if (this.placeConfirmHolder && !isNull(this.placeConfirmHolder)) {
      try {
        this.placeConfirmHolder.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    this.placeConfirmHolder = null;
  }

  /** Point `t`'s local +Z (the PanelKit/Text readable face) at the CAMERA'S
   *  CURRENT POSITION — recomputed every frame, so it tracks both head rotation
   *  AND translation (a camera-rotation copy only tracks rotation, which is why
   *  the panels ended up facing away when the user stepped past the ball). The
   *  aim direction is flattened onto the ground plane so the panel stays upright
   *  and never gimbal-flips when the user looks straight down at a low ball. */
  private faceCameraFlat(t: Transform, worldPos: vec3): void {
    if (isNull(this.cameraObject)) return;
    const camPos = this.cameraObject.getTransform().getWorldPosition();
    let toCam = new vec3(camPos.x - worldPos.x, 0, camPos.z - worldPos.z);
    if (toCam.length < 1e-4) toCam = new vec3(0, 0, 1);
    toCam = toCam.normalize();
    t.setWorldPosition(worldPos);
    t.setWorldRotation(quat.lookAt(toCam, vec3.up()));
  }

  /** Keep the Confirm / Reset row just below the frozen ball and facing the
   *  player — run EVERY FRAME while awaiting confirm. */
  private orientConfirmHolder(): void {
    if (!this.placeConfirmHolder || isNull(this.placeConfirmHolder)) return;
    if (isNull(this.sphere)) return;
    const spherePos = this.sphere.getTransform().getWorldPosition();
    this.faceCameraFlat(
      this.placeConfirmHolder.getTransform(),
      spherePos.add(new vec3(0, -(this.sphereDiameterCm * 0.5 + 6), 0))
    );
  }

  /**
   * Every frame while FOLLOWING (this IS the live placement preview — the ball
   * you see is exactly where it will be dropped). Built on the WorldQueryHit
   * package's recipe:
   *
   *   - Get the SIK hand-ray interactor that's targeting; cast the World Query
   *     `hitTest(interactor.startPoint, interactor.endPoint, …)` at the real
   *     room mesh and rest the ball ON the surface (hit + normal * radius).
   *   - When the ray leaves every surface for a frame, HOLD the last good spot
   *     rather than flinging the ball out; before the first hit ever (and in
   *     the Editor) hover `placeDistanceCm` along the ray.
   *   - Draw a VISIBLE line trace from the hand (`interactor.startPoint`) to
   *     the ball.
   *   - The drop gesture is the interactor's trigger-RELEASE edge
   *     (`InteractorTriggerType` -> None), same as the WorldQueryHit example —
   *     this replaces the old GestureModule filtered pinch-down.
   *   - Editor: the mouse cursor (unprojected through the camera) drives the
   *     follow and a screen tap is the drop.
   */
  private updatePlacementFollow(): void {
    if (!this.sphere || isNull(this.sphere)) return;
    const camT = isNull(this.cameraObject) ? null : this.cameraObject.getTransform();
    const camPos = camT ? camT.getWorldPosition() : vec3.zero();
    const camFwd = camT ? camT.forward.uniformScale(-1) : new vec3(0, 0, -1);
    const radius = this.sphereDiameterCm * 0.5;

    // SIK's interactor drives the follow on BOTH device (HandInteractor — the
    // hand ray) AND in Preview (MouseInteractor — the cursor ray, which is what
    // shows the pinch dot). Only fall through to the camera-cursor unproject if
    // there's genuinely no interactor yet.
    const interactor = this.getPlaceInteractor();

    if (getTime() - this.placeDiagT > 1.5) {
      this.placeDiagT = getTime();
      console.log(
        `[Orb][WorldQuery] follow — interactor=${interactor ? "yes" : "no"} ` +
          `session=${this.placeHitSession ? "yes" : "no"} ` +
          `hit=${this.placeHitPos ? "surface" : this.placeLastGoodHit ? "held" : "none"}`
      );
    }

    let hand: vec3;
    let dir: vec3;
    let bootstrap: vec3;

    if (interactor) {
      const sp = interactor.startPoint as vec3;
      const ep = interactor.endPoint as vec3;
      hand = sp;
      const rayDir = ep.sub(sp);
      dir = rayDir.length > 1e-4 ? rayDir.normalize() : camFwd;
      bootstrap = sp.add(dir.uniformScale(this.placeDistanceCm));

      if (this.placeHitSession) {
        const rayStart = sp.add(dir.uniformScale(3)); // small nudge off the hand
        try {
          this.placeHitSession.hitTest(rayStart, ep, (hit: WorldQueryHitTestResult) => {
            if (hit && !isNull(hit.position)) {
              const n =
                hit.normal && hit.normal.length > 1e-4 ? hit.normal.normalize() : dir.uniformScale(-1);
              this.placeHitPos = hit.position.add(n.uniformScale(radius)); // sit ON the surface
              this.placeLastGoodHit = this.placeHitPos;
            } else {
              this.placeHitPos = null;
            }
          });
        } catch (e) {
          /* session hiccup */
        }
      }

      // Drop on the trigger-RELEASE edge (WorldQueryHit example's gesture).
      const held = interactor.currentTrigger !== InteractorTriggerType.None;
      const wasHeld = interactor.previousTrigger !== InteractorTriggerType.None;
      if (held) this.placeSawTrigger = true;
      if (this.placeSawTrigger && wasHeld && !held && getTime() - this.placeArmedT > 0.4) {
        this.onPlacePinch();
        return;
      }
    } else if (global.deviceInfoSystem.isEditor() && camT) {
      const camComp = isNull(this.cameraObject)
        ? null
        : (this.cameraObject.getComponent("Component.Camera") as Camera);
      const ct = camComp
        ? camComp.screenSpaceToWorldSpace(this.editorCursor, this.placeDistanceCm)
        : camPos.add(camFwd.uniformScale(this.placeDistanceCm));
      hand = camPos;
      const d = ct.sub(camPos);
      dir = d.length > 1e-4 ? d.normalize() : camFwd;
      bootstrap = ct;
    } else {
      // hand not yet targeting / not tracked — hold whatever we last had
      hand = camPos;
      dir = camFwd;
      bootstrap = camPos.add(camFwd.uniformScale(this.placeDistanceCm));
    }

    let target = this.placeHitPos || this.placeLastGoodHit || bootstrap;
    if (target.sub(hand).length < PLACE_MIN_CM) {
      target = hand.add(dir.uniformScale(PLACE_MIN_CM));
    }

    if (!this.followPos) this.followPos = target;
    else {
      const k = Math.min(1, getDeltaTime() * 9);
      this.followPos = this.followPos.add(target.sub(this.followPos).uniformScale(k));
    }
    this.sphere.getTransform().setWorldPosition(this.followPos);

    this.billboardHint(this.followPos);
    // 20 cm line from the gesture toward the ball, whenever a gesture ray is
    // driving the follow. In the Editor the "hand" IS the camera, so the line
    // would point straight away from the viewer (invisible) — offset the anchor
    // down-and-right there so it reads as a hand held below the eye.
    if (interactor) {
      let traceFrom = hand;
      if (global.deviceInfoSystem.isEditor() && camT) {
        traceFrom = hand
          .add(camT.right.uniformScale(7))
          .add(camT.up.uniformScale(-11));
      }
      this.updatePlaceTrace(traceFrom, this.followPos);
    }
  }

  /** True billboard of the "Pinch to place" label, riding just above the ball.
   *  Copies the camera's world rotation (screen-aligned) rather than
   *  `quat.lookAt` — lookAt with a world-up hint flips when you look straight
   *  down at a ball near the floor, which is why the label was sometimes seen
   *  from behind (2026-09-06). */
  private billboardHint(ballPos: vec3): void {
    if (!this.placeHintObj || isNull(this.placeHintObj)) return;
    this.faceCameraFlat(
      this.placeHintObj.getTransform(),
      ballPos.add(new vec3(0, this.sphereDiameterCm * 0.5 + 3, 0))
    );
  }

  // --- placement tether curve ------------------------------------------

  private buildPlaceTrace(): void {
    this.hidePlaceTrace();
    const o = global.scene.createSceneObject("PlaceTrace");
    o.setParent(this.sceneObject);
    const rmv = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const m = LINE_MAT_BASE.clone();
    try {
      (m.mainPass as any).depthTest = false;
      (m.mainPass as any).depthWrite = false;
      (m.mainPass as any).twoSided = true;
    } catch (e) {
      /* ignore */
    }
    rmv.clearMaterials();
    rmv.addMaterial(m);
    // The ribbon verts are WORLD coords — keep the holder identity so they
    // aren't transformed by OrbRoot's spawn-in-front pose.
    const t = o.getTransform();
    t.setWorldPosition(vec3.zero());
    t.setWorldRotation(quat.quatIdentity());
    t.setWorldScale(new vec3(1, 1, 1));
    this.placeTraceObj = o;
  }

  private hidePlaceTrace(): void {
    if (this.placeTraceObj && !isNull(this.placeTraceObj)) {
      try {
        this.placeTraceObj.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    this.placeTraceObj = null;
  }

  /** Draw a STRAIGHT, camera-facing line ribbon `PLACE_TETHER_CM` (20 cm) long
   *  from the pinch point `a` toward the ball `b` — a short "here's my gesture,
   *  it's aiming there" trace. Stops at the ball when it's nearer than 20 cm. */
  private updatePlaceTrace(a: vec3, b: vec3): void {
    if (!this.placeTraceObj || isNull(this.placeTraceObj)) return;
    const rmv = this.placeTraceObj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    if (!rmv) return;

    let dir = b.sub(a);
    const span = dir.length;
    if (span < 0.5) return;
    dir = dir.uniformScale(1 / span);
    const end = a.add(dir.uniformScale(Math.min(PLACE_TETHER_CM, span)));

    const camPos = isNull(this.cameraObject)
      ? a.add(new vec3(0, 0, 1))
      : this.cameraObject.getTransform().getWorldPosition();

    const SEG = 6;
    const halfW = 0.7; // cm — thick enough to read clearly as a line
    const verts: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      const p = a.add(end.sub(a).uniformScale(u));
      let right = dir.cross(camPos.sub(p).normalize());
      if (right.length < 1e-4) right = new vec3(1, 0, 0);
      right = right.normalize().uniformScale(halfW);
      const l = p.sub(right);
      const r = p.add(right);
      verts.push(l.x, l.y, l.z, 0, u, r.x, r.y, r.z, 1, u);
      if (i < SEG) {
        const b0 = i * 2;
        idx.push(b0, b0 + 1, b0 + 3, b0, b0 + 3, b0 + 2);
      }
    }

    const mb = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    mb.topology = MeshTopology.Triangles;
    mb.indexType = MeshIndexType.UInt16;
    mb.appendVerticesInterleaved(verts);
    mb.appendIndices(idx);
    rmv.mesh = mb.getMesh();
    mb.updateMesh();
  }

  private getAimRay(): { origin: vec3; direction: vec3 } {
    if (!global.deviceInfoSystem.isEditor()) {
      const hand = HandInputData.getInstance().getDominantHand();
      const td = hand.targetingData;
      if (td) {
        return { origin: td.targetingLocusInWorld, direction: td.targetingDirectionInWorld };
      }
    }
    // Editor/Preview (no hand tracking), or the hand is briefly untracked
    // on device — fall back to the camera's forward ray.
    if (!isNull(this.cameraObject)) {
      const t = this.cameraObject.getTransform();
      return { origin: t.getWorldPosition(), direction: t.forward.uniformScale(-1) };
    }
    return { origin: vec3.zero(), direction: new vec3(0, 0, -1) };
  }

  /** Append/replace this entry in the small JSON-array day store — the
   *  multi-day extension of TraceJournalSpikeD_Persistence's single-entry
   *  proof. Same entry id (e.g. Save tapped twice across screens) replaces
   *  rather than duplicates. */
  private persistEntry(data: JournalEntryData): void {
    let days: JournalEntryData[] = [];
    try {
      const raw = this.store.getString(DAYS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) days = parsed;
      }
    } catch (e) {
      console.log("[Orb] persistEntry: prior blob unreadable, starting fresh — " + e);
      days = [];
    }
    const idx = days.findIndex((d) => d && d.id === data.id);
    if (idx >= 0) days[idx] = data;
    else days.push(data);
    try {
      this.store.putString(DAYS_KEY, JSON.stringify(days));
      console.log(`[Orb] persisted — ${days.length} day(s) total in store`);
    } catch (e) {
      console.log("[Orb] persistEntry: write failed — " + e);
    }
  }

  // --- tweens (pop-in) + continuous spin ------------------------------

  // `obj` lets onUpdate skip/drop a tween whose target was destroyed out from
  // under it (e.g. a second rebuild()'s destroySphere() tearing down the
  // sphere a still-pending pop-in tween from the FIRST build was animating —
  // real race, seen when debugStartState="Orb" causes OnStartEvent then an
  // immediate OnEnableEvent to both call rebuild()) instead of dereferencing
  // a null SceneObject and throwing.
  private tweens: { obj: SceneObject; t0: number; dur: number; step: (eased: number) => void }[] = [];
  private spinners: { obj: SceneObject; degPerSec: number; angle: number }[] = [];

  private onUpdate(): void {
    const dt = getDeltaTime();

    if (this.tweens.length > 0) {
      const now = getTime();
      for (let i = this.tweens.length - 1; i >= 0; i--) {
        const tw = this.tweens[i];
        if (isNull(tw.obj)) {
          this.tweens.splice(i, 1);
          continue;
        }
        const k = (now - tw.t0) / tw.dur;
        tw.step(easeOutCubic(k));
        if (k >= 1) this.tweens.splice(i, 1);
      }
    }

    if (this.spinners.length > 0) {
      for (let i = this.spinners.length - 1; i >= 0; i--) {
        const s = this.spinners[i];
        if (isNull(s.obj)) {
          this.spinners.splice(i, 1);
          continue;
        }
        s.angle += s.degPerSec * dt;
        s.obj.getTransform().setLocalRotation(quat.fromEulerAngles(0, (s.angle * Math.PI) / 180, 0));
      }
    }

    if (this.placing) this.updatePlacementFollow();
    if (this.awaitingConfirm) this.orientConfirmHolder();
    if (this.savedPanelRoot && !isNull(this.savedPanelRoot) && this.savedPanelAnchor) {
      this.faceCameraFlat(this.savedPanelRoot.getTransform(), this.savedPanelAnchor);
    }
    this.updateOrbEyes();
    if (
      this.orbSapling &&
      this.sphere &&
      !isNull(this.sphere) &&
      !isNull(this.cameraObject)
    ) {
      const sp = this.sphere.getTransform().getWorldPosition();
      const r = (this.sphere.getTransform().getWorldScale().x || this.sphereDiameterCm) * 0.5;
      this.orbSapling.place(sp, r, this.cameraObject.getTransform().getWorldPosition());
      this.orbSapling.update(getDeltaTime());
      // Commit the new stage only once the grow tween has actually finished, so
      // the growth is never skipped by a same-entry rebuild.
      if (this.orbSaplingEid && this.orbSapling.isSettled()) {
        sessionOrbStage.set(this.orbSaplingEid, this.orbSaplingStage);
      }
    }
  }

  // --- debug autopilot (Preview verification without hand taps) ------

  private delay(sec: number, fn: () => void): void {
    const e = this.createEvent("DelayedCallbackEvent");
    e.bind(() => fn());
    e.reset(sec);
  }

  private maybeAutopilot(): void {
    if (this.autopilotRan) return;
    if (this.debugAutopilot) {
      this.autopilotRan = true;
      console.log("[Orb][Autopilot] start (Keep Private)");
      this.delay(1.0, () => {
        console.log("[Orb][Autopilot] step 1: Keep Private");
        this.saveDay("private");
      });
      this.delay(2.2, () => {
        console.log("[Orb][Autopilot] step 2: Done -> Home");
        this.flowManager.goTo(TraceScreen.Launch);
      });
    } else if (this.debugAutopilotPlace) {
      this.autopilotRan = true;
      console.log("[Orb][Autopilot] start (Place in Space)");
      this.delay(1.0, () => {
        console.log("[Orb][Autopilot] step 1: begin placement (sphere follows, 'Pinch to place')");
        this.beginPlacement();
      });
      this.delay(2.2, () => {
        console.log("[Orb][Autopilot] step 2: pinch stand-in -> Confirm/Reset on the sphere");
        this.onPlacePinch();
      });
      this.delay(3.4, () => {
        console.log("[Orb][Autopilot] step 3: Confirm -> save placed");
        this.finalizePlacement();
      });
      this.delay(4.6, () => {
        console.log("[Orb][Autopilot] step 4: Done -> Home");
        this.flowManager.goTo(TraceScreen.Launch);
      });
    }
  }
}
