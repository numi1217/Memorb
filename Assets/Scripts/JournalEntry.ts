/**
 * JournalEntry.ts — Memorb core data model (Phase 0 spine).
 *
 * OWNS: the shape of a single journal entry and its (de)serialization.
 * Plain data only — NO scene access, NO @component. Import the class/interface
 * anywhere it is needed.
 *
 * Fields mirror the agreed Memorb spec (§13 of the design doc): every
 * value the full flow will eventually populate. Later phases fill these in
 * stage by stage (Scan -> Confirm -> Reflect -> Feel -> Generate -> Orb).
 *
 * MUST NOT: reference SceneObject / Component / global.scene. Keep it portable
 * so it can be unit-reasoned and persisted as a blob (see SpikeD_Persistence).
 */

export type FeelingId =
  | "calm"
  | "grateful"
  | "tender"
  | "restless"
  | "heavy"
  | "hopeful"
  | "proud"
  | "unsettled"
  | string;

/** DESIGN.md v2 §11 — private by default; "Placed" is optionally anchored
 *  somewhere meaningful (real spatial anchoring is deferred, not MVP; for now
 *  this just records the user's choice). */
export type EntryPrivacy = "private" | "placed";

/** Serializable snapshot of a JournalEntry — the exact JSON written to disk. */
export interface JournalEntryData {
  /** Schema version so future migrations can detect old blobs. */
  schema: number;
  id: string;
  /** ISO-8601 date string (yyyy-mm-dd or full timestamp). */
  date: string;
  confirmedLocation: string;
  objectLabels: string[];
  keptOcrText: string[];
  reflection: string;
  /** Gemini-generated short title (<=6 words, DESIGN.md §9). */
  title: string;
  generatedJournalText: string;
  finalReflection: string;
  feeling: FeelingId;
  /** Hex string e.g. "#8FcovID" — colour the Memory Orb folds into. */
  orbColor: string;
  /** §7 — the kept-moment orders selected for this entry's journal. */
  selectedMomentIds: number[];
  /** §11 — set when the day is saved. "" until then. */
  privacy: EntryPrivacy | "";
  songTitle?: string;
  songArtist?: string;
}

const CURRENT_SCHEMA = 1;

export class JournalEntry {
  schema: number = CURRENT_SCHEMA;
  id: string;
  date: string;
  confirmedLocation: string = "";
  objectLabels: string[] = [];
  keptOcrText: string[] = [];
  reflection: string = "";
  title: string = "";
  generatedJournalText: string = "";
  finalReflection: string = "";
  feeling: FeelingId = "";
  orbColor: string = "";
  selectedMomentIds: number[] = [];
  privacy: EntryPrivacy | "" = "";
  songTitle?: string;
  songArtist?: string;

  constructor(id?: string, date?: string) {
    this.id = id ?? JournalEntry.newId();
    this.date = date ?? JournalEntry.today();
  }

  /** Lightweight unique id — good enough for on-device single-user storage. */
  static newId(): string {
    const rand = Math.floor(Math.random() * 1e9).toString(36);
    return `trace_${Date.now().toString(36)}_${rand}`;
  }

  static today(): string {
    // getDate() is available in the Lens runtime; fall back to epoch if not.
    try {
      const d = new Date();
      const mm = (d.getMonth() + 1).toString().padStart(2, "0");
      const dd = d.getDate().toString().padStart(2, "0");
      return `${d.getFullYear()}-${mm}-${dd}`;
    } catch (e) {
      return `${Date.now()}`;
    }
  }

  /** Month bucket used by the Memory Jar, e.g. "2026-09". */
  monthKey(): string {
    return (this.date || JournalEntry.today()).slice(0, 7);
  }

  toData(): JournalEntryData {
    return {
      schema: this.schema,
      id: this.id,
      date: this.date,
      confirmedLocation: this.confirmedLocation,
      objectLabels: this.objectLabels.slice(),
      keptOcrText: this.keptOcrText.slice(),
      reflection: this.reflection,
      title: this.title,
      generatedJournalText: this.generatedJournalText,
      finalReflection: this.finalReflection,
      feeling: this.feeling,
      orbColor: this.orbColor,
      selectedMomentIds: this.selectedMomentIds.slice(),
      privacy: this.privacy,
      songTitle: this.songTitle,
      songArtist: this.songArtist,
    };
  }

  toJSON(): string {
    return JSON.stringify(this.toData());
  }

  static fromData(data: Partial<JournalEntryData>): JournalEntry {
    const e = new JournalEntry(data.id, data.date);
    e.schema = data.schema ?? CURRENT_SCHEMA;
    e.confirmedLocation = data.confirmedLocation ?? "";
    e.objectLabels = Array.isArray(data.objectLabels) ? data.objectLabels.slice() : [];
    e.keptOcrText = Array.isArray(data.keptOcrText) ? data.keptOcrText.slice() : [];
    e.reflection = data.reflection ?? "";
    e.title = data.title ?? "";
    e.generatedJournalText = data.generatedJournalText ?? "";
    e.finalReflection = data.finalReflection ?? "";
    e.feeling = data.feeling ?? "";
    e.orbColor = data.orbColor ?? "";
    e.selectedMomentIds = Array.isArray(data.selectedMomentIds) ? data.selectedMomentIds.slice() : [];
    e.privacy = data.privacy ?? "";
    e.songTitle = data.songTitle;
    e.songArtist = data.songArtist;
    return e;
  }

  /** Lenient parse — tolerates surrounding whitespace / a bad blob. Returns null on failure. */
  static fromJSON(raw: string): JournalEntry | null {
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw) as Partial<JournalEntryData>;
      if (!obj || typeof obj !== "object") return null;
      return JournalEntry.fromData(obj);
    } catch (e) {
      return null;
    }
  }
}
