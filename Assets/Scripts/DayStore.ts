/**
 * DayStore.ts — the one place that reads the persisted list of saved journal
 * days (`traceJournal.days`, written by OrbScreen.persistEntry).
 *
 * Replaces three near-identical private helpers (LaunchScreen.todaysSavedEntry,
 * ReviewScreen.todayAlreadySaved, and MomentEmotionReflect's new one).
 *
 * Plain module — no scene access, no @component.
 */

import { JournalEntry, JournalEntryData } from "./JournalEntry";

export const DAYS_KEY = "traceJournal.days";

/** Every saved day ([] when none / unreadable). Not sorted. */
export function readSavedDays(): JournalEntryData[] {
  try {
    const raw = global.persistentStorageSystem.store.getString(DAYS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JournalEntryData[]) : [];
  } catch (e) {
    return [];
  }
}

/** The saved entry whose date is `dateYmd` (yyyy-mm-dd), or null. */
export function findSavedDay(dateYmd: string): JournalEntryData | null {
  const hits = readSavedDays().filter(
    (e) => !!e && (e.date || "").slice(0, 10) === dateYmd
  );
  return hits.length > 0 ? hits[0] : null;
}

/** The saved entry with this id, or null. */
export function findSavedById(id: string): JournalEntryData | null {
  const hits = readSavedDays().filter((e) => !!e && e.id === id);
  return hits.length > 0 ? hits[0] : null;
}

/** Today's saved entry, or null. */
export function todaysSavedEntry(): JournalEntryData | null {
  return findSavedDay(JournalEntry.today());
}
