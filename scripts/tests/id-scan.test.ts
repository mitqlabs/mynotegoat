/** Mock data only. Run: npx tsx scripts/tests/id-scan.test.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addressFromValues,
  idImageName,
  idWrite,
  matchIdPatients,
  nameConflict,
  parseAamva,
  parseIdFront,
  planIdUpdate,
  valuesFromRead,
} from "../../src/lib/id-scan";

const ca = `
ANSI 636014090002DL00410288ZA03290015DL
DCSDOE
DACJANE
DADANN
DBB03151990
DBC2
DAG123 MAIN ST
DAHAPT 4
DAIGLENDALE
DAJCA
DAK912050000
`;
const read = parseAamva(ca);
assert.ok(read);
assert.equal(read.source, "barcode");
assert.equal(read.fields.lastName?.value, "Doe");
assert.equal(read.fields.firstName?.value, "Jane");
assert.equal(read.fields.dob?.value, "03/15/1990");
assert.equal(read.fields.sex?.value, "Female");
assert.equal(read.fields.street?.value, "123 Main St");
assert.equal(read.fields.unit?.value, "Apt 4");
assert.equal(read.fields.city?.value, "Glendale");
assert.equal(read.fields.state?.value, "CA");
assert.equal(read.fields.zip?.value, "91205");
assert.equal(read.fields.lastName?.confidence, "exact");

const daa = parseAamva("AAMVA\nDAASMITH,ROBERT,Q\nDBB01021980\nDBC1\nDAG10 OAK AVE\nDAIAUSTIN\nDAJTX\nDAK787010000");
assert.equal(daa?.fields.lastName?.value, "Smith");
assert.equal(daa?.fields.firstName?.value, "Robert");
assert.equal(daa?.fields.sex?.value, "Male");
assert.equal(daa?.fields.dob?.value, "01/02/1980");

const canada = parseAamva("ANSI 604327090001DL\nDCSDOE\nDACJANE\nDBB19900315\nDBC2");
assert.equal(canada?.fields.dob?.value, "03/15/1990");

assert.equal(parseAamva("not a license"), null);

const front = parseIdFront(`CALIFORNIA DRIVER LICENSE
LN DOE
FN JANE MARIE
DOB 03/15/1990
SEX F
123 MAIN ST
GLENDALE CA 91205`);
assert.equal(front.source, "ocr");
assert.equal(front.fields.lastName?.value, "Doe");
assert.equal(front.fields.lastName?.confidence, "read");
assert.equal(front.fields.firstName?.value, "Jane");
assert.equal(front.fields.dob?.value, "03/15/1990");
assert.equal(front.fields.sex?.value, "Female");
assert.equal(front.fields.city?.value, "Glendale");
assert.equal(front.fields.zip?.value, "91205");

const guess = parseIdFront("DOE, JANE\nHELLO");
assert.equal(guess.fields.lastName?.confidence, "check");
assert.ok(guess.notes.some((n) => /doesn't look like the front/.test(n)));

const values = valuesFromRead(read!);
assert.equal(addressFromValues(values), "123 Main St, Apt 4, Glendale, CA 91205");

const blank = { id: "p1", fullName: "Doe, Jane", dob: "", sex: "", address: "" };
const plan = planIdUpdate(blank, { lastName: "Doe", firstName: "Jane", dob: "03/15/1990", sex: "Female", street: "123 Main St", city: "Glendale", state: "CA", zip: "91205" });
assert.equal(plan.fills.length, 3);
assert.deepEqual(plan.conflicts, []);
const wrote = idWrite(plan, {});
assert.equal(wrote.dob, "1990-03-15");
assert.equal(wrote.sex, "Female");
assert.match(wrote.address ?? "", /123 Main St/);

const clash = planIdUpdate(
  { id: "p1", fullName: "Doe, Jane", dob: "1980-01-02", sex: "Female", address: "9 Other Rd, Glendale, CA 91205" },
  { dob: "03/15/1990", sex: "Female", street: "123 Main St", city: "Glendale", state: "CA", zip: "91205" },
);
assert.equal(clash.conflicts.find((c) => c.key === "dob")?.current, "01/02/1980");
assert.ok(clash.same.includes("sex"));
assert.equal(idWrite(clash, {}).dob, undefined);
assert.equal(idWrite(clash, { dob: true }).dob, "1990-03-15");

assert.equal(nameConflict("Doe, Jane", "Doe", "Jane"), null);
assert.equal(nameConflict("Doe, John", "Doe", "Jane")?.fromId, "Doe, Jane");

const people = [
  { id: "a", fullName: "Doe, Jane", dob: "1990-03-15" },
  { id: "b", fullName: "Doe, Janet", dob: "1990-03-15" },
  { id: "c", fullName: "Doe, Jane", dob: "1980-01-02", deleted: true },
];
assert.deepEqual(matchIdPatients({ lastName: "Doe", firstName: "Jane", dob: "03/15/1990" }, people).map((p) => p.id), ["a"]);
assert.deepEqual(matchIdPatients({ lastName: "Doe", firstName: "Jane" }, people).map((p) => p.id), ["a"]);

assert.equal(idImageName("back", "Doe", "Jane"), "ID (back) - Doe, Jane.jpg");
assert.equal(idImageName("front", "O'Neil/x", "Ann"), "ID (front) - O'Neil x, Ann.jpg");

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const picker = readFileSync(join(root, "src/components/camera-picker.tsx"), "utf8");
const idModal = readFileSync(join(root, "src/components/id-scan-modal.tsx"), "utf8");
const scanner = readFileSync(join(root, "src/components/document-scanner-modal.tsx"), "utf8");
const hook = readFileSync(join(root, "src/hooks/use-office-camera.ts"), "utf8");
const reader = readFileSync(join(root, "src/lib/id-scan-read.ts"), "utf8");
for (const src of [picker, idModal, scanner]) {
  assert.doesNotMatch(src.replace(/iPhone/g, "Device"), /\bphone\b/i);
}
assert.match(picker, /Don&apos;t see your iPhone\? Turn on Continuity Camera on the iPhone/);
assert.match(picker, /Settings &gt; General &gt; AirPlay &amp; Continuity/);
assert.match(picker, /Device/);
assert.match(picker, /Refresh/);
assert.doesNotMatch(hook, /facingMode\s*:/);
assert.match(hook, /enumerateDevices\(\)[\s\S]{0,500}getTracks\(\)/);
assert.match(scanner, /useOfficeCamera/);
assert.match(scanner, /CameraPicker/);
assert.match(idModal, /useOfficeCamera/);
assert.match(idModal, /CameraPicker/);
assert.match(hook, /casemate\.scanner-camera\.v1/);
assert.match(hook, /devicechange/);
assert.match(hook, /reconcileCamera/);
assert.match(reader, /PDF417/);
assert.match(reader, /\/goat\/zxing\//);
assert.doesNotMatch(reader, /openai|anthropic|chat\/completions|generativelanguage/i);

console.log("id-scan: ok");
