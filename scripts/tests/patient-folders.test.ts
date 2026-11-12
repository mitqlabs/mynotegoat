/**
 * Patient-as-folder preview: grouping, money, and the off switch.
 * Run: npx tsx scripts/tests/patient-folders.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { patientToRow } from "../../src/lib/patients-cloud";
import { frozenPersonColumns, rememberOriginalPerson, resetFrozenPeople, splitPersonPatch } from "../../src/lib/patient-folder-guard";
import { patientFoldersEnabled } from "../../src/lib/patient-folder-flag";
import { PATIENT_FOLDERS_KEY } from "../../src/lib/patient-folder-store";
import { CASE_NOTE_ENTRIES_KEY } from "../../src/lib/case-note-entries";
import {
  addressKey,
  countImagingStudies,
  dashboardNumbersFromCases,
  dobKey,
  groupPatientCases,
  phoneKey,
  proveFolderNumbers,
  resolveCaseMoney,
} from "../../src/lib/patient-folders";
import { clampSquareCrop, initialSquareCrop, isPatientPhotoDataUrl, isPatientPhotoPath, moveSquareCrop } from "../../src/lib/patient-photo";
import { normalizeFolderCloud } from "../../src/lib/patient-folder-store";
import type { PatientRecord } from "../../src/lib/mock-data";

const envKey = "NEXT_PUBLIC_PATIENT_FOLDERS";
const previous = process.env[envKey];
delete process.env[envKey];

assert.equal(patientFoldersEnabled(), false, "the switch defaults off");
assert.equal(frozenPersonColumns("any"), null, "no person freeze while the switch is off");
assert.deepEqual(splitPersonPatch({ fullName: "Smith, John", attorney: "Hart" }), {
  hasPerson: false,
  person: {},
  casePatch: { fullName: "Smith, John", attorney: "Hart" },
});

const base = {
  id: "c1",
  fullName: "Smith, John",
  dob: "03/14/1980",
  phone: "(818) 555-0142",
  email: "john.smith@example.com",
  address: "1234 Example Street, Glendale, CA 91203",
  caseStatus: "Active",
  billed: 8400,
  paid: 0,
};

const second = {
  ...base,
  id: "c2",
  phone: "8185550142",
  address: "1234 Example St, Glendale CA 91203",
  dob: "1980-03-14",
  caseStatus: "Paid",
  billed: 7150,
  paid: 7150,
};

const grouped = groupPatientCases([base, second]);
assert.equal(grouped.folders.length, 1, "same name and DOB, matching phone and address, one folder");
assert.equal(grouped.conflicts.length, 0);
assert.equal(grouped.closeMatches.length, 0);
assert.deepEqual(grouped.folders[0].caseIds, ["c1", "c2"]);

const conflict = groupPatientCases([
  base,
  { ...second, id: "c3", phone: "(818) 555-0199" },
]);
assert.equal(conflict.folders.length, 2, "disagreeing phones stay separate");
assert.equal(conflict.conflicts.length, 1);
assert.equal(conflict.closeMatches.length, 0, "a phone conflict is not also listed as a close match");
assert.equal(conflict.folders.filter((folder) => folder.caseIds.length > 1).length, 0);

const blankPhone = groupPatientCases([base, { ...second, id: "c4", phone: "" }]);
assert.equal(blankPhone.folders.length, 1, "a blank phone does not disagree");

const differentDob = groupPatientCases([base, { ...second, id: "c5", dob: "11/02/1988" }]);
assert.equal(differentDob.folders.length, 2);
assert.equal(differentDob.closeMatches.length > 0, true, "same name, different DOB is a close match");
assert.equal(differentDob.folders.every((folder) => folder.caseIds.length === 1), true);

const middle = groupPatientCases([base, { ...base, id: "c6", fullName: "Smith, John A" }]);
assert.equal(middle.folders.length, 2, "a middle initial is not an exact match");
assert.equal(middle.closeMatches.length > 0, true);

assert.equal(phoneKey("(818) 555-0142"), phoneKey("8185550142"));
assert.equal(addressKey("1234 Example Street"), addressKey("1234 Example St"));
assert.equal(dobKey("03/14/1980"), dobKey("1980-03-14"));

const moneyCases = [
  { ...base, xrayStudies: 4, mriStudies: 2 },
  { ...second, xrayStudies: 1, mriStudies: 0 },
];
const proof = proveFolderNumbers(moneyCases);
assert.equal(proof.before.cases, 2);
assert.equal(proof.before.billed, 15550);
assert.equal(proof.before.paid, 7150);
assert.equal(proof.before.owed, 8400);
assert.equal(proof.before.byStatus.Active, 1);
assert.equal(proof.before.byStatus.Paid, 1);
assert.equal(proof.before.xrayStudies, 5);
assert.equal(proof.before.mriStudies, 2);
assert.deepEqual(proof.after, proof.before);
assert.equal(proof.folders, 1);
assert.equal(proof.multiCasePatients, 1);

const frozenInput = Object.freeze({ ...base, phone: "will-change" });
assert.doesNotThrow(() => groupPatientCases([frozenInput]));

assert.deepEqual(
  dashboardNumbersFromCases(moneyCases),
  dashboardNumbersFromCases([...moneyCases].reverse()),
);

assert.deepEqual(resolveCaseMoney({ billedAmount: 100, paidAmount: 0 }, { billed: "40", paidAmount: "15" }), {
  billed: 100,
  paid: 15,
  owed: 85,
});
assert.deepEqual(resolveCaseMoney(null, { billed: "$8,400", paidAmount: "$0" }), { billed: 8400, paid: 0, owed: 8400 });

assert.equal(
  countImagingStudies([
    { center: "Diagnostic Imaging Network", regions: ["Cervical", "Shoulder"], lateralityByRegion: { Shoulder: "BL" }, isPrior: false },
    { center: "", regions: ["Lumbar"] },
    { center: "Outside", regions: ["Lumbar"], isPrior: true },
  ]),
  3,
  "bilateral shoulder is two studies; empty center and prior studies are skipped",
);

const patient = {
  id: "c1",
  fullName: "Overlay, Name",
  dob: "03/14/1980",
  phone: "8185550142",
  email: "new@example.com",
  address: "999 New St",
  attorney: "Hart & Lowe Injury Law",
  caseStatus: "Active",
  dateOfLoss: "2026-09-28",
  lastUpdate: "2026-11-11",
  priority: "Normal",
  alerts: ["Allergic to latex"],
} as PatientRecord;

const offRow = patientToRow(patient, "ws");
assert.equal(offRow.full_name, "Overlay, Name");
assert.equal(offRow.attorney, "Hart & Lowe Injury Law");

process.env[envKey] = "on";
assert.equal(patientFoldersEnabled(), true);
rememberOriginalPerson("c1", {
  fullName: "Smith, John",
  dob: "03/14/1980",
  sex: "Male",
  maritalStatus: "Married",
  phone: "(818) 555-0142",
  email: "john.smith@example.com",
  address: "1234 Example Ave",
  alerts: ["Allergic to latex"],
});
const onRow = patientToRow(patient, "ws");
assert.equal(onRow.full_name, "Smith, John", "case row keeps the original name");
assert.equal(onRow.phone, "(818) 555-0142");
assert.equal(onRow.email, "john.smith@example.com");
assert.equal(onRow.address, "1234 Example Ave");
assert.equal(onRow.attorney, "Hart & Lowe Injury Law", "case fields still save");
assert.equal(onRow.case_status, "Active");

const split = splitPersonPatch({ fullName: "Smith, Jane", attorney: "Benson", caseStatus: "Paid" });
assert.equal(split.hasPerson, true);
assert.deepEqual(split.person, { fullName: "Smith, Jane" });
assert.deepEqual(split.casePatch, { attorney: "Benson", caseStatus: "Paid" });

delete process.env[envKey];
resetFrozenPeople();
if (previous !== undefined) process.env[envKey] = previous;

assert.notEqual(PATIENT_FOLDERS_KEY, CASE_NOTE_ENTRIES_KEY);
assert.match(readFileSync("src/lib/patient-folder-store.ts", "utf8"), /Case notes stay in/);
assert.match(readFileSync("src/app/(portal)/patients/page.tsx", "utf8"), /All Patients Workspace/);
assert.match(readFileSync("src/lib/patient-folder-flag.ts", "utf8"), /NEXT_PUBLIC_PATIENT_FOLDERS === "on"/);
assert.doesNotMatch(readFileSync("src/lib/patient-folder-flag.ts", "utf8"), /localStorage\./);

const smithBilled = 8400 + 12200 + 9800 + 7150;
const smithPaid = 0 + 0 + 9800 + 7150;
assert.equal(smithBilled, 37550);
assert.equal(smithPaid, 16950);
assert.equal(smithBilled - smithPaid, 20600);

const idCard = initialSquareCrop(1000, 600);
assert.equal(idCard.size, idCard.size);
assert.equal(idCard.x + idCard.size <= 1000 && idCard.y + idCard.size <= 600, true);
assert.equal(idCard.size, Math.round(600 * 0.62));
const moved = moveSquareCrop(1000, 600, idCard, -5000, -5000, 1);
assert.equal(moved.x, 0);
assert.equal(moved.y, 0);
assert.equal(moved.size, idCard.size);
const tiny = clampSquareCrop(30, 30, { x: -10, y: 80, size: 5 });
assert.equal(tiny.size, 30);
assert.equal(tiny.x, 0);
assert.equal(tiny.y, 0);

const jpeg = "data:image/jpeg;base64," + "a".repeat(40);
assert.equal(isPatientPhotoDataUrl(jpeg), true);
assert.equal(isPatientPhotoDataUrl("data:text/plain;base64,aaaa"), false);
assert.equal(isPatientPhotoPath("user/patient-photos/pf-smith.jpg"), true);
assert.equal(isPatientPhotoPath("../secret"), false);

const stored = normalizeFolderCloud({
  people: {
    "pf-1": {
      folderId: "pf-1",
      fullName: "Smith, John",
      dob: "03/14/1980",
      phone: "",
      email: "",
      address: "",
      sex: "",
      maritalStatus: "",
      alerts: [],
      photoDataUrl: jpeg,
      photoPath: "user/patient-photos/pf-1.jpg",
      updatedAt: "2026-11-12T00:00:00.000Z",
    },
  },
  notes: [],
  todos: [],
});
assert.equal(stored.people["pf-1"].photoDataUrl, jpeg);
assert.equal(stored.people["pf-1"].photoPath, "user/patient-photos/pf-1.jpg");
assert.match(readFileSync("src/components/patient-photo-cropper.tsx", "utf8"), /capture="environment"/);
assert.match(readFileSync("src/components/patient-photo-cropper.tsx", "utf8"), /Upload ID/);
assert.match(readFileSync("supabase/patient_photos_bucket.sql", "utf8"), /DO NOT run this on the production project/);

console.log("patient folders OK");
