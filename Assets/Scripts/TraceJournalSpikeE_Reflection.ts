/**
 * TraceJournalSpikeE_Reflection.ts — Spike E: ASR reflection capture.
 *
 * GOAL (de-risk): on a button hold, capture speech -> show the transcript on a
 * panel. If ASR is unreliable (Preview, or repeated errors), fall back to the
 * AR keyboard and say so.
 *
 * EXIT CHECK: a spoken phrase becomes visible text on the panel, OR the
 * keyboard fallback is chosen and wired.
 *
 * @input forceKeyboard - skip ASR entirely and use the AR keyboard
 * @input asrErrorsBeforeFallback - after this many ASR errors, auto-switch to keyboard
 *
 * NOTES
 *  - ASR (LensStudio:AsrModule) needs internet and, in practice, a real device
 *    or an Interactive Preview paired to Specs. In plain Preview it typically
 *    returns nothing — that's why the keyboard fallback exists.
 *  - Button hold events are onTriggerDown / onTriggerUp (NOT Start/End).
 */

import { PanelKit, TitledPanel } from "./PanelKit";
import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button";

@component
export class TraceJournalSpikeE_Reflection extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Spike E — ASR reflection capture</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Skip ASR and use the AR keyboard fallback directly.")
  forceKeyboard: boolean = false;

  @input
  @hint("After this many ASR errors in a session, auto-switch to the keyboard fallback.")
  asrErrorsBeforeFallback: number = 2;
  @ui.group_end

  private asrModule = require("LensStudio:AsrModule") as AsrModule;
  private panel: TitledPanel | null = null;
  private talkButton: Button | null = null;

  private listening = false;
  private latest = "";
  private asrErrorCount = 0;
  private usingKeyboard = false;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    this.panel = PanelKit.create(this.sceneObject, {
      name: "SpikeE_ReflectionPanel",
      title: "Speak your reflection",
      body: this.forceKeyboard
        ? "Keyboard mode. Tap the button to type."
        : "Hold the button and speak.",
      widthCm: 46,
      heightCm: 28,
      localPosition: new vec3(0, 0, -100),
    });

    this.usingKeyboard = this.forceKeyboard;

    this.talkButton = this.panel.addButton(
      this.usingKeyboard ? "Type" : "Hold to Talk",
      () => {
        // onTriggerUp handler. In keyboard mode a tap opens the keyboard.
        if (this.usingKeyboard) this.openKeyboard();
        else this.stopListening();
      }
    );
    // Hold-to-talk: press starts ASR, release (handled above) stops it.
    this.talkButton.onTriggerDown.add(() => {
      if (this.usingKeyboard) return;
      this.startListening();
    });

    console.log(
      `[SpikeE] ready — mode=${this.usingKeyboard ? "keyboard" : "ASR (hold to talk)"}`
    );
  }

  // --- ASR path ------------------------------------------------------------

  private startListening(): void {
    if (this.listening) return;
    this.listening = true;
    this.latest = "";
    if (this.panel) this.panel.setBody("Listening… (release to stop)");
    console.log("[SpikeE] press -> startTranscribing");

    const opts = AsrModule.AsrTranscriptionOptions.create();
    opts.silenceUntilTerminationMs = 1500;
    opts.mode = AsrModule.AsrMode.HighAccuracy;

    opts.onTranscriptionUpdateEvent.add((e: AsrModule.TranscriptionUpdateEvent) => {
      this.latest = e.text || this.latest;
      if (this.panel) this.panel.setBody(this.latest || "…");
      console.log(`[SpikeE] partial="${e.text}" final=${e.isFinal}`);
    });
    opts.onTranscriptionErrorEvent.add((code: AsrModule.AsrStatusCode) => {
      this.asrErrorCount++;
      this.listening = false;
      console.log(`[SpikeE] ASR error code=${code} (count=${this.asrErrorCount})`);
      if (this.panel) this.panel.setBody("ASR error: " + code);
      if (this.asrErrorCount >= this.asrErrorsBeforeFallback) {
        console.log("[SpikeE] too many ASR errors — switching to keyboard fallback");
        this.switchToKeyboard();
      }
    });

    try {
      this.asrModule.startTranscribing(opts);
    } catch (e) {
      this.listening = false;
      this.asrErrorCount++;
      console.log("[SpikeE] startTranscribing threw: " + e);
      if (this.asrErrorCount >= this.asrErrorsBeforeFallback) this.switchToKeyboard();
    }
  }

  private stopListening(): void {
    if (!this.listening) return;
    this.listening = false;
    console.log("[SpikeE] release -> stopTranscribing");
    this.asrModule.stopTranscribing().then(() => {
      const final = this.latest.trim();
      if (this.panel) {
        this.panel.setBody(final.length > 0 ? "Heard: " + final : "Nothing heard — try again or type.");
      }
      console.log(`[SpikeE] stopped, transcript="${final}"`);
      if (final.length === 0) this.asrErrorCount++;
      if (this.asrErrorCount >= this.asrErrorsBeforeFallback && !this.usingKeyboard) {
        this.switchToKeyboard();
      }
    });
  }

  // --- keyboard fallback -------------------------------------------------

  private switchToKeyboard(): void {
    if (this.usingKeyboard) return;
    this.usingKeyboard = true;
    if (this.panel) this.panel.setBody("Switched to keyboard. Tap the button to type.");
    console.log("[SpikeE] keyboard fallback ACTIVE (documented in report)");
  }

  private openKeyboard(): void {
    const tis = global.textInputSystem;
    const opts = new TextInputSystem.KeyboardOptions();
    opts.keyboardType = TextInputSystem.KeyboardType.Text;
    opts.returnKeyType = TextInputSystem.ReturnKeyType.Done;
    opts.enablePreview = true;
    opts.onTextChanged = (text: string) => {
      this.latest = text;
      if (this.panel) this.panel.setBody(text.length > 0 ? text : "…");
      console.log(`[SpikeE] keyboard text="${text}"`);
    };
    opts.onReturnKeyPressed = () => {
      console.log(`[SpikeE] keyboard done, transcript="${this.latest.trim()}"`);
      if (this.panel) {
        this.panel.setBody("Typed: " + (this.latest.trim() || "(empty)"));
      }
      tis.dismissKeyboard();
    };
    tis.requestKeyboard(opts);
    console.log("[SpikeE] AR keyboard requested");
  }
}
