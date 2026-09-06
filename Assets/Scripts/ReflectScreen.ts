/**
 * ReflectScreen.ts — Memorest "Add a personal reflection" screen
 * (DESIGN.md §5, MVP priority 6).
 *
 * OWNS: the wireframe world-space UI for capturing ONE personal reflection —
 * the prompt "What do you want to remember about today?", a Speak path (ASR,
 * hold-to-talk), an AR-keyboard fallback (ASR is device-only so the keyboard is
 * the Preview-testable path), a Skip, and then Confirm / Try Again / Remove on
 * the captured text (spec §5). On Confirm it writes the VERBATIM text to
 * JournalSession.getEntry().reflection and advances the flow to Feel (§6). Skip
 * writes "" and advances. The text is stored raw — no processing (spec §5:
 * "Gemini must not invent emotions, relationships or events...").
 *
 * Screen ROOT visibility is owned by ScreenRouter (enables this component's
 * SceneObject only on the Reflect state). This script builds its panel when its
 * object wakes / is re-enabled (and FlowManager.current === Reflect) and tears
 * it down on disable.
 *
 * Promoted from TraceJournalSpikeE_Reflection (ASR + AR-keyboard fallback logic);
 * that spike SceneObject stays disabled. The ASR / keyboard plumbing now lives in
 * the shared `ReflectionCapture` helper (also used by MomentEmotionReflect §5) —
 * this screen only owns its own view-model.
 *
 * INTERACTION MODEL: PanelKit buttons cannot be relabelled after creation, so
 * each phase change (prompt <-> captured) rebuilds the panel tree — same pattern
 * as ConfirmScreen.
 *
 * @input flowManager      - screen transitions (Skip / Confirm -> Feel)
 * @input journalSession    - writes getEntry().reflection on Confirm / Skip
 * @input panelDistanceCm   - local Z of the panel in front of the screen root
 * @input forceKeyboard     - skip ASR, use the AR keyboard directly (ASR is device-only)
 * @input asrErrorsBeforeFallback - after this many ASR errors, auto-switch to the keyboard
 * @input promptText / speakLabel / typeLabel / skipLabel / confirmLabel / tryAgainLabel / removeLabel - copy
 * @input debugAutopilot     - Preview-only: inject typed text -> Try Again -> Remove -> re-type -> Confirm
 * @input debugAutopilotSkip - Preview-only: instead of the Confirm path, exercise Skip
 * @input debugReflectionText - the text the autopilot "types" for the confirmed reflection
 *
 * MUST NOT: call Gemini, own the screen state machine, or hold journal data
 * itself (that is JournalSession).
 */

import { FlowManager, TraceScreen } from "./FlowManager";
import { JournalSession } from "./JournalSession";
import { PanelKit, TitledPanel } from "./PanelKit";
import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button";
import { ReflectionCapture } from "./ReflectionCapture";

type Phase = "prompt" | "captured";

@component
export class ReflectScreen extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">ReflectScreen — add a personal reflection (§5)</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("FlowManager — Skip / Confirm advance to Feel (§6).")
  flowManager!: FlowManager;
  @input
  @hint("JournalSession — Confirm writes the verbatim text to getEntry().reflection; Skip writes \"\".")
  journalSession!: JournalSession;
  @ui.group_end

  @ui.group_start("Settings")
  @input
  @hint("Local Z of the Reflect panel relative to this screen root (cm, negative = in front).")
  panelDistanceCm: number = -100;
  @input
  @hint("Skip ASR and use the AR keyboard fallback directly. ASR is device-only, so this is the Preview-testable path.")
  forceKeyboard: boolean = false;
  @input
  @hint("After this many ASR errors / empty results in a session, auto-switch to the keyboard fallback.")
  asrErrorsBeforeFallback: number = 2;
  @input
  promptText: string = "What do you want to remember about today?";
  @input
  speakLabel: string = "Hold to Speak";
  @input
  typeLabel: string = "Type";
  @input
  skipLabel: string = "Skip";
  @input
  confirmLabel: string = "Confirm";
  @input
  tryAgainLabel: string = "Try Again";
  @input
  removeLabel: string = "Remove";
  @ui.group_end

  @ui.group_start("Debug")
  @input
  @hint("Preview-only: once the screen builds, inject typed text -> Try Again -> Remove -> re-type -> Confirm (no hand taps / mic needed). Leave OFF for real use.")
  debugAutopilot: boolean = false;
  @input
  @hint("Preview-only: with debugAutopilot on, exercise the Skip path (reflection = \"\") instead of the Confirm path.")
  debugAutopilotSkip: boolean = false;
  @input
  @hint("The text the autopilot 'types' as the confirmed reflection.")
  debugReflectionText: string = "Long walk by the river after work; the light went gold over the water.";
  @ui.group_end

  private ready = false;
  private content: SceneObject | null = null;
  private panel: TitledPanel | null = null;
  private speakButton: Button | null = null;

  private phase: Phase = "prompt";
  private text = "";
  private capture: ReflectionCapture | null = null;
  private autopilotRan = false;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      this.ready = true;
      this.makeCapture();
      this.rebuild();
      this.maybeAutopilot();
    });
    this.createEvent("OnEnableEvent").bind(() => {
      if (!this.ready) return;
      // Fresh visit — start from the prompt with an empty transcript.
      this.phase = "prompt";
      this.text = "";
      this.makeCapture();
      this.rebuild();
      this.maybeAutopilot();
    });
    this.createEvent("OnDisableEvent").bind(() => {
      if (this.capture) this.capture.dispose();
      this.teardown();
    });
  }

  /** (Re)build the shared voice/keyboard capture helper for a fresh visit. */
  private makeCapture(): void {
    if (this.capture) this.capture.dispose();
    this.capture = new ReflectionCapture(
      { forceKeyboard: this.forceKeyboard, asrErrorsBeforeFallback: this.asrErrorsBeforeFallback },
      {
        onPartial: (t) => {
          if (this.panel && this.phase === "prompt") this.panel.setBody(t.length > 0 ? t : "…");
        },
        onFinal: (t) => {
          this.text = t;
          this.phase = "captured";
          this.rebuild();
        },
        onStatus: (m) => {
          if (this.panel) this.panel.setBody(m);
        },
        onKeyboardMode: () => {
          if (this.phase === "prompt") this.rebuild();
        },
      }
    );
  }

  // --- build / teardown ------------------------------------------------

  private teardown(): void {
    this.speakButton = null;
    this.panel = null;
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
      console.log("[Reflect] ERROR: flowManager / journalSession not wired — screen inert");
      return;
    }
    this.teardown();

    // ReflectRoot can be briefly enabled at scene start before ScreenRouter's
    // first apply() disables it — only stand up the panel on the real screen.
    if (this.flowManager.current !== TraceScreen.Reflect) return;

    const content = global.scene.createSceneObject("ReflectContent");
    content.setParent(this.sceneObject);
    // Anchor the panel's TOP just above the sight line rather than centring it
    // (which put the title ~22 cm up) — matches the other screens (2026-09-06:
    // "windows too high"). Panel is ~44-46 cm tall.
    const panelH = this.phase === "prompt" ? 44 : 46;
    content.getTransform().setLocalPosition(new vec3(0, 9 - panelH / 2, this.panelDistanceCm));
    this.content = content;

    if (this.phase === "prompt") this.buildPrompt(content);
    else this.buildCaptured(content);
  }

  private buildPrompt(parent: SceneObject): void {
    const panel = PanelKit.create(parent, {
      name: "ReflectPrompt",
      title: this.promptText,
      // No static body — the title is the prompt and the buttons are
      // self-explanatory. setBody() is still used for transient status
      // ("Listening…", "Cleared. Skip, or add a reflection.").
      body: "",
      widthCm: 48,
      heightCm: 44,
      localPosition: new vec3(0, 0, 0),
      buttonsVertical: true,
    });
    this.panel = panel;

    const cap = this.capture!;
    if (cap.usingKeyboard) {
      panel.addButton(this.typeLabel, () => cap.openKeyboard());
    } else {
      this.speakButton = panel.addButton(this.speakLabel, () => {
        // onTriggerUp — release ends the hold.
        cap.stopListening();
      });
      this.speakButton.onTriggerDown.add(() => cap.startListening());
      panel.addButton("Type instead", () => {
        cap.usingKeyboard = true;
        cap.openKeyboard();
      });
    }

    panel.addButton(this.skipLabel, () => this.doSkip());
  }

  private buildCaptured(parent: SceneObject): void {
    const shown = this.text.trim().length > 0 ? this.text.trim() : "(nothing captured)";

    const panel = PanelKit.create(parent, {
      name: "ReflectCaptured",
      title: "Remember this?",
      body: shown,
      widthCm: 48,
      heightCm: 46,
      localPosition: new vec3(0, 0, 0),
      buttonsVertical: true,
    });
    this.panel = panel;

    panel.addButton(this.confirmLabel, () => this.doConfirm());
    panel.addButton(this.tryAgainLabel, () => this.doTryAgain());
    panel.addButton(this.removeLabel, () => this.doRemove());
  }

  // --- actions --------------------------------------------------

  private doTryAgain(): void {
    console.log("[Reflect] Try Again — clear + re-capture");
    this.text = "";
    if (this.capture) this.capture.reset();
    this.phase = "prompt";
    this.rebuild();
    // Re-initiate capture: keyboard reopens; ASR waits for the next hold.
    if (this.capture && this.capture.usingKeyboard) this.capture.openKeyboard();
    else if (this.panel) this.panel.setBody("Hold Speak and talk again.");
  }

  private doRemove(): void {
    console.log("[Reflect] Remove — clear text, reflection stays empty");
    this.text = "";
    if (this.capture) this.capture.reset();
    this.phase = "prompt";
    this.rebuild();
    if (this.panel) this.panel.setBody("Cleared. Skip, or add a reflection.");
  }

  private doSkip(): void {
    this.journalSession.getEntry().reflection = "";
    console.log('[Reflect] Skip -> reflection="" -> Feel');
    this.flowManager.goTo(TraceScreen.Feel);
  }

  private doConfirm(): void {
    const r = this.text.trim();
    this.journalSession.getEntry().reflection = r;
    console.log(`[Reflect] Confirm -> reflection="${r}" -> Feel`);
    this.flowManager.goTo(TraceScreen.Feel);
  }

  // --- debug autopilot (Preview verification without hand taps) ---

  private delay(sec: number, fn: () => void): void {
    const e = this.createEvent("DelayedCallbackEvent");
    e.bind(() => fn());
    e.reset(sec);
  }

  private inject(t: string, phase: Phase): void {
    this.text = t;
    this.phase = phase;
    this.rebuild();
  }

  private maybeAutopilot(): void {
    if (!this.debugAutopilot || this.autopilotRan) return;
    if (this.flowManager.current !== TraceScreen.Reflect) return;
    this.autopilotRan = true;
    console.log(`[Reflect][Autopilot] start (${this.debugAutopilotSkip ? "skip path" : "confirm path"})`);

    if (this.debugAutopilotSkip) {
      this.delay(1.2, () => {
        console.log("[Reflect][Autopilot] Skip");
        this.doSkip();
      });
      return;
    }

    this.delay(1.2, () => {
      console.log("[Reflect][Autopilot] step 1: type text -> captured");
      this.inject("first draft of a thought", "captured");
    });
    this.delay(2.6, () => {
      console.log("[Reflect][Autopilot] step 2: Try Again -> prompt (cleared)");
      this.doTryAgain();
    });
    this.delay(4.0, () => {
      console.log("[Reflect][Autopilot] step 3: type again -> captured");
      this.inject("second thought", "captured");
    });
    this.delay(5.4, () => {
      console.log("[Reflect][Autopilot] step 4: Remove -> prompt (cleared, reflection stays empty)");
      this.doRemove();
    });
    this.delay(6.8, () => {
      console.log("[Reflect][Autopilot] step 5: type the real reflection -> captured");
      this.inject(this.debugReflectionText, "captured");
    });
    this.delay(8.2, () => {
      console.log("[Reflect][Autopilot] step 6: Confirm -> Feel");
      this.doConfirm();
    });
  }
}
