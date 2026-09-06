/**
 * ReflectionCapture.ts — shared voice + AR-keyboard text-capture helper.
 *
 * Factored out of ReflectScreen (DESIGN.md §5) so the per-DAY reflection
 * (`ReflectScreen`) and the per-MOMENT reflective question
 * (`MomentEmotionReflect`, §4-§5) share ONE ASR / keyboard implementation instead
 * of each carrying its own copy.
 *
 * NOT a @component. The owner constructs one, calls start/stop/openKeyboard from
 * its capture buttons, and reacts through the handler callbacks. ASR is
 * device-only; the AR keyboard is the Preview-testable path. `forceKeyboard` or
 * repeated ASR errors switch to the keyboard automatically.
 *
 * The helper owns ONLY the transcription plumbing + a working `text` buffer. The
 * owner still owns its own view-model (phase, panel rebuilds, where the committed
 * text goes).
 *
 * MUST NOT: build UI, touch the scene, drive FlowManager, or call Gemini.
 */

export interface ReflectionCaptureOptions {
  /** Skip ASR entirely and use the AR keyboard (ASR is device-only). */
  forceKeyboard: boolean;
  /** After this many ASR errors / empty results, auto-switch to the keyboard. */
  asrErrorsBeforeFallback: number;
}

export interface ReflectionCaptureHandlers {
  /** Live partial text — ASR interim result, or keyboard onTextChanged. */
  onPartial: (text: string) => void;
  /** Committed text — ASR release with content, or keyboard "Done". */
  onFinal: (text: string) => void;
  /** Human-readable status line for the panel body. */
  onStatus: (msg: string) => void;
  /** ASR gave up — the owner should re-render in keyboard mode. */
  onKeyboardMode: () => void;
}

export class ReflectionCapture {
  /** True once ASR has failed enough / forceKeyboard — owner should show a Type button. */
  usingKeyboard: boolean;

  private asrModule: AsrModule = require("LensStudio:AsrModule");
  private listening = false;
  private text = "";
  private asrErrors = 0;

  constructor(
    private opts: ReflectionCaptureOptions,
    private h: ReflectionCaptureHandlers
  ) {
    this.usingKeyboard = !!opts.forceKeyboard;
  }

  isListening(): boolean {
    return this.listening;
  }

  currentText(): string {
    return this.text;
  }

  /** Clear the working buffer (Try Again / Remove / fresh visit). */
  reset(): void {
    this.text = "";
  }

  // --- ASR (device-only) ------------------------------------------------

  startListening(): void {
    if (this.usingKeyboard || this.listening) return;
    this.listening = true;
    this.text = "";
    this.h.onStatus("Listening… (release to stop)");
    console.log("[Capture] hold -> startTranscribing");

    let o: AsrModule.AsrTranscriptionOptions;
    try {
      o = AsrModule.AsrTranscriptionOptions.create();
      o.silenceUntilTerminationMs = 1500;
      o.mode = AsrModule.AsrMode.HighAccuracy;
      o.onTranscriptionUpdateEvent.add((e: AsrModule.TranscriptionUpdateEvent) => {
        this.text = e.text || this.text;
        this.h.onPartial(this.text);
      });
      o.onTranscriptionErrorEvent.add((code: AsrModule.AsrStatusCode) => {
        this.onError("error code=" + code);
      });
      this.asrModule.startTranscribing(o);
    } catch (e) {
      this.onError("startTranscribing threw: " + e);
    }
  }

  stopListening(): void {
    if (!this.listening) return;
    this.listening = false;
    console.log("[Capture] release -> stopTranscribing");
    try {
      this.asrModule.stopTranscribing().then(() => this.settle());
    } catch (e) {
      this.settle();
    }
  }

  private settle(): void {
    const final = this.text.trim();
    if (final.length > 0) {
      this.text = final;
      console.log(`[Capture] transcript="${final}"`);
      this.h.onFinal(final);
    } else {
      this.asrErrors++;
      this.h.onStatus("Nothing heard — hold to speak again, or type.");
      if (this.asrErrors >= this.opts.asrErrorsBeforeFallback) this.toKeyboard();
    }
  }

  private onError(why: string): void {
    this.listening = false;
    this.asrErrors++;
    console.log(`[Capture] ASR ${why} (count=${this.asrErrors})`);
    this.h.onStatus("Speech unavailable — type instead.");
    if (this.asrErrors >= this.opts.asrErrorsBeforeFallback) this.toKeyboard();
  }

  toKeyboard(): void {
    if (this.usingKeyboard) return;
    this.usingKeyboard = true;
    console.log("[Capture] keyboard fallback ACTIVE");
    this.h.onKeyboardMode();
  }

  // --- AR keyboard (Preview-testable) --------------------------------

  openKeyboard(): void {
    const tis = global.textInputSystem;
    if (!tis) {
      console.log("[Capture] textInputSystem unavailable");
      return;
    }
    const o = new TextInputSystem.KeyboardOptions();
    o.keyboardType = TextInputSystem.KeyboardType.Text;
    o.returnKeyType = TextInputSystem.ReturnKeyType.Done;
    o.enablePreview = true;
    o.onTextChanged = (t: string) => {
      this.text = t;
      this.h.onPartial(t);
    };
    o.onReturnKeyPressed = () => {
      tis.dismissKeyboard();
      this.text = this.text.trim();
      console.log(`[Capture] typed="${this.text}"`);
      this.h.onFinal(this.text);
    };
    tis.requestKeyboard(o);
    console.log("[Capture] AR keyboard requested");
  }

  dispose(): void {
    if (this.listening) {
      this.listening = false;
      try {
        this.asrModule.stopTranscribing();
      } catch (e) {
        /* ignore */
      }
    }
  }
}
