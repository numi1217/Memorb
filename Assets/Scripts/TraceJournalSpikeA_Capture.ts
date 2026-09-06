/**
 * TraceJournalSpikeA_Capture.ts — Spike A: pinch-to-capture still + marker.
 *
 * GOAL (de-risk): on a pinch, grab ONE camera still, freeze it onto a
 * world-space panel in front of the user, and drop a white sphere marker at
 * the centre ray hit point. Play a short capture sound. Debounce repeat pinches.
 *
 * EXIT CHECK: pinch in Preview -> frozen image panel + marker appear.
 *
 * @input cameraObject   - the scene "Camera Object" (ray origin + editor marker fallback)
 * @input marker         - a small sphere SceneObject, starts disabled; moved to the hit point
 * @input captureAudio   - AudioComponent that plays the capture cue (optional)
 * @input debounceSec    - min seconds between captures
 *
 * PUBLIC: onCapture: Event<Texture> — fires with the frozen still (Spike B listens).
 *
 * NOTES
 *  - requestImage() is device-only. In Preview we fall back to the live camera
 *    stream texture (requestCamera + one frame) so the panel still populates.
 *  - WorldQueryModule hit tests need on-device depth; in Preview we place the
 *    marker at a fixed distance along the camera forward ray.
 */

import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { PanelKit, TitledPanel } from "./PanelKit";

const CAPTURE_PANEL_DISTANCE = -95; // cm, in front of the user
const MARKER_FALLBACK_DISTANCE = 90; // cm along camera forward when no surface hit

@component
export class TraceJournalSpikeA_Capture extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Spike A — pinch capture + marker</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint('The scene "Camera Object". Used as the ray origin and Preview marker fallback.')
  cameraObject!: SceneObject;

  @input
  @hint("A small sphere SceneObject. Starts disabled; repositioned to the ray hit point.")
  @allowUndefined
  marker!: SceneObject;

  @input
  @hint("AudioComponent that plays the capture cue. Optional.")
  @allowUndefined
  captureAudio!: AudioComponent;
  @ui.group_end
  @ui.group_start("Settings")
  @input
  @hint("Minimum seconds between captures (debounce).")
  debounceSec: number = 0.8;

  @input
  @hint("Debug: fire one capture automatically N seconds after start (0 = off). Lets Spike B run without a pinch.")
  autoCaptureAfterSec: number = 0;
  @ui.group_end

  /** Fires with the frozen still texture after each successful capture. */
  public readonly onCapture: Event<Texture> = new Event<Texture>();

  private cameraModule = require("LensStudio:CameraModule") as CameraModule;
  private gestureModule = require("LensStudio:GestureModule") as GestureModule;
  private worldQuery = require("LensStudio:WorldQueryModule") as WorldQueryModule;

  private hitSession: HitTestSession | null = null;
  private panel: TitledPanel | null = null;
  private frozenImage: Image | null = null;
  private liveCameraTex: Texture | null = null;
  private lastCaptureTime = -999;
  private busy = false;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    // Build the freeze-frame panel.
    this.panel = PanelKit.create(this.sceneObject, {
      name: "SpikeA_CapturePanel",
      title: "Captured Trace",
      body: "Pinch to capture.",
      widthCm: 46,
      heightCm: 34,
      localPosition: new vec3(0, 0, CAPTURE_PANEL_DISTANCE),
    });

    // Image surface for the frozen still, parented under the panel content.
    const imgObj = global.scene.createSceneObject("FrozenStill");
    imgObj.setParent(this.panel.contentAnchor);
    imgObj.getTransform().setLocalPosition(new vec3(0, -2, 0.2));
    this.frozenImage = imgObj.createComponent("Component.Image") as Image;
    const mat = (requireAsset("../Materials/ImageMaterial.mat") as Material).clone();
    this.frozenImage.clearMaterials();
    this.frozenImage.addMaterial(mat);

    // Hit-test session for the marker.
    this.hitSession = this.worldQuery.createHitTestSession();
    this.hitSession.start();

    if (this.marker) this.marker.enabled = false;

    // Pinch wiring — editor uses TapEvent, device uses the pinch gesture.
    if (global.deviceInfoSystem.isEditor()) {
      this.createEvent("TapEvent").bind(() => this.tryCapture());
      console.log("[SpikeA] editor mode: click the preview to capture");
    } else {
      // 1 == GestureModule.HandType.Right (numeric literal — runtime doesn't
      // expose the namespace enum as a value on this LS build).
      this.gestureModule
        .getPinchDownEvent(1 as unknown as GestureModule.HandType)
        .add(() => this.tryCapture());
      console.log("[SpikeA] device mode: pinch (right hand) to capture");
    }

    if (this.autoCaptureAfterSec > 0) {
      const auto = this.createEvent("DelayedCallbackEvent");
      auto.bind(() => {
        console.log("[SpikeA] auto-capture firing (autoCaptureAfterSec debug affordance)");
        this.tryCapture();
      });
      auto.reset(this.autoCaptureAfterSec);
    }
  }

  private tryCapture(): void {
    const now = getTime();
    if (this.busy) {
      console.log("[SpikeA] ignored pinch — capture in progress");
      return;
    }
    if (now - this.lastCaptureTime < this.debounceSec) {
      console.log("[SpikeA] ignored pinch — debounced");
      return;
    }
    this.lastCaptureTime = now;
    this.busy = true;
    console.log("[SpikeA] capture requested");
    this.capture()
      .then((tex) => {
        this.busy = false;
        if (tex) {
          console.log("[SpikeA] capture complete");
          this.placeMarker();
          this.onCapture.invoke(tex);
        }
      })
      .catch((e) => {
        this.busy = false;
        console.log("[SpikeA] capture failed: " + e);
        if (this.panel) this.panel.setBody("Capture failed: " + e);
      });
  }

  private async capture(): Promise<Texture | null> {
    let tex: Texture | null = null;

    if (!global.deviceInfoSystem.isEditor()) {
      // Device: proper high-res still.
      try {
        const req = CameraModule.createImageRequest();
        req.resolution = new vec2(1024, 768); // keep the still small for a fast round-trip
        const frame = await this.cameraModule.requestImage(req);
        tex = frame.texture;
        console.log("[SpikeA] used requestImage() still");
      } catch (e) {
        console.log("[SpikeA] requestImage failed, falling back to stream: " + e);
      }
    }

    if (!tex) {
      // Editor (or device fallback): use the live camera stream, settle 1 frame.
      tex = await this.getLiveCameraTexture();
      console.log("[SpikeA] used live camera stream texture");
    }

    if (tex && this.frozenImage) {
      (this.frozenImage.mainPass as any).baseTex = tex;
      (this.frozenImage.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
    }
    if (this.panel) this.panel.setBody("Frozen at " + Math.round(getTime()) + "s");
    this.playCue();
    return tex;
  }

  private getLiveCameraTexture(): Promise<Texture> {
    if (this.liveCameraTex) return Promise.resolve(this.liveCameraTex);
    return new Promise<Texture>((resolve) => {
      const req = CameraModule.createCameraRequest();
      req.cameraId = global.deviceInfoSystem.isEditor()
        ? CameraModule.CameraId.Default_Color
        : CameraModule.CameraId.Right_Color;
      const camTex = this.cameraModule.requestCamera(req);
      const provider = camTex.control as CameraTextureProvider;
      const reg = provider.onNewFrame.add(() => {
        provider.onNewFrame.remove(reg);
        this.liveCameraTex = camTex;
        resolve(camTex);
      });
    });
  }

  private placeMarker(): void {
    if (!this.marker) {
      console.log("[SpikeA] no marker wired — skipping marker placement");
      return;
    }
    const camT = this.cameraObject.getTransform();
    const origin = camT.getWorldPosition();
    const look = camT.forward.uniformScale(-1); // camera looks down -Z
    const rayEnd = origin.add(look.uniformScale(500));

    let placed = false;
    if (this.hitSession) {
      this.hitSession.hitTest(origin, rayEnd, (hit: WorldQueryHitTestResult) => {
        if (hit && !isNull(hit.position)) {
          this.marker.getTransform().setWorldPosition(hit.position);
          this.marker.enabled = true;
          placed = true;
          console.log("[SpikeA] marker at surface hit " + hit.position);
        }
      });
    }
    // Hit test is async + may miss (no depth in Preview). Fallback next frame.
    const fallback = this.createEvent("DelayedCallbackEvent");
    fallback.bind(() => {
      if (placed) return;
      const p = origin.add(look.uniformScale(MARKER_FALLBACK_DISTANCE));
      this.marker.getTransform().setWorldPosition(p);
      this.marker.enabled = true;
      console.log("[SpikeA] marker at fallback distance " + p);
    });
    fallback.reset(0.15);
  }

  private playCue(): void {
    if (isNull(this.captureAudio)) {
      console.log("[SpikeA] captureAudio not wired — no cue");
      return;
    }
    // The AudioComponent has no AudioTrack assigned yet (no WAV generated —
    // Node.js is missing so /build-sfx could not run). Guard so a missing
    // track can never break the capture chain. Assign a short WAV to the
    // SpikeA_Audio AudioComponent and this cue starts working.
    try {
      if (isNull(this.captureAudio.audioTrack)) {
        console.log("[SpikeA] no AudioTrack on captureAudio — skipping cue (assign a WAV to SpikeA_Audio)");
        return;
      }
      this.captureAudio.playbackMode = Audio.PlaybackMode.LowLatency;
      this.captureAudio.play(1);
      console.log("[SpikeA] capture cue played");
    } catch (e) {
      console.log("[SpikeA] capture cue failed (non-fatal): " + e);
    }
  }
}
