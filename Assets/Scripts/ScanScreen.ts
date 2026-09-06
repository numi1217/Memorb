/**
 * ScanScreen.ts — Memorb Phase 1 "Scan a trace" screen (DESIGN.md §2).
 *
 * OWNS: the Scan screen's view (prompt panel, capture frame/reticle, loading
 * state, error state) and the capture -> Gemini -> Memory Card orchestration for
 * one trace at a time. Screen ROOT visibility is owned by ScreenRouter; this
 * script only swaps its own sub-panels and drives the reticle.
 *
 * @input flowManager / gemini / capture / cardSpawner / cameraObject - wiring
 * @input promptText / loadingText / errUnrecognized / errNetwork - copy
 * @input maxTraces        - hard cap on Memory Cards this session (spec: 1-5)
 * @input reticle*         - capture-frame size / distance (head-locked to camera)
 * @input debugLatencyProbe - after the first real capture, A/B gemini-2.0-flash
 *        vs gemini-2.5-flash x JSON-mime on/off and log timings (Phase 1 task 1.4).
 *
 * MUST NOT: own journal data, build Memory Cards (that is MemoryCardSpawner), or
 * toggle other screens' roots.
 */

import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { FlowManager, TraceScreen } from "./FlowManager";
import { GeminiService, TraceError, TraceErrorKind, TraceResult, SegmentResult } from "./GeminiService";
import { CaptureController, CaptureResult } from "./CaptureController";
import { MemoryCardSpawner } from "./MemoryCardSpawner";
import { JournalSession } from "./JournalSession";
import { PanelKit, TitledPanel } from "./PanelKit";
import { makeReticle, Reticle } from "./TraceGizmos";

/** How long the card build waits on segmentPrimary before showing the card
 *  anyway (raw/bbox thumbnail). A backstop against a hung call, not the normal
 *  path — segmentPrimary usually settles in a few seconds, but the FIRST call
 *  of a session can be slow (cold connection), so give it more room before
 *  falling back. If it does land after this, the card is upgraded in place. */
const SEG_SPAWN_TIMEOUT_SEC = 16;

/** Client-side backstop for a hung analyzeTrace transport (RSG deadline ~30 s,
 *  one retry). */
const ANALYZE_WATCHDOG_SEC = 55;

@component
export class ScanScreen extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">ScanScreen — pinch -> Gemini -> Memory Card</span>')
  @ui.separator
  @ui.group_start("References")
  @input flowManager!: FlowManager;
  @input gemini!: GeminiService;
  @input capture!: CaptureController;
  @input cardSpawner!: MemoryCardSpawner;
  @input
  @hint("JournalSession — when wired, the trace cap counts KEPT traces (removed cards free capacity) instead of ever-spawned cards.")
  @allowUndefined
  journalSession!: JournalSession;
  @input
  @hint('Scene "Camera Object" — the reticle is parented here so it stays head-locked.')
  cameraObject!: SceneObject;
  @input
  @hint("Base material for the capture-frame reticle (wire to MarkerWhite.mat).")
  markerMat!: Material;
  @ui.group_end

  @ui.group_start("Copy")
  @input promptText: string = "Hold still while I capture this moment.";
  @input loadingText: string = "Finding the memory in this trace";
  @input errUnrecognized: string = "I couldn't clearly identify this.";
  @input errNetwork: string = "I couldn't analyse this trace right now.";
  @ui.group_end

  @ui.group_start("Settings")
  @input
  @hint("Maximum Memory Cards to create this session (spec: 1-5).")
  maxTraces: number = 5;

  @input
  @hint("Capture-frame width in cm.")
  reticleWidthCm: number = 26;
  @input
  @hint("Capture-frame height in cm.")
  reticleHeightCm: number = 20;
  @input
  @hint("Capture-frame distance in front of the user in cm (head-locked).")
  reticleDistanceCm: number = 60;

  @input
  @hint("Local Z of the Scan panels relative to this screen root (cm, negative = in front).")
  panelDistanceCm: number = -95;
  @ui.group_end

  @ui.group_start("Debug")
  @input
  @hint("After the first capture, benchmark model x json-mime combos and log timings.")
  debugLatencyProbe: boolean = false;
  @ui.group_end

  /** Fires after a Memory Card is successfully created (order index in payload). */
  public readonly onTraceCarded: Event<number> = new Event<number>();

  private prompt: TitledPanel | null = null;
  private loading: TitledPanel | null = null;
  private errorPanel: TitledPanel | null = null;
  private reticle: Reticle | null = null;

  /** Analyses currently awaiting a Gemini reply. Captures run concurrently so a
   *  second pinch during a 5-18 s round-trip is NOT dropped (that made the first
   *  object's late result look like a stale label for the second scan). */
  private activeCount = 0;
  private readonly maxConcurrent = 3;
  private traceCount = 0; // Memory Cards successfully spawned
  /** analyzeTrace has returned but the card is NOT shown yet — we're waiting on
   *  segmentPrimary so it can appear already wearing its cut-out + outline
   *  instead of visibly swapping a few seconds later (2026-09-05). Counts as
   *  "busy" for the loading panel. */
  private pendingSpawns = 0;
  private probeDone = false;

  private lastFrozen: Texture | null = null;
  private lastMarkerPos: vec3 | null = null;

  private ellipsisT = 0;
  private ellipsisActive = false;
  private onScan = false;
  /** getTime() when the Scan screen last became active. The pinch that pressed
   *  "Capture a Moment" on Home can still be in flight when we land here and
   *  CaptureController (which runs screen-independently) would turn it into an
   *  unwanted capture — so ignore any capture within `entryGraceSec` of arrival
   *  (2026-09-06: "after i press 'capture the moment' i still see the loading
   *  animation"). */
  private scanEnteredAt = -999;
  private readonly entryGraceSec = 0.8;

  /** Small rotating arc in the centre of the loading panel (2026-09-05). */
  private spinnerObj: SceneObject | null = null;
  private spinnerAngle = 0;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  private onStart(): void {
    if (
      isNull(this.flowManager) ||
      isNull(this.gemini) ||
      isNull(this.capture) ||
      isNull(this.cardSpawner) ||
      isNull(this.cameraObject)
    ) {
      console.log("[Scan] ERROR: one or more @inputs not wired — aborting build");
      return;
    }

    // Wire the pipeline BEFORE building the view, so a view hiccup can never
    // sever the capture -> analyze path.
    this.capture.onCapture.add((r: CaptureResult) => this.handleCapture(r));
    this.flowManager.onScreenChanged.add((c) => this.applyScreen(c.to));

    this.buildView();

    // Catch up in case FlowManager already emitted its first transition before
    // this subscription was added.
    this.applyScreen(this.flowManager.current);
  }

  // --- view ----------------------------------------------------------------

  private buildView(): void {
    const z = this.panelDistanceCm;

    this.prompt = PanelKit.create(this.sceneObject, {
      name: "ScanPrompt",
      title: this.promptText,
      body: "Pinch to capture.",
      widthCm: 42,
      heightCm: 22,
      localPosition: new vec3(0, 18, z),
    });

    this.loading = PanelKit.create(this.sceneObject, {
      name: "ScanLoading",
      title: this.loadingText + "…",
      body: "",
      widthCm: 42,
      heightCm: 16,
      localPosition: new vec3(0, 16, z), // title sits above the head-locked spinner
      frameless: true,
    });
    this.loading.setVisible(false);
    this.buildLoadingSpinner();

    this.errorPanel = PanelKit.create(this.sceneObject, {
      name: "ScanError",
      title: "Something went wrong.",
      body: "",
      widthCm: 46,
      heightCm: 28,
      localPosition: new vec3(0, 0, z),
    });
    this.errorPanel.addButton("Try Again", () => this.retryLast());
    this.errorPanel.setVisible(false);

    // Head-locked capture frame.
    if (!isNull(this.markerMat)) {
      this.reticle = makeReticle(
        this.cameraObject,
        {
          name: "CaptureReticle",
          widthCm: this.reticleWidthCm,
          heightCm: this.reticleHeightCm,
          localZ: -this.reticleDistanceCm,
          color: new vec4(1, 1, 1, 1), // white (2026-09-05)
          lineWidthCm: 0.8, // chunky rounded bars, not hairlines
          armFraction: 0.16, // 2026-09-06: shorter corner ticks (was 0.32)
        },
        this.markerMat
      );
    } else {
      console.log("[Scan] markerMat not wired — capture frame not drawn");
    }
  }

  private applyScreen(screen: TraceScreen | null): void {
    // Reticle + Scan sub-panels belong to the Scan screen only. On Card the
    // ScanRoot is disabled by ScreenRouter; the reticle lives under Camera
    // Object so it must be hidden explicitly here.
    const active = screen === TraceScreen.Scan;
    if (active && !this.onScan) this.scanEnteredAt = getTime(); // just arrived
    this.onScan = active;
    if (!active) {
      this.showPromptOnly();
      this.syncReticle();
      return;
    }
    if (this.activeCount === 0) this.showPromptOnly();
    this.syncReticle();
  }

  /** Both head-locked overlays live under Camera Object (NOT ScanRoot), so
   *  ScreenRouter disabling ScanRoot doesn't touch them AND this script's
   *  UpdateEvent stops firing once off-screen — they must be driven explicitly
   *  from every state change here. Capture frame: on-screen AND idle. Loading
   *  arc: on-screen AND a capture is processing (2026-09-06). */
  private syncReticle(): void {
    if (this.reticle) this.reticle.root.enabled = this.onScan && !this.ellipsisActive;
    if (this.spinnerObj && !isNull(this.spinnerObj)) {
      this.spinnerObj.enabled = this.onScan && this.ellipsisActive;
    }
  }

  /** Called after any analysis settles: keep the loading panel up while others
   *  are still running (or a card is waiting on its segmentation before it can
   *  be shown), otherwise return to the prompt. */
  private refreshBusyView(): void {
    if (this.activeCount > 0 || this.pendingSpawns > 0) {
      if (!this.ellipsisActive) this.showLoading();
    } else {
      this.showPromptOnly();
    }
  }

  private loadingLabel(): string {
    return this.activeCount > 1
      ? `Finding the memory in ${this.activeCount} traces`
      : this.loadingText;
  }

  private showPromptOnly(): void {
    this.ellipsisActive = false;
    if (this.prompt) this.prompt.setVisible(true);
    if (this.loading) this.loading.setVisible(false);
    if (this.errorPanel) this.errorPanel.setVisible(false);
    this.syncReticle();
  }

  private showLoading(): void {
    this.ellipsisActive = true;
    this.ellipsisT = 0;
    if (this.prompt) this.prompt.setVisible(false);
    if (this.errorPanel) this.errorPanel.setVisible(false);
    if (this.loading) {
      this.loading.setVisible(true);
      this.loading.setTitle(this.loadingLabel() + "…");
    }
    this.syncReticle();
  }

  private showError(kind: TraceErrorKind, detail: string): void {
    this.ellipsisActive = false;
    if (this.prompt) this.prompt.setVisible(false);
    if (this.loading) this.loading.setVisible(false);
    this.syncReticle();
    if (this.errorPanel) {
      const msg =
        kind === TraceErrorKind.NetworkFail ? this.errNetwork : this.errUnrecognized;
      this.errorPanel.setTitle(msg);
      this.errorPanel.setBody("(" + kind + ") — tap Try Again to re-send this capture.");
      this.errorPanel.setVisible(true);
    }
    console.log(`[Scan] error shown: ${kind} :: ${detail}`);
  }

  private onUpdate(): void {
    // Keep the head-locked capture frame + loading arc in sync every frame
    // while this screen is live.
    this.syncReticle();
    // Spin the loading arc whenever it's up.
    if (this.spinnerObj && !isNull(this.spinnerObj) && this.onScan && this.ellipsisActive) {
      this.spinnerAngle -= 300 * getDeltaTime();
      this.spinnerObj
        .getTransform()
        .setLocalRotation(quat.fromEulerAngles(0, 0, (this.spinnerAngle * Math.PI) / 180));
    }

    if (!this.ellipsisActive || !this.loading) return;
    this.ellipsisT += getDeltaTime();
    const dots = 1 + (Math.floor(this.ellipsisT * 2) % 3);
    this.loading.setTitle(this.loadingLabel() + " " + ".".repeat(dots));
  }

  /** A small white ~270° arc head-locked in the CENTRE of the capture frame
   *  (2026-09-06 — was inside the loading panel). onUpdate spins it while a
   *  capture is processing. */
  private buildLoadingSpinner(): void {
    if (isNull(this.markerMat) || isNull(this.cameraObject)) return;
    const o = global.scene.createSceneObject("LoadingSpinner");
    o.setParent(this.cameraObject);
    o.getTransform().setLocalPosition(new vec3(0, 0, -this.reticleDistanceCm + 1));
    const rmv = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const mb = new MeshBuilder([{ name: "position", components: 3 }]);
    mb.topology = MeshTopology.Triangles;
    mb.indexType = MeshIndexType.UInt16;
    const ri = 2.2,
      ro = 3.3,
      seg = 34,
      sweep = Math.PI * 1.55;
    const verts: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * sweep;
      const ca = Math.cos(a),
        sa = Math.sin(a);
      verts.push(ca * ri, sa * ri, 0, ca * ro, sa * ro, 0);
    }
    for (let i = 0; i < seg; i++) {
      const b = i * 2;
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
    mb.appendVerticesInterleaved(verts);
    mb.appendIndices(idx);
    rmv.mesh = mb.getMesh();
    mb.updateMesh();
    const m = this.markerMat.clone();
    try {
      (m.mainPass as any).twoSided = true;
    } catch (e) {
      /* ignore */
    }
    rmv.clearMaterials();
    rmv.addMaterial(m);
    o.enabled = false;
    this.spinnerObj = o;
  }

  // --- capture -> analyze -> card ----------------------------------------

  private handleCapture(r: CaptureResult): void {
    // Capture only counts on the Scan screen. CaptureController now runs
    // independently of the screen roots, so a stray tap while on Card / Launch
    // must be dropped here.
    if (!isNull(this.flowManager) && this.flowManager.current !== TraceScreen.Scan) {
      console.log(
        `[Scan] capture ignored — not on Scan screen (current=${this.flowManager.current})`
      );
      return;
    }

    // The same pinch that pressed "Capture a Moment" on Home can still land here
    // as a capture the instant we arrive — ignore it so the loading animation
    // only ever appears on a DELIBERATE pinch (2026-09-06).
    if (getTime() - this.scanEnteredAt < this.entryGraceSec) {
      console.log("[Scan] capture ignored — within screen-entry grace (the button-press pinch)");
      return;
    }

    // Cap on the FINAL number of traces. With a JournalSession wired this counts
    // KEPT traces (+ in-flight) so removed cards free capacity; otherwise it
    // falls back to ever-spawned cards (Phase 1 behaviour).
    const base = !isNull(this.journalSession)
      ? this.journalSession.keptCount()
      : this.traceCount;
    const committed = base + this.activeCount;
    if (committed >= this.maxTraces) {
      console.log(
        `[Scan] trace cap (${this.maxTraces}) reached — use "Create Today's Journal" on the action panel`
      );
      if (this.prompt) this.prompt.setBody(`Trace limit reached (${this.maxTraces}).`);
      return;
    }
    if (this.activeCount >= this.maxConcurrent) {
      console.log(
        `[Scan] ${this.activeCount} analyses already running — ignoring this pinch, try again in a moment`
      );
      return;
    }

    this.activeCount += 1;
    this.lastFrozen = r.frozen;
    this.lastMarkerPos = r.markerPos;
    this.showLoading();

    const t0 = getTime();
    console.log(
      `[Scan] analyzeTrace start (still ${r.width}x${r.height}, active=${this.activeCount})`
    );

    // Watchdog for a hung analyzeTrace transport — otherwise activeCount never
    // drops, the loading panel never clears and further pinches stay blocked
    // (§14 fallback). RSG's own deadline is ~30 s and the call retries once.
    let settled = false;
    const watchdog = this.createEvent("DelayedCallbackEvent");
    watchdog.bind(() => {
      if (settled) return;
      settled = true;
      this.activeCount -= 1;
      console.log(`[Scan] analyzeTrace watchdog fired after ${ANALYZE_WATCHDOG_SEC}s — no response`);
      if (this.activeCount === 0) this.showError(TraceErrorKind.NetworkFail, "analyzeTrace: no response");
      else this.refreshBusyView();
    });
    watchdog.reset(ANALYZE_WATCHDOG_SEC);

    this.gemini
      .analyzeTrace(r.frozen)
      .then((result: TraceResult) => {
        if (settled) return; // watchdog already gave up on this one
        settled = true;
        const dt = (getTime() - t0).toFixed(2);
        console.log(
          `[Scan] analyzeTrace OK in ${dt}s :: label="${result.label}" conf=${result.confidence} textLen=${result.text.length} ocrUncertain=${!!result.ocrUncertain}`
        );
        this.activeCount -= 1;
        // `r` is this capture's own frozen still + marker (closed over) — never
        // the other in-flight capture's, so labels can't cross.
        this.onAnalyzeSuccess(result, r);
        this.refreshBusyView();
        if (this.debugLatencyProbe && !this.probeDone) {
          this.probeDone = true;
          this.runLatencyProbe(r.frozen);
        }
      })
      .catch((e) => {
        if (settled) return;
        settled = true;
        const dt = (getTime() - t0).toFixed(2);
        this.activeCount -= 1;
        const kind =
          e instanceof TraceError ? e.kind : TraceErrorKind.NetworkFail;
        console.log(`[Scan] analyzeTrace FAILED in ${dt}s :: ${kind} :: ${e}`);
        // Only surface the error panel if nothing else is still working; a
        // concurrent success will otherwise replace it. (Full per-trace error
        // handling is Phase 9.)
        if (this.activeCount === 0) this.showError(kind, String(e));
        else this.refreshBusyView();
      });
  }

  private onAnalyzeSuccess(result: TraceResult, cap: CaptureResult): void {
    this.traceCount += 1;
    const order = this.traceCount;

    // DESIGN.md v2 §3 (2026-09-05): segment FIRST, THEN spawn the card so it
    // appears already wearing its background-removed cut-out + white outline.
    // Previously the card popped in with the raw capture and the cut-out
    // swapped in seconds later — a visible, jarring lag. The loading panel
    // stays up (pendingSpawns) until segmentPrimary settles or a safety
    // timeout fires.
    this.pendingSpawns += 1;
    let cardUp = false;
    const spawnCard = (seg: SegmentResult | null) => {
      if (cardUp) {
        // The card is already up because the safety timeout fired first (common
        // on the FIRST capture — the cold Gemini connection can take >10 s). If
        // segmentation has NOW arrived, upgrade the live card in place instead
        // of throwing it away, which was leaving the first moment stuck with the
        // raw capture and no cut-out sticker (2026-09-06: "frequent").
        if (seg) {
          this.cardSpawner.applySegmentation(order, seg, cap.frozen);
          console.log(`[Scan] segmentPrimary #${order} arrived after the timeout — cut-out applied to the live card`);
        }
        return;
      }
      cardUp = true;
      this.pendingSpawns -= 1;

      this.cardSpawner.spawn(result, cap.frozen, cap.markerPos, order);
      // Same synchronous tick — the bbox thumb built by spawn() is replaced
      // before the first frame of its pop-in tween, so there's no flash.
      if (seg) this.cardSpawner.applySegmentation(order, seg, cap.frozen);
      this.onTraceCarded.invoke(order);

      if (this.flowManager.current === TraceScreen.Scan) {
        this.flowManager.goTo(TraceScreen.Card);
      } else {
        // already on Card (2nd+ trace) — keep loading up if others are still
        // running/pending, otherwise drop back to the prompt.
        this.refreshBusyView();
      }

      if (this.prompt) {
        this.prompt.setBody(
          this.traceCount >= this.maxTraces
            ? `Trace ${this.traceCount}/${this.maxTraces} — limit reached.`
            : `Trace ${this.traceCount}/${this.maxTraces} captured. Pinch again for another.`
        );
      }
    };

    this.gemini
      .segmentPrimary(cap.frozen)
      .then((seg) => spawnCard(seg))
      .catch((e) => {
        console.log(`[Scan] segmentPrimary #${order} failed: ${e}`);
        spawnCard(null);
      });

    // Safety net: never trap the user on the loading panel if segmentation
    // hangs. segmentPrimary normally resolves (to null on failure) within a
    // few seconds; this only fires on a true stall.
    const safety = this.createEvent("DelayedCallbackEvent");
    safety.bind(() => {
      if (!cardUp) {
        console.log(`[Scan] segmentPrimary #${order} slow (>${SEG_SPAWN_TIMEOUT_SEC}s) — showing card now, cut-out will upgrade in when it lands`);
        spawnCard(null);
      }
    });
    safety.reset(SEG_SPAWN_TIMEOUT_SEC);
  }

  private retryLast(): void {
    if (this.activeCount >= this.maxConcurrent) return;
    if (isNull(this.lastFrozen)) {
      console.log("[Scan] Try Again with no stored capture — ignoring");
      this.showPromptOnly();
      return;
    }
    console.log("[Scan] Try Again — re-sending stored capture");
    this.handleCapture({
      frozen: this.lastFrozen!,
      markerPos: this.lastMarkerPos ?? new vec3(0, 0, -95),
      width: this.lastFrozen!.getWidth(),
      height: this.lastFrozen!.getHeight(),
    });
  }

  // --- latency probe (Phase 1 task 1.4) ---------------------------------

  private async runLatencyProbe(tex: Texture): Promise<void> {
    const combos: { model: string; jsonMime: boolean }[] = [
      { model: "gemini-3-flash-preview", jsonMime: true },
      { model: "gemini-2.5-flash", jsonMime: true },
      { model: "gemini-2.5-flash-lite", jsonMime: true },
    ];
    console.log("[Latency] probe start (4 combos, sequential)");
    for (const c of combos) {
      const t0 = getTime();
      try {
        const res = await this.gemini.analyzeTrace(tex, c);
        const ms = ((getTime() - t0) * 1000).toFixed(0);
        console.log(
          `[Latency] model=${c.model} jsonMime=${c.jsonMime} ms=${ms} ok=true label="${res.label}" textLen=${res.text.length}`
        );
      } catch (e) {
        const ms = ((getTime() - t0) * 1000).toFixed(0);
        const kind = e instanceof TraceError ? e.kind : "unknown";
        console.log(
          `[Latency] model=${c.model} jsonMime=${c.jsonMime} ms=${ms} ok=false err=${kind}`
        );
      }
    }
    console.log("[Latency] probe done");
  }
}
