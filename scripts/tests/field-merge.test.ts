import assert from "node:assert/strict";
import { editedPatch, flatten, takeExternal } from "../../src/lib/field-merge";

const loaded = { caseStatus: "Submitted", attorney: "Sample Legal", lastUpdate: "2026-10-01", matrix: { paidAmount: "0", paidDate: "", discharge: "", notes: "x" } };
const base = flatten(loaded);
// Nothing edited → nothing to write.
assert.equal(editedPatch({ ...loaded, lastUpdate: "2026-10-15" }, base, { always: ["lastUpdate"] }), null);
// Edited only notes → only notes (+ lastUpdate) sent; stale caseStatus/paid never sent.
assert.deepEqual(
  editedPatch({ ...loaded, lastUpdate: "2026-10-15", matrix: { ...loaded.matrix, notes: "y" } }, base, { always: ["lastUpdate"] }),
  { matrix: { notes: "y" }, lastUpdate: "2026-10-15" },
);
// Outside change (G.O.A.T. marked paid) on untouched fields → taken; on a field the user is editing → conflict kept for the user.
const incoming = flatten({ caseStatus: "Paid", attorney: "Nazaryan Law", matrix: { paidAmount: "3200", paidDate: "2026-10-15" } });
const current = flatten({ ...loaded, attorney: "Typed By User" });
const r = takeExternal(base, current, incoming);
assert.deepEqual(r.take.sort(), ["caseStatus", "matrix.paidAmount", "matrix.paidDate"]);
assert.deepEqual(r.conflicts, ["attorney"]);
// Same value both sides isn't a conflict.
assert.deepEqual(takeExternal(base, flatten({ caseStatus: "Paid" }), flatten({ caseStatus: "Paid" })).take, ["caseStatus"]);
console.log("field-merge OK");
