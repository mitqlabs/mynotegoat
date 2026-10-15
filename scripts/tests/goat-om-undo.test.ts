/**
 * Office manager apply + undo through the real stores (mock data, fake browser storage).
 * Undo must put billing, case status, attorney, matrix and Case Notes back exactly.
 */
import assert from "node:assert/strict";
const mem = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k), key: () => null, length: 0, clear: () => mem.clear() },
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
};
process.on("unhandledRejection", () => {}); // cloud writes have no backend here

async function main() {
  const md = await import("../../src/lib/mock-data");
  const { applyOmChanges, restoreOmSnapshot, snapshotFor, buildOmData } = await import("../../src/lib/goat-om-apply");
  const { omTurn, planChanges, emptyOmMemory } = await import("../../src/lib/goat-om");
  const { getCaseNote } = await import("../../src/lib/case-notes");
  const { loadPatientBillingMap, savePatientBillingMap } = await import("../../src/lib/patient-billing");
  const p = md.createPatientRecord({ firstName: "Mocky", lastName: "Testerson", attorney: "Sample Legal", dateOfLoss: "01/01/2026" } as never);
  assert.ok(p, "mock patient");
  savePatientBillingMap({ ...loadPatientBillingMap(), [p.id]: { patientId: p.id, billedAmount: 3200, paidAmount: 0, paidDate: "", adjustments: [], createdAt: "x", updatedAt: "x" } });
  md.updatePatientRecordById(p.id, { caseStatus: "Submitted" });
  const before = JSON.stringify({ b: loadPatientBillingMap()[p.id], pt: md.patients.find((x) => x.id === p.id), n: getCaseNote(p.id) });
  const data = buildOmData({ patients: md.patients, appointments: [], encounters: [], contacts: [], today: "2026-10-15" });
  const r = omTurn("Sample Legal paid 2800 on Mocky Testerson, we asked 3200", data, emptyOmMemory(), false);
  assert.ok(r?.kind === "confirm", JSON.stringify(r));
  const changes = planChanges(r.plan, data);
  const snap = snapshotFor([p.id], md.patients);
  applyOmChanges(changes, md.patients, (t) => `10/15/26 - ${t} -Mock`);
  const after = md.patients.find((x) => x.id === p.id)!;
  assert.equal(after.caseStatus, "Paid");
  assert.equal(after.matrix?.paidAmount, "2800");
  assert.equal(after.matrix?.paidDate, "2026-10-15");
  const b = loadPatientBillingMap()[p.id];
  assert.equal(b.paidAmount, 2800);
  assert.equal(b.paidDate, "10/15/2026");
  assert.equal(b.adjustments[0].amount, 400);
  assert.match(getCaseNote(p.id) ?? "", /reduction accepted.*-Mock$/);
  restoreOmSnapshot(snap);
  const back = JSON.stringify({ b: loadPatientBillingMap()[p.id], pt: md.patients.find((x) => x.id === p.id), n: getCaseNote(p.id) });
  // Same values; an empty matrix / empty note entry reads the same as none.
  assert.equal(back.replace(/,"matrix":\{\}/, "").replace(/"n":""/, '"n":null'), before, "undo restores exactly");
  console.log("goat-om apply/undo OK");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
