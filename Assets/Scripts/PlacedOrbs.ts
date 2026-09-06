/**
 * PlacedOrbs.ts — on Lens start, re-creates every ball the user has parked in
 * the room in a previous session (from PlacedOrbStore) and keeps each one's
 * creature face + white-core glow billboarded toward the camera, blinking
 * gently — the same look OrbScreen gives a fresh placement.
 *
 * Lives on the ALWAYS-ON OrbSpawner object (same host as OrbLook) so the
 * restored orbs survive every screen change. Each restored orb is registered
 * in `sessionPlacedOrbs` so JarScreen's "Revisit the month" (Round O) shows
 * the real ball at its spot, exactly as for a same-session placement.
 *
 * OrbScreen still builds the orb during the placement flow; on Confirm it
 * records the world position via PlacedOrbStore.recordPlacement and this
 * script picks it up on the NEXT launch.
 *
 * @input orbMesh / orbMat - sphere mesh + Vertex Distortion material (wire to
 *        the SAME assets OrbScreen.orbMesh / orbMat point at).
 * @input cameraObject     - scene "Camera Object", for the per-frame billboard.
 * @input debugClearPlacements - Preview one-shot: wipe traceJournal.placements
 *        on start. Leave OFF.
 */

import { findSavedById } from "./DayStore";
import { applyOrbLook } from "./OrbLook";
import { eyeTexture, radialGlowTexture, tintedOrbGradient, sessionPlacedOrbs } from "./OrbScreen";
import { clearPlacements, PlacedRecord, readPlacements } from "./PlacedOrbStore";
import { buildSapling, dayOrbSapling, momentCountToStage, Sapling } from "./Sapling";

const GLOW_MAT = requireAsset("../Materials/ImageMaterial.mat") as Material;

interface RestoredOrb {
  id: string;
  sphere: SceneObject;
  glow: SceneObject | null;
  eyes: SceneObject | null;
  eyeL: SceneObject | null;
  eyeR: SceneObject | null;
  eyeGap: number;
  sapling: Sapling | null;
  radiusCm: number;
  liveT: number;
  blink: number;
  blinkDir: number; // -1 opening, 0 idle, +1 closing
  blinkTimer: number;
}

@component
export class PlacedOrbs extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">PlacedOrbs — restore parked balls across sessions (§11)</span>')
  @ui.separator
  @input
  @hint("Sphere mesh — wire to MarkerSphereMesh.mesh (same asset OrbScreen.orbMesh uses).")
  @allowUndefined
  orbMesh!: RenderMesh;
  @input
  @hint("Orb material — wire to Vertex Distortion.mat (same asset OrbScreen.orbMat uses).")
  @allowUndefined
  orbMat!: Material;
  @input
  @hint('Scene "Camera Object" — drives the per-frame billboard of each restored orb\'s face + glow.')
  @allowUndefined
  cameraObject!: SceneObject;

  @ui.group_start("Debug")
  @input
  @hint("Preview one-shot: wipe traceJournal.placements on start (clears test pollution). Turn back OFF after one run.")
  debugClearPlacements: boolean = false;
  @ui.group_end

  private orbs: RestoredOrb[] = [];

  onAwake(): void {
    // Restore during AWAKE (not OnStart) so every parked ball is already in
    // `sessionPlacedOrbs` before any screen — JarScreen especially — runs its
    // first build.
    this.restoreAll();
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  private restoreAll(): void {
    if (this.debugClearPlacements) {
      clearPlacements();
      console.log("[PlacedOrbs][Debug] wiped traceJournal.placements");
      return;
    }
    if (isNull(this.orbMesh) || isNull(this.orbMat)) {
      console.log("[PlacedOrbs] orbMesh/orbMat not wired — cannot restore parked balls");
      return;
    }
    const recs = readPlacements();
    for (const rec of recs) {
      // A ball placed earlier THIS session is already live (sessionPlacedOrbs) —
      // don't build a duplicate.
      if (sessionPlacedOrbs.has(rec.id)) continue;
      this.buildRestored(rec);
    }
    console.log(`[PlacedOrbs] restored ${this.orbs.length} parked ball(s)`);
  }

  private buildRestored(rec: PlacedRecord): void {
    const d = rec.scale > 0.5 ? rec.scale : 18;
    const holder = global.scene.createSceneObject("RestoredOrb_" + rec.id);
    holder.setParent(this.sceneObject);
    const t = holder.getTransform();
    t.setWorldPosition(new vec3(rec.px, rec.py, rec.pz));
    t.setWorldScale(new vec3(d, d, d));

    const rmv = holder.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    rmv.mesh = this.orbMesh;
    const mat = this.orbMat.clone();
    applyOrbLook(mat, rec.colorHex || "#9AA0A6");
    rmv.clearMaterials();
    rmv.addMaterial(mat);

    const glow = this.buildGlow(d, rec.colorHex || "#9AA0A6");
    const eyes = this.buildEyes(d);

    // The plant, at the stage this day's saved moment count earns — no tween
    // here, restored orbs just show their current growth.
    const saved = findSavedById(rec.id);
    const stage = momentCountToStage(saved ? (saved.selectedMomentIds || []).length : 0);
    const sapling = buildSapling(this.sceneObject, d, { scaleMul: 1.25 });
    sapling.snapToStage(stage);
    dayOrbSapling.set(rec.id, sapling); // "Add to Today's Journal" bumps this in place

    sessionPlacedOrbs.set(rec.id, holder);
    this.orbs.push({
      id: rec.id,
      sphere: holder,
      glow: glow,
      eyes: eyes.holder,
      eyeL: eyes.left,
      eyeR: eyes.right,
      eyeGap: eyes.gap,
      sapling: sapling,
      radiusCm: d * 0.5,
      liveT: Math.random() * 3,
      blink: 0,
      blinkDir: 0,
      blinkTimer: 2 + Math.random() * 3,
    });
  }

  /** Camera-facing white-core -> day-colour -> clear gradient disc (parented to
   *  this always-on root at scale 1, so its mesh units == cm; billboarded each
   *  frame). Matches OrbScreen.buildOrbGlow. */
  private buildGlow(diameterCm: number, colorHex: string): SceneObject | null {
    const tex = tintedOrbGradient(colorHex) || radialGlowTexture();
    if (!tex) return null;
    const o = global.scene.createSceneObject("RGlow");
    o.setParent(this.sceneObject);
    const rmv = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const mb = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    mb.topology = MeshTopology.Triangles;
    mb.indexType = MeshIndexType.UInt16;
    const s = diameterCm * 0.8;
    mb.appendVerticesInterleaved([-s, -s, 0, 0, 0, s, -s, 0, 1, 0, s, s, 0, 1, 1, -s, s, 0, 0, 1]);
    mb.appendIndices([0, 1, 2, 0, 2, 3]);
    rmv.mesh = mb.getMesh();
    mb.updateMesh();
    const m = GLOW_MAT.clone();
    try {
      (m.mainPass as any).baseTex = tex;
      (m.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
      (m.mainPass as any).depthTest = false;
      (m.mainPass as any).depthWrite = false;
      (m.mainPass as any).twoSided = true;
    } catch (e) {
      /* ignore */
    }
    rmv.clearMaterials();
    rmv.addMaterial(m);
    return o;
  }

  private buildEyes(diameterCm: number): {
    holder: SceneObject;
    left: SceneObject;
    right: SceneObject;
    gap: number;
  } {
    const holder = global.scene.createSceneObject("REyes");
    holder.setParent(this.sceneObject);
    const halfLen = diameterCm * 0.08;
    const r = Math.max(0.2, diameterCm * 0.025);
    const gap = diameterCm * 0.17;
    return {
      holder: holder,
      left: this.makeEyeBar(holder, -gap * 0.5, halfLen, r),
      right: this.makeEyeBar(holder, gap * 0.5, halfLen, r),
      gap: gap,
    };
  }

  /** One vertical stadium (rectangle + semicircle caps) — same recipe as
   *  OrbScreen.makeEyeBar. */
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
      const a = (i / CAP) * Math.PI;
      push(Math.cos(a) * r, halfLen + Math.sin(a) * r);
    }
    push(-r, halfLen);
    push(-r, -halfLen);
    for (let i = 1; i < CAP; i++) {
      const a = Math.PI + (i / CAP) * Math.PI;
      push(Math.cos(a) * r, -halfLen + Math.sin(a) * r);
    }
    for (let i = 0; i < perim.length; i++) {
      idx.push(0, perim[i], perim[(i + 1) % perim.length]);
    }
    mb.appendVerticesInterleaved(verts);
    mb.appendIndices(idx);
    rmv.mesh = mb.getMesh();
    mb.updateMesh();
    const m = GLOW_MAT.clone();
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

  private onUpdate(): void {
    if (this.orbs.length === 0 || isNull(this.cameraObject)) return;
    const dt = getDeltaTime();
    const camPos = this.cameraObject.getTransform().getWorldPosition();

    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const orb = this.orbs[i];
      if (isNull(orb.sphere)) {
        if (orb.sapling) {
          if (dayOrbSapling.get(orb.id) === orb.sapling) dayOrbSapling.delete(orb.id);
          try {
            orb.sapling.destroy();
          } catch (e) {
            /* ignore */
          }
        }
        this.orbs.splice(i, 1);
        continue;
      }
      orb.liveT += dt;

      const spherePos = orb.sphere.getTransform().getWorldPosition();
      let toCam = camPos.sub(spherePos);
      if (toCam.length < 1e-3) toCam = new vec3(0, 0, 1);
      toCam = toCam.normalize();
      const faceRot = quat.lookAt(toCam, vec3.up());

      if (orb.sapling) {
        orb.sapling.place(spherePos, orb.radiusCm, camPos);
        orb.sapling.update(dt);
      }

      if (orb.glow && !isNull(orb.glow)) {
        const g = orb.glow.getTransform();
        g.setWorldPosition(spherePos.add(toCam.uniformScale(orb.radiusCm)));
        g.setWorldRotation(faceRot);
      }
      if (!orb.eyes || isNull(orb.eyes)) continue;
      const et = orb.eyes.getTransform();
      et.setWorldPosition(spherePos.add(toCam.uniformScale(orb.radiusCm * 1.03)));
      et.setWorldRotation(faceRot);

      const bob = Math.sin(orb.liveT * 2.1) * (orb.radiusCm * 0.05);
      const glance = Math.sin(orb.liveT * 0.7) * (orb.radiusCm * 0.06);

      if (orb.blinkDir === 0) {
        orb.blinkTimer -= dt;
        if (orb.blinkTimer <= 0) orb.blinkDir = 1;
      } else if (orb.blinkDir === 1) {
        orb.blink = Math.min(1, orb.blink + dt / 0.09);
        if (orb.blink >= 1) orb.blinkDir = -1;
      } else {
        orb.blink = Math.max(0, orb.blink - dt / 0.12);
        if (orb.blink <= 0) {
          orb.blinkDir = 0;
          orb.blinkTimer = 2.0 + Math.random() * 3.5;
        }
      }
      const openY = 1 - 0.9 * orb.blink;
      if (orb.eyeL && !isNull(orb.eyeL)) this.setEyeBar(orb.eyeL, -orb.eyeGap * 0.5 + glance, bob, openY);
      if (orb.eyeR && !isNull(orb.eyeR)) this.setEyeBar(orb.eyeR, orb.eyeGap * 0.5 + glance, bob, openY);
    }
  }

  private setEyeBar(o: SceneObject, x: number, y: number, openY: number): void {
    const t = o.getTransform();
    t.setLocalPosition(new vec3(x, y, 0.05));
    t.setLocalScale(new vec3(1, openY, 1));
  }
}
