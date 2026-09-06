/**
 * UISound.ts — one soft, round "bubble" click played on every interactable UI
 * touch (DESIGN.md polish, 2026-09-06).
 *
 * PanelKit routes all of its buttons + tappable panels through `playUISound()`;
 * the standalone UIKit Buttons (JarScreen's day spheres and the placed-orb tap
 * targets) call it directly. One shared AudioComponent, a short debounce so a
 * burst of triggers can't stack into a buzz.
 *
 * Lives on an ALWAYS-ON object (e.g. OrbSpawner) so a screen root being
 * disabled can't mute it — mirrors UITheme's module-state + live-component
 * pattern.
 *
 * @input clickTrack  - AudioTrackAsset to play — wire to the UI SFX Pack's
 *                       `bubble_low` track. Unset = silent (no error).
 * @input volume      - 0..1 playback volume.
 * @input minGapSec   - minimum seconds between clicks (debounce).
 */

let _play: (() => void) | null = null;

/** Play the shared soft UI click. No-op until UISound.onAwake has run. */
export function playUISound(): void {
  if (_play) _play();
}

@component
export class UISound extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">UISound — soft click on every interactable (polish)</span>')
  @ui.separator
  @input
  @hint("Soft UI click AudioTrackAsset — wire to the UI SFX Pack's `bubble_low` track.")
  @allowUndefined
  clickTrack!: AudioTrackAsset;
  @input
  @hint("Playback volume (0-1).")
  @widget(new SliderWidget(0, 1, 0.05))
  volume: number = 0.5;
  @input
  @hint("Minimum seconds between clicks — debounce so rapid re-triggers don't buzz.")
  @widget(new SliderWidget(0, 0.5, 0.01))
  minGapSec: number = 0.05;

  private audio: AudioComponent | null = null;
  private lastPlay = 0;

  onAwake(): void {
    const obj = global.scene.createSceneObject("UISoundPlayer");
    obj.setParent(this.sceneObject);
    this.audio = obj.createComponent("Component.AudioComponent") as AudioComponent;
    if (!isNull(this.clickTrack)) this.audio.audioTrack = this.clickTrack;
    try {
      this.audio.playbackMode = Audio.PlaybackMode.LowLatency;
    } catch (e) {
      /* older runtime — default playback mode */
    }
    _play = () => this.playNow();
  }

  onDestroy(): void {
    _play = null;
  }

  private playNow(): void {
    if (!this.audio || isNull(this.audio) || isNull(this.clickTrack)) return;
    const t = getTime();
    if (t - this.lastPlay < this.minGapSec) return;
    this.lastPlay = t;
    try {
      this.audio.volume = this.volume;
      this.audio.play(1);
    } catch (e) {
      /* ignore */
    }
  }
}
