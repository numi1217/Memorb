/**
 * CaptureController.ts — Memorest Phase 1 capture path (promoted from
 * TraceJournalSpikeA_Capture).
 *
 * OWNS: turning one deliberate pinch/tap into (a) a FROZEN still texture and
 * (b) a world-space marker position at the centre raycast point. Nothing else —
 * no panels, no Gemini, no cards. ScanScreen listens to `onCapture`.
 *
 * @input cameraObject   - the scene "Camera Object" (ray origin + Preview fallback)
 * @input captureAudioTrack - optional short WAV; played once on capture (spec §2). Skipped silently if unset.
 * @input debounceSec    - min seconds between captures
 * @input captureWidthDevice / captureHeightDevice - still resolution requested on
 *        device (smaller = faster Gemini round-trip — Phase 0 finding). No effect
 *        in Preview, which uses the live camera stream at its native size.
 * @input useWorldQuery  - device surface hit-test for the marker (camera-forward
 *        fallback always applies in Preview / on a miss).
 * @input autoCaptureAfterSec - debug: fire one capture N s after start (0 = off).
 *
 * PUBLIC: onCapture: Event<CaptureResult>
 *
 * MUST NOT: build UI, call GeminiService, or advance FlowManager.
 */

import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";

export interface CaptureResult {
  /** A static snapshot of the frame at capture time (safe to hand to Gemini / bind to an Image). */
  frozen: Texture;
  /** World position of the centre raycast point (surface hit, or camera-forward fallback). */
  markerPos: vec3;
  /** Native pixel size of the frozen texture — logged by ScanScreen for the latency report. */
  width: number;
  height: number;
}

const MARKER_FALLBACK_DISTANCE = 90; // cm along camera-forward when there is no surface hit

@component
export class CaptureController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">CaptureController — pinch/tap -> frozen still + marker point</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint('The scene "Camera Object". Ray origin and Preview marker fallback.')
  cameraObject!: SceneObject;

  @input
  @hint("Optional short capture cue WAV. Played once per capture; skipped silently if empty.")
  @allowUndefined
  captureAudioTrack!: AudioTrackAsset;
  @ui.group_end

  @ui.group_start("Settings")
  @input
  @hint("Minimum seconds between captures (debounce). Raised (2026-09-05) so a jittery first pinch can't fire two captures.")
  debounceSec: number = 1.6;

  @input
  @hint("Still width requested on device (px). Smaller = faster Gemini. Preview ignores this.")
  captureWidthDevice: number = 640;

  @input
  @hint("Still height requested on device (px).")
  captureHeightDevice: number = 480;

  @input
  @hint("Use the device WorldQuery surface hit-test for the marker point.")
  useWorldQuery: boolean = true;

  @input
  @hint("Debug: auto-fire one capture N seconds after start (0 = off).")
  autoCaptureAfterSec: number = 0;
  @ui.group_end

  /** Fires once per successful capture with a frozen still + marker point. */
  public readonly onCapture: Event<CaptureResult> = new Event<CaptureResult>();

  private cameraModule = require("LensStudio:CameraModule") as CameraModule;
  private gestureModule = require("LensStudio:GestureModule") as GestureModule;
  private worldQuery = require("LensStudio:WorldQueryModule") as WorldQueryModule;

  private hitSession: HitTestSession | null = null;
  private cameraTex: Texture | null = null;
  private cameraProvider: CameraTextureProvider | null = null;
  private camFrameCount = 0;
  private audio: AudioComponent | null = null;
  private lastCaptureTime = -999;
  private busy = false;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    if (isNull(this.cameraObject)) {
      console.log("[Capture] ERROR: cameraObject not wired");
      return;
    }

    if (this.useWorldQuery) {
      this.hitSession = this.worldQuery.createHitTestSession();
      this.hitSession.start();
    }

    // Warm the camera stream now so the first capture doesn't wait on it and
    // frames are already flowing.
    try {
      this.ensureCameraStream();
    } catch (e) {
      console.log("[Capture] camera stream warm-up failed (will retry on capture): " + e);
    }

    if (!isNull(this.captureAudioTrack)) {
      const audioObj = global.scene.createSceneObject("CaptureAudio");
      audioObj.setParent(this.sceneObject);
      this.audio = audioObj.createComponent("Component.AudioComponent") as AudioComponent;
      this.audio.audioTrack = this.captureAudioTrack;
      this.audio.playbackMode = Audio.PlaybackMode.LowLatency;
    }

    if (global.deviceInfoSystem.isEditor()) {
      this.createEvent("TapEvent").bind(() => this.tryCapture());
      console.log("[Capture] editor mode: click the preview to capture");
    } else {
      // 1 == GestureModule.HandType.Right (numeric literal — this LS build does
      // not expose the namespace enum as a runtime value). *Filtered* pinch-down
      // (2026-09-05) — stays a single event when the hand is moving/jittery,
      // instead of firing twice on one deliberate pinch.
      this.gestureModule
        .getFilteredPinchDownEvent(1 as unknown as GestureModule.HandType)
        .add(() => this.tryCapture());
      console.log("[Capture] device mode: pinch (right hand) to capture");
    }

    if (this.autoCaptureAfterSec > 0) {
      const auto = this.createEvent("DelayedCallbackEvent");
      auto.bind(() => {
        console.log("[Capture] auto-capture firing");
        this.tryCapture();
      });
      auto.reset(this.autoCaptureAfterSec);
    }
  }

  /** True while a capture is being processed — ScanScreen also guards, this is defence in depth. */
  isBusy(): boolean {
    return this.busy;
  }

  private tryCapture(): void {
    const now = getTime();
    if (this.busy) {
      console.log("[Capture] ignored — capture in progress");
      return;
    }
    if (now - this.lastCaptureTime < this.debounceSec) {
      console.log("[Capture] ignored — debounced");
      return;
    }
    this.lastCaptureTime = now;
    this.busy = true;
    console.log("[Capture] requested");

    // Watchdog: if the capture chain (frame grab / marker resolve) never settles,
    // clear `busy` anyway so the user is not locked out of scanning entirely.
    const watchdog = this.createEvent("DelayedCallbackEvent");
    watchdog.bind(() => {
      if (this.busy) {
        this.busy = false;
        console.log("[Capture] watchdog: capture stalled >5s — resetting so you can pinch again");
      }
    });
    watchdog.reset(5.0);
    const clearWatchdog = () => {
      try { this.removeEvent(watchdog); } catch (e) { /* already fired/removed */ }
    };

    this.grabFrame()
      .then((live) => {
        const frozen = this.freeze(live);
        return this.computeMarkerPos().then((markerPos) => {
          clearWatchdog();
          this.playCue();
          this.busy = false;
          console.log(
            `[Capture] complete (${frozen.getWidth()}x${frozen.getHeight()}) marker=${markerPos} camFrame=${this.camFrameCount}`
          );
          this.onCapture.invoke({
            frozen,
            markerPos,
            width: frozen.getWidth(),
            height: frozen.getHeight(),
          });
        });
      })
      .catch((e) => {
        clearWatchdog();
        this.busy = false;
        console.log("[Capture] failed: " + e);
      });
  }

  private async grabFrame(): Promise<Texture> {
    if (!global.deviceInfoSystem.isEditor()) {
      try {
        const req = CameraModule.createImageRequest();
        req.resolution = new vec2(this.captureWidthDevice, this.captureHeightDevice);
        const frame = await this.cameraModule.requestImage(req);
        console.log("[Capture] used requestImage() still");
        return frame.texture;
      } catch (e) {
        console.log("[Capture] requestImage failed, falling back to stream: " + e);
      }
    }
    return this.getLiveCameraTexture();
  }

  /** Snapshot the live camera texture so downstream consumers get an independent still. */
  private freeze(src: Texture): Texture {
    try {
      return ProceduralTextureProvider.createFromTexture(src);
    } catch (e) {
      console.log("[Capture] freeze copy failed, passing live texture through: " + e);
      return src;
    }
  }

  /** Start the camera stream once and keep a PERMANENT frame listener alive. */
  private ensureCameraStream(): void {
    if (this.cameraTex) return;
    const req = CameraModule.createCameraRequest();
    req.cameraId = global.deviceInfoSystem.isEditor()
      ? CameraModule.CameraId.Default_Color
      : CameraModule.CameraId.Right_Color;
    this.cameraTex = this.cameraModule.requestCamera(req);
    this.cameraProvider = this.cameraTex.control as CameraTextureProvider;
    // Keep this listener forever. The old code removed its listener after the
    // first frame, which left the texture stuck on frame 1 — every later capture
    // then froze that SAME image (identical thumbnail, identical Gemini label).
    this.cameraProvider.onNewFrame.add(() => {
      this.camFrameCount += 1;
    });
  }

  /**
   * Resolves once a FRESH camera frame has arrived after this call, so `freeze()`
   * copies current content rather than a stale buffer. Falls back to whatever is
   * in the texture after 500 ms.
   */
  private getLiveCameraTexture(): Promise<Texture> {
    this.ensureCameraStream();
    return new Promise<Texture>((resolve) => {
      let done = false;
      let reg: any = null;
      let timeoutEvt: any = null;
      const finish = (why: string) => {
        if (done) return;
        done = true;
        if (reg && this.cameraProvider) this.cameraProvider.onNewFrame.remove(reg);
        if (timeoutEvt) { try { this.removeEvent(timeoutEvt); } catch (e) {} }
        console.log(`[Capture] live frame acquired (${why}, frameCount=${this.camFrameCount})`);
        resolve(this.cameraTex!);
      };
      // The next onNewFrame after now is, by definition, a frame produced for
      // THIS capture request.
      reg = this.cameraProvider!.onNewFrame.add(() => finish("fresh"));
      timeoutEvt = this.createEvent("DelayedCallbackEvent");
      timeoutEvt.bind(() => finish("timeout — using current buffer"));
      timeoutEvt.reset(0.5);
    });
  }

  /**
   * World point for the trace marker. The WorldQuery hit-test callback is
   * ASYNCHRONOUS (fires a frame or two later), so this resolves a Promise:
   * the surface hit if one comes back, otherwise a camera-forward fallback —
   * either on an explicit miss or after a short timeout (Preview has no depth
   * pipeline and the callback may never fire).
   */
  private computeMarkerPos(): Promise<vec3> {
    const camT = this.cameraObject.getTransform();
    const origin = camT.getWorldPosition();
    const look = camT.forward.uniformScale(-1); // camera looks down -Z
    const fallback = origin.add(look.uniformScale(MARKER_FALLBACK_DISTANCE));

    if (!this.hitSession) {
      console.log("[Capture] marker at camera-forward fallback (no hit session) " + fallback);
      return Promise.resolve(fallback);
    }

    return new Promise<vec3>((resolve) => {
      let settled = false;
      let timeoutEvt: DelayedCallbackEvent | null = null;
      const finish = (p: vec3, why: string) => {
        if (settled) return;
        settled = true;
        if (timeoutEvt) {
          try { this.removeEvent(timeoutEvt); } catch (e) { /* already gone */ }
        }
        console.log("[Capture] marker " + why + " " + p);
        resolve(p);
      };

      // A hit is only trustworthy if it's actually IN FRONT of the camera and a
      // sane distance away. The WorldQuery depth map lags head motion (~5 Hz) and
      // can hand back a stale point from a previous view — which, once you've
      // turned to frame the next object, lands the card behind you / where the
      // last object was. Reject those and fall back to camera-forward.
      const sane = (p: vec3): boolean => {
        const v = p.sub(origin);
        const dist = v.length;
        if (dist < 15 || dist > 800) return false; // 15 cm .. 8 m
        return v.normalize().dot(look) > 0.35; // within ~70° of straight ahead
      };

      const rayEnd = origin.add(look.uniformScale(500));
      this.hitSession!.hitTest(origin, rayEnd, (hit: WorldQueryHitTestResult) => {
        if (hit && !isNull(hit.position) && sane(hit.position)) {
          finish(hit.position, "at surface hit");
        } else {
          finish(fallback, hit && !isNull(hit.position)
            ? "at camera-forward fallback (hit-test result rejected — behind/too far)"
            : "at camera-forward fallback (hit-test miss)");
        }
      });

      timeoutEvt = this.createEvent("DelayedCallbackEvent");
      timeoutEvt.bind(() => finish(fallback, "at camera-forward fallback (hit-test timeout)"));
      timeoutEvt.reset(0.25);
    });
  }

  private playCue(): void {
    if (!this.audio || isNull(this.audio.audioTrack)) return;
    try {
      this.audio.play(1);
    } catch (e) {
      console.log("[Capture] cue failed (non-fatal): " + e);
    }
  }
}
