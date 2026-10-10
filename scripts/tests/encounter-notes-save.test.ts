/**
 * Integration test through the real saveEncounterNoteRecords() path with a
 * mock cloud writer (no network, no database). Simulates: an edit save that
 * is slow, a Close save right behind it, another note's save, and a failed
 * write — then checks the close still reaches the "cloud".
 *
 * Run:  npx tsx scripts/tests/encounter-notes-save.test.ts
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
  type Rec = import("../../src/lib/encounter-notes").EncounterNoteRecord;

  const cloud = new Map<string, Rec>();
  const log: string[] = [];
  let failNext = 0;
  let delay = 0;
  mod.__setEncounterCloudWriteDepsForTest({
    upsertEncounterNoteToTable: async (note) => {
      await tick(delay);
      if (failNext > 0) {
        failNext--;
        log.push(`FAIL ${note.id} signed=${note.signed}`);
        throw new Error("Failed to fetch");
      }
      cloud.set(note.id, JSON.parse(JSON.stringify(note)));
      log.push(`OK   ${note.id} signed=${note.signed}`);
    },
    reportCloudWriteStart: () => {},
    reportCloudWriteSuccess: () => {},
    reportCloudWriteError: () => {},
  });

  const make = (id: string, over: Partial<Rec> = {}): Rec => ({
    id,
    patientId: "p-mock",
    patientName: "Mock Patient",
    provider: "Dr. Mock",
    appointmentType: "Lumbar Spinal Decompression",
    encounterDate: "07/08/2026",
    startTime: "",
    soap: { subjective: "S", objective: "O", assessment: "A", plan: "P" },
    macroRuns: [],
    diagnoses: [],
    charges: [],
    signed: false,
    signedAt: "",
    createdAt: "2026-10-05T23:06:16.001Z",
    updatedAt: "2026-10-05T23:06:16.001Z",
    ...over,
  });

  // Cloud load baseline (what the table holds).
  const n1 = make("enc-mock-1");
  const n2 = make("enc-mock-2", { encounterDate: "07/09/2026" });
  cloud.set(n1.id, n1);
  cloud.set(n2.id, n2);
  mod.replaceEncounterNotesFromCloud([n1, n2]);

  delay = 25;
  // 1) edit (slow write in flight)
  const edited = { ...n1, soap: { ...n1.soap, plan: "P edited" }, updatedAt: "2026-10-05T23:08:33.490Z" };
  mod.saveEncounterNoteRecords([edited, n2]);
  await tick(1);
  // 2) Close, while #1 is still in flight; its first write will fail
  const closed = { ...edited, signed: true, signedAt: "2026-10-05T23:08:45.204Z", updatedAt: "2026-10-05T23:08:45.204Z" };
  mod.saveEncounterNoteRecords([closed, n2]);
  // 3) another save right behind it (edit to a different note)
  const n2edit = { ...n2, soap: { ...n2.soap, subjective: "S2" }, updatedAt: "2026-10-05T23:08:46.000Z" };
  mod.saveEncounterNoteRecords([closed, n2edit]);
  await tick(30); // edit lands
  failNext = 1; // next write (the close or n2) fails
  await tick(120);

  // The queue retries with backoff (first retry 2s). Wait for it.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !(cloud.get("enc-mock-1")?.signed && cloud.get("enc-mock-2")?.soap.subjective === "S2")) {
    await tick(100);
  }
  assert.equal(cloud.get("enc-mock-1")?.signed, true, "close persisted");
  assert.equal(cloud.get("enc-mock-1")?.soap.plan, "P edited", "earlier edit persisted");
  assert.equal(cloud.get("enc-mock-2")?.soap.subjective, "S2", "other note's edit persisted");
  assert.ok(log.some((l) => l.startsWith("FAIL")), "a write really failed");
  console.log("write log:\n  " + log.join("\n  "));
  console.log("PASS  saveEncounterNoteRecords: edit + Close + other save + failed write → close persisted after retry");

  // saveEncounterNoteToCloudNow waits for the exact version.
  const reopened = { ...closed, signed: false, signedAt: "", updatedAt: "2026-10-05T23:09:00.000Z" };
  const ok = await mod.saveEncounterNoteToCloudNow(reopened);
  assert.equal(ok, true);
  assert.equal(cloud.get("enc-mock-1")?.signed, false);
  console.log("PASS  saveEncounterNoteToCloudNow resolves only after the cloud has that version");

  // A stale copy (older updatedAt, e.g. another component's old state) is not pushed.
  mod.saveEncounterNoteRecords([closed, n2edit]);
  await tick(60);
  assert.equal(cloud.get("enc-mock-1")?.signed, false, "older closed copy didn't overwrite the newer reopen");
  console.log("PASS  stale older copy is skipped");

  // A cloud reload where the local copy is newer (close never landed) re-sends it.
  const cloudStale = { ...reopened };
  const localNewer = { ...reopened, signed: true, signedAt: "2026-10-05T23:10:00.000Z", updatedAt: "2026-10-05T23:10:00.000Z" };
  // put the newer local copy in the local cache, as a previous session would
  localStorage.setItem("casemate.encounter-notes.v1", JSON.stringify([localNewer, n2edit]));
  cloud.set(cloudStale.id, cloudStale);
  mod.replaceEncounterNotesFromCloud([cloudStale, n2edit]);
  await tick(150);
  assert.equal(cloud.get("enc-mock-1")?.signed, true, "reload re-sent the newer local close");
  console.log("PASS  reload re-sends a local close the cloud is missing");

  console.log("\nAll assertions passed (mock writer, 0 DB writes)");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
