/**
 * FlowManager.ts — Memorb screen state machine (Phase 0 spine).
 *
 * OWNS: the single source of truth for "which screen are we on", plus the
 * transition event every other system listens to.
 *
 * @input debugStartState — jump straight to a screen on launch (later phases
 *        use this to iterate on one screen without walking the whole flow).
 *
 * PUBLIC API
 *   goTo(state)            -> request a transition
 *   current               -> current screen
 *   onScreenChanged        -> Event<{from, to}>; fires after every goTo()
 *
 * MUST NOT: own domain data (that lives in JournalEntry), build UI, or call
 * external services. It only tracks and broadcasts screen state.
 */

import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";

export enum TraceScreen {
  Launch = "Launch",
  Scan = "Scan",
  Card = "Card",
  Confirm = "Confirm",
  Reflect = "Reflect",
  Feel = "Feel",
  Generate = "Generate",
  Review = "Review",
  Orb = "Orb",
  Jar = "Jar",
}

/**
 * Canonical forward order of the flow. Used for next()/prev() convenience
 * (currently unused elsewhere — every screen calls goTo() explicitly — but
 * kept accurate for whenever that changes). Confirm/Reflect are the retired
 * v1 batch-confirm / day-level-reflection screens, superseded by the
 * per-moment card (§3) and MomentEmotionReflect (§4-§6) — parked at the end,
 * out of the live v2 path (Launch -> Scan -> Card -> Review -> Feel -> Generate
 * -> Orb -> Jar).
 */
export const SCREEN_ORDER: TraceScreen[] = [
  TraceScreen.Launch,
  TraceScreen.Scan,
  TraceScreen.Card,
  TraceScreen.Review,
  TraceScreen.Feel,
  TraceScreen.Generate,
  TraceScreen.Orb,
  TraceScreen.Jar,
  TraceScreen.Confirm,
  TraceScreen.Reflect,
];

export interface ScreenChange {
  from: TraceScreen | null;
  to: TraceScreen;
}

@component
export class FlowManager extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">FlowManager — screen state machine</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint(
    "Screen to enter on launch. One of: Launch, Scan, Card, Review, Feel, Generate, Orb, Jar, Confirm, Reflect (the last two are retired v1 screens). Invalid text falls back to Launch."
  )
  debugStartState: string = "Launch";

  @input
  @hint("Log every screen transition to the console.")
  verbose: boolean = true;
  @ui.group_end

  /** Fires after each successful goTo(). Subscribe via onScreenChanged.add(cb). */
  public readonly onScreenChanged: Event<ScreenChange> = new Event<ScreenChange>();

  private _current: TraceScreen | null = null;

  onAwake(): void {
    // Defer the first transition to OnStart so listeners wired in other
    // onAwake()s are ready to receive it.
    this.createEvent("OnStartEvent").bind(() => {
      const start = FlowManager.parseScreen(this.debugStartState);
      this.goTo(start);
    });
  }

  get current(): TraceScreen | null {
    return this._current;
  }

  /** Transition to `state`. No-op (but still logged) if already there. */
  goTo(state: TraceScreen): void {
    const from = this._current;
    if (from === state) {
      if (this.verbose) console.log(`[FlowManager] already on ${state}`);
      return;
    }
    this._current = state;
    if (this.verbose) console.log(`[FlowManager] ${from ?? "(start)"} -> ${state}`);
    this.onScreenChanged.invoke({ from, to: state });
  }

  /** Advance to the next screen in SCREEN_ORDER (clamped at Jar). */
  next(): void {
    const idx = this._current ? SCREEN_ORDER.indexOf(this._current) : -1;
    const nextIdx = Math.min(idx + 1, SCREEN_ORDER.length - 1);
    this.goTo(SCREEN_ORDER[nextIdx]);
  }

  /** Step back one screen (clamped at Launch). */
  prev(): void {
    const idx = this._current ? SCREEN_ORDER.indexOf(this._current) : 0;
    const prevIdx = Math.max(idx - 1, 0);
    this.goTo(SCREEN_ORDER[prevIdx]);
  }

  static parseScreen(raw: string): TraceScreen {
    if (!raw) return TraceScreen.Launch;
    const wanted = raw.trim().toLowerCase();
    for (const s of SCREEN_ORDER) {
      if (s.toLowerCase() === wanted) return s;
    }
    console.log(`[FlowManager] unknown debugStartState "${raw}", using Launch`);
    return TraceScreen.Launch;
  }
}
