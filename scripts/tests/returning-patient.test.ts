/**
 * Returning-patient fill copies demographics into empty boxes only.
 * Run: npx tsx scripts/tests/returning-patient.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findDuplicateCases } from "../../src/lib/patient-duplicate";
import {
  demographicsFromPatient,
  fillEmptyDemographics,
  findReturningPatients,
  type ReturningDemographics,
} from "../../src/lib/returning-patient";

const existing = {
  id: "p1",
  fullName: "Harutyunyan, Yervand",
  dob: "1990-01-05",
  phone: "7472736284",
  sex: "Male",
  maritalStatus: "Single",
  email: "yervand@example.com",
  address: "123 Brand Blvd, Apt 3, Glendale, CA 91205",
  isCashPatient: false,
  attorney: "Yepremyan Law",
  dateOfLoss: "2024-06-29",
  notes: "old case note",
};

const accented = { id: "p2", fullName: "García, José", dob: "1988-03-02", phone: "8185550100" };
const other = { id: "p3", fullName: "Harutyunyan, Anna", dob: "1992-04-04", phone: "8185550199" };
const deleted = { id: "p4", fullName: "Harutyunyan, Yervand", deleted: true, phone: "0000000000" };

const found = findReturningPatients([existing, accented, other, deleted], { firstName: "Yervand", lastName: "Harutyunyan" });
assert.deepEqual(found.map((row) => row.id), ["p1"]);

const folded = findReturningPatients([accented], { firstName: "Jose", lastName: "Garcia" });
assert.equal(folded[0]?.id, "p2");

const typo = findReturningPatients([existing], { firstName: "Yervand", lastName: "Harutunyan" });
assert.equal(typo[0]?.id, "p1");

assert.equal(findReturningPatients([existing], { firstName: "", lastName: "Harutyunyan" }).length, 0);
assert.equal(findReturningPatients([existing, other], { firstName: "Anna", lastName: "Harutyunyan" })[0]?.id, "p3");

const several = findReturningPatients(
  [existing, { ...existing, id: "p5", dob: "1981-02-02", phone: "8185552222" }],
  { firstName: "yervand", lastName: "HARUTYUNYAN" },
);
assert.equal(several.length, 2);

const empty: ReturningDemographics & { attorney: string; dateOfLoss: string; notes: string } = {
  phone: "",
  dob: "",
  sex: "",
  maritalStatus: "",
  addressStreet: "",
  addressUnit: "",
  addressCity: "",
  addressState: "",
  addressZip: "",
  email: "",
  isCashPatient: false,
  attorney: "Keep Law",
  dateOfLoss: "03/01/2026",
  notes: "typed note",
};

const filled = fillEmptyDemographics({ ...empty, phone: "818-555-0199" }, demographicsFromPatient(existing));
assert.equal(filled.phone, "818-555-0199");
assert.equal(filled.dob, "01/05/1990");
assert.equal(filled.sex, "Male");
assert.equal(filled.maritalStatus, "Single");
assert.equal(filled.addressStreet, "123 Brand Blvd");
assert.equal(filled.addressUnit, "Apt 3");
assert.equal(filled.addressCity, "Glendale");
assert.equal(filled.addressState, "CA");
assert.equal(filled.addressZip, "91205");
assert.equal(filled.email, "yervand@example.com");
assert.equal(filled.isCashPatient, false);
assert.equal(filled.attorney, "Keep Law");
assert.equal(filled.dateOfLoss, "03/01/2026");
assert.equal(filled.notes, "typed note");

const cash = fillEmptyDemographics(empty, demographicsFromPatient({ ...existing, isCashPatient: true, attorney: "Nope" }));
assert.equal(cash.isCashPatient, true);
assert.equal(cash.attorney, "Keep Law");

const dupes = findDuplicateCases(
  [{ id: "p1", fullName: existing.fullName, dateOfLoss: "2026-03-01" }],
  { firstName: "Yervand", lastName: "Harutyunyan", dateOfLoss: "03/01/2026" },
);
assert.equal(dupes.length, 1);

const page = readFileSync(new URL("../../src/app/(portal)/patients/page.tsx", import.meta.url), "utf8");
assert.match(page, /findDuplicateCases/);
assert.match(page, /DuplicateCaseWarning/);
assert.match(page, /ReturningPatientBanner/);
assert.match(page, /fillEmptyDemographics/);

console.log("returning patient ok");
