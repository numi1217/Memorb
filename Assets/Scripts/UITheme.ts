/**
 * UITheme.ts — one Inspector panel for the whole wireframe UI's look: panel
 * background, text size/colour/outline, frame thickness/roundedness, and how
 * far buttons sit off the panel surface.
 *
 * Put the `UITheme` component near the TOP of the scene hierarchy so its
 * onAwake runs before the screens build their panels.
 *
 * LIVE vs NEXT-BUILD:
 *   - `backgroundOpacity` is LIVE — every panel/button fill material is
 *     registered here, so dragging the slider updates them instantly, even
 *     mid-Preview, on already-built panels.
 *   - Everything else (text size, colour, outline, frame thickness, corner
 *     roundedness, button forward offset) is read ONCE, at the moment
 *     PanelKit builds a panel/button. Changing these values changes what the
 *     NEXT panel looks like — re-enter the screen (or refresh Preview) to
 *     see it. This matches how every other layout @input in this project
 *     behaves (e.g. MemoryCardSpawner.cardWidthCm) and avoids the far more
 *     invasive plumbing full live-reflow would need (re-triggering Wrap/
 *     Shrink text layout and re-triangulating every rounded-rect mesh on
 *     every already-built panel, every frame).
 *
 * Defaults match what PanelKit/TraceGizmos previously hardcoded, EXCEPT
 * `textOutlineEnabled`, now OFF by default (was always on, per-file — see
 * BUILD_PLAN.md 2026-09-04) and `buttonForwardCm`, now non-zero (buttons sat
 * flush with barely any separation from the panel surface, which read as
 * overlapping the frame at a glance).
 *
 * Readers: PanelKit (every panel/button it builds) and GenerateScreen's
 * `addFreeText` (the long-paragraph text block PanelKit's own title/body
 * bands are too small for — see BUILD_PLAN.md 2026-09-04 on why that path
 * doesn't use PanelKit.makeText's sizeToFit+Shrink technique). Both only
 * READ these getters; this module is the single owner of the values.
 */

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// --- background fill opacity (LIVE — material-only, cheap to re-push) -----

let _fillOpacity = 0; // panel background fully transparent by default (2026-09-04)
const _fillMats: Material[] = [];

function applyFill(m: Material): void {
  try {
    const c = (m.mainPass as any).baseColor as vec4;
    (m.mainPass as any).baseColor = new vec4(c.x, c.y, c.z, _fillOpacity);
  } catch (e) {
    /* material without a baseColor uniform — skip */
  }
}

/** Called by makeRectFrame for each fill material it builds. */
export function registerFillMaterial(m: Material): void {
  _fillMats.push(m);
  applyFill(m);
}

export function setFillOpacity(v: number): void {
  _fillOpacity = clamp01(v);
  for (let i = 0; i < _fillMats.length; i++) applyFill(_fillMats[i]);
}

export function getFillOpacity(): number {
  return _fillOpacity;
}

// --- everything else (read at build time) ---------------------------------

/** App-wide UI font (titles, buttons, captions). null = Lens Studio's built-in
 *  default. Set the `font` @input on the UITheme component to a Font asset (drop
 *  a .ttf into Assets/ or import one from the Font panel / the font-selector
 *  skill) and EVERY text the UI builds through PanelKit + the free-text spots
 *  picks it up on next build. */
let _font: Font | null = null;
/** Font for LONG-FORM PROSE only — the generated journal paragraph + closing
 *  reflection (GenerateScreen) and the revealed journal text (JarScreen). Lets
 *  the reading text use e.g. a serif while the chrome stays a sans. Falls back
 *  to `_font` when unset. */
let _paragraphFont: Font | null = null;

/** Apply the app UI font (if set) to a freshly-created Text component. */
export function applyFont(t: Text): void {
  if (!_font) return;
  try {
    t.font = _font;
  } catch (e) {
    /* older Text API / font asset missing — leave the default */
  }
}
/** Apply the prose font to a freshly-created Text component (paragraph font if
 *  set, else the UI font). */
export function applyParagraphFont(t: Text): void {
  const f = _paragraphFont || _font;
  if (!f) return;
  try {
    t.font = f;
  } catch (e) {
    /* ignore */
  }
}
export function getFont(): Font | null { return _font; }
export function getParagraphFont(): Font | null { return _paragraphFont || _font; }

let _titleSize = 220;
let _bodySize = 170;
let _buttonLabelSize = 110;
let _textColor = new vec4(1, 1, 1, 1);
let _textOutlineEnabled = false;
let _textOutlineColor = new vec4(0, 0, 0, 0.85);
let _textOutlineWidth = 0.4;
let _lineColor = new vec4(1, 1, 1, 1);
let _panelFrameThicknessCm = 0.5;
let _buttonFrameThicknessCm = 0.4;
let _panelCornerFraction = 0.2;
let _buttonCornerFraction = 0.5;
let _buttonForwardCm = 0.5;

export function getTitleSize(): number { return _titleSize; }
export function getBodySize(): number { return _bodySize; }
export function getButtonLabelSize(): number { return _buttonLabelSize; }
export function getTextColor(): vec4 { return _textColor; }
export function getTextOutlineEnabled(): boolean { return _textOutlineEnabled; }
export function getTextOutlineColor(): vec4 { return _textOutlineColor; }
export function getTextOutlineWidth(): number { return _textOutlineWidth; }
export function getLineColor(): vec4 { return _lineColor; }
export function getPanelFrameThicknessCm(): number { return _panelFrameThicknessCm; }
export function getButtonFrameThicknessCm(): number { return _buttonFrameThicknessCm; }
export function getPanelCornerFraction(): number { return _panelCornerFraction; }
export function getButtonCornerFraction(): number { return _buttonCornerFraction; }
export function getButtonForwardCm(): number { return _buttonForwardCm; }

@component
export class UITheme extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">UITheme — one Inspector panel for the wireframe UI look</span>')
  @ui.separator
  @ui.group_start("Background (live)")
  @input
  @hint("Opacity of the translucent backing behind every wireframe PANEL (not buttons — those carry their own gradient fill, see UIButtonFill.mat). 0 = outline only, 1 = solid. Updates live in Preview. Default 0 (2026-09-04: 'make the panel background totally transparent').")
  @widget(new SliderWidget(0, 1, 0.01))
  backgroundOpacity: number = 0;
  @ui.group_end

  @ui.group_start("Text (next panel build)")
  @input
  @hint("App-wide UI font (titles, buttons, captions). Empty = Lens Studio's built-in font. Drop a .ttf into Assets/ (or import one via the Font panel) and pick it here to replace EVERY UI text on the next screen build / Preview refresh.")
  @allowUndefined
  font!: Font;
  @input
  @hint("Font for LONG-FORM PROSE only — the generated journal paragraph + reflection and the revealed journal text. Empty = use the UI font above. Pick a different family (e.g. a serif) to set the reading text apart from the chrome.")
  @allowUndefined
  paragraphFont!: Font;
  @input
  @hint("Title text size ceiling — sizeToFit shrinks long titles below this, never grows past it.")
  @widget(new SliderWidget(40, 320, 1))
  titleSize: number = 220;
  @input
  @hint("Body text size ceiling.")
  @widget(new SliderWidget(30, 320, 1))
  bodySize: number = 170;
  @input
  @hint("Button label text size ceiling.")
  @widget(new SliderWidget(30, 200, 1))
  buttonLabelSize: number = 110;
  @input
  @hint("Default text fill colour (title/body/button labels). Explicit runtime recolours — e.g. a kept card's title, an emotion swatch — are set separately and are not affected by this.")
  textColor: vec4 = new vec4(1, 1, 1, 1);
  @input
  @hint("Draw a coloured outline behind every letter. OFF by default (2026-09-04: was always on and read as a heavy black smudge around small text).")
  textOutlineEnabled: boolean = false;
  @input
  @hint("Outline colour, only used when Text Outline Enabled is on.")
  textOutlineColor: vec4 = new vec4(0, 0, 0, 0.85);
  @input
  @hint("Outline thickness, only used when Text Outline Enabled is on.")
  @widget(new SliderWidget(0, 2, 0.05))
  textOutlineWidth: number = 0.4;
  @ui.group_end

  @ui.group_start("Frame (next panel build)")
  @input
  @hint("Default wireframe line colour for panels and buttons. Explicit recolours (kept-state green, dimmed grey, emotion swatches) are set separately and are not affected by this.")
  lineColor: vec4 = new vec4(1, 1, 1, 1);
  @input
  @hint("Panel border bar thickness, in cm.")
  @widget(new SliderWidget(0.05, 2, 0.05))
  panelFrameThicknessCm: number = 0.5;
  @input
  @hint("Button border bar thickness, in cm.")
  @widget(new SliderWidget(0.05, 2, 0.05))
  buttonFrameThicknessCm: number = 0.4;
  @input
  @hint("Panel corner roundedness, as a fraction of the shorter side (0 = sharp, 0.5 = stadium).")
  @widget(new SliderWidget(0, 0.5, 0.01))
  panelCornerFraction: number = 0.2;
  @input
  @hint("Button corner roundedness — usually rounder than the panel.")
  @widget(new SliderWidget(0, 0.5, 0.01))
  buttonCornerFraction: number = 0.5;
  @ui.group_end

  @ui.group_start("Layout (next panel build)")
  @input
  @hint("Extra local-Z distance (cm) buttons sit off the panel surface, on top of PanelKit's base offset. Raise this if buttons read as overlapping/z-fighting the panel frame.")
  @widget(new SliderWidget(0, 3, 0.05))
  buttonForwardCm: number = 0.5;
  @ui.group_end

  onAwake(): void {
    setFillOpacity(this.backgroundOpacity);
    this.syncBuildTimeFields();
    // Inspector edits DO reach an already-running component's @input fields
    // live during Preview (same as backgroundOpacity always relied on) — but
    // nothing calls US back when that happens, so poll every frame. The
    // fill-opacity path only does real work (a material loop) when the value
    // actually changed; the rest is plain variable copies PanelKit reads on
    // its next build, cheap enough to redo unconditionally every frame.
    this.createEvent("UpdateEvent").bind(() => {
      if (this.backgroundOpacity !== getFillOpacity()) setFillOpacity(this.backgroundOpacity);
      this.syncBuildTimeFields();
    });
  }

  private syncBuildTimeFields(): void {
    _font = isNull(this.font) ? null : this.font;
    _paragraphFont = isNull(this.paragraphFont) ? null : this.paragraphFont;
    _titleSize = this.titleSize;
    _bodySize = this.bodySize;
    _buttonLabelSize = this.buttonLabelSize;
    _textColor = this.textColor;
    _textOutlineEnabled = this.textOutlineEnabled;
    _textOutlineColor = this.textOutlineColor;
    _textOutlineWidth = this.textOutlineWidth;
    _lineColor = this.lineColor;
    _panelFrameThicknessCm = this.panelFrameThicknessCm;
    _buttonFrameThicknessCm = this.buttonFrameThicknessCm;
    _panelCornerFraction = this.panelCornerFraction;
    _buttonCornerFraction = this.buttonCornerFraction;
    _buttonForwardCm = this.buttonForwardCm;
  }
}
