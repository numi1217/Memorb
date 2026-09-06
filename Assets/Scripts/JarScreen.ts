/**
 * JarScreen.ts — Memorb "Revisit the month" screen (DESIGN.md v2 §12,
 * MVP priority 12) — the Memory Jar / monthly container.
 *
 * OWNS: the spatial container of one coloured sphere per COMPLETED journal day.
 * Reads the multi-day JSON array `OrbScreen` persists to
 * `global.persistentStorageSystem.store` under `traceJournal.days` (so §13
 * persistence is already covered on the write side — this is the read side).
 * Each sphere is tinted that day's `orbColor` (the overall feeling chosen at
 * §8). The user can:
 *   - see the month at a glance (the row of colours = the emotional pattern)
 *   - tap a sphere -> its date, title and object-label previews
 *   - deliberately "Reveal journal" -> the full generated paragraph + final
 *     reflection (the design's "deliberately unlock the full journal entry")
 *   - Delete a day (edit / move / export are DEFERRED — DESIGN.md: "advanced
 *     journal text editing" is not MVP)
 *
 * Object CUT-OUT thumbnails are NOT persisted (they're live textures), so the
 * previews here are the object LABELS as text — the pragmatic MVP scope.
 *
 * Screen ROOT visibility is owned by ScreenRouter (enabled only on the Jar
 * state). Builds on wake / re-enable when FlowManager.current === Jar; tears
 * down on disable. Two view-models: `month` (the sphere grid) and `day` (one
 * entry's detail) — a selection rebuilds the tree, same pattern as
 * ReviewScreen / ConfirmScreen.
 *
 * @input flowManager   - Back -> Launch (Home)
 * @input sphereMesh / sphereMat - a sphere mesh + base material, cloned and
 *        tinted per day (wire to MarkerSphereMesh.mesh / MarkerWhite.mat —
 *        requireAsset() can't resolve Assets-root files, so @inputs)
 * @input panelDistanceCm - local Z of the panel tree in front of the screen root
 * @input backLabel - copy
 * @input debugSeedDays - Preview-only: seed 3 fake days so the Jar can be
 *        screenshotted without saving 3 real journals. Leave OFF.
 *
 * MUST NOT: call Gemini, own the screen state machine, or hold journal data
 * beyond the store read.
 */

import { FlowManager, TraceScreen } from "./FlowManager";
import { JournalEntryData } from "./JournalEntry";
import { JournalSession, KeptTrace } from "./JournalSession";
import { sessionPlacedOrbs } from "./OrbScreen";
import { PanelKit, TitledPanel } from "./PanelKit";
import { forgetPlacement } from "./PlacedOrbStore";
import { buildSapling, momentCountToStage } from "./Sapling";
import { PersistedSticker, decodeSticker, readStickers, removeStickers } from "./StickerStore";
import { makePolygonCutout, ThumbOutline } from "./TraceGizmos";
import { applyFont, applyParagraphFont } from "./UITheme";
import { playUISound } from "./UISound";
import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button";

const STICKER_OUTLINE: ThumbOutline = { color: new vec4(1, 1, 1, 1), widthCm: 0.5 };

const DAYS_KEY = "traceJournal.days";

/** When set, the next time the Jar screen is entered it opens straight to this
 *  day's detail view instead of the month grid. Consumed once. Used by
 *  LaunchScreen's "Review Today" when today's journal is already saved but the
 *  session has no live moments (2026-09-06). */
let _pendingDayId: string | null = null;
export function requestJarDay(id: string): void {
  _pendingDayId = id || null;
}

function hexToVec4(hex: string): vec4 {
  const h = (hex || "").replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return new vec4(isNaN(r) ? 0.7 : r, isNaN(g) ? 0.7 : g, isNaN(b) ? 0.7 : b, 1);
}

/** "2026-09-14" -> "14 Sep". Falls back to the raw string on any parse trouble. */
function prettyDate(iso: string): string {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = parseInt(m[2], 10) - 1;
  return `${parseInt(m[3], 10)} ${months[mi] || m[2]}`;
}

function monthLabel(iso: string): string {
  const m = (iso || "").match(/^(\d{4})-(\d{2})/);
  if (!m) return "This month";
  const months = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  return `${months[parseInt(m[2], 10) - 1] || m[2]} ${m[1]}`;
}

/** "2026-09-14" -> "2026-09" (the month bucket). "" on parse trouble. */
function monthKey(iso: string): string {
  const m = (iso || "").match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : "";
}

type JarView = "month" | "day";

@component
export class JarScreen extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">JarScreen — Revisit the month (§12)</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("FlowManager — Back -> Launch (Home).")
  flowManager!: FlowManager;
  @input
  @hint("JournalSession — when this day's entry matches the live session (i.e. the day you just saved), the day-detail view shows that day's cut-out stickers. Optional; without it the detail view falls back to the object labels only.")
  @allowUndefined
  journalSession!: JournalSession;
  @input
  @hint("Sphere mesh for each day-sphere (wire to MarkerSphereMesh.mesh).")
  @allowUndefined
  sphereMesh!: RenderMesh;
  @input
  @hint("Base material for the day-spheres — cloned + tinted per day (wire to MarkerWhite.mat).")
  @allowUndefined
  sphereMat!: Material;
  @input
  @hint('Scene "Camera Object" — the Jar panels are placed in front of the user each time this screen opens (yaw-only, not billboarded). Optional; falls back to the screen root\'s authored position if unwired.')
  @allowUndefined
  cameraObject!: SceneObject;
  @ui.group_end

  @ui.group_start("Copy")
  @input backLabel: string = "Back to Home";
  @ui.group_end

  @ui.group_start("Settings")
  @input
  @hint("Local Z of the Jar panel tree relative to this screen root (cm, negative = in front).")
  panelDistanceCm: number = -100;
  @input
  @hint("Diameter of each day-sphere in cm.")
  sphereDiameterCm: number = 7;
  @ui.group_end

  @ui.group_start("Debug")
  @input
  @hint("Preview-only: if the store has 0 saved days when this screen opens, seed 3 fake days so the layout is screenshot-able. Leave OFF for real use.")
  debugSeedDays: boolean = false;
  @input
  @hint("Preview-only: auto-open the first day's detail view a moment after the Jar builds (no hand tap needed), so the detail + Reveal can be screenshotted. Leave OFF for real use.")
  debugOpenFirstDay: boolean = false;
  @input
  @hint("Preview-only ONE-SHOT: wipe the persistent traceJournal.days store when this screen opens (clears test pollution). Turn back OFF after one run.")
  debugClearSavedDays: boolean = false;
  @ui.group_end

  private ready = false;
  private content: SceneObject | null = null;
  private panels: TitledPanel[] = [];
  private spheres: SceneObject[] = [];
  /** Tap-target children JarScreen adds to the real placed orbs — destroyed on
   *  teardown; the placed orbs themselves are OrbScreen's, never touched. */
  private placedTaps: SceneObject[] = [];
  /** Original local scale of each session-placed orb, captured the first time
   *  JarScreen sees it — so the pop-in tween + the day-view restore can put it
   *  back exactly (dayId -> scale). */
  private placedFullScale: Map<string, vec3> = new Map<string, vec3>();
  /** Scale-pop-in tweens for the day balls (grid spheres + real placed orbs). */
  private pops: { obj: SceneObject; t0: number; dur: number; full: vec3 }[] = [];
  private days: JournalEntryData[] = [];
  private view: JarView = "month";
  private selectedId: string | null = null;
  private revealed = false;
  /** Distinct month buckets present in `days`, ascending ("2026-08", "2026-09"). */
  private monthKeys: string[] = [];
  /** Which month bucket the grid is showing. -1 = "not set yet" -> defaults to
   *  the most recent month on the next build. Kept across a month<->day round
   *  trip so "Back to month" lands where you left off. */
  private monthIdx = -1;
  /** World pose of the ball the user just tapped — so the day panel spawns
   *  ABOVE that ball rather than dead-ahead (2026-09-06). Null when the day
   *  view was opened without a tap (e.g. "Review Today"). */
  private lastTapWorldPos: vec3 | null = null;
  private lastTapWorldRadius = 0;
  private store = global.persistentStorageSystem.store;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      this.ready = true;
      if (_pendingDayId) {
        this.view = "day";
        this.selectedId = _pendingDayId;
        _pendingDayId = null;
        this.lastTapWorldPos = null; // opened without a ball tap -> centred
      }
      this.spawnInFrontOfUser();
      this.rebuild();
    });
    this.createEvent("OnEnableEvent").bind(() => {
      if (!this.ready) return;
      // A fresh open starts on the month grid — unless something asked for a
      // specific day (requestJarDay), e.g. "Review Today" on an already-saved day.
      this.revealed = false;
      if (_pendingDayId) {
        this.view = "day";
        this.selectedId = _pendingDayId;
        _pendingDayId = null;
        this.lastTapWorldPos = null; // opened without a ball tap -> centred
      } else {
        this.view = "month";
        this.selectedId = null;
        this.monthIdx = -1; // fresh open -> newest month
      }
      this.spawnInFrontOfUser();
      this.rebuild();
    });
    this.createEvent("OnDisableEvent").bind(() => {
      // Leaving the Jar: put every real placed orb back the way OrbScreen left
      // it (full size, visible) before tearing our own scaffolding down.
      this.restorePlacedOrbs();
      this.teardown();
    });
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  private onUpdate(): void {
    if (this.pops.length === 0) return;
    const now = getTime();
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      if (isNull(p.obj)) {
        this.pops.splice(i, 1);
        continue;
      }
      const k = Math.max(0, Math.min(1, (now - p.t0) / p.dur));
      const e = 1 - Math.pow(1 - k, 3); // ease-out
      const s = 0.05 + 0.95 * e;
      p.obj.getTransform().setLocalScale(new vec3(p.full.x * s, p.full.y * s, p.full.z * s));
      if (k >= 1) this.pops.splice(i, 1);
    }
  }

  /** Restore every session-placed orb to its captured full scale + visible
   *  (the day view hides / the month view pop-tweens them). Prunes dead refs. */
  private restorePlacedOrbs(): void {
    sessionPlacedOrbs.forEach((orb, id) => {
      if (!orb || isNull(orb)) {
        sessionPlacedOrbs.delete(id);
        this.placedFullScale.delete(id);
        return;
      }
      orb.enabled = true;
      const full = this.placedFullScale.get(id);
      if (full) orb.getTransform().setLocalScale(full);
    });
  }

  /** Re-enable a session-placed orb where the user parked it, pop its scale in
   *  from near-zero, and hang an invisible tap target on it that opens its day.
   *  The orb SceneObject itself belongs to OrbScreen — only the tap child is
   *  ours to destroy. */
  private surfacePlacedOrb(entry: JournalEntryData, staggerIndex: number): void {
    const orb = sessionPlacedOrbs.get(entry.id);
    if (!orb || isNull(orb)) return;
    orb.enabled = true;

    const t = orb.getTransform();
    let full = this.placedFullScale.get(entry.id);
    if (!full) {
      full = t.getLocalScale();
      if (!full || full.x < 0.01) {
        full = new vec3(this.sphereDiameterCm, this.sphereDiameterCm, this.sphereDiameterCm);
      }
      this.placedFullScale.set(entry.id, full);
    }
    t.setLocalScale(new vec3(full.x * 0.05, full.y * 0.05, full.z * 0.05));
    this.pops.push({ obj: orb, t0: getTime() + staggerIndex * 0.06, dur: 0.5, full });

    const tapObj = global.scene.createSceneObject("JarPlacedTap_" + entry.id);
    tapObj.setParent(orb);
    tapObj.getTransform().setLocalPosition(new vec3(0, 0, 0));
    const btn = tapObj.createComponent(Button.getTypeName()) as Button;
    btn.onInitialized.add(() => {
      try {
        btn.opacity = 0;
      } catch (e) {
        /* ignore */
      }
      try {
        const bg = tapObj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
        if (bg) bg.enabled = false;
      } catch (e) {
        /* ignore */
      }
      try {
        btn.size = new vec3(1.4, 1.4, 1.4); // local — the orb parent is ~sphereDiameterCm
      } catch (e) {
        /* ignore */
      }
    });
    btn.onTriggerUp.add(() => {
      playUISound();
      this.lastTapWorldPos = orb.getTransform().getWorldPosition();
      this.lastTapWorldRadius = (orb.getTransform().getWorldScale().x || this.sphereDiameterCm) * 0.5;
      this.openDay(entry.id);
    });
    btn.initialize();
    this.placedTaps.push(tapObj);
  }

  /** Move this screen's root to the camera's current position + yaw (once per
   *  entry — not billboarded). Mirrors ReviewScreen / GenerateScreen. */
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

  // --- build / teardown ---------------------------------------------------

  private teardown(): void {
    for (const p of this.panels) {
      try {
        p.destroy();
      } catch (e) {
        /* already gone with its parent */
      }
    }
    this.panels = [];
    for (const s of this.spheres) {
      if (!isNull(s)) {
        try {
          s.destroy();
        } catch (e) {
          /* ignore */
        }
      }
    }
    this.spheres = [];
    // Our tap children on the real placed orbs — destroy these, NEVER the orbs.
    for (const tp of this.placedTaps) {
      if (!isNull(tp)) {
        try {
          tp.destroy();
        } catch (e) {
          /* ignore */
        }
      }
    }
    this.placedTaps = [];
    this.pops = [];
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
    if (isNull(this.flowManager)) {
      console.log("[Jar] ERROR: flowManager not wired — screen inert");
      return;
    }
    this.teardown();
    if (this.flowManager.current !== TraceScreen.Jar) return;

    if (this.debugClearSavedDays) {
      try {
        this.store.putString(DAYS_KEY, "[]");
        for (const k of this.store.getAllKeys()) {
          if (k.indexOf("traceJournal.thumbs.") === 0) this.store.remove(k);
        }
        this.store.remove("traceJournal.placements");
        console.log("[Jar][Debug] wiped traceJournal.days + thumbs + placements");
      } catch (e) {
        /* ignore */
      }
    }

    this.days = this.readDays();
    if (this.days.length === 0 && this.debugSeedDays) {
      // In-memory only — NEVER written to the persistent store, so it can't
      // leak fake days into a real session once the flag is turned back off.
      this.days = JarScreen.debugSeed();
    }

    const content = global.scene.createSceneObject("JarContent");
    content.setParent(this.sceneObject);
    content.getTransform().setLocalPosition(new vec3(0, 0, this.panelDistanceCm));
    this.content = content;

    if (this.view === "day" && this.selectedId) {
      this.buildDayView(content);
    } else {
      this.buildMonthView(content);
    }
  }

  // --- month grid -------------------------------------------------------

  private buildMonthView(content: SceneObject): void {
    this.lastTapWorldPos = null; // back on the grid — next day view is centred unless a ball is tapped

    // Bucket the days by month and show ONE month at a time (§12 "Revisit the
    // month" — 2026-09-06: navigate across months). monthIdx is clamped here;
    // -1 (fresh open) lands on the most recent month.
    const seenM: { [k: string]: boolean } = {};
    this.monthKeys = [];
    for (const e of this.days) {
      const k = monthKey(e.date);
      if (k && !seenM[k]) {
        seenM[k] = true;
        this.monthKeys.push(k);
      }
    }
    this.monthKeys.sort();
    if (this.monthIdx < 0 || this.monthIdx >= this.monthKeys.length) {
      this.monthIdx = Math.max(0, this.monthKeys.length - 1);
    }
    const curKey = this.monthKeys[this.monthIdx] || "";
    const monthDays = curKey ? this.days.filter((e) => monthKey(e.date) === curKey) : this.days.slice();
    const n = monthDays.length;
    const monthTxt = curKey ? monthLabel(curKey) : "This month";

    // Days the user PLACED in the room this session show as their real orbs,
    // right where they parked them (item 2026-09-06). Every other day (older
    // sessions — world positions aren't persisted, DESIGN.md defers anchoring)
    // still shows as a sphere in the panel grid.
    const placedDays: JournalEntryData[] = [];
    const gridDays: JournalEntryData[] = [];
    for (const e of monthDays) {
      const orb = sessionPlacedOrbs.get(e.id);
      if (orb && !isNull(orb)) placedDays.push(e);
      else gridDays.push(e);
    }
    // Bring every placed orb back, then hide the ones whose day isn't in the
    // month being browsed, and re-pop the ones that are.
    this.restorePlacedOrbs();
    sessionPlacedOrbs.forEach((orb, id) => {
      if (!orb || isNull(orb)) return;
      orb.enabled = monthDays.some((e) => e.id === id);
    });
    for (let i = 0; i < placedDays.length; i++) this.surfacePlacedOrb(placedDays[i], i);

    const ng = gridDays.length;

    // Compact, vertically symmetric layout (2026-09-05) so the whole tree —
    // header, sphere grid AND the Back button — fits a headset FOV once the
    // root is placed dead-ahead by spawnInFrontOfUser(). The old layout put
    // the header at +42 and the Back button near -44, which clipped off both
    // edges on device (looked like "the journal disappeared / stuck").
    const d = this.sphereDiameterCm;
    const perRow = ng > 0 ? Math.min(7, ng) : 1;
    const rows = ng > 0 ? Math.ceil(ng / perRow) : 1;
    const gapX = d + 5;
    const gapY = d + 12;
    const gridHalfH = ((rows - 1) * gapY) / 2;
    const headerCY = gridHalfH + d / 2 + 11;
    // Tighter (was +17) — the date caption + Back button were reading too far
    // apart from the spheres (2026-09-06). Still clears the caption at -d*0.5-3.2.
    const footerCY = -(gridHalfH + d / 2 + 11);

    const headerBody =
      n === 0
        ? "No journals yet."
        : ng === 0 && placedDays.length > 0
        ? "Your placed orbs are around you — tap one to open its day."
        : "";
    const header = PanelKit.create(content, {
      name: "JarHeader",
      title: monthTxt,
      body: headerBody,
      widthCm: 60,
      heightCm: 14,
      localPosition: new vec3(0, headerCY, 0),
      titleSize: 140,
      contentDropCm: headerBody === "" ? 3 : 0, // centre the month text in the header box
    });
    this.panels.push(header);

    if (ng > 0 && !isNull(this.sphereMesh) && !isNull(this.sphereMat)) {
      for (let i = 0; i < ng; i++) {
        const entry = gridDays[i];
        const col = i % perRow;
        const row = Math.floor(i / perRow);
        const inThisRow = Math.min(perRow, ng - row * perRow);
        const thisRowW = (inThisRow - 1) * gapX;
        const cx = -thisRowW / 2 + col * gapX;
        const cy = gridHalfH - row * gapY;
        this.buildDaySphere(content, entry, new vec3(cx, cy, 0), d);
      }
    }

    // Back button, plus month-navigation arrows when more than one month has
    // journals ([ Prev ] [ Back ] [ Next ]). Dimmed at the ends.
    const footer = PanelKit.create(content, {
      name: "JarFooter",
      title: "",
      body: n === 0 ? "Save a day's journal and it lands here." : "",
      widthCm: 60,
      heightCm: 14,
      localPosition: new vec3(0, footerCY, 0),
      buttonsVertical: false,
      frameless: true,
    });
    const multiMonth = this.monthKeys.length > 1;
    if (multiMonth) {
      const atOldest = this.monthIdx <= 0;
      footer.addButton(
        "Prev",
        () => {
          if (this.monthIdx > 0) {
            this.monthIdx -= 1;
            this.rebuild();
          }
        },
        { dim: atOldest }
      );
    }
    footer.addButton(this.backLabel, () => this.goHome());
    if (multiMonth) {
      const atNewest = this.monthIdx >= this.monthKeys.length - 1;
      footer.addButton(
        "Next",
        () => {
          if (this.monthIdx < this.monthKeys.length - 1) {
            this.monthIdx += 1;
            this.rebuild();
          }
        },
        { dim: atNewest }
      );
    }
    this.panels.push(footer);

    // Shrink the tree to a comfortable field of view (target ~40cm tall
    // effective height at panelDistanceCm).
    const spanV = headerCY + 7 - (footerCY - 7);
    const spanH = Math.max(56, (perRow - 1) * gapX + d);
    const scale = Math.min(1, 40 / spanV, 150 / spanH);
    content.getTransform().setLocalScale(new vec3(scale, scale, scale));

    console.log(`[Jar] month view built — ${n} day(s), scale=${scale.toFixed(2)}`);

    if (this.debugOpenFirstDay && n > 0 && !this.debugOpenedOnce) {
      this.debugOpenedOnce = true;
      const e = this.createEvent("DelayedCallbackEvent");
      e.bind(() => {
        console.log("[Jar][Debug] auto-opening first day");
        this.openDay(this.days[0].id);
        const e2 = this.createEvent("DelayedCallbackEvent");
        e2.bind(() => {
          console.log("[Jar][Debug] auto-revealing the journal");
          this.revealed = true;
          this.rebuild();
        });
        e2.reset(1.5);
      });
      e.reset(1.0);
    }
  }
  private debugOpenedOnce = false;

  private buildDaySphere(parent: SceneObject, entry: JournalEntryData, localPos: vec3, d: number): void {
    const holder = global.scene.createSceneObject("JarDay_" + entry.id);
    holder.setParent(parent);
    holder.getTransform().setLocalPosition(localPos);

    const orb = global.scene.createSceneObject("Sphere");
    orb.setParent(holder);
    // Smooth scale pop-in, staggered across the grid (2026-09-06).
    const full = new vec3(d, d, d);
    orb.getTransform().setLocalScale(new vec3(d * 0.05, d * 0.05, d * 0.05));
    this.pops.push({ obj: orb, t0: getTime() + this.spheres.length * 0.05, dur: 0.45, full });
    const rmv = orb.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    rmv.mesh = this.sphereMesh;
    const mat = this.sphereMat.clone();
    const baseColor = hexToVec4(entry.orbColor || "#9AA0A6");
    try {
      (mat.mainPass as any).baseColor = baseColor;
    } catch (e) {
      /* material without a baseColor uniform — sphere stays the base colour */
    }
    rmv.clearMaterials();
    rmv.addMaterial(mat);

    // The plant on top, at this day's earned stage (static — the grid just
    // shows current growth; the animated grow lives on the Orb screen).
    const stage = momentCountToStage((entry.selectedMomentIds || []).length);
    const sap = buildSapling(holder, d, { scaleMul: 1.6 }); // bigger so it reads at grid scale
    sap.root.getTransform().setLocalPosition(new vec3(0, d * 0.5 * 0.92, 0));
    sap.snapToStage(stage);

    // Small date caption under the sphere.
    const cap = global.scene.createSceneObject("Date");
    cap.setParent(holder);
    cap.getTransform().setLocalPosition(new vec3(0, -d * 0.5 - 3.2, 0.3));
    const t = cap.createComponent("Component.Text") as Text;
    t.text = prettyDate(entry.date);
    t.size = 44;
    t.depthTest = true;
    applyFont(t);

    // Whole holder is the tap target.
    const btnObj = global.scene.createSceneObject("Tap");
    btnObj.setParent(holder);
    btnObj.getTransform().setLocalPosition(new vec3(0, 0, d * 0.5 + 0.5));
    const btn = btnObj.createComponent(Button.getTypeName()) as Button;
    btn.onInitialized.add(() => {
      try {
        btn.opacity = 0;
      } catch (e) {
        /* ignore */
      }
      try {
        const bg = btnObj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
        if (bg) bg.enabled = false;
      } catch (e) {
        /* ignore */
      }
      try {
        btn.size = new vec3(d * 1.3, d * 1.3, 1);
      } catch (e) {
        /* ignore */
      }
    });
    btn.onTriggerUp.add(() => {
      playUISound();
      // Remember where this ball is so the day panel spawns above it.
      this.lastTapWorldPos = holder.getTransform().getWorldPosition();
      this.lastTapWorldRadius = (orb.getTransform().getWorldScale().x || d) * 0.5;
      this.openDay(entry.id);
    });

    // Hover highlight (2026-09-05): blend the sphere toward a light yellow
    // while the cursor is on it, restore its day-colour on exit.
    const HOVER_TINT = new vec4(1.0, 0.97, 0.7, 1.0);
    const mix = (a: vec4, b: vec4, t: number) =>
      new vec4(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, 1);
    const setSphereColor = (c: vec4) => {
      try {
        (mat.mainPass as any).baseColor = c;
      } catch (e) {
        /* no baseColor uniform */
      }
    };
    btn.onHoverEnter.add(() => setSphereColor(mix(baseColor, HOVER_TINT, 0.65)));
    btn.onHoverExit.add(() => setSphereColor(baseColor));

    btn.initialize();

    this.spheres.push(holder);
  }

  // --- one day's detail ----------------------------------------------

  private buildDayView(content: SceneObject): void {
    const entry = this.days.filter((d) => d.id === this.selectedId)[0];
    if (!entry) {
      this.view = "month";
      this.rebuild();
      return;
    }

    // "Once they pick a specific one, display the chosen one only" (2026-09-06)
    // — hide every session-placed orb except the picked day's.
    sessionPlacedOrbs.forEach((orb, id) => {
      if (!orb || isNull(orb)) return;
      orb.enabled = id === entry.id;
    });

    const labels = (entry.objectLabels || []).filter((s) => !!s);
    const previews = labels.length > 0 ? labels.join("  ·  ") : "(no object previews)";

    // This day's cut-out stickers. Prefer the live JournalSession textures (the
    // day just made this session); otherwise fall back to the base64 thumbs
    // StickerStore persisted at save time (survives a Lens restart); otherwise
    // the object-label list.
    const liveStickers = this.revealed ? [] : this.liveStickersFor(entry);
    const persistedStickers: PersistedSticker[] =
      !this.revealed && liveStickers.length === 0 ? readStickers(entry.id) : [];
    const stickerCount = liveStickers.length || persistedStickers.length;
    const hasStickers = stickerCount > 0;

    const w = this.revealed ? 60 : 52;
    // Revealed panel tightened (was 58) so the title / journal text / buttons
    // sit closer together (2026-09-06). Grows for a long entry (e.g. one that's
    // had "Add to Today's Journal" run on it) so the text clears the buttons.
    const journalLen =
      (entry.generatedJournalText || "").length + (entry.finalReflection || entry.reflection || "").length;
    const revealedH = journalLen > 380 ? Math.min(62, 44 + Math.ceil((journalLen - 380) / 90) * 4) : 44;
    const h = this.revealed ? revealedH : hasStickers ? 46 : 34;

    const panel = PanelKit.create(content, {
      name: "JarDayDetail",
      title: `${prettyDate(entry.date)}${entry.title ? " — " + entry.title : ""}`,
      // Revealed: the whole entry (paragraph + closing reflection) is ONE
      // wrapped Text block below — keeping the reflection out of PanelKit's
      // body band, which was overlapping the paragraph (2026-09-05).
      body: this.revealed ? "" : hasStickers ? "" : previews,
      widthCm: w,
      heightCm: h,
      localPosition: new vec3(0, 0, 0),
      buttonsVertical: false,
      titleSize: 130,
      contentDropCm: this.revealed ? 2 : hasStickers ? 6 : 5, // pull the date/title toward centre
    });

    if (liveStickers.length > 0) this.buildStickerRow(panel, liveStickers, -2);
    else if (persistedStickers.length > 0) this.buildPersistedStickerRow(panel, persistedStickers, -2);

    if (this.revealed) {
      // The unlocked journal — paragraph + closing reflection as one wrapped
      // block, so the reflection can't collide with the paragraph.
      const para = global.scene.createSceneObject("JournalText");
      para.setParent(panel.contentAnchor);
      para.getTransform().setLocalPosition(new vec3(0, 0, 0.3));
      const pt = para.createComponent("Component.Text") as Text;
      const refl = (entry.finalReflection || entry.reflection || "").trim();
      pt.text = (entry.generatedJournalText || "(no journal text)") + (refl ? `\n\n— ${refl}` : "");
      pt.size = 56; // bigger journal text (was 52)
      pt.depthTest = true;
      applyParagraphFont(pt); // the revealed journal is prose
      try {
        pt.horizontalOverflow = HorizontalOverflow.Wrap;
        pt.verticalOverflow = VerticalOverflow.Overflow;
        // Narrow band between the title band and the button row — small gaps
        // both sides now the panel is shorter (2026-09-06).
        pt.layoutRect = Rect.create(-(w - 8) / 2, (w - 8) / 2, -h * 0.2, h * 0.16);
      } catch (e) {
        /* older Text API — renders at `size` */
      }
    }

    if (!this.revealed) {
      panel.addButton("Reveal journal", () => {
        this.revealed = true;
        this.rebuild();
      });
    }
    panel.addButton("Delete", () => this.deleteDay(entry.id));
    panel.addButton("Back to month", () => {
      this.view = "month";
      this.revealed = false;
      this.selectedId = null;
      this.rebuild();
    });
    this.panels.push(panel);

    // No separate "Back to Home" footer any more (2026-09-05 — it pushed the
    // tree past the FOV): "Back to month" -> the month view's Back button.
    const spanV = h + 4;
    const spanH = Math.max(w, 44);
    const scale = Math.min(1, 44 / spanV, 150 / spanH);
    content.getTransform().setLocalScale(new vec3(scale, scale, scale));

    // If the user got here by pressing a ball (grid sphere or a room-placed
    // orb), float this panel above and a little beyond that ball
    // (2026-09-06). A ball parked close to the player pushed the journal right
    // into their face — so keep the panel out at a comfortable reading distance
    // along the ball's bearing, and sit it noticeably HIGHER than the ball.
    if (this.lastTapWorldPos) {
      const pr = panel.root.getTransform();
      const halfHW = panel.halfHeightCm * scale;
      const ball = this.lastTapWorldPos;
      const camPos = isNull(this.cameraObject)
        ? ball.add(new vec3(0, 0, 70))
        : this.cameraObject.getTransform().getWorldPosition();

      // Horizontal bearing to the ball, pushed out to at least READ_CM.
      let flat = new vec3(ball.x - camPos.x, 0, ball.z - camPos.z);
      const dist = flat.length;
      flat = dist > 1e-3 ? flat.uniformScale(1 / dist) : new vec3(0, 0, -1);
      const READ_CM = 85;
      const outCm = Math.max(dist, READ_CM);
      const anchorX = camPos.x + flat.x * outCm;
      const anchorZ = camPos.z + flat.z * outCm;

      // Sit it clearly above the ball (bottom edge ~10 cm clear + the panel
      // body), capped so its top stays inside the FOV.
      let py = ball.y + this.lastTapWorldRadius + halfHW + 10;
      const maxTop = camPos.y + 32;
      if (py + halfHW > maxTop) py = maxTop - halfHW;

      pr.setWorldPosition(new vec3(anchorX, py, anchorZ));
      // Face the reader. quat.lookAt on the flattened panel->camera vector — a
      // yaw euler flips 180° when the head is pitched (looking up/down at the
      // ball), which left the revealed journal facing away.
      let toCam = new vec3(camPos.x - anchorX, 0, camPos.z - anchorZ);
      if (toCam.length < 1e-4) toCam = new vec3(0, 0, 1);
      pr.setWorldRotation(quat.lookAt(toCam.normalize(), vec3.up()));
    }

    console.log(
      `[Jar] day view built — id=${entry.id} revealed=${this.revealed} ` +
        `above-ball=${this.lastTapWorldPos !== null} ` +
        `stickers(live=${liveStickers.length} persisted=${persistedStickers.length})`
    );
  }

  /** The cut-out stickers for `data`'s day, IF that day is the one still held
   *  live by JournalSession (textures aren't persisted, so only the just-made
   *  day has them). Filtered to the moments that were selected for the journal. */
  private liveStickersFor(data: JournalEntryData): KeptTrace[] {
    if (isNull(this.journalSession)) return [];
    const live = this.journalSession.getEntry();
    if (!live || live.id !== data.id) return [];
    const sel = Array.isArray(data.selectedMomentIds) ? data.selectedMomentIds : [];
    return this.journalSession
      .keptTraces()
      .filter((t) => !!t.thumb && (sel.length ? sel.indexOf(t.order) >= 0 : !!t.includedInJournal));
  }

  private buildStickerRow(panel: TitledPanel, traces: KeptTrace[], centerY: number): void {
    const shown = traces.slice(0, 5);
    const hCm = 10;
    const slotW = 11.5;
    const gap = 1.8;
    const rowW = shown.length * slotW + (shown.length - 1) * gap;
    let cx = -rowW / 2 + slotW / 2;
    for (const t of shown) {
      this.buildOneSticker(panel, t, hCm, new vec3(cx, centerY, 0.3));
      cx += slotW + gap;
    }
  }

  /** One LIVE sticker (from a KeptTrace's in-memory texture). */
  private buildOneSticker(panel: TitledPanel, t: KeptTrace, hCm: number, localPos: vec3): void {
    if (!t.thumb) return;
    this.buildStickerFromTex(panel, t.thumb, t.thumbBox, t.thumbPolygon, t.order, hCm, localPos);
  }

  /** Decode + lay out the base64 thumbs StickerStore persisted for a past day.
   *  Each decode is async — positions are computed up front from the record
   *  count so the row stays put as textures arrive. */
  private buildPersistedStickerRow(panel: TitledPanel, recs: PersistedSticker[], centerY: number): void {
    const shown = recs.slice(0, 5);
    const hCm = 10;
    const slotW = 11.5;
    const gap = 1.8;
    const rowW = shown.length * slotW + (shown.length - 1) * gap;
    let cx = -rowW / 2 + slotW / 2;
    for (const rec of shown) {
      const pos = new vec3(cx, centerY, 0.3);
      decodeSticker(rec, (tex) => {
        // The day view may have been torn down while this decoded.
        if (isNull(panel.contentAnchor)) return;
        this.buildStickerFromTex(panel, tex, rec.box, rec.polygon, rec.order, hCm, pos);
      });
      cx += slotW + gap;
    }
  }

  /** Shared sticker renderer — polygon cut-out mesh if we have the outline,
   *  else a UV-cropped Image, else the full frame. Mirrors
   *  ReviewScreen.buildThumb / MomentEmotionReflect.buildOneKeptThumb. */
  private buildStickerFromTex(
    panel: TitledPanel,
    thumb: Texture,
    box: { x: number; y: number; w: number; h: number } | undefined,
    polygon: { x: number; y: number }[] | undefined,
    order: number,
    hCm: number,
    localPos: vec3
  ): void {
    if (!thumb) return;

    if (polygon && polygon.length >= 3) {
      try {
        const mat = (requireAsset("../Materials/ImageMaterial.mat") as Material).clone();
        (mat.mainPass as any).baseTex = thumb;
        (mat.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
        const cut = makePolygonCutout(panel.contentAnchor, mat, polygon, hCm, localPos, STICKER_OUTLINE);
        if (cut) return;
      } catch (e) {
        console.log("[Jar] sticker cutout bind failed — " + e);
      }
    }

    const imgObj = global.scene.createSceneObject("Sticker_" + order);
    imgObj.setParent(panel.contentAnchor);
    imgObj.getTransform().setLocalPosition(localPos);
    const img = imgObj.createComponent("Component.Image") as Image;
    const hasBox = !!box && box.w > 0.03 && box.h > 0.03 && box.w <= 1 && box.h <= 1;
    let cropped = false;
    try {
      const mat = (requireAsset("../Materials/ImageMaterial.mat") as Material).clone();
      img.clearMaterials();
      img.addMaterial(mat);
      (img.mainPass as any).baseTex = thumb;
      (img.mainPass as any).baseColor = new vec4(1, 1, 1, 1);
      if (hasBox && box) {
        const sx = Math.max(0.03, Math.min(1, box.w));
        const sy = Math.max(0.03, Math.min(1, box.h));
        const ox = Math.max(0, Math.min(1 - sx, box.x));
        const oy = Math.max(0, Math.min(1 - sy, 1 - box.y - sy));
        (img.mainPass as any).baseTexUvScale = new vec2(sx, sy);
        (img.mainPass as any).baseTexUvOffset = new vec2(ox, oy);
        cropped = true;
      }
    } catch (e) {
      console.log("[Jar] sticker image bind failed — " + e);
      return;
    }
    const frameAspect = thumb.getHeight() > 0 ? thumb.getWidth() / thumb.getHeight() : 1.333;
    const aspect = cropped && box ? frameAspect * (box.w / box.h) : frameAspect;
    imgObj.getTransform().setLocalScale(new vec3(hCm * aspect, hCm, 1));
  }

  // --- actions ------------------------------------------------------

  private openDay(id: string): void {
    console.log(`[Jar] open day id=${id}`);
    this.selectedId = id;
    this.revealed = false;
    this.view = "day";
    this.rebuild();
  }

  private deleteDay(id: string): void {
    const next = this.days.filter((d) => d.id !== id);
    try {
      this.store.putString(DAYS_KEY, JSON.stringify(next));
      console.log(`[Jar] deleted day id=${id} — ${next.length} left`);
    } catch (e) {
      console.log("[Jar] delete: write failed — " + e);
    }
    removeStickers(id); // drop its persisted base64 thumbs too
    forgetPlacement(id); // and its saved room position
    // If that day had a real orb placed in the room this session, retire it too.
    const placed = sessionPlacedOrbs.get(id);
    if (placed && !isNull(placed)) {
      try {
        placed.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    sessionPlacedOrbs.delete(id);
    this.placedFullScale.delete(id);
    this.view = "month";
    this.revealed = false;
    this.selectedId = null;
    this.rebuild();
  }

  private goHome(): void {
    console.log("[Jar] Back -> Launch (Home)");
    this.flowManager.goTo(TraceScreen.Launch);
  }

  // --- store ------------------------------------------------------

  private readDays(): JournalEntryData[] {
    let days: JournalEntryData[] = [];
    try {
      const raw = this.store.getString(DAYS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) days = parsed as JournalEntryData[];
      }
    } catch (e) {
      console.log("[Jar] readDays: blob unreadable — " + e);
      days = [];
    }
    days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return days;
  }

  private static debugSeed(): JournalEntryData[] {
    console.log("[Jar] debugSeedDays -> using 4 in-memory fake days across 2 months (not persisted)");
    const seed: JournalEntryData[] = [
      {
        schema: 1, id: "jar_seed_0", date: "2026-08-24", confirmedLocation: "",
        objectLabels: ["postcard", "seashell"], keptOcrText: [],
        reflection: "End of summer.", title: "A day by the water",
        generatedJournalText:
          "A postcard never sent and a seashell from a walk that already feels like last year. The light was long and gold and nobody was in a hurry to leave.",
        finalReflection: "Some summers deserve a second look.",
        feeling: "peaceful", orbColor: "#5B8DEF", selectedMomentIds: [10], privacy: "private",
      },
      {
        schema: 1, id: "jar_seed_1", date: "2026-09-02", confirmedLocation: "",
        objectLabels: ["ceramic mug", "library book"], keptOcrText: [],
        reflection: "A slow morning.", title: "Warm and unhurried",
        generatedJournalText:
          "The day started with a chipped mug and a library book left open on the table. Light moved slowly across the room and there was no rush to be anywhere. It felt like the kind of ordinary that is easy to miss and worth keeping.",
        finalReflection: "Keep making mornings like this.",
        feeling: "peaceful", orbColor: "#5B8DEF", selectedMomentIds: [1, 2], privacy: "private",
      },
      {
        schema: 1, id: "jar_seed_2", date: "2026-09-05", confirmedLocation: "",
        objectLabels: ["train ticket"], keptOcrText: ["09:42 platform 4"],
        reflection: "Unexpected trip.", title: "A small adventure",
        generatedJournalText:
          "A train ticket turned up in a coat pocket and the afternoon bent around it. The platform was loud and bright and everything felt a little more possible than it had that morning.",
        finalReflection: "Say yes to the detour more often.",
        feeling: "surprising", orbColor: "#E67E22", selectedMomentIds: [3], privacy: "placed",
      },
      {
        schema: 1, id: "jar_seed_3", date: "2026-09-09", confirmedLocation: "",
        objectLabels: ["headphones", "notebook", "coffee cup"], keptOcrText: [],
        reflection: "Heads-down day.", title: "Quiet focus",
        generatedJournalText:
          "Headphones on, notebook filling up, a coffee going cold beside it. The hours ran together in a good way and by the end there was a real sense of something made.",
        finalReflection: "Protect these days.",
        feeling: "happy", orbColor: "#F2C94C", selectedMomentIds: [4, 5], privacy: "private",
      },
    ];
    return seed;
  }
}
