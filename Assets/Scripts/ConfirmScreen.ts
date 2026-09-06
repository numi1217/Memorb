/**
 * ConfirmScreen.ts — Memorb "Confirm the evidence" screen (DESIGN.md §4,
 * MVP priority 5).
 *
 * OWNS: the wireframe world-space UI for reviewing every kept trace before it
 * becomes journal evidence — per-trace label confirm / re-pick, per OCR-fragment
 * Keep / Remove, explicit opt-in for a detected date and location, and (with 2+
 * traces) choosing the primary memory. On "Confirm and Continue" it hands the
 * confirmed values to JournalSession.applyConfirmation(...) and advances the flow
 * to Reflect (§5, Phase 4 — currently an empty placeholder root).
 *
 * Screen ROOT visibility is owned by ScreenRouter (enables this component's
 * SceneObject only on the Confirm state). This script builds its panels when its
 * object wakes / is re-enabled and tears them down when disabled.
 *
 * INTERACTION MODEL: PanelKit buttons cannot be relabelled after creation, so
 * every toggle mutates a local view-model and rebuilds the panel tree (same
 * pattern as MemoryCardSpawner's action panel). The view-model persists on the
 * component across rebuilds and across a Back-to-Scanning round trip.
 *
 * @input flowManager    - screen transitions (Back to Scanning / Confirm and Continue)
 * @input journalSession  - evidence store; read keptTraces(), write applyConfirmation()
 * @input panelDistanceCm - local Z of the panel tree in front of the screen root
 * @input headingText / backLabel / continueLabel - copy
 * @input debugAutopilot  - Preview-only: exercise the toggles + Confirm and Continue
 *
 * MUST NOT: call Gemini, own the screen state machine, or hold journal data
 * itself (that is JournalSession).
 */

import { FlowManager, TraceScreen } from "./FlowManager";
import {
  JournalSession,
  KeptTrace,
  TraceConfirmation,
  splitOcrFragments,
} from "./JournalSession";
import { PanelKit, TitledPanel } from "./PanelKit";

/** Max OCR fragments given individual Keep/Remove buttons; the rest are kept and
 *  noted in the panel body (keeps a single trace panel from getting absurdly tall). */
const FRAG_CAP = 4;

interface TraceVM {
  order: number;
  labelOptions: string[];
  labelIdx: number;
  label: string;
  labelConfirmed: boolean;
  /** Fragments shown with toggles (capped at FRAG_CAP). */
  fragments: string[];
  fragKept: boolean[];
  /** Fragments beyond the cap — always kept, shown only as a body note. */
  extraFrags: string[];
  hasDate: boolean;
  date: string;
  dateOptIn: boolean;
  hasLoc: boolean;
  loc: string;
  locOptIn: boolean;
  isPrimary: boolean;
}

function dedupe(xs: string[]): string[] {
  const out: string[] = [];
  for (const x of xs) {
    const t = (x || "").trim();
    if (t.length > 0 && out.indexOf(t) < 0) out.push(t);
  }
  return out;
}

function short(s: string, n: number): string {
  const t = (s || "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

@component
export class ConfirmScreen extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">ConfirmScreen — confirm the evidence (§4)</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("FlowManager — Back to Scanning -> Scan, Confirm and Continue -> Reflect.")
  flowManager!: FlowManager;
  @input
  @hint("JournalSession — reads keptTraces(), writes the confirmed evidence via applyConfirmation().")
  journalSession!: JournalSession;
  @ui.group_end

  @ui.group_start("Settings")
  @input
  @hint("Local Z of the Confirm panel tree relative to this screen root (cm, negative = in front).")
  panelDistanceCm: number = -100;
  @input
  headingText: string = "Here's what I found. Is it correct?";
  @input
  backLabel: string = "Back to Scanning";
  @input
  continueLabel: string = "Confirm and Continue";
  @ui.group_end

  @ui.group_start("Debug")
  @input
  @hint("Preview-only: once the screen builds with >=1 trace, auto-run remove-a-fragment -> opt in date/location -> re-pick primary -> Confirm and Continue. Leave OFF for real use.")
  debugAutopilot: boolean = false;
  @ui.group_end

  private ready = false;
  private content: SceneObject | null = null;
  private panels: TitledPanel[] = [];
  private vms: TraceVM[] = [];
  private autopilotRan = false;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      this.ready = true;
      this.rebuild();
      this.maybeAutopilot();
    });
    this.createEvent("OnEnableEvent").bind(() => {
      if (!this.ready) return;
      this.rebuild();
      this.maybeAutopilot();
    });
    this.createEvent("OnDisableEvent").bind(() => this.teardown());
  }

  // --- build / teardown -------------------------------------------------

  private teardown(): void {
    for (const p of this.panels) {
      try {
        p.destroy();
      } catch (e) {
        /* already gone with its parent */
      }
    }
    this.panels = [];
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
      console.log("[Confirm] ERROR: flowManager / journalSession not wired — screen inert");
      return;
    }
    this.teardown();

    // Only stand up the panel tree when we are actually on the Confirm screen.
    // (ConfirmRoot can be briefly enabled at scene start before ScreenRouter's
    // first apply() disables it.)
    if (this.flowManager.current !== TraceScreen.Confirm) return;

    const traces = this.journalSession.keptTraces();
    this.syncVms(traces);

    const content = global.scene.createSceneObject("ConfirmContent");
    content.setParent(this.sceneObject);
    content.getTransform().setLocalPosition(new vec3(0, 0, this.panelDistanceCm));
    this.content = content;

    const N = this.vms.length;

    // --- layout budget ------------------------------------------------
    const panelW = N <= 1 ? 46 : N === 2 ? 40 : Math.max(24, Math.min(34, Math.floor(104 / N) - 4));
    const gap = 4;
    let maxK = 1;
    for (const v of this.vms) maxK = Math.max(maxK, this.buttonCount(v));
    const traceH = N > 0 ? 18 + maxK * 12 : 6;
    const rowW = N > 0 ? N * panelW + (N - 1) * gap : 0;

    const headerH = 12;
    const footerH = N > 0 ? 38 : 24;
    const vGap = 11;

    const headerCY = traceH / 2 + vGap + headerH / 2;
    const footerCY = -(traceH / 2 + vGap + footerH / 2);
    const spanV = headerCY + headerH / 2 - (footerCY - footerH / 2);
    const spanH = Math.max(rowW, 54);
    // Generous budgets: the tree sits at z≈-100 and the user can look around on
    // Specs, so we only scale down when it gets very large.
    const scale = Math.min(1, 108 / spanV, 150 / spanH);
    content.getTransform().setLocalScale(new vec3(scale, scale, scale));
    // Anchor the header's TOP just above the sight line instead of centring the
    // whole tree (which put the header ~40 cm up) — matches ReviewScreen /
    // FeelScreen / the Generate windows (2026-09-06: "windows too high").
    const HEADER_TOP_CM = 9;
    const contentY = HEADER_TOP_CM - (headerCY + headerH / 2) * scale;
    content.getTransform().setLocalPosition(new vec3(0, contentY, this.panelDistanceCm));

    // --- header -----------------------------------------------------
    const header = PanelKit.create(content, {
      name: "ConfirmHeader",
      title: this.headingText,
      body:
        N === 0
          ? "No traces kept yet."
          : `${N} ${N === 1 ? "trace" : "traces"} — tap a field to change it.`,
      widthCm: Math.max(rowW, 54),
      heightCm: headerH,
      localPosition: new vec3(0, headerCY, 0),
    });
    this.panels.push(header);

    // --- one panel per kept trace ---------------------------------
    for (let i = 0; i < N; i++) {
      const v = this.vms[i];
      const cx = -rowW / 2 + panelW / 2 + i * (panelW + gap);
      this.buildTracePanel(content, v, N, panelW, traceH, new vec3(cx, 0, 0));
    }

    // --- footer ---------------------------------------------------
    const footer = PanelKit.create(content, {
      name: "ConfirmFooter",
      title: N === 0 ? "Nothing to confirm" : "Ready?",
      body: "",
      widthCm: 44,
      heightCm: footerH,
      localPosition: new vec3(0, footerCY, 0),
      buttonsVertical: true,
    });
    footer.addButton(this.backLabel, () => this.backToScanning());
    if (N > 0) footer.addButton(this.continueLabel, () => this.confirmAndContinue());
    this.panels.push(footer);

    console.log(
      `[Confirm] built — ${N} trace panel(s), scale=${scale.toFixed(2)}`
    );
  }

  private buttonCount(v: TraceVM): number {
    return (
      1 +
      (v.labelOptions.length > 1 ? 1 : 0) +
      v.fragments.length +
      (v.hasDate ? 1 : 0) +
      (v.hasLoc ? 1 : 0) +
      (this.vms.length >= 2 ? 1 : 0)
    );
  }

  private buildTracePanel(
    parent: SceneObject,
    v: TraceVM,
    n: number,
    widthCm: number,
    heightCm: number,
    localPos: vec3
  ): void {
    const keptFrags = v.fragKept.filter((b) => b).length;
    const bodyBits: string[] = [];
    if (v.fragments.length === 0) bodyBits.push("No text found.");
    else bodyBits.push(`${keptFrags}/${v.fragments.length} text kept`);
    if (v.extraFrags.length > 0) bodyBits.push(`+${v.extraFrags.length} more kept`);

    const panel = PanelKit.create(parent, {
      name: "ConfirmTrace_" + v.order,
      title: `#${v.order}  ${short(v.label, n >= 3 ? 12 : 20)}`,
      body: bodyBits.join("  ·  "),
      widthCm: widthCm,
      heightCm: heightCm,
      localPosition: localPos,
      buttonsVertical: true,
    });

    // label confirm
    panel.addButton(
      v.labelConfirmed ? "Label OK: " + short(v.label, 14) : "Confirm label: " + short(v.label, 12),
      () => {
        v.labelConfirmed = !v.labelConfirmed;
        this.rebuild();
      }
    );

    // re-pick label from Gemini's alternatives (spec §4 — reuse altLabels)
    if (v.labelOptions.length > 1) {
      panel.addButton(`Change label (${v.labelOptions.length})`, () => {
        v.labelIdx = (v.labelIdx + 1) % v.labelOptions.length;
        v.label = v.labelOptions[v.labelIdx];
        v.labelConfirmed = true;
        this.rebuild();
      });
    }

    // per OCR fragment Keep / Remove
    for (let i = 0; i < v.fragments.length; i++) {
      const idx = i;
      panel.addButton(
        (v.fragKept[idx] ? "Keep: " : "Remove: ") + short(v.fragments[idx], 16),
        () => {
          v.fragKept[idx] = !v.fragKept[idx];
          this.rebuild();
        }
      );
    }

    // detected date — OFF by default, explicit opt-in (spec §4)
    if (v.hasDate) {
      panel.addButton((v.dateOptIn ? "Date ON: " : "Date off: ") + short(v.date, 12), () => {
        v.dateOptIn = !v.dateOptIn;
        this.rebuild();
      });
    }

    // detected location — OFF by default, explicit opt-in (spec §4)
    if (v.hasLoc) {
      panel.addButton(
        (v.locOptIn ? "Location ON: " : "Location off: ") + short(v.loc, 12),
        () => {
          v.locOptIn = !v.locOptIn;
          this.rebuild();
        }
      );
    }

    // primary memory (spec §4) — only meaningful with 2+ traces
    if (n >= 2) {
      panel.addButton(v.isPrimary ? "Primary memory ✓" : "Make primary", () => {
        if (!v.isPrimary) {
          this.journalSession.setPrimary(v.order);
          this.rebuild();
        }
      });
    }

    this.panels.push(panel);
  }

  // --- view-model ----------------------------------------------------

  private syncVms(traces: KeptTrace[]): void {
    const next: TraceVM[] = [];
    for (const t of traces) {
      const allFrags = splitOcrFragments(t.ocrText);
      const fragments = allFrags.slice(0, FRAG_CAP);
      const extraFrags = allFrags.slice(FRAG_CAP);
      const labelOptions = dedupe([t.label, ...(t.altLabels || [])]);

      const prev = this.vms.find((v) => v.order === t.order);
      if (prev) {
        prev.labelOptions = labelOptions.length > 0 ? labelOptions : [t.label];
        if (prev.labelIdx >= prev.labelOptions.length) prev.labelIdx = 0;
        prev.label = prev.labelOptions[prev.labelIdx] || t.label;
        if (prev.fragments.length !== fragments.length) {
          prev.fragments = fragments;
          prev.fragKept = fragments.map(() => true);
        } else {
          prev.fragments = fragments;
        }
        prev.extraFrags = extraFrags;
        prev.hasDate = !!(t.date && t.date.length > 0);
        prev.date = t.date || "";
        prev.hasLoc = !!(t.location && t.location.length > 0);
        prev.loc = t.location || "";
        prev.isPrimary = t.isPrimary;
        next.push(prev);
      } else {
        const opts = labelOptions.length > 0 ? labelOptions : [t.label];
        const idx = Math.max(0, opts.indexOf(t.label));
        next.push({
          order: t.order,
          labelOptions: opts,
          labelIdx: idx,
          label: opts[idx] || t.label,
          labelConfirmed: true,
          fragments,
          fragKept: fragments.map(() => true),
          extraFrags,
          hasDate: !!(t.date && t.date.length > 0),
          date: t.date || "",
          dateOptIn: false,
          hasLoc: !!(t.location && t.location.length > 0),
          loc: t.location || "",
          locOptIn: false,
          isPrimary: t.isPrimary,
        });
      }
    }
    this.vms = next;
  }

  // --- actions -----------------------------------------------------

  private backToScanning(): void {
    console.log("[Confirm] Back to Scanning -> Scan");
    this.flowManager.goTo(TraceScreen.Scan);
  }

  private confirmAndContinue(): void {
    const perTrace: TraceConfirmation[] = this.vms.map((v) => ({
      order: v.order,
      label: v.labelOptions[v.labelIdx] || v.label,
      keptOcr: v.fragments.filter((_, i) => v.fragKept[i]).concat(v.extraFrags),
    }));

    let confirmedLocation = "";
    let confirmedDate = "";
    for (const v of this.vms) {
      if (v.hasLoc && v.locOptIn && !confirmedLocation) confirmedLocation = v.loc;
      if (v.hasDate && v.dateOptIn && !confirmedDate) confirmedDate = v.date;
    }

    const primaryOrder = this.journalSession.primaryOrder();
    this.journalSession.applyConfirmation({
      perTrace,
      primaryOrder,
      confirmedLocation,
      confirmedDate,
    });
    this.journalSession.logContents();
    console.log("[Confirm] Confirm and Continue -> Reflect");
    this.flowManager.goTo(TraceScreen.Reflect);
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
    console.log("[Confirm][Autopilot] start");

    this.delay(1.2, () => {
      const v = this.vms[0];
      if (v && v.fragments.length > 0) {
        const last = v.fragments.length - 1;
        v.fragKept[last] = false;
        console.log(`[Confirm][Autopilot] step 1: remove fragment "${v.fragments[last]}" on #${v.order}`);
        this.rebuild();
      } else {
        console.log("[Confirm][Autopilot] step 1: no fragments to remove");
      }
    });

    this.delay(2.4, () => {
      let touched = false;
      for (const v of this.vms) {
        if (v.hasDate && !v.dateOptIn) {
          v.dateOptIn = true;
          touched = true;
        }
        if (v.hasLoc && !v.locOptIn) {
          v.locOptIn = true;
          touched = true;
        }
      }
      console.log(
        `[Confirm][Autopilot] step 2: opt in detected date/location (${touched ? "some found" : "none present — empty path"})`
      );
      if (touched) this.rebuild();
    });

    this.delay(3.6, () => {
      if (this.vms.length >= 2) {
        const target = this.vms[this.vms.length - 1].order;
        console.log(`[Confirm][Autopilot] step 3: make #${target} primary`);
        this.journalSession.setPrimary(target);
        this.rebuild();
      } else {
        console.log("[Confirm][Autopilot] step 3: single trace — primary unchanged");
      }
    });

    this.delay(4.8, () => {
      console.log("[Confirm][Autopilot] step 4: Confirm and Continue");
      this.confirmAndContinue();
    });

    this.delay(6.2, () => console.log("[Confirm][Autopilot] done"));
  }
}
