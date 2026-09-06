/**
 * OrbLook.ts — one Inspector panel for the Memory Orb's look (DESIGN.md v2
 * §11), PLUS a real-time debug preview.
 *
 * MATERIAL (2026-09-05): the orb now uses the asset-library **Vertex
 * Distortion** material (`Vertex Distortion.lspkg/Vertex Distortion.mat`) —
 * a graph shader that wobbles the sphere's vertices with animated noise (a
 * real "wavy" surface, not a fake normal map) and exposes plain albedo /
 * emissive / roughness / metallic ports. The earlier UberPBR rim-light /
 * normal-map approach is gone: that material had no working rim glow here.
 *
 * MATTE + GLOW (2026-09-05): `applyOrbLook` also drives `Port_Roughness` high
 * (matte, no plastic highlight) and a faint `Port_Emissive` (mostly the day
 * colour + a little white) so the orb reads as a luminous matte blob — lit
 * side toward white, edges saturated. A true white-centre → colour-edge
 * *radial* gradient would need a Fresnel/facing node added to the graph
 * shader itself; this is the no-graph-edit approximation.
 *
 * WHY THIS IS A SEPARATE SCRIPT FROM OrbScreen (2026-09-04): OrbScreen's
 * component lives on `Screens/OrbRoot`, which ScreenRouter disables whenever
 * the user isn't on the Orb screen — and a disabled SceneObject's
 * `UpdateEvent` never fires. A live "preview any time, drag sliders, watch it
 * update" debug mode needs to keep running regardless of the active screen,
 * so it — and the shared look settings it tunes — live here instead, on the
 * ALWAYS-ON `OrbSpawner` object. Mirrors UITheme.ts's module-level-state-
 * plus-live-component pattern.
 *
 * OrbScreen reads the getters below at build time for the REAL saved orb, and
 * calls `applyOrbLook(mat, entry.orbColor)` so the sphere takes the colour of
 * the day's chosen feeling (§8).
 *
 * @input orbMesh / orbMat - sphere geometry + the Vertex Distortion material
 *        (wire both to the same assets OrbScreen's own @inputs point at)
 * @input waveStrength / waveSpeed / noiseScale / rotationSpeedDegPerSec - the
 *        shared surface look
 * @input debugPreviewOrb - Preview-only: a live-tunable orb, independent of
 *        the screen flow, re-applying the sliders every frame. Leave OFF.
 * @input debugOrbColorHex - orb colour for the debug preview only
 */

function hexToVec3(hex: string): vec3 {
  const h = (hex || "").replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return new vec3(isNaN(r) ? 0.7 : r, isNaN(g) ? 0.7 : g, isNaN(b) ? 0.7 : b);
}

let _waveStrength = 0.2;
let _waveSpeed = 2.9;
let _noiseScale = 0.2;
let _rotationSpeedDegPerSec = 12;
// Matte-paper feel: high roughness kills the plastic specular highlight; a
// faint colour-tinted emissive keeps the orb luminous. The white-centre →
// colour-edge radial gradient itself is now a camera-facing gradient disc laid
// over the orb (OrbScreen.buildOrbGlow), so the white emissive is dialled to 0.
let _matteRoughness = 0.9;
let _glowColorAmount = 0.14;
let _glowWhiteAmount = 0.0;

export function getRotationSpeedDegPerSec(): number { return _rotationSpeedDegPerSec; }

/** Push the shared look — and the per-entry colour — onto one orb material
 *  clone. `colorHex` is the day's feeling colour (§8) for the real orb, or
 *  `debugOrbColorHex` for the preview. Every write is wrapped: if the wired
 *  material isn't the Vertex Distortion graph, the unknown ports just no-op. */
export function applyOrbLook(mat: Material, colorHex: string): void {
  const p = mat.mainPass as any;
  const c = hexToVec3(colorHex);
  try {
    p.Port_Albedo_N006 = c; // the graph's base-colour port
  } catch (e) {
    /* not the Vertex Distortion graph — no albedo port */
  }
  try {
    p.Port_Roughness_N006 = _matteRoughness; // matte — no plastic highlight
  } catch (e) {
    /* ignore */
  }
  try {
    p.Port_Metallic_N006 = 0;
  } catch (e) {
    /* ignore */
  }
  try {
    p.Port_Emissive_N006 = new vec3(
      c.x * _glowColorAmount + _glowWhiteAmount,
      c.y * _glowColorAmount + _glowWhiteAmount,
      c.z * _glowColorAmount + _glowWhiteAmount
    );
  } catch (e) {
    /* ignore */
  }
  try {
    p.strength = _waveStrength;
  } catch (e) {
    /* ignore */
  }
  try {
    p.animatedSpeed = _waveSpeed;
  } catch (e) {
    /* ignore */
  }
  try {
    p.noiseScale = _noiseScale;
  } catch (e) {
    /* ignore */
  }
}

const DEBUG_ORB_NAME = "DebugPreviewOrb";

@component
export class OrbLook extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">OrbLook — Memory Orb look + live debug preview (§11)</span>')
  @ui.separator
  @ui.group_start("References (debug preview only)")
  @input
  @hint("Sphere mesh for the debug preview (wire to MarkerSphereMesh.mesh — same asset OrbScreen.orbMesh uses).")
  @allowUndefined
  orbMesh!: RenderMesh;
  @input
  @hint("Orb material for the debug preview — wire to Vertex Distortion.mat, the SAME asset OrbScreen.orbMat uses.")
  @allowUndefined
  orbMat!: Material;
  @ui.group_end

  @ui.group_start("Orb look (shared by the real orb + the debug preview)")
  @input
  @hint("How far the surface vertices wobble (Vertex Distortion 'strength').")
  @widget(new SliderWidget(0, 1, 0.01))
  waveStrength: number = 0.2;
  @input
  @hint("How fast the wobble animates (Vertex Distortion 'animatedSpeed').")
  @widget(new SliderWidget(0, 20, 0.1))
  waveSpeed: number = 2.9;
  @input
  @hint("Noise scale of the wobble — smaller = broader swells, larger = finer ripples (Vertex Distortion 'noiseScale').")
  @widget(new SliderWidget(0, 1, 0.01))
  noiseScale: number = 0.2;
  @input
  @hint("Degrees/second the whole orb slowly spins on top of the surface wobble.")
  @widget(new SliderWidget(-60, 60, 1))
  rotationSpeedDegPerSec: number = 12;
  @input
  @hint("Surface roughness — 1 = fully matte (no specular highlight, 'matte paper'), 0 = glossy/plastic.")
  @widget(new SliderWidget(0, 1, 0.01))
  matteRoughness: number = 0.9;
  @input
  @hint("Self-glow tinted with the day colour — makes the orb read as luminous. 0 = none.")
  @widget(new SliderWidget(0, 0.6, 0.01))
  glowColorAmount: number = 0.14;
  @input
  @hint("Extra white added to the self-glow — pushes the lit side toward a white core.")
  @widget(new SliderWidget(0, 0.4, 0.01))
  glowWhiteAmount: number = 0.0;
  @ui.group_end

  @ui.group_start("Debug")
  @input
  @hint("Preview-only: shows a live-tunable orb immediately, independent of the save flow, re-applying the sliders above every frame. Leave OFF for real use.")
  debugPreviewOrb: boolean = false;
  @input
  @hint("Orb colour used ONLY by the debug preview (the real orb always uses the day's feeling colour).")
  debugOrbColorHex: string = "#5B8DEF";
  @ui.group_end

  private debugSphere: SceneObject | null = null;
  private debugSphereMat: Material | null = null;
  private debugAngle = 0;

  onAwake(): void {
    // This component's own SceneObject (OrbSpawner) is ALWAYS enabled — see
    // class doc — so this ticks regardless of which screen is on-screen.
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  private onUpdate(): void {
    _waveStrength = this.waveStrength;
    _waveSpeed = this.waveSpeed;
    _noiseScale = this.noiseScale;
    _rotationSpeedDegPerSec = this.rotationSpeedDegPerSec;
    _matteRoughness = this.matteRoughness;
    _glowColorAmount = this.glowColorAmount;
    _glowWhiteAmount = this.glowWhiteAmount;

    this.updateDebugPreview();
  }

  private updateDebugPreview(): void {
    if (!this.debugPreviewOrb) {
      if (this.debugSphere) {
        try {
          this.debugSphere.destroy();
        } catch (e) {
          /* ignore */
        }
        this.debugSphere = null;
        this.debugSphereMat = null;
      }
      return;
    }
    if (isNull(this.orbMesh) || isNull(this.orbMat)) {
      console.log("[OrbLook] debugPreviewOrb on but orbMesh/orbMat not wired — nothing to preview");
      return;
    }

    if (!this.debugSphere || isNull(this.debugSphere)) {
      const obj = global.scene.createSceneObject(DEBUG_ORB_NAME);
      obj.setParent(this.sceneObject);
      obj.getTransform().setLocalPosition(new vec3(0, 20, -40));
      const d = 18;
      obj.getTransform().setLocalScale(new vec3(d, d, d));
      const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      rmv.mesh = this.orbMesh;
      const mat = this.orbMat.clone();
      rmv.clearMaterials();
      rmv.addMaterial(mat);
      this.debugSphere = obj;
      this.debugSphereMat = mat;
      this.debugAngle = 0;
      console.log("[OrbLook][Debug] preview orb built — drag the look sliders to tune live");
    }

    if (this.debugSphereMat) applyOrbLook(this.debugSphereMat, this.debugOrbColorHex);

    this.debugAngle += _rotationSpeedDegPerSec * getDeltaTime();
    this.debugSphere.getTransform().setLocalRotation(quat.fromEulerAngles(0, (this.debugAngle * Math.PI) / 180, 0));
  }
}
