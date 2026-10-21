import assert from "node:assert/strict";
import { canPurgeQuestionnaire, type PurgeRow } from "../../src/lib/patient-forms-purge";

const row: PurgeRow = {
  status: "submitted",
  review_status: "inserted",
  inserted_encounter_id: "enc-1",
  reviewed_at: "2026-10-21T20:00:00.000Z",
  workspace_id: "owner:office",
  patient_id: "p1",
};
const note = { id: "enc-1", workspace_id: "owner:office", patient_id: "p1", updated_at: "2026-10-21T20:00:05.000Z", soap: { objective: "<p>BP 120/80</p>" } };

assert.deepEqual(canPurgeQuestionnaire(row, "enc-1", note), { ok: true });
// Dismissed or never applied → keep.
assert.equal(canPurgeQuestionnaire({ ...row, review_status: "dismissed" }, "enc-1", note).ok, false);
assert.equal(canPurgeQuestionnaire({ ...row, review_status: "new", reviewed_at: null }, "enc-1", note).ok, false);
// Not submitted.
assert.equal(canPurgeQuestionnaire({ ...row, status: "started" }, "enc-1", note).ok, false);
// Different note than the one it went into.
assert.equal(canPurgeQuestionnaire(row, "enc-2", { ...note, id: "enc-2" }).ok, false);
// Note not in the cloud at all (save failed).
assert.deepEqual(canPurgeQuestionnaire(row, "enc-1", null), { ok: false, reason: "note-not-saved" });
// Cloud copy older than the insert (the save with the answers hasn't landed).
assert.equal(canPurgeQuestionnaire(row, "enc-1", { ...note, updated_at: "2026-10-21T19:59:59.000Z" }).ok, false);
// Empty Objective in the cloud.
assert.equal(canPurgeQuestionnaire(row, "enc-1", { ...note, soap: { objective: "<p>&nbsp;</p>" } }).ok, false);
// Other office / other patient.
assert.equal(canPurgeQuestionnaire(row, "enc-1", { ...note, workspace_id: "x:y" }).ok, false);
assert.equal(canPurgeQuestionnaire(row, "enc-1", { ...note, patient_id: "p2" }).ok, false);
console.log("questionnaire-purge: ok");
