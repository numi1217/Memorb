/**
 * TraceGizmos.ts — tiny runtime geometry helpers for the Memorb Scan flow
 * (Phase 1).
 *
 * Three builders. Geometry is generated with MeshBuilder; the base material and
 * (for the marker) the sphere mesh are passed in by the caller from an @input
 * wired to MarkerWhite.mat / MarkerSphereMesh.mesh — requireAsset() cannot
 * resolve those Assets-root files.
 *
 *   makeReticle(parent, opts, baseMat)        -> four 「」corner brackets (capture frame)
 *   makeGlowLine(parent, baseMat, color?, w?) -> a thin bright bar; call .set(a, b)
 *   makeMarker(parent, pos, mesh, mat)        -> the temporary white sphere marker (spec §2)
 *   makeRectFrame(parent, baseMat, opts)      -> a solid-thickness rectangular border,
 *                                                transparent interior; call .resize(w, h)
 *   makePolygonCutout(parent, mat, pts01, h, pos) -> a triangulated cut-out MESH sampling
 *                                                `mat.baseTex` directly — the object's own
 *                                                silhouette is the geometry, so there is no
 *                                                raster mask texture to build at all
 *   triangulatePolygon(pts)                   -> ear-clipping triangulation (exported for
 *                                                the polygon cutout, reusable elsewhere)
 *
 * MUST NOT: own state, know Memorb screens, or call services.
 */

import { registerFillMaterial } from "./UITheme";

/** White unlit material for the sticker-style outline behind cut-out
 *  thumbnails (2026-09-05). Shared clone base — callers get a tinted clone. */
const THUMB_OUTLINE_BASE = requireAsset("../Materials/UILine.mat") as Material;
const WHITE = new vec4(1, 1, 1, 1);

export interface ThumbOutline {
  /** Border colour (usually white). */
  color?: vec4;
  /** How far the border peeks out past the image edge, in cm. */
  widthCm: number;
}

function tintedClone(baseMat: Material, color: vec4): Material {
  const mat = baseMat.clone();
  try {
    (mat.mainPass as any).baseColor = color;
  } catch (e) {
    /* graph shader without a baseColor uniform — leave as-is */
  }
  return mat;
}

export interface Reticle {
  root: SceneObject;
  setColor(c: vec4): void;
}

export interface ReticleOptions {
  name?: string;
  widthCm?: number;
  heightCm?: number;
  /** local Z position relative to parent (head-locked frame sits in front). */
  localZ?: number;
  color?: vec4;
  /** Bracket-arm thickness in cm (2026-09-05: solid stadium bars, not hairlines). */
  lineWidthCm?: number;
  /** Bracket-arm length as a fraction of the shorter half-dimension (default 0.32). */
  armFraction?: number;
}

/**
 * Capture-frame reticle as four 「」corner brackets (2026-09-05). Each bracket is
 * two solid **stadium** bars (rectangle + rounded ends) rather than 1px lines,
 * so the frame reads as a chunky white 「 」 framing cue. Arms point inward
 * toward the centre; arm length is a fraction of the shorter half-dimension.
 * All eight bars share one triangle mesh + one material (so `setColor` is one
 * write).
 */
export function makeReticle(
  parent: SceneObject,
  opts: ReticleOptions,
  baseMat: Material
): Reticle {
  const w = (opts.widthCm ?? 22) * 0.5;
  const h = (opts.heightCm ?? 22) * 0.5;
  const color = opts.color ?? new vec4(1, 1, 1, 1); // white (2026-09-05)
  const r = Math.max(0.05, (opts.lineWidthCm ?? 0.7) * 0.5); // bar half-thickness
  const arm = Math.max(2, Math.min(w, h) * (opts.armFraction ?? 0.32)); // corner-bracket arm length (cm)

  const root = global.scene.createSceneObject(opts.name ?? "Reticle");
  root.setParent(parent);
  root.getTransform().setLocalPosition(new vec3(0, 0, opts.localZ ?? 0));

  const rmv = root.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  const builder = new MeshBuilder([{ name: "position", components: 3 }]);
  builder.topology = MeshTopology.Triangles;
  builder.indexType = MeshIndexType.UInt16;

  const verts: number[] = [];
  const indices: number[] = [];
  const CAP = 6; // segments per rounded end

  // One rounded-end bar (stadium) from A to B, radius r — fan from the midpoint.
  const bar = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay;
    const len = Math.max(1e-4, Math.sqrt(dx * dx + dy * dy));
    const ux = dx / len, uy = dy / len; // A -> B unit
    const px = -uy, py = ux;            // left perpendicular
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const center = verts.length / 3;
    verts.push(mx, my, 0);
    const perim: number[] = [];
    // Cap at A: v(θ) = p·cos θ + (−u)·sin θ, θ: 0 → π  (p → −u → −p)
    for (let i = 0; i <= CAP; i++) {
      const t = (i / CAP) * Math.PI;
      const vx = px * Math.cos(t) + -ux * Math.sin(t);
      const vy = py * Math.cos(t) + -uy * Math.sin(t);
      perim.push(verts.length / 3);
      verts.push(ax + r * vx, ay + r * vy, 0);
    }
    // Cap at B: v(θ) = (−p)·cos θ + u·sin θ, θ: 0 → π  (−p → u → p)
    for (let i = 0; i <= CAP; i++) {
      const t = (i / CAP) * Math.PI;
      const vx = -px * Math.cos(t) + ux * Math.sin(t);
      const vy = -py * Math.cos(t) + uy * Math.sin(t);
      perim.push(verts.length / 3);
      verts.push(bx + r * vx, by + r * vy, 0);
    }
    for (let i = 0; i < perim.length; i++) {
      const a = perim[i];
      const b2 = perim[(i + 1) % perim.length];
      indices.push(center, a, b2);
    }
  };

  // Four corners, two bars each. sx/sy point the arms toward the frame centre.
  const corner = (cx: number, cy: number, sx: number, sy: number) => {
    bar(cx, cy, cx, cy + sy * arm); // vertical arm
    bar(cx, cy, cx + sx * arm, cy); // horizontal arm
  };
  corner(-w,  h,  1, -1); // top-left
  corner( w,  h, -1, -1); // top-right
  corner( w, -h, -1,  1); // bottom-right
  corner(-w, -h,  1,  1); // bottom-left

  builder.appendVerticesInterleaved(verts);
  builder.appendIndices(indices);
  rmv.mesh = builder.getMesh();
  builder.updateMesh();

  const mat = tintedClone(baseMat, color);
  try {
    (mat.mainPass as any).twoSided = true;
  } catch (e) {
    /* pass has no twoSided uniform */
  }
  rmv.clearMaterials();
  rmv.addMaterial(mat);

  return {
    root,
    setColor(c: vec4) {
      try {
        (mat.mainPass as any).baseColor = c;
      } catch (e) {
        /* ignore */
      }
    },
  };
}

export interface GlowLine {
  root: SceneObject;
  /** Span the bar between two world points. `planeNormal`, if given, is the
   *  normal of the plane the line should lie flat in (the bar's thin axis aligns
   *  to it) so the connector reads as an in-plane line, not a 3D rod. */
  set(a: vec3, b: vec3, planeNormal?: vec3): void;
  destroy(): void;
}

/**
 * A thin white connector from the marker to the Memory Card (spec §3).
 *
 * A unit cube (built here with MeshBuilder, length along local +Z) tinted with
 * the marker material. `.set(a, b, planeNormal?)` positions, orients and scales
 * it to span two world points as a straight bar.
 */
export function makeGlowLine(
  parent: SceneObject,
  baseMat: Material,
  color: vec4 = new vec4(1.0, 1.0, 1.0, 1.0),
  widthCm: number = 0.5
): GlowLine {
  const root = global.scene.createSceneObject("GlowLine");
  root.setParent(parent);
  const rmv = root.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;

  // Unit cube centred on the origin, -0.5..0.5 on each axis. Two triangles per
  // face, wound CCW when viewed from outside.
  const builder = new MeshBuilder([{ name: "position", components: 3 }]);
  builder.topology = MeshTopology.Triangles;
  builder.indexType = MeshIndexType.UInt16;
  const h = 0.5;
  builder.appendVerticesInterleaved([
    -h, -h, -h,  h, -h, -h,  h, h, -h,  -h, h, -h, // 0-3 back  (z = -h)
    -h, -h,  h,  h, -h,  h,  h, h,  h,  -h, h,  h, // 4-7 front (z = +h)
  ]);
  builder.appendIndices([
    0, 2, 1, 0, 3, 2, // back
    4, 5, 6, 4, 6, 7, // front
    0, 1, 5, 0, 5, 4, // bottom
    3, 7, 6, 3, 6, 2, // top
    1, 2, 6, 1, 6, 5, // right
    0, 4, 7, 0, 7, 3, // left
  ]);
  rmv.mesh = builder.getMesh();
  builder.updateMesh();

  const mat = tintedClone(baseMat, color);
  rmv.clearMaterials();
  rmv.addMaterial(mat);

  return {
    root,
    set(a: vec3, b: vec3, planeNormal?: vec3) {
      const dir = b.sub(a);
      const len = dir.length;
      if (len < 0.001) return;
      const t = root.getTransform();
      const n = dir.normalize();
      const up =
        planeNormal && planeNormal.length > 0.001
          ? planeNormal.normalize()
          : Math.abs(n.dot(vec3.up())) > 0.999
          ? vec3.right()
          : vec3.up();
      t.setWorldPosition(a.add(b).uniformScale(0.5));
      t.setWorldRotation(quat.lookAt(n, up)); // local +Z -> a..b, local +Y -> `up`
      // local X = visible line width (in-plane), local Y = thin (along normal).
      t.setLocalScale(new vec3(widthCm, planeNormal ? widthCm * 0.25 : widthCm, len));
    },
    destroy() {
      root.destroy();
    },
  };
}

/** The temporary white sphere marker dropped at the centre raycast point (spec §2). */
export function makeMarker(
  parent: SceneObject,
  worldPos: vec3,
  mesh: RenderMesh,
  mat: Material,
  diameterCm: number = 2
): SceneObject {
  const obj = global.scene.createSceneObject("TraceMarker");
  obj.setParent(parent);
  obj.getTransform().setWorldPosition(worldPos);
  obj.getTransform().setLocalScale(new vec3(diameterCm, diameterCm, diameterCm));

  const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  rmv.mesh = mesh;
  rmv.clearMaterials();
  rmv.addMaterial(mat);
  return obj;
}

export interface RectFrame {
  root: SceneObject;
  /** Half-width / half-height in cm — handy for edge-of-panel connector math. */
  halfW: number;
  halfH: number;
  resize(widthCm: number, heightCm: number): void;
  setColor(c: vec4): void;
  destroy(): void;
}

export interface RectFrameOptions {
  name?: string;
  widthCm: number;
  heightCm: number;
  /** Border bar thickness in cm (uniform on all four sides). */
  thicknessCm?: number;
  /** Corner radius as a fraction of the shorter side (0 = sharp, 0.5 = stadium). */
  cornerFraction?: number;
  color?: vec4;
  localPosition?: vec3;
  /** If given, also fill the rounded interior with this (blended) material,
   *  tinted `fillColor` — a faint background behind the wireframe. */
  fillMat?: Material;
  fillColor?: vec4;
  /** Skip registering the fill material with UITheme's live background-
   *  opacity control — use for a fill that carries its OWN baked-in look
   *  (e.g. a gradient texture) and must not be dimmed/hidden by the panel
   *  opacity slider. Default false (existing panel/card fills stay opted in). */
  fillIgnoresThemeOpacity?: boolean;
  /** Mirror the fill's U coordinate (0..1 -> 1..0), so a horizontal gradient
   *  texture reads RIGHT-to-left instead of left-to-right. */
  fillFlipU?: boolean;
}

const CORNER_SEGMENTS = 6; // arc subdivisions per rounded corner

/**
 * A rounded-rectangle border of constant bar thickness with a fully transparent
 * interior — a wireframe "window". Built as a triangulated ring so the bar width
 * stays uniform when resized. `.resize(w, h)` rebuilds the mesh; `.halfW` /
 * `.halfH` expose the (bounding) half extents for connector geometry.
 */
export function makeRectFrame(
  parent: SceneObject,
  baseMat: Material,
  opts: RectFrameOptions
): RectFrame {
  const th = opts.thicknessCm ?? 0.35;
  const cornerFrac = opts.cornerFraction ?? 0.2;
  const color = opts.color ?? new vec4(1, 1, 1, 1);

  const root = global.scene.createSceneObject(opts.name ?? "RectFrame");
  root.setParent(parent);
  if (opts.localPosition) root.getTransform().setLocalPosition(opts.localPosition);

  const rmv = root.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  const mat = tintedClone(baseMat, color);
  rmv.clearMaterials();
  rmv.addMaterial(mat);

  // Optional faint interior fill (drawn behind the border, slightly recessed).
  let fillRmv: RenderMeshVisual | null = null;
  if (opts.fillMat) {
    const fillObj = global.scene.createSceneObject("Fill");
    fillObj.setParent(root);
    fillObj.getTransform().setLocalPosition(new vec3(0, 0, -0.05));
    fillRmv = fillObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const fillMat = tintedClone(opts.fillMat, opts.fillColor ?? new vec4(0, 0, 0, 0.25));
    fillRmv.clearMaterials();
    fillRmv.addMaterial(fillMat);
    if (!opts.fillIgnoresThemeOpacity) {
      // Let the UITheme Inspector slider drive this material's alpha (live).
      registerFillMaterial(fillMat);
    }
  }

  const state = { halfW: opts.widthCm / 2, halfH: opts.heightCm / 2 };

  const build = (w: number, h: number) => {
    const ox = Math.max(w, th * 2) / 2;
    const oy = Math.max(h, th * 2) / 2;

    // Outer corner radius; inner arc shares the same centre so pairs stay matched.
    const rOuter = Math.max(
      0,
      Math.min(cornerFrac * Math.min(w, h), Math.min(ox, oy) - 0.01)
    );
    const rInner = Math.max(rOuter - th, 0.02);

    // Corner arc centres (TR, TL, BL, BR) and the CCW angle each arc sweeps.
    const corners = [
      { cx: ox - rOuter, cy: oy - rOuter, a0: 0 },
      { cx: -(ox - rOuter), cy: oy - rOuter, a0: Math.PI / 2 },
      { cx: -(ox - rOuter), cy: -(oy - rOuter), a0: Math.PI },
      { cx: ox - rOuter, cy: -(oy - rOuter), a0: (3 * Math.PI) / 2 },
    ];

    const verts: number[] = [];
    const outerIdx: number[] = [];
    const innerIdx: number[] = [];
    let n = 0;
    for (const c of corners) {
      for (let s = 0; s <= CORNER_SEGMENTS; s++) {
        const a = c.a0 + (s / CORNER_SEGMENTS) * (Math.PI / 2);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        verts.push(c.cx + rOuter * ca, c.cy + rOuter * sa, 0);
        outerIdx.push(n++);
        verts.push(c.cx + rInner * ca, c.cy + rInner * sa, 0);
        innerIdx.push(n++);
      }
    }

    const idx: number[] = [];
    const ring = outerIdx.length;
    for (let i = 0; i < ring; i++) {
      const j = (i + 1) % ring;
      const oI = outerIdx[i];
      const oJ = outerIdx[j];
      const iI = innerIdx[i];
      const iJ = innerIdx[j];
      // Two triangles per ring quad. Material is twoSided, so winding is cosmetic.
      idx.push(oI, oJ, iJ, oI, iJ, iI);
    }

    const builder = new MeshBuilder([{ name: "position", components: 3 }]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;
    builder.appendVerticesInterleaved(verts);
    builder.appendIndices(idx);
    rmv.mesh = builder.getMesh();
    builder.updateMesh();
    state.halfW = ox;
    state.halfH = oy;

    // Fill: triangle fan from the centre out to the outer rounded perimeter.
    // Carries a UV (texture0) alongside position — u/v map the local -ox..ox /
    // -oy..oy extents to 0..1, so a horizontal gradient texture (e.g. the
    // button fill's light-gray-to-transparent look) reads left-to-right
    // across the actual shape instead of needing a flat tint.
    if (fillRmv) {
      const flipU = !!opts.fillFlipU;
      const fv: number[] = [0, 0, 0, 0.5, 0.5];
      for (let k = 0; k < outerIdx.length; k++) {
        const base = outerIdx[k] * 3;
        const vx = verts[base];
        const vy = verts[base + 1];
        const u0 = (vx + ox) / (2 * ox);
        fv.push(vx, vy, verts[base + 2], flipU ? 1 - u0 : u0, (vy + oy) / (2 * oy));
      }
      const fi: number[] = [];
      const rim = outerIdx.length;
      for (let k = 0; k < rim; k++) {
        fi.push(0, 1 + k, 1 + ((k + 1) % rim));
      }
      const fb = new MeshBuilder([
        { name: "position", components: 3 },
        { name: "texture0", components: 2 },
      ]);
      fb.topology = MeshTopology.Triangles;
      fb.indexType = MeshIndexType.UInt16;
      fb.appendVerticesInterleaved(fv);
      fb.appendIndices(fi);
      fillRmv.mesh = fb.getMesh();
      fb.updateMesh();
    }
  };

  build(opts.widthCm, opts.heightCm);

  return {
    root,
    get halfW() {
      return state.halfW;
    },
    get halfH() {
      return state.halfH;
    },
    resize(widthCm: number, heightCm: number) {
      build(widthCm, heightCm);
    },
    setColor(c: vec4) {
      try {
        (mat.mainPass as any).baseColor = c;
      } catch (e) {
        /* ignore */
      }
    },
    destroy() {
      root.destroy();
    },
  };
}

/**
 * Ear-clipping triangulation of a simple polygon (points may be wound either
 * way — normalized to CCW internally). Returns a flat index array (triples)
 * into `pts`, or [] for degenerate input. Never throws: when ear-clipping
 * can't fully resolve (self-intersecting / noisy model output) it falls back
 * to a fan from the first remaining vertex for whatever's left, so callers
 * always get SOME triangulation rather than nothing.
 */
export function triangulatePolygon(pts: { x: number; y: number }[]): number[] {
  const n = pts.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];

  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    signedArea += p.x * q.y - q.x * p.y;
  }

  let ring = pts.map((p, i) => ({ x: p.x, y: p.y, i }));
  if (signedArea < 0) ring.reverse(); // ear-clipping below assumes CCW

  const pointInTriangle = (
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number }
  ) => {
    const d1 = cross(a, b, p);
    const d2 = cross(b, c, p);
    const d3 = cross(c, a, p);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  const indices: number[] = [];
  let guard = 0;
  while (ring.length > 3 && guard++ < 2000) {
    let clipped = false;
    for (let i = 0; i < ring.length; i++) {
      const prev = ring[(i - 1 + ring.length) % ring.length];
      const curr = ring[i];
      const next = ring[(i + 1) % ring.length];
      if (cross(prev, curr, next) <= 0) continue; // reflex / collinear — not an ear

      let isEar = true;
      for (let j = 0; j < ring.length; j++) {
        if (j === i) continue;
        const idxPrev = (i - 1 + ring.length) % ring.length;
        const idxNext = (i + 1) % ring.length;
        if (j === idxPrev || j === idxNext) continue;
        if (pointInTriangle(ring[j], prev, curr, next)) {
          isEar = false;
          break;
        }
      }
      if (!isEar) continue;

      indices.push(prev.i, curr.i, next.i);
      ring.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate remainder — fan it below rather than loop forever
  }

  if (ring.length === 3) {
    indices.push(ring[0].i, ring[1].i, ring[2].i);
  } else if (ring.length > 3) {
    for (let k = 1; k < ring.length - 1; k++) {
      indices.push(ring[0].i, ring[k].i, ring[k + 1].i);
    }
  }
  return indices;
}

export interface PolygonCutout {
  root: SceneObject;
  destroy(): void;
}

/**
 * A cut-out MESH shaped exactly like a Gemini segmentation polygon, sampling
 * `mat`'s `baseTex` directly at each vertex's own image-space UV. The
 * silhouette IS the geometry — no raster mask, no alpha compositing, nothing
 * to decode. `mat` should already have `baseTex` bound to the captured still
 * (clone + set it before calling this).
 *
 * @param pts01   polygon points, normalized 0..1, origin TOP-LEFT (image space)
 * @param heightCm world-space height of the cut-out; width follows the
 *                  polygon's own aspect ratio
 */
export function makePolygonCutout(
  parent: SceneObject,
  mat: Material,
  pts01: { x: number; y: number }[],
  heightCm: number,
  localPosition: vec3,
  outline?: ThumbOutline
): PolygonCutout | null {
  const tris = triangulatePolygon(pts01);
  if (tris.length < 3) return null;

  let minX = 1,
    minY = 1,
    maxX = 0,
    maxY = 0;
  for (const p of pts01) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(0.01, maxX - minX);
  const h = Math.max(0.01, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const worldH = heightCm;
  const worldW = heightCm * (w / h);

  const root = global.scene.createSceneObject("PolygonCutout");
  root.setParent(parent);
  root.getTransform().setLocalPosition(localPosition);

  // Local-space silhouette verts (image space -> world-cm, Y flipped up).
  const local: { x: number; y: number }[] = [];
  for (const p of pts01) {
    const lx = ((p.x - cx) / w) * worldW;
    const ly = -((p.y - cy) / h) * worldH;
    local.push({ x: lx, y: ly });
  }

  // Optional sticker outline — the SAME silhouette, radially inflated by
  // `outline.widthCm`, flat white. Built FIRST (so it draws first, i.e.
  // BEHIND the textured cut-out in hierarchy render order) so the textured
  // mesh paints over the interior and only the inflated rim shows
  // (2026-09-05: it was ending up as a rectangle around the un-cut image —
  // now it hugs the actual removed-background silhouette).
  if (outline && outline.widthCm > 0) {
    const ob = new MeshBuilder([{ name: "position", components: 3 }]);
    ob.topology = MeshTopology.Triangles;
    ob.indexType = MeshIndexType.UInt16;
    const ov: number[] = [];
    for (const l of local) {
      const len = Math.sqrt(l.x * l.x + l.y * l.y);
      const s = len > 0.01 ? (len + outline.widthCm) / len : 1;
      ov.push(l.x * s, l.y * s, 0);
    }
    ob.appendVerticesInterleaved(ov);
    ob.appendIndices(tris);
    const oObj = global.scene.createSceneObject("Outline");
    oObj.setParent(root);
    oObj.getTransform().setLocalPosition(new vec3(0, 0, -0.05));
    const orm = oObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    orm.mesh = ob.getMesh();
    ob.updateMesh();
    const om = tintedClone(THUMB_OUTLINE_BASE, outline.color ?? WHITE);
    try {
      (om.mainPass as any).twoSided = true;
    } catch (e) {
      /* ignore */
    }
    orm.clearMaterials();
    orm.addMaterial(om);
  }

  // Textured cut-out — its OWN child, created AFTER the outline so it renders
  // on top. The mesh IS the silhouette (no per-pixel alpha), so depthWrite is
  // safe and lets it occlude the outline behind it in the interior.
  const cut = global.scene.createSceneObject("Cutout");
  cut.setParent(root);
  cut.getTransform().setLocalPosition(new vec3(0, 0, 0));
  const rmv = cut.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  rmv.clearMaterials();
  rmv.addMaterial(mat);
  try {
    (mat.mainPass as any).twoSided = true;
  } catch (e) {
    /* pass has no twoSided uniform */
  }
  try {
    (mat.mainPass as any).depthWrite = true;
  } catch (e) {
    /* ignore */
  }

  const builder = new MeshBuilder([
    { name: "position", components: 3 },
    { name: "texture0", components: 2 },
  ]);
  builder.topology = MeshTopology.Triangles;
  builder.indexType = MeshIndexType.UInt16;
  const verts: number[] = [];
  for (const p of pts01) {
    const lx = ((p.x - cx) / w) * worldW;
    const ly = -((p.y - cy) / h) * worldH;
    verts.push(lx, ly, 0, p.x, 1 - p.y); // V flipped: texture V runs bottom-up
  }
  builder.appendVerticesInterleaved(verts);
  builder.appendIndices(tris);
  rmv.mesh = builder.getMesh();
  builder.updateMesh();

  return {
    root,
    destroy() {
      root.destroy();
    },
  };
}
