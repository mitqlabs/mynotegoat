import assert from "node:assert/strict";
import { loadPatientListSort, nextSort, PATIENT_LIST_SORT_KEY, savePatientListSort } from "../../src/lib/patient-list-sort";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
const cols = ["patient", "initialExam", "dateOfLoss"] as const;
const fb = { column: "patient" as const, asc: true };

{ const s = mem(); assert.deepEqual(loadPatientListSort(cols, fb, s), fb, "nothing saved → default"); }
{ // Initial Exam, newest first → remembered on the next visit
  const s = mem();
  let sort = nextSort(fb, "initialExam"); sort = nextSort(sort, "initialExam");
  assert.deepEqual(sort, { column: "initialExam", asc: false });
  savePatientListSort(sort, s);
  assert.deepEqual(loadPatientListSort(cols, fb, s), { column: "initialExam", asc: false });
  assert.ok(!PATIENT_LIST_SORT_KEY.startsWith("casemate."), "key stays out of the cloud snapshot prefix");
}
{ // legacy keys migrate
  const s = mem(); s.setItem("casemate.patient-sort-column.v1", "dateOfLoss"); s.setItem("casemate.patient-sort-asc.v1", "false");
  assert.deepEqual(loadPatientListSort(cols, fb, s), { column: "dateOfLoss", asc: false });
}
{ // unknown column / junk → default
  const s = mem(); s.setItem(PATIENT_LIST_SORT_KEY, JSON.stringify({ column: "gone", asc: false }));
  assert.deepEqual(loadPatientListSort(cols, fb, s), fb);
  s.setItem(PATIENT_LIST_SORT_KEY, "{bad json");
  assert.deepEqual(loadPatientListSort(cols, fb, s), fb);
}
console.log("PASS patient-list-sort (7 checks)");
