// Regression (2026-10-13 ~12:00 PT): ~2,300 unchanged notes were re-uploaded because
// a cloud row and its local-cache copy never matched (key order, startTime). Mock data only.
import assert from "node:assert/strict";
import { createNoteWriteQueue } from "../../src/lib/note-write-queue";
import { encounterNoteFingerprint, type EncounterNoteRecord } from "../../src/lib/encounter-notes";
import { noteToRow, rowToNote } from "../../src/lib/encounter-notes-cloud";

const mock = (i: number): EncounterNoteRecord => ({
  id: `enc-mock-${i}`, patientId: "PT-MOCK", patientName: "Test Patient", provider: "Dr. Mock",
  appointmentType: "Mock Visit", encounterDate: "09/01/2026", startTime: "10:00 AM",
  soap: { subjective: "mock S", objective: "mock O", assessment: "mock A", plan: "mock P" },
  macroRuns: [], diagnoses: [{ id: "dx-mock", code: "M54.50", description: "Low back pain, unspecified", source: "Manual" }], charges: [], signed: i % 2 === 0, signedAt: i % 2 === 0 ? "2026-09-01T18:00:00.000Z" : "",
  createdAt: "2026-09-01T17:00:00.000Z", updatedAt: "2026-09-01T18:00:00.000Z",
} as EncounterNoteRecord);

async function main() {
  const cloud = Array.from({ length: 2300 }, (_, i) => rowToNote(noteToRow(mock(i), "ws-mock")));
  // Local cache copy: same content, different key order, startTime cleared by the cache normalizer.
  const local = cloud.map((n) => {
    const { soap, id, ...rest } = n;
    // Cloud jsonb hands diagnosis keys back in a different order; the cache keeps appointmentId.
    const diagnoses = n.diagnoses.map((d) => { const { code, ...r } = d as { code: string }; return { ...r, code }; });
    return { soap, ...rest, diagnoses, id, startTime: "", appointmentId: "appt-mock" } as unknown as EncounterNoteRecord;
  });
  assert.notEqual(JSON.stringify(cloud[0]), JSON.stringify(local[0]), "raw JSON differs (the old comparison)");
  assert.equal(encounterNoteFingerprint(cloud[0]), encounterNoteFingerprint(local[0]));
  console.log("PASS  cloud row and cache copy of the same note have the same fingerprint");

  const writes: string[] = [];
  const q = createNoteWriteQueue<EncounterNoteRecord>({
    write: async (n) => { writes.push(n.id); },
    versionOf: encounterNoteFingerprint,
    setTimer: () => 0,
  });
  q.setConfirmed(cloud);
  assert.equal(q.enqueue(local), 0, "unchanged notes are not uploaded");
  const edited = { ...local[7], soap: { ...local[7].soap, plan: "mock P edited" }, updatedAt: "2026-10-13T19:00:00.000Z" };
  const all = local.slice(); all[7] = edited;
  assert.equal(q.enqueue(all), 1, "only the edited note is queued");
  await q.flush();
  assert.deepEqual(writes, ["enc-mock-7"]);
  console.log("PASS  saving the full set of 2,300 notes uploads only the 1 changed note");
  console.log("\n2 passed, 0 failed (mock data only, 0 DB writes)");
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });
