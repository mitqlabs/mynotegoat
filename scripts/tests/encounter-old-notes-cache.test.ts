/**
 * End-to-end through the REAL local cache: an old note is pruned out of the
 * cache, another hook instance's save notifies, and the merge must keep the
 * old note held in memory — while a real delete still removes it. Mock data.
 *
 * Run:  npx tsx scripts/tests/encounter-old-notes-cache.test.ts
 */
import assert from "node:assert/strict";

// Minimal browser shims (localStorage + window events).
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() {
    return store.size;
  },
  clear: () => store.clear(),
};
g.addEventListener = () => {};
g.removeEventListener = () => {};
g.dispatchEvent = () => true;
if (typeof g.CustomEvent === "undefined") {
  g.CustomEvent = class<T> extends Event {
    detail: T;
    constructor(type: string, init?: { detail?: T }) {
      super(type);
      this.detail = init?.detail as T;
    }
  };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const mod = await import("../../src/lib/encounter-notes");
  const merge = await import("../../src/lib/encounter-merge");
  type Rec = import("../../src/lib/encounter-notes").EncounterNoteRecord;
  mod.__setEncounterCloudWriteDepsForTest({
    upsertEncounterNoteToTable: async () => {},
    reportCloudWriteStart: () => {},
    reportCloudWriteSuccess: () => {},
    reportCloudWriteError: () => {},
  });
  const make = (id: string, encounterDate: string, over: Partial<Rec> = {}): Rec => ({
    id, patientId: "p-mock", patientName: "Mock Patient", provider: "Dr. Mock",
    appointmentType: "Office Visit", encounterDate, startTime: "",
    soap: { subjective: "S", objective: "O", assessment: "A", plan: "P" },
    macroRuns: [], diagnoses: [], charges: [], signed: false, signedAt: "",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...over,
  });
  const d = new Date();
  const us = (offsetDays: number) => {
    const x = new Date(d.getTime() - offsetDays * 86400000);
    return `${String(x.getMonth() + 1).padStart(2, "0")}/${String(x.getDate()).padStart(2, "0")}/${x.getFullYear()}`;
  };
  const oldNote = make("enc-old", us(300));
  const recentNote = make("enc-recent", us(2), { updatedAt: new Date().toISOString() });
  const full = [oldNote, recentNote];
  // Boot: the cloud holds both; the local cache keeps only a pruned slice.
  mod.replaceEncounterNotesFromCloud(full);
  const cached = mod.loadEncounterNoteRecords();
  assert.ok(!cached.some((n) => n.id === "enc-old"), "old note really is pruned from the local cache");
  assert.ok(cached.some((n) => n.id === "enc-recent"));

  // Instance A (full list in memory) receives the notification from instance B's save.
  const afterOtherSave = merge.mergeNewerById(full, mod.loadEncounterNoteRecords());
  assert.deepEqual(afterOtherSave.map((n) => n.id).sort(), ["enc-old", "enc-recent"], "old note survives");
  console.log("PASS  old note survives another instance's save (real pruned cache)");

  // Real delete: removed in every instance, no duplicates anywhere.
  merge.markEncounterDeleted("enc-old");
  const afterDelete = merge.mergeNewerById(afterOtherSave, mod.loadEncounterNoteRecords());
  assert.deepEqual(afterDelete.map((n) => n.id), ["enc-recent"], "deleted note removed");
  const again = merge.mergeNewerById(afterDelete, mod.loadEncounterNoteRecords());
  assert.deepEqual(again.map((n) => n.id), ["enc-recent"], "stays removed, no duplicates");
  console.log("PASS  real delete still removes the note; nothing duplicates");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
