/**
 * PlacedOrbStore.ts — persistence for "Place in Space" orbs so a parked ball
 * reappears where it was left after the Lens is closed and reopened
 * (DESIGN.md §11 previously deferred spatial persistence; 2026-09-06 the user
 * asked for it).
 *
 *   key:  traceJournal.placements  ->  JSON PlacedRecord[]
 *
 * Stores the ball's WORLD position + diameter + day colour, keyed by the
 * journal entry id. Rotation is not kept — the orb is a sphere and its
 * creature face/glow billboard to the camera every frame regardless.
 *
 * CAVEAT: the world position is relative to the device's tracking origin,
 * which is only approximately stable between sessions without a persistent
 * spatial anchor / saved map. Same-room, session-to-session it lands close;
 * true drift-free anchoring would need Spatial Anchors and is a separate
 * feature.
 *
 * Plain module — no scene access, no @component.
 */

const KEY = "traceJournal.placements";

export interface PlacedRecord {
  /** journal entry id (matches JournalEntry.id / sessionPlacedOrbs keys). */
  id: string;
  px: number;
  py: number;
  pz: number;
  /** orb diameter in cm at placement time. */
  scale: number;
  /** day's feeling colour hex, e.g. "#5B8DEF". */
  colorHex: string;
}

function store(): GeneralDataStore {
  return global.persistentStorageSystem.store;
}

/** All persisted placements ([] when none / unreadable). */
export function readPlacements(): PlacedRecord[] {
  try {
    const raw = store().getString(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlacedRecord[]) : [];
  } catch (e) {
    return [];
  }
}

/** Upsert one placement (called when the user confirms "Place in Space"). */
export function recordPlacement(id: string, pos: vec3, scaleCm: number, colorHex: string): void {
  if (!id) return;
  try {
    const arr = readPlacements().filter((r) => r && r.id !== id);
    arr.push({ id: id, px: pos.x, py: pos.y, pz: pos.z, scale: scaleCm, colorHex: colorHex || "#9AA0A6" });
    store().putString(KEY, JSON.stringify(arr));
    console.log(`[PlacedOrbStore] recorded ${id} @ (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
  } catch (e) {
    console.log("[PlacedOrbStore] record failed — " + e);
  }
}

/** Drop one placement (called when a day is deleted). */
export function forgetPlacement(id: string): void {
  try {
    const arr = readPlacements().filter((r) => r && r.id !== id);
    store().putString(KEY, JSON.stringify(arr));
  } catch (e) {
    /* ignore */
  }
}

/** Wipe every placement (debug reset). */
export function clearPlacements(): void {
  try {
    store().remove(KEY);
  } catch (e) {
    /* ignore */
  }
}
