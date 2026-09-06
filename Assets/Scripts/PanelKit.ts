/**
 * PanelKit.ts — builder for the recurring "titled world-space panel + a few
 * action buttons" pattern (Phase 0 spine).
 *
 * STYLE: wireframe. The panel and every button are a white rounded-rectangle
 * OUTLINE (TraceGizmos.makeRectFrame) with a fully transparent interior — no
 * fill. The UIKit `Button` is kept only for reliable SIK tap handling; its own
 * fill is hidden (opacity 0) and the white frame + big label carry the look.
 *
 * LAYOUT is done by hand (fixed local offsets), not UIKit FlexLayout — the flex
 * column kept fighting the large type and stacked buttons. Title sits at the top
 * band, buttons at the bottom (a row, or a full-width column when
 * `buttonsVertical`), and any free content a caller parents to `contentAnchor`
 * (thumbnail / OCR) goes in the gap between.
 *
 * NOT a @component — it is a builder. Returned handle is a plain object.
 *
 * MUST NOT: own state, know about Memorest screens, or call services.
 */

import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button";
import { makeRectFrame, RectFrame } from "./TraceGizmos";
import * as UITheme from "./UITheme";
import { playUISound } from "./UISound";

// Text size, colour, outline, frame thickness, corner roundedness, and how
// far buttons sit off the panel surface all come from UITheme (Inspector-
// adjustable, see that file's header for what's live vs. next-build). Only
// pure layout constants (gaps, padding, the base Z lift) stay fixed here.
const CONTENT_Z = 0.6; // lift text/frames off the surface plane
const GAP = 1.8; // vertical gap between stacked elements (cm)
const BUTTON_HEIGHT = 10;
const BUTTON_MIN_W = 5;
const PAD = 2.6; // inset from the panel outline to content

const DIM_COLOR = new vec4(0.45, 0.47, 0.5, 1); // greyed "unavailable" button
// Panel-surface backing-fill RGB — white, so the panel reads as a frosted
// surface and the opacity slider is actually visible (black-on-dark looked
// transparent). The ALPHA is driven live by the UITheme `backgroundOpacity`
// Inspector slider (default 0 — fully transparent panel, 2026-09-04).
const FILL_COLOR = new vec4(1, 1, 1, 0.35);
// Button fill's own tint — left at full white/opaque so UIButtonFill.mat's
// baked-in gradient texture (light gray -> transparent, horizontal) shows
// through unmodified. NOT tied to backgroundOpacity — see fillIgnoresThemeOpacity
// below; buttons keep their own gradient look regardless of the panel slider.
const BUTTON_FILL_COLOR = new vec4(1, 1, 1, 1);

/** Shared base materials: unlit white line, panel fill, and the button fill's
 *  own horizontal gradient (light gray -> transparent). */
const UI_MAT = requireAsset("../Materials/UILine.mat") as Material;
const UI_FILL_MAT = requireAsset("../Materials/UIFill.mat") as Material;
const UI_BUTTON_FILL_MAT = requireAsset("../Materials/UIButtonFill.mat") as Material;

export interface TitledPanel {
  root: SceneObject;
  /** Child at +Z — parent free content (thumbnail / OCR) here. */
  contentAnchor: SceneObject;
  /** Panel outline half-extents in cm (for edge-of-panel connector math). */
  halfWidthCm: number;
  halfHeightCm: number;
  setTitle(text: string): void;
  setBody(text: string): void;
  /** Add an action button. `opts.dim` greys the label + frame to read as a
   *  disabled/unavailable affordance (the tap still fires — the caller decides
   *  what a dimmed tap does, e.g. show a hint). */
  addButton(label: string, onTap: () => void, opts?: { dim?: boolean }): Button;
  /** Make the title band tap-target an action (opens a chooser / editor). Adds
   *  an invisible UIKit Button over the title plus a small "✎" affordance. */
  setTitleTappable(onTap: () => void): void;
  /** Make the WHOLE panel surface a tap target (e.g. "pinch the card to
   *  choose it" instead of a dedicated button) — an invisible UIKit Button
   *  covering the full width/height, sitting close to the surface (well
   *  BEHIND any button's own forward offset) so real buttons on the same
   *  panel still win the nearest-hit within their own bounds; this plate
   *  only catches taps everywhere else. */
  setPanelTappable(onTap: () => void): void;
  setVisible(v: boolean): void;
  /** Recolour the wireframe outline (Phase 2: brighten a card to its "kept" state). */
  setSurfaceColor(c: vec4): void;
  /** Recolour the title text (paired with setSurfaceColor for the kept state). */
  setTitleColor(c: vec4): void;
  /** Destroy the whole panel SceneObject tree. */
  destroy(): void;
}

export interface PanelOptions {
  name?: string;
  title: string;
  body?: string;
  widthCm?: number;
  heightCm?: number;
  localPosition?: vec3;
  /** Stack the buttons full-width instead of in a row — use for 3+ buttons or
   *  long labels so each button is wide enough for large text. */
  buttonsVertical?: boolean;
  /** Lay the buttons out in a grid of this many columns (rows stack from the
   *  bottom inset upward, reading order = top-left first). Overrides
   *  buttonsVertical. Use for a picker of many small same-size buttons. */
  buttonGridCols?: number;
  /** Nudge the whole button block down by this many cm (bottom-anchored
   *  buttons otherwise sit a fixed inset off the bottom edge). */
  buttonDropCm?: number;
  /** Override the title text size for just this panel (default: UITheme's
   *  global titleSize). Use for a panel whose title should read smaller/
   *  bigger than the rest of the app's panels. */
  titleSize?: number;
  /** Shift the title + body block down (positive) from its top anchor, in cm.
   *  Use to visually centre a panel whose content otherwise hugs the top. */
  contentDropCm?: number;
  /** Draw NO surface frame / fill — just the title/body/buttons floating.
   *  Use for a bare button row (e.g. a footer that is only actions). */
  frameless?: boolean;
  /** Give the BUTTONS no wireframe frame and no gradient fill — just the bare
   *  label (e.g. an emoji), still a full-size tap target. Use for a picker
   *  where the glyph alone carries the affordance. */
  buttonsFrameless?: boolean;
  /** Uniform scale on button HEIGHT + label box (default 1). <1 makes a more
   *  compact button row/stack; width is still driven by the layout. */
  buttonScale?: number;
  /** Mirror the button gradient fill horizontally (light edge on the RIGHT
   *  instead of the left). No effect with `buttonsFrameless`. */
  buttonGradientFlip?: boolean;
}

/** A tween descriptor shaped to drop straight into any caller's own
 *  `{ obj, t0, dur, step }[]` + onUpdate-loop idiom (the pattern already used
 *  by MemoryCardSpawner/OrbScreen/etc.) — `obj` lets that loop skip/drop the
 *  tween if its target is destroyed before it finishes. */
export interface PopTween {
  obj: SceneObject;
  t0: number;
  dur: number;
  step: (eased: number) => void;
}

export class PanelKit {
  /** A quick "pop in" scale-up for a just-built panel (or any SceneObject),
   *  so a new window appearing reads as a smooth transition instead of an
   *  instant snap. Sets the tiny starting scale synchronously (no 1-frame
   *  flash at full size), then returns a tween descriptor — push it into the
   *  caller's own tweens array and drive it from their existing onUpdate. */
  static popInTween(root: SceneObject, dur: number = 0.25): PopTween {
    const t = root.getTransform();
    const target = t.getLocalScale().x || 1;
    t.setLocalScale(new vec3(target * 0.05, target * 0.05, target * 0.05));
    return {
      obj: root,
      t0: getTime(),
      dur,
      step: (e: number) => {
        const s = target * (0.05 + 0.95 * e);
        t.setLocalScale(new vec3(s, s, s));
      },
    };
  }

  static create(parent: SceneObject, opts: PanelOptions): TitledPanel {
    const w = opts.widthCm ?? 30;
    const h = opts.heightCm ?? 18;
    const name = opts.name ?? "Panel";
    const gridCols = opts.buttonGridCols && opts.buttonGridCols > 1 ? Math.floor(opts.buttonGridCols) : 0;
    const vertical = !gridCols && opts.buttonsVertical === true;
    const drop = opts.buttonDropCm ?? 0;
    // Captured here because `addButton`'s own `opts` param shadows this one.
    const buttonsFrameless = opts.buttonsFrameless === true;
    const buttonGradientFlip = opts.buttonGradientFlip === true;
    const btnH = BUTTON_HEIGHT * (opts.buttonScale && opts.buttonScale > 0 ? opts.buttonScale : 1);
    const innerW = w - PAD * 2;

    const root = global.scene.createSceneObject(name);
    root.setParent(parent);
    if (opts.localPosition) root.getTransform().setLocalPosition(opts.localPosition);
    root.createComponent("Component.Canvas");

    // --- wireframe surface (skipped when frameless) --------------------
    const surface = opts.frameless
      ? null
      : makeRectFrame(root, UI_MAT, {
          name: "Surface",
          widthCm: w,
          heightCm: h,
          thicknessCm: UITheme.getPanelFrameThicknessCm(),
          cornerFraction: UITheme.getPanelCornerFraction(),
          color: UITheme.getLineColor(),
          fillMat: UI_FILL_MAT,
          fillColor: FILL_COLOR,
          localPosition: new vec3(0, 0, 0),
        });

    const content = global.scene.createSceneObject("Content");
    content.setParent(root);
    content.getTransform().setLocalPosition(new vec3(0, 0, CONTENT_Z));

    // --- title + body, top-anchored (optionally dropped toward centre) --
    const contentDrop = opts.contentDropCm ?? 0;
    const topY = h / 2 - PAD - contentDrop;
    const titleBandH = Math.min(h * 0.22, 9);
    const bodyBandH = opts.body ? Math.min(h * 0.18, 8) : 0;

    const titleObj = PanelKit.makeText(
      content, "Title", opts.title, opts.titleSize ?? UITheme.getTitleSize(), new vec2(innerW, titleBandH)
    );
    titleObj.getTransform().setLocalPosition(new vec3(0, topY - titleBandH / 2, 0.1));

    const bodyObj = PanelKit.makeText(
      content, "Body", opts.body ?? "", UITheme.getBodySize(), new vec2(innerW, Math.max(bodyBandH, 3))
    );
    bodyObj.getTransform().setLocalPosition(
      new vec3(0, topY - titleBandH - GAP - bodyBandH / 2, 0.1)
    );

    const titleText = titleObj.getComponent("Component.Text") as Text;
    const bodyText = bodyObj.getComponent("Component.Text") as Text;

    // --- buttons, bottom-anchored, laid out by hand ------------------
    const bottomY = -h / 2 + PAD;
    const buttons: Button[] = [];
    const btnObjs: SceneObject[] = [];
    const btnFrames: (RectFrame | null)[] = [];
    const btnLabels: Text[] = [];

    const relayout = () => {
      const n = buttons.length;
      if (n === 0) return;
      const rowGap = GAP;
      // Extra local-Z lift so buttons read as clearly in front of the panel
      // surface rather than overlapping/z-fighting its frame — Inspector-
      // adjustable (UITheme.buttonForwardCm).
      const fwd = UITheme.getButtonForwardCm();
      const baseY = bottomY + btnH / 2 - drop;

      if (gridCols) {
        const cols = Math.min(gridCols, n);
        const rows = Math.ceil(n / cols);
        const btnW = Math.max(BUTTON_MIN_W, (innerW - rowGap * (cols - 1)) / cols);
        for (let i = 0; i < n; i++) {
          const col = i % cols;
          const row = Math.floor(i / cols); // row 0 = TOP (reading order)
          const inThisRow = Math.min(cols, n - row * cols);
          const rowW = btnW * inThisRow + rowGap * (inThisRow - 1);
          const cx = -rowW / 2 + btnW / 2 + col * (btnW + rowGap);
          const cy = baseY + (rows - 1 - row) * (btnH + rowGap);
          btnObjs[i].getTransform().setLocalPosition(new vec3(cx, cy, fwd));
          applyBtnSize(i, btnW);
        }
      } else if (vertical) {
        const btnW = innerW;
        // Stack upward from the bottom inset.
        for (let i = 0; i < n; i++) {
          const cy = baseY + (n - 1 - i) * (btnH + rowGap);
          btnObjs[i].getTransform().setLocalPosition(new vec3(0, cy, fwd));
          applyBtnSize(i, btnW);
        }
      } else {
        const btnW = Math.max(
          BUTTON_MIN_W,
          Math.min(innerW, (innerW - rowGap * (n - 1)) / n)
        );
        const rowW = btnW * n + rowGap * (n - 1);
        for (let i = 0; i < n; i++) {
          const cx = -rowW / 2 + btnW / 2 + i * (btnW + rowGap);
          btnObjs[i].getTransform().setLocalPosition(new vec3(cx, baseY, fwd));
          applyBtnSize(i, btnW);
        }
      }
    };

    const applyBtnSize = (i: number, btnW: number) => {
      try {
        buttons[i].size = new vec3(btnW, btnH, 1);
      } catch (e) {
        /* not initialized yet — onInitialized re-runs relayout */
      }
      if (btnFrames[i]) btnFrames[i]!.resize(btnW, btnH);
      if (btnLabels[i]) {
        try {
          const lw = btnW * 0.78;
          const lh = btnH * 0.5;
          btnLabels[i].layoutRect = Rect.create(-lw / 2, lw / 2, -lh / 2, lh / 2);
        } catch (e) {
          /* layoutRect unsupported — sizeToFit falls back to `size` */
        }
      }
    };

    return {
      root,
      contentAnchor: content,
      halfWidthCm: w / 2,
      halfHeightCm: h / 2,
      setTitle(text: string) {
        titleText.text = text;
      },
      setBody(text: string) {
        bodyText.text = text;
      },
      addButton(label: string, onTap: () => void, opts?: { dim?: boolean }): Button {
        const btnObj = global.scene.createSceneObject("Btn_" + label);
        btnObj.setParent(content);
        const btn = btnObj.createComponent(Button.getTypeName()) as Button;
        buttons.push(btn);
        btnObjs.push(btnObj);

        const frame = buttonsFrameless
          ? null
          : makeRectFrame(btnObj, UI_MAT, {
              name: "BtnFrame",
              widthCm: BUTTON_MIN_W,
              heightCm: btnH,
              thicknessCm: UITheme.getButtonFrameThicknessCm(),
              cornerFraction: UITheme.getButtonCornerFraction(),
              color: UITheme.getLineColor(),
              fillMat: UI_BUTTON_FILL_MAT,
              fillColor: BUTTON_FILL_COLOR,
              fillIgnoresThemeOpacity: true,
              fillFlipU: buttonGradientFlip,
              // Pushed well forward (was 0.05) so the gradient fill quad
              // (frame-z minus 0.05 = 0.20) is nowhere near coplanar with SIK's
              // own button-background quad at z≈0 — coplanar transparent quads
              // with no depth-write were the "glitchy" flicker as the head moved
              // (2026-09-05).
              localPosition: new vec3(0, 0, 0.25),
            });
        btnFrames.push(frame);

        btn.onInitialized.add(() => {
          try {
            btn.opacity = 0; // hide UIKit's own fill — the frame is the visual
          } catch (e) {
            /* opacity API absent — frame still shows the boundary */
          }
          // opacity:0 still leaves SIK's button-background quad in the draw
          // list, sort-fighting our gradient fill. Actually disable its
          // RenderMeshVisual so there's just the one quad (2026-09-05).
          try {
            const bg = btnObj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
            if (bg) bg.enabled = false;
          } catch (e) {
            /* no SIK background visual on the button object — nothing to disable */
          }
          relayout();
        });

        const labelObj = PanelKit.makeText(
          btnObj, "Label", label, UITheme.getButtonLabelSize(),
          new vec2(BUTTON_MIN_W - 2, btnH - 1.6)
        );
        labelObj.getTransform().setLocalPosition(new vec3(0, 0, 0.45));
        const labelText = labelObj.getComponent("Component.Text") as Text;
        btnLabels.push(labelText);

        if (opts && opts.dim) {
          if (frame) frame.setColor(DIM_COLOR);
          try {
            labelText.textFill.color = DIM_COLOR;
          } catch (e) {
            /* older Text API — leave default */
          }
        }

        btn.onTriggerUp.add(() => {
          playUISound();
          onTap();
        });
        btn.initialize();
        relayout();
        return btn;
      },
      setTitleTappable(onTap: () => void) {
        const tapObj = global.scene.createSceneObject("TitleTap");
        tapObj.setParent(content);
        tapObj
          .getTransform()
          .setLocalPosition(new vec3(0, topY - titleBandH / 2, 0.2));
        const b = tapObj.createComponent(Button.getTypeName()) as Button;
        b.onInitialized.add(() => {
          try {
            b.opacity = 0; // invisible hit target — the title text is the visual
          } catch (e) {
            /* opacity API absent */
          }
          try {
            const bg = tapObj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
            if (bg) bg.enabled = false; // no phantom quad — see addButton
          } catch (e) {
            /* nothing to disable */
          }
          try {
            b.size = new vec3(innerW, Math.max(titleBandH, 4), 1);
          } catch (e) {
            /* size not settable yet */
          }
        });
        b.onTriggerUp.add(() => {
          playUISound();
          onTap();
        });
        b.initialize();

        // Small visible "edit" affordance at the title's trailing edge.
        const pen = PanelKit.makeText(
          content, "EditGlyph", "✎", UITheme.getBodySize(), new vec2(4, titleBandH * 0.7)
        );
        pen
          .getTransform()
          .setLocalPosition(
            new vec3(innerW / 2 - 2.5, topY - titleBandH / 2, 0.25)
          );
      },
      setPanelTappable(onTap: () => void) {
        const tapObj = global.scene.createSceneObject("PanelTap");
        tapObj.setParent(content);
        // Low Z (well behind CONTENT_Z's own local buttons, which sit further
        // forward via UITheme.buttonForwardCm) — a real button on this same
        // panel still wins the nearest-hit within its own bounds; this plate
        // only catches everything else.
        tapObj.getTransform().setLocalPosition(new vec3(0, 0, -CONTENT_Z * 0.5));
        const b = tapObj.createComponent(Button.getTypeName()) as Button;
        b.onInitialized.add(() => {
          try {
            b.opacity = 0; // fully invisible — the panel's own surface/content is the visual
          } catch (e) {
            /* opacity API absent */
          }
          try {
            const bg = tapObj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
            if (bg) bg.enabled = false; // no phantom quad — see addButton
          } catch (e) {
            /* nothing to disable */
          }
          try {
            b.size = new vec3(w, h, 1);
          } catch (e) {
            /* size not settable yet */
          }
        });
        b.onTriggerUp.add(() => {
          playUISound();
          onTap();
        });
        b.initialize();
      },
      setVisible(v: boolean) {
        root.enabled = v;
      },
      setSurfaceColor(c: vec4) {
        if (surface) surface.setColor(c);
      },
      setTitleColor(c: vec4) {
        try {
          titleText.textFill.color = c;
        } catch (e) {
          /* older Text API — leave default */
        }
      },
      destroy() {
        root.destroy();
      },
    };
  }

  private static makeText(
    parent: SceneObject,
    name: string,
    value: string,
    size: number,
    fitBoxCm?: vec2
  ): SceneObject {
    const o = global.scene.createSceneObject(name);
    o.setParent(parent);
    const t = o.createComponent("Component.Text") as Text;
    t.text = value;
    t.size = size;
    t.depthTest = true;
    UITheme.applyFont(t);
    try {
      t.textFill.color = UITheme.getTextColor();
      t.outlineSettings.enabled = UITheme.getTextOutlineEnabled();
      t.outlineSettings.fill.color = UITheme.getTextOutlineColor();
      t.outlineSettings.size = UITheme.getTextOutlineWidth();
    } catch (e) {
      /* older Text API — leave defaults */
    }
    if (fitBoxCm) {
      try {
        t.horizontalOverflow = HorizontalOverflow.Wrap;
        t.verticalOverflow = VerticalOverflow.Shrink;
        t.sizeToFit = true;
        t.layoutRect = Rect.create(
          -fitBoxCm.x / 2, fitBoxCm.x / 2, -fitBoxCm.y / 2, fitBoxCm.y / 2
        );
      } catch (e) {
        /* layoutRect / overflow API absent — text renders at `size` */
      }
    }
    return o;
  }
}
