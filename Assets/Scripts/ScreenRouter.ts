/**
 * ScreenRouter.ts — Memorest Phase 1 screen visibility (task 1.1).
 *
 * OWNS: the single mapping from FlowManager.current -> which screen root
 * SceneObject is enabled. One screen visible at a time. FlowManager stays a pure
 * state machine (it MUST NOT touch the scene); this script is the one place that
 * translates its `onScreenChanged` event into `.enabled` flips.
 *
 * Phase 1 builds Launch / Scan for real. Memory Cards are spatial world objects
 * spawned by MemoryCardSpawner (its own always-on object) — not a toggled
 * screen. Phase 3 builds Confirm for real (own root + confirmRoot input). The
 * still-unbuilt screens (Reflect, Feel, Generate, Review, Orb, Jar) get empty
 * roots wired into `otherRoots` so nothing errors when a later phase calls
 * goTo() on them.
 *
 * Phase 2: exactly ONE screen root is enabled at a time. The "Card" state
 * enables NO screen root — the spawned cards + the Add-Another / Create-Journal
 * action panel live on always-on objects (CardSpawner), and ScanScreen blanks
 * its own reticle when the screen is not Scan. The capture pipeline (Capture /
 * CaptureController) was moved out from under ScanRoot so it keeps running while
 * ScanRoot is disabled.
 *
 * @input flowManager      - the state machine to follow
 * @input launchRoot       - Launch screen root
 * @input scanRoot         - Scan screen root (Scan only; disabled on Card)
 * @input otherRoots       - empty placeholder roots for the unbuilt screens
 * @input reviewRoot       - Review Today screen root (DESIGN.md §7)
 * @input generateRoot     - Generate screen root (DESIGN.md §9)
 * @input orbRoot          - Save-the-day screen root (DESIGN.md §11)
 * @input jarRoot          - Monthly container / Jar screen root (DESIGN.md §12)
 *
 * MUST NOT: build UI or own journal data.
 */

import { FlowManager, TraceScreen } from "./FlowManager";

@component
export class ScreenRouter extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">ScreenRouter — one screen visible at a time</span>')
  @ui.separator
  @ui.group_start("References")
  @input flowManager!: FlowManager;
  @input launchRoot!: SceneObject;
  @input scanRoot!: SceneObject;
  @input
  @hint("Empty roots for the not-yet-built screens (Reflect, Feel, Generate, Review, Orb, Jar — and Confirm, which is also wired to confirmRoot below).")
  otherRoots!: SceneObject[];
  @input
  @hint("Confirm screen root (DESIGN.md §4) — enabled only on the Confirm state. Wire to Screens/ConfirmRoot.")
  @allowUndefined
  confirmRoot!: SceneObject;
  @input
  @hint("Reflect screen root (DESIGN.md §5) — enabled only on the Reflect state. Wire to Screens/ReflectRoot.")
  @allowUndefined
  reflectRoot!: SceneObject;
  @input
  @hint("Feel screen root (DESIGN.md §6) — enabled only on the Feel state. Wire to Screens/FeelRoot.")
  @allowUndefined
  feelRoot!: SceneObject;
  @input
  @hint("Review Today screen root (DESIGN.md §7) — enabled only on the Review state. Wire to Screens/ReviewRoot.")
  @allowUndefined
  reviewRoot!: SceneObject;
  @input
  @hint("Generate screen root (DESIGN.md §9) — enabled only on the Generate state. Wire to Screens/GenerateRoot.")
  @allowUndefined
  generateRoot!: SceneObject;
  @input
  @hint("Orb screen root (DESIGN.md §11) — enabled only on the Orb state. Wire to Screens/OrbRoot.")
  @allowUndefined
  orbRoot!: SceneObject;
  @input
  @hint("Jar / monthly-container screen root (DESIGN.md §12) — enabled only on the Jar state. Wire to Screens/JarRoot.")
  @allowUndefined
  jarRoot!: SceneObject;
  @ui.group_end

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }

  private onStart(): void {
    if (isNull(this.flowManager) || isNull(this.launchRoot) || isNull(this.scanRoot)) {
      console.log("[ScreenRouter] ERROR: required @inputs not wired");
      return;
    }
    this.flowManager.onScreenChanged.add((c) => this.apply(c.to));
    this.apply(this.flowManager.current);
  }

  private apply(screen: TraceScreen | null): void {
    // Exactly one screen root at a time. Card enables none — cards + the action
    // panel are on always-on objects, and ScanScreen hides its own reticle when
    // the screen is not Scan.
    const scanVisible = screen === TraceScreen.Scan;
    const launchVisible = screen === TraceScreen.Launch || screen === null;

    this.launchRoot.enabled = launchVisible;
    this.scanRoot.enabled = scanVisible;

    if (!isNull(this.otherRoots)) {
      for (const r of this.otherRoots) {
        if (!isNull(r)) r.enabled = false;
      }
    }

    // Confirm (§4) / Reflect (§5) / Feel (§6). Each root may also appear in
    // otherRoots (disabled by the loop above); these lines run after it and win
    // on their own state.
    const confirmVisible = screen === TraceScreen.Confirm;
    const reflectVisible = screen === TraceScreen.Reflect;
    const feelVisible = screen === TraceScreen.Feel;
    const reviewVisible = screen === TraceScreen.Review;
    const generateVisible = screen === TraceScreen.Generate;
    const orbVisible = screen === TraceScreen.Orb;
    const jarVisible = screen === TraceScreen.Jar;
    if (!isNull(this.confirmRoot)) this.confirmRoot.enabled = confirmVisible;
    if (!isNull(this.reflectRoot)) this.reflectRoot.enabled = reflectVisible;
    if (!isNull(this.feelRoot)) this.feelRoot.enabled = feelVisible;
    if (!isNull(this.reviewRoot)) this.reviewRoot.enabled = reviewVisible;
    if (!isNull(this.generateRoot)) this.generateRoot.enabled = generateVisible;
    if (!isNull(this.orbRoot)) this.orbRoot.enabled = orbVisible;
    if (!isNull(this.jarRoot)) this.jarRoot.enabled = jarVisible;

    console.log(
      `[ScreenRouter] ${screen ?? "(start)"} -> launch=${launchVisible} scan=${scanVisible} ` +
        `confirm=${confirmVisible} reflect=${reflectVisible} feel=${feelVisible} review=${reviewVisible} ` +
        `generate=${generateVisible} orb=${orbVisible} jar=${jarVisible}`
    );
  }
}
