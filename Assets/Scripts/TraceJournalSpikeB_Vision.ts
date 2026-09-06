/**
 * TraceJournalSpikeB_Vision.ts — Spike B: Gemini Flash vision round-trip.
 *
 * GOAL (de-risk): take a captured still, send it through
 * GeminiService.analyzeTrace(), and log the parsed structured result. Confirm
 * the JSON schema parses reliably; surface failure modes by their typed kind.
 *
 * EXIT CHECK: a capture produces a logged { label, confidence, text, altLabels }
 * within one request.
 *
 * @input capture  - Spike A component; we listen to its onCapture event
 * @input gemini   - GeminiService component
 * @input analyzeOnStart - also fire one analyze pass on start using a live frame
 *                          (handy when testing Spike B without pinching)
 *
 * REQUIRES: RemoteServiceGatewayCredentials populated with a Google token.
 * Without it every call logs a NetworkFail.
 */

import { TraceJournalSpikeA_Capture } from "./TraceJournalSpikeA_Capture";
import {
  GeminiService,
  TraceError,
  TraceErrorKind,
  TraceResult,
} from "./GeminiService";

@component
export class TraceJournalSpikeB_Vision extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Spike B — Gemini vision round-trip</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("Spike A capture component. Spike B analyzes each still it emits.")
  capture!: TraceJournalSpikeA_Capture;

  @input
  @hint("GeminiService component.")
  gemini!: GeminiService;
  @ui.group_end
  @ui.group_start("Settings")
  @input
  @hint("Also run one analyze pass on start using a live camera frame.")
  analyzeOnStart: boolean = false;
  @ui.group_end

  private inFlight = false;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      if (isNull(this.capture) || isNull(this.gemini)) {
        console.log("[SpikeB] ERROR: capture and/or gemini @input not wired");
        return;
      }
      this.capture.onCapture.add((tex: Texture) => this.analyze(tex, "pinch"));
      console.log("[SpikeB] listening for Spike A captures");

      if (this.analyzeOnStart) {
        // Reuse Spike A's own capture path by asking it to fire once would be
        // cleaner, but for an isolated test just wait a beat then analyze a
        // frame the user has (hopefully) already captured. If none, this is a
        // no-op until the first pinch.
        console.log("[SpikeB] analyzeOnStart set — pinch once to trigger");
      }
    });
  }

  private analyze(tex: Texture, source: string): void {
    if (this.inFlight) {
      console.log("[SpikeB] skip — previous analyze still running");
      return;
    }
    this.inFlight = true;
    const t0 = getTime();
    console.log(`[SpikeB] analyzeTrace start (source=${source})`);

    this.gemini
      .analyzeTrace(tex)
      .then((r: TraceResult) => {
        this.inFlight = false;
        const dt = (getTime() - t0).toFixed(2);
        console.log(
          `[SpikeB] OK in ${dt}s :: ` +
            JSON.stringify({
              label: r.label,
              confidence: r.confidence,
              text: r.text,
              date: r.date ?? "",
              location: r.location ?? "",
              altLabels: r.altLabels,
            })
        );
      })
      .catch((e) => {
        this.inFlight = false;
        const dt = (getTime() - t0).toFixed(2);
        if (e instanceof TraceError) {
          // LowOcr / Unrecognized still carry a usable partial in many cases —
          // log the kind so we can see which failure path fired.
          console.log(`[SpikeB] TraceError.${e.kind} in ${dt}s :: ${e.message}`);
          if (e.kind === TraceErrorKind.NetworkFail) {
            console.log("[SpikeB] hint: is the RSG Google token set + internet available?");
          }
        } else {
          console.log(`[SpikeB] unexpected error in ${dt}s :: ${e}`);
        }
      });
  }
}
