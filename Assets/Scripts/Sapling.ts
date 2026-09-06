/**
 * Sapling.ts — a tiny procedural "stick and leaves" plant that rides on top of
 * every memory orb and grows as the day gathers moments (DESIGN idea 2026-09-06,
 * CLAD_PROMPTS #55).
 *
 * STAGE = min(5, that day's `selectedMomentIds.length`). Stage 0 is a bare
 * sprout; each extra moment unfurls one more leaf and lengthens the stem, up to
 * five leaves at stage 5.
 *
 * The whole plant is a handful of flat MeshBuilder shapes (one tapered stem
 * quad + up to five soft rounded leaf blades) on an alpha-blended unlit
 * material clone — the same cheap recipe as the orb's eyes / glow disc. Muted
 * sage/spring-green tints and a slow idle sway keep it reading gentle rather
 * than stiff. The root is yaw-billboarded toward the camera by `place()` so the
 * silhouette always reads, while staying vertical like a real plant.
 *
 * GROWTH ANIMATION ("Orb only, animated", 2026-09-06): on the Orb screen the
 * plant tweens `growth01` from its previous value up to the new stage, so you
 * see it grow. `sessionOrbStage` remembers the last stage shown for each day so
 * re-opening an orb after "Add to Today's Journal" animates prev -> new instead
 * of snapping. The restored room orbs (PlacedOrbs) and the Jar grid spheres
 * just show the plant at its current stage (no tween needed — call
 * `snapToStage`).
 *
 * USAGE
 *   const sap = buildSapling(parentSceneObject, orbDiameterCm);
 *   sap.setStage(stage);                 // animate toward it
 *   sap.snapToStage(stage);              // or jump straight there
 *   // per frame, for a world-space orb:
 *   sap.place(spherePos, radiusCm, camPos);
 *   sap.update(dt);
 *   // for a panel-local orb (Jar grid): parent under the holder, no place()/update loop
 *   sap.root.setParent(holder);
 *   sap.root.getTransform().setLocalPosition(new vec3(0, d * 0.5 * 0.86, 0));
 *   sap.snapToStage(stage); sap.update(0);
 */

const SAP_MAT_BASE = requireAsset("../Materials/ImageMaterial.mat") as Material;

export const SAPLING_MAX_STAGE = 5;

/** dayId -> the sapling stage last shown for that orb THIS session, so the Orb
 *  screen can animate prev -> new after "Add to Today's Journal" instead of
 *  snapping. Cleared naturally when the Lens restarts. */
export const sessionOrbStage = new Map<string, number>();

/** dayId -> the Sapling currently living on that day's ROOM orb — restored by
 *  PlacedOrbs on launch, or reparented onto a same-session placed ball by
 *  OrbScreen.finalizePlacement. "Add to Today's Journal" bumps this to the new
 *  stage in place (no re-placement, no second ball). */
export const dayOrbSapling = new Map<string, Sapling>();

/** moment count -> clamped sapling stage. */
export function momentCountToStage(n: number): number {
  if (!(n > 0)) return 0;
  return Math.min(SAPLING_MAX_STAGE, Math.floor(n));
}

const STEM_COLOR = new vec4(0.5, 0.6, 0.42, 1); // soft muted sage stem
const LEAF_COLOR = new vec4(0.62, 0.8, 0.56, 1); // pale, gentle spring green

let _stemTex: Texture | null = null;
let _leafTex: Texture | null = null;
function solidTex(color: vec4, cache: "stem" | "leaf"): Texture | null {
  if (cache === "stem" && _stemTex) return _stemTex;
  if (cache === "leaf" && _leafTex) return _leafTex;
  try {
    const tex = ProceduralTextureProvider.createWithFormat(4, 4, TextureFormat.RGBA8Unorm);
    const ctrl = tex.control as ProceduralTextureProvider;
    const d = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.round(color.x * 255);
      d[i + 1] = Math.round(color.y * 255);
      d[i + 2] = Math.round(color.z * 255);
      d[i + 3] = 255;
    }
    ctrl.setPixels(0, 0, 4, 4, d);
    if (cache === "stem") _stemTex = tex;
    else _leafTex = tex;
    return tex;
  } catch (e) {
    return null;
  }
}

/** A soft rounded leaf blade pointing +x, inner tip at the origin, length `L`.
 *  Fan-triangulated from the origin around a smooth curved outline (fat near
 *  the middle, gently pointed tip, rounded base) — reads much softer than a
 *  hard 4-point diamond. */
function roundLeafMesh(L: number): RenderMesh {
  const verts: number[] = [0, 0, 0, 0.5, 0.5];
  const bnd: number[] = [];
  const push = (x: number, y: number) => {
    bnd.push(verts.length / 5);
    verts.push(x, y, 0, 0.5, 0.5);
  };
  const halfW = (t: number) =>
    L * 0.46 * Math.sin(Math.PI * Math.pow(t, 0.62)) * (1 - 0.06 * t);
  const M = 12;
  for (let i = 1; i <= M; i++) push(L * (i / M), halfW(i / M)); // top edge base -> tip
  for (let i = M - 1; i >= 1; i--) push(L * (i / M), -halfW(i / M)); // bottom edge tip -> base
  const idx: number[] = [];
  for (let i = 0; i < bnd.length - 1; i++) idx.push(0, bnd[i], bnd[i + 1]);
  return flatMesh(verts, idx);
}

function flatMesh(verts: number[], idx: number[]): RenderMesh {
  const mb = new MeshBuilder([
    { name: "position", components: 3 },
    { name: "texture0", components: 2 },
  ]);
  mb.topology = MeshTopology.Triangles;
  mb.indexType = MeshIndexType.UInt16;
  mb.appendVerticesInterleaved(verts);
  mb.appendIndices(idx);
  const mesh = mb.getMesh();
  mb.updateMesh();
  return mesh;
}

function paint(o: SceneObject, mesh: RenderMesh, tex: Texture | null): void {
  const rmv = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  rmv.mesh = mesh;
  const m = SAP_MAT_BASE.clone();
  try {
    if (tex) (m.mainPass as any).baseTex = tex;
    (m.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
    (m.mainPass as any).twoSided = true;
    (m.mainPass as any).depthTest = false; // always composite over the wobbling orb
    (m.mainPass as any).depthWrite = false;
  } catch (e) {
    /* ignore */
  }
  rmv.clearMaterials();
  rmv.addMaterial(m);
}

interface Leaf {
  obj: SceneObject;
  baseY: number; // height up the full-length stem
  side: number; // -1 left, +1 right
  scale: number; // full leaf scale (cm)
  tilt: number; // z-rotation, radians
}

export interface Sapling {
  root: SceneObject;
  /** Animate the plant toward `stage` (0..SAPLING_MAX_STAGE). */
  setStage(stage: number): void;
  /** Jump straight to `stage` with no tween. */
  snapToStage(stage: number): void;
  /** World-place the root at the top of a world-space orb, yaw-billboarded. */
  place(spherePos: vec3, radiusCm: number, camPos?: vec3 | null): void;
  /** Ease growth toward the target stage and lay out stem + leaves. */
  update(dt: number): void;
  /** True once the grow tween has reached its target stage. */
  isSettled(): boolean;
  destroy(): void;
}

/**
 * Builds the plant under `parent`. `orbDiameterCm` scales the whole thing so it
 * sits in proportion on any orb size. Starts at growth 0 (a bare sprout) — call
 * setStage / snapToStage next.
 */
export function buildSapling(
  parent: SceneObject,
  orbDiameterCm: number,
  opts?: { scaleMul?: number }
): Sapling {
  const base = orbDiameterCm > 1 ? orbDiameterCm : 18;
  const d = base * (opts && opts.scaleMul && opts.scaleMul > 0 ? opts.scaleMul : 1);
  const H = d * 0.58; // full stem height (tall enough that the lower leaves clear the orb)
  const wB = Math.max(0.3, d * 0.035); // stem width at the base
  const wT = wB * 0.4; // ...tapering in at the tip
  const leafScale = d * 0.135;

  const root = global.scene.createSceneObject("Sapling");
  root.setParent(parent);

  // --- stem: one tapered quad, pivot at its base (y = 0), grown via scale.y ---
  const stem = global.scene.createSceneObject("Stem");
  stem.setParent(root);
  paint(
    stem,
    flatMesh(
      [
        -wB * 0.5, 0, 0, 0, 0,
        wB * 0.5, 0, 0, 1, 0,
        wT * 0.5, H, 0, 1, 1,
        -wT * 0.5, H, 0, 0, 1,
      ],
      [0, 1, 2, 0, 2, 3]
    ),
    solidTex(STEM_COLOR, "stem")
  );

  // --- leaves: soft rounded blades, pivot at the inner tip (x = 0), fanned up
  //     the stem, alternating sides, with a gentle idle sway ---
  const leafMesh = roundLeafMesh(leafScale);
  const leaves: Leaf[] = [];
  for (let i = 0; i < SAPLING_MAX_STAGE; i++) {
    const o = global.scene.createSceneObject("Leaf" + (i + 1));
    o.setParent(root);
    paint(o, leafMesh, solidTex(LEAF_COLOR, "leaf"));
    const frac = SAPLING_MAX_STAGE > 1 ? i / (SAPLING_MAX_STAGE - 1) : 0;
    leaves.push({
      obj: o,
      baseY: H * (0.42 + 0.52 * frac), // all leaves sit well up the stem, clear of the orb
      side: i % 2 === 0 ? 1 : -1,
      scale: leafScale * (1 - 0.14 * frac), // higher leaves a touch smaller
      tilt: 0.52 - 0.24 * frac, // gentle fan; upper ones near-level
    });
    o.enabled = false;
  }

  let growth01 = 0;
  let target01 = 0;
  let swayT = Math.random() * 6.28; // desync each plant's idle sway

  const applyLayout = (): void => {
    // Stem reaches full length by growth ~0.55 so later leaves have something
    // to sit on.
    const sg = Math.min(1, growth01 / 0.55);
    const stemGrow = sg * sg * (3 - 2 * sg); // smoothstep
    const st = stem.getTransform();
    st.setLocalScale(new vec3(0.7 + 0.3 * stemGrow, 0.14 + 0.86 * stemGrow, 1));
    // A slow, tiny lean so the whole plant breathes instead of standing rigid.
    const lean = Math.sin(swayT * 0.8) * 0.05 * stemGrow;
    st.setLocalRotation(quat.fromEulerAngles(0, 0, lean));

    const curLen = H * (0.14 + 0.86 * stemGrow);
    for (let i = 0; i < leaves.length; i++) {
      const lf = leaves[i];
      // leaf i unfurls across growth window [i/MAX .. (i+1)/MAX]
      const lr = Math.max(0, Math.min(1, growth01 * SAPLING_MAX_STAGE - i));
      if (lr <= 0.02) {
        lf.obj.enabled = false;
        continue;
      }
      lf.obj.enabled = true;
      // ease-out-back: a newly-unfurling leaf overshoots ~10% then settles, so
      // the growth reads as a distinct little "pop" even at a glance.
      let back = 1;
      if (lr < 1) {
        const k = 1.7;
        const u = lr - 1;
        back = 1 + (k + 1) * u * u * u + k * u * u;
      }
      const s = lf.scale * Math.max(0, back);
      const t = lf.obj.getTransform();
      const y = Math.min(lf.baseY, curLen * 0.98);
      // Each leaf sways on its own slight phase — a soft rustle, not a wobble.
      const rustle = Math.sin(swayT * 1.1 + i * 1.7) * 0.07 * lr;
      t.setLocalPosition(new vec3(lean * 3, y, 0.05 + i * 0.02));
      t.setLocalRotation(quat.fromEulerAngles(0, 0, lf.side * lf.tilt + rustle));
      t.setLocalScale(new vec3(lf.side * s, s, 1));
    }
  };

  const sap: Sapling = {
    root,
    setStage(stage: number): void {
      target01 = Math.max(0, Math.min(SAPLING_MAX_STAGE, stage)) / SAPLING_MAX_STAGE;
    },
    snapToStage(stage: number): void {
      target01 = Math.max(0, Math.min(SAPLING_MAX_STAGE, stage)) / SAPLING_MAX_STAGE;
      growth01 = target01;
      applyLayout();
    },
    place(spherePos: vec3, radiusCm: number, camPos?: vec3 | null): void {
      if (isNull(root)) return;
      const t = root.getTransform();
      t.setWorldPosition(spherePos.add(new vec3(0, radiusCm * 0.92, 0)));
      if (camPos) {
        let flat = new vec3(camPos.x - spherePos.x, 0, camPos.z - spherePos.z);
        if (flat.length < 1e-4) flat = new vec3(0, 0, 1);
        t.setWorldRotation(quat.lookAt(flat.normalize(), vec3.up()));
      }
    },
    update(dt: number): void {
      if (isNull(root)) return;
      swayT += Math.max(0, dt);
      if (growth01 !== target01) {
        // ~0.4s per stage — a one-stage grow (e.g. after adding one moment)
        // takes ~0.4s, a full 0 -> 5 takes ~2s. Slow enough to actually see.
        const step = (Math.max(0, dt) * 1) / (SAPLING_MAX_STAGE * 0.4);
        if (growth01 < target01) growth01 = Math.min(target01, growth01 + step);
        else growth01 = Math.max(target01, growth01 - step);
      }
      applyLayout();
    },
    isSettled(): boolean {
      return Math.abs(growth01 - target01) < 1e-4;
    },
    destroy(): void {
      if (!isNull(root)) {
        try {
          root.destroy();
        } catch (e) {
          /* ignore */
        }
      }
    },
  };

  applyLayout();
  return sap;
}
