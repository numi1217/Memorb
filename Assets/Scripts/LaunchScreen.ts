/**
 * LaunchScreen.ts — Memorest HOME screen (DESIGN.md v2 §1).
 *
 * The SCREEN is now "Home". It still lives on FlowManager state `Launch` (that
 * enum value is reused as the Home state — no new state was added) and on the
 * `Screens/LaunchRoot` SceneObject; only the class/log tags and the panel
 * content changed for design v2.
 *
 * OWNS: the Home panel — a heading plus three actions:
 *   • Capture a Moment   -> goTo(Scan)
 *   • Review Today        -> goTo(Review)  (DESIGN.md §7 — ReviewScreen.ts)
 *   • Revisit the Month   -> goTo(Jar)     (DESIGN.md §12 — JarScreen.ts)
 * Review Today is DIMMED and inert while there are 0 captured moments; the panel
 * is rebuilt whenever JournalSession.onKeptChanged fires so it unlocks after the
 * first Keep. Revisit the Month is always available — the Jar shows its own
 * empty state when nothing has been saved yet.
 *
 * (DESIGN.md §12 also mentions a palm-up hand menu as the Jar summon; the
 * always-visible button is the pragmatic version — see BUILD_PLAN's cut lines.)
 *
 * Screen ROOT visibility is owned by ScreenRouter; this only builds content.
 *
 * @input flowManager    - state machine to drive on button press
 * @input journalSession  - source of the captured-moment count (keptCount)
 * @input home* / capture* / review* copy - panel + button text
 * @input panelDistanceCm - layout
 * @input debugSeedMoment - Preview-only: seed one kept moment on start so the
 *        "Review Today enabled" state can be screenshotted without a capture.
 *        OFF in the shipped scene.
 *
 * MUST NOT: own journal data or toggle other screens.
 */

import { todaysSavedEntry } from "./DayStore";
import { FlowManager, TraceScreen } from "./FlowManager";
import { requestJarDay } from "./JarScreen";
import { JournalSession } from "./JournalSession";
import { PanelKit, TitledPanel } from "./PanelKit";

@component
export class LaunchScreen extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Home — Capture a Moment / Review Today</span>')
  @ui.separator
  @ui.group_start("References")
  @input flowManager!: FlowManager;
  @input
  @hint("JournalSession — Review Today is disabled until keptCount() >= 1; the panel rebuilds on onKeptChanged.")
  journalSession!: JournalSession;
  @input
  @hint('Scene "Camera Object" — the Home menu is placed in front of the user each time this screen is entered (e.g. returning here via "Finish for Now"). Optional; falls back to the screen root\'s authored position if unwired.')
  @allowUndefined
  cameraObject!: SceneObject;
  @ui.group_end

  @ui.group_start("Copy")
  @input homeHeading: string = "What made today feel like today?";
  @input captureLabel: string = "Capture a Moment";
  @input captureHint: string = "Notice something meaningful around you.";
  @input reviewLabel: string = "Review Today";
  @input reviewHint: string = "Turn today's moments into a journal entry.";
  @input reviewDisabledNote: string =
    "Capture a moment first — then you can review today.";
  @input jarLabel: string = "Revisit the Month";
  @ui.group_end

  @ui.group_start("Settings")
  @input
  @hint("Local Z of the panel relative to this screen root (cm, negative = in front).")
  panelDistanceCm: number = -100;
  @ui.group_end

  @ui.group_start("Debug")
  @input
  @hint("Preview-only: seed one kept moment on start so the 'Review Today enabled' Home state can be captured without running a real capture. Leave OFF for real use.")
  debugSeedMoment: boolean = false;
  @ui.group_end

  private panel: TitledPanel | null = null;
  private started = false;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    // Re-entering Home (e.g. "Finish for Now") re-enables this root — replace
    // it in front of wherever the user now is, then rebuild (2026-09-05).
    this.createEvent("OnEnableEvent").bind(() => {
      if (!this.started) return;
      this.spawnInFrontOfUser();
      this.rebuild();
    });
  }

  /** Move this screen's root to the camera's current position + yaw (once per
   *  entry — not billboarded). Mirrors ReviewScreen / FeelScreen. */
  private spawnInFrontOfUser(): void {
    if (isNull(this.cameraObject)) return;
    const camT = this.cameraObject.getTransform();
    this.sceneObject.getTransform().setWorldPosition(camT.getWorldPosition());
    // Face where the camera looks, flattened to the horizon — via quat.lookAt on
    // the view vector, NOT a yaw euler (whose decomposition flips 180° when the
    // head is pitched, which spawned these panels behind the user).
    let f = camT.forward; // camera-object local +Z ≈ points behind the view = our +Z
    let flat = new vec3(f.x, 0, f.z);
    if (flat.length < 1e-4) flat = new vec3(0, 0, 1);
    this.sceneObject.getTransform().setWorldRotation(quat.lookAt(flat.normalize(), vec3.up()));
  }

  private onStart(): void {
    if (isNull(this.flowManager)) {
      console.log("[Home] ERROR: flowManager not wired");
      return;
    }
    if (isNull(this.journalSession)) {
      console.log("[Home] WARN: journalSession not wired — Review Today will stay disabled");
    } else {
      this.journalSession.onKeptChanged.add(() => this.rebuild());
    }

    this.started = true;
    this.spawnInFrontOfUser();
    this.rebuild();

    if (this.debugSeedMoment && !isNull(this.journalSession)) {
      const e = this.createEvent("DelayedCallbackEvent");
      e.bind(() => {
        console.log("[Home] debugSeedMoment -> seeding one kept moment");
        this.journalSession.keep(99, "seeded moment", [], "");
      });
      e.reset(0.2);
    }
  }

  private momentCount(): number {
    return isNull(this.journalSession) ? 0 : this.journalSession.keptCount();
  }


  /** Rebuild the whole panel — PanelKit buttons can't be relabelled/removed, so
   *  the enable/disable flip on Review Today is a full rebuild (same pattern as
   *  ConfirmScreen / ReflectScreen). */
  private rebuild(): void {
    const moments = this.momentCount();
    const savedToday = todaysSavedEntry();
    // "Review Today" is live with live moments OR when today was already
    // journalled in a previous session (2026-09-06).
    const reviewEnabled = moments > 0 || savedToday !== null;

    if (this.panel) {
      this.panel.destroy();
      this.panel = null;
    }

    const reviewLine =
      moments > 0 && savedToday
        ? "Add today's new moment(s) to your journal."
        : moments > 0
        ? this.reviewHint
        : savedToday
        ? "Today's journal is saved — open it to reread."
        : this.reviewDisabledNote;

    this.panel = PanelKit.create(this.sceneObject, {
      name: "HomePanel",
      title: this.homeHeading,
      body: `${this.captureHint}\n${reviewLine}`,
      widthCm: 46,
      heightCm: 58, // 3 stacked buttons now (Capture / Review / Revisit the Month) — 2026-09-05
      localPosition: new vec3(0, 0, this.panelDistanceCm),
      buttonsVertical: true,
    });

    this.panel.addButton(this.captureLabel, () => {
      console.log("[Home] Capture a Moment -> Scan");
      this.flowManager.goTo(TraceScreen.Scan);
    });

    this.panel.addButton(
      this.reviewLabel,
      () => {
        const saved = todaysSavedEntry();
        if (this.momentCount() > 0) {
          if (saved && !isNull(this.journalSession) && !this.journalSession.isAppending()) {
            console.log(`[Home] Review Today -> Review (append new moments to ${saved.id})`);
            this.journalSession.hydrateForAppend(saved);
          } else {
            console.log("[Home] Review Today -> Review");
          }
          this.flowManager.goTo(TraceScreen.Review);
          return;
        }
        if (saved) {
          console.log("[Home] Review Today (already saved, no new moments) -> Jar day view");
          requestJarDay(saved.id);
          this.flowManager.goTo(TraceScreen.Jar);
          return;
        }
        console.log("[Home] Review Today tapped with nothing to review — ignored");
        if (this.panel) this.panel.setBody(this.reviewDisabledNote);
      },
      { dim: !reviewEnabled }
    );

    this.panel.addButton(this.jarLabel, () => {
      console.log("[Home] Revisit the Month -> Jar");
      this.flowManager.goTo(TraceScreen.Jar);
    });

    console.log(`[Home] built — moments=${moments} reviewEnabled=${reviewEnabled}`);
  }
}
