/**
 * StickerStore.ts — persist the cut-out "sticker" thumbnails for a saved day so
 * the Memory Jar (DESIGN.md §12) can still show them after the Lens is closed
 * and reopened.
 *
 * The frozen-still Textures held live by JournalSession vanish on restart, so
 * the Jar's day view only had thumbnails for the day made in the current
 * session. This base64-encodes the included moments' stills (JPEG, maximum
 * compression) into GeneralDataStore under one key per entry id, and decodes
 * them back to Textures on demand.
 *
 *   key:  traceJournal.thumbs.<entryId>  ->  JSON PersistedSticker[]
 *
 * Size guard: only the most recent MAX_DAYS days keep a thumb blob; older blobs
 * are pruned on every write so the tiny entry JSON can always save.
 *
 * Plain module — no scene access, no @component.
 */

import { KeptTrace } from "./JournalSession";

const PREFIX = "traceJournal.thumbs.";
const DAYS_KEY = "traceJournal.days";
const MAX_DAYS = 8;

export interface PersistedSticker {
  order: number;
  /** base64 JPEG of the moment's frozen still. */
  b64: string;
  /** normalized crop rect (0..1, top-left origin), when the card was bbox-tier. */
  box?: { x: number; y: number; w: number; h: number };
  /** normalized segmentation polygon (0..1), when the card had a cut-out. */
  polygon?: { x: number; y: number }[];
}

function store(): GeneralDataStore {
  return global.persistentStorageSystem.store;
}

/**
 * Encode the given traces' stills and write them under the entry id. Encodes
 * run async; the blob is written once all of them settle. Safe to call with
 * traces that have no thumb (they're skipped).
 *
 * `append` = true keeps the stickers already stored for this id (the "Add to
 * Today's Journal" flow) and puts the new ones after them.
 */
export function persistStickers(entryId: string, traces: KeptTrace[], append?: boolean): void {
  const withThumb = traces.filter((t) => !!t.thumb);
  if (!entryId || withThumb.length === 0) return;

  const kept: PersistedSticker[] = append ? readStickers(entryId) : [];
  const fresh: PersistedSticker[] = [];
  let pending = withThumb.length;
  const finish = () => {
    pending -= 1;
    if (pending > 0) return;
    try {
      if (fresh.length > 0) {
        fresh.sort((a, b) => a.order - b.order);
        const out = kept.concat(fresh).slice(-8); // cap — Jar shows 5
        store().putString(PREFIX + entryId, JSON.stringify(out));
        prune();
        console.log(`[StickerStore] saved ${out.length} thumb(s) for ${entryId}${append ? " (appended)" : ""}`);
      }
    } catch (e) {
      console.log("[StickerStore] write failed — " + e);
    }
  };

  for (const t of withThumb) {
    try {
      Base64.encodeTextureAsync(
        t.thumb as Texture,
        (b64: string) => {
          fresh.push({ order: t.order, b64: b64, box: t.thumbBox, polygon: t.thumbPolygon });
          finish();
        },
        () => {
          console.log(`[StickerStore] encode failed for #${t.order}`);
          finish();
        },
        CompressionQuality.MaximumCompression,
        EncodingType.Jpg
      );
    } catch (e) {
      console.log("[StickerStore] encode threw — " + e);
      finish();
    }
  }
}

/** Read the persisted stickers for an entry id ([] when none / unreadable). */
export function readStickers(entryId: string): PersistedSticker[] {
  if (!entryId) return [];
  try {
    const raw = store().getString(PREFIX + entryId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PersistedSticker[]) : [];
  } catch (e) {
    return [];
  }
}

/** Drop the thumb blob for one entry (called when a day is deleted). */
export function removeStickers(entryId: string): void {
  try {
    store().remove(PREFIX + entryId);
  } catch (e) {
    /* ignore */
  }
}

/** Decode one persisted sticker back to a Texture (async). */
export function decodeSticker(
  rec: PersistedSticker,
  onTexture: (tex: Texture) => void
): void {
  try {
    Base64.decodeTextureAsync(rec.b64, onTexture, () => {
      console.log(`[StickerStore] decode failed for #${rec.order}`);
    });
  } catch (e) {
    console.log("[StickerStore] decode threw — " + e);
  }
}

/** Keep thumb blobs only for the most recent MAX_DAYS saved days. */
export function prune(): void {
  try {
    const s = store();
    const raw = s.getString(DAYS_KEY);
    const days = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(days)) return;
    const keep: { [id: string]: boolean } = {};
    days
      .slice()
      .sort((a: any, b: any) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, MAX_DAYS)
      .forEach((d: any) => {
        if (d && d.id) keep[d.id] = true;
      });
    for (const k of s.getAllKeys()) {
      if (k.indexOf(PREFIX) === 0 && !keep[k.substr(PREFIX.length)]) s.remove(k);
    }
  } catch (e) {
    /* ignore */
  }
}
