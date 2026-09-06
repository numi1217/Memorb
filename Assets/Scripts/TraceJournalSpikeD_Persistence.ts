/**
 * TraceJournalSpikeD_Persistence.ts — Spike D: persistence round-trip.
 *
 * GOAL (de-risk): write a serialized JournalEntry to the persistent store and
 * read it back on the next run. Log both. Confirm the value survives a Preview
 * restart.
 *
 * EXIT CHECK: value survives a Preview restart (runCount increments, and the
 * previously written entry is read back verbatim).
 *
 * Uses global.persistentStorageSystem.store (a GeneralDataStore) — the
 * cross-session key/value store. No @input needed.
 */

import { JournalEntry } from "./JournalEntry";

const KEY_ENTRY = "traceJournal.spikeD.entry";
const KEY_RUNCOUNT = "traceJournal.spikeD.runCount";

@component
export class TraceJournalSpikeD_Persistence extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Spike D — persistence round-trip</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Write a fresh entry every run (proves the write path). Leave on for the spike.")
  writeEachRun: boolean = true;
  @ui.group_end

  private store = global.persistentStorageSystem.store;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.run());
  }

  private run(): void {
    // --- READ BACK what a previous run wrote --------------------------------
    const prevCount = this.readInt(KEY_RUNCOUNT, 0);
    const prevRaw = this.readString(KEY_ENTRY, "");

    if (prevRaw) {
      const parsed = JournalEntry.fromJSON(prevRaw);
      if (parsed) {
        console.log(
          `[SpikeD] READ BACK (run #${prevCount}) :: id=${parsed.id} date=${parsed.date} ` +
            `feeling=${parsed.feeling} labels=[${parsed.objectLabels.join(", ")}] ` +
            `reflection="${parsed.reflection}"`
        );
        console.log("[SpikeD] READ BACK raw blob :: " + prevRaw);
      } else {
        console.log("[SpikeD] prior blob present but failed to parse :: " + prevRaw);
      }
    } else {
      console.log("[SpikeD] no prior blob — first run on this device/store");
    }

    // --- WRITE a fresh entry for the next run -----------------------------
    if (this.writeEachRun) {
      const nextCount = prevCount + 1;
      const e = new JournalEntry();
      e.confirmedLocation = "Preview bench";
      e.objectLabels = ["train ticket", "receipt"];
      e.keptOcrText = ["09:42 → Kings Cross", "£4.20"];
      e.reflection = `spike D write on run ${nextCount} at ${Math.round(getTime())}s`;
      e.feeling = "hopeful";
      e.orbColor = "#7FB2FF";

      const raw = e.toJSON();
      this.store.putString(KEY_ENTRY, raw);
      this.store.putInt(KEY_RUNCOUNT, nextCount);

      console.log(`[SpikeD] WROTE (run #${nextCount}) :: ${raw}`);
      console.log(
        "[SpikeD] restart Preview and check that run # increments and the blob reads back."
      );
    }
  }

  private readString(key: string, fallback: string): string {
    try {
      const v = this.store.getString(key);
      return v && v.length > 0 ? v : fallback;
    } catch (e) {
      return fallback;
    }
  }

  private readInt(key: string, fallback: number): number {
    try {
      const v = this.store.getInt(key);
      return typeof v === "number" && !isNaN(v) ? v : fallback;
    } catch (e) {
      return fallback;
    }
  }
}
