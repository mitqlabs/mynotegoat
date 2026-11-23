/**
 * Sex and age buckets for Statistics → Patient Demographics.
 * Run: npx tsx scripts/tests/patient-demographics.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ageBandLabel,
  sectionsOpenedByLocationHash,
  sexLabel,
  summarizeAge,
  summarizeSex,
  type DemographicPatient,
} from "../../src/lib/patient-demographics";

const AS_OF = "2026-11-23";

assert.equal(sexLabel("Male"), "Male");
assert.equal(sexLabel(" Female "), "Female");
assert.equal(sexLabel(""), "Not set");
assert.equal(sexLabel(undefined), "Not set");
assert.equal(sexLabel(null), "Not set");
assert.equal(sexLabel("Other"), "Not set");
assert.equal(sexLabel("male"), "Not set");

const sexPatients: DemographicPatient[] = [
  { sex: "Male" },
  { sex: "Male" },
  { sex: "Female" },
  { sex: "" },
  { sex: "Other" },
  { sex: "Female", deleted: true },
];
const sex = summarizeSex(sexPatients);
assert.equal(sex.total, 5);
assert.deepEqual(
  sex.rows.map((row) => [row.label, row.count, row.percent]),
  [
    ["Male", 2, 40],
    ["Female", 1, 20],
    ["Not set", 2, 40],
  ],
);
assert.equal(summarizeSex([]).total, 0);
assert.equal(summarizeSex([]).rows[0].percent, 0);

assert.equal(ageBandLabel("2010-11-23", AS_OF), "Under 18");
assert.equal(ageBandLabel("2008-11-24", AS_OF), "Under 18"); // turns 18 tomorrow
assert.equal(ageBandLabel("2008-11-23", AS_OF), "18-29");
assert.equal(ageBandLabel("11/24/1996", AS_OF), "18-29"); // 29 until tomorrow
assert.equal(ageBandLabel("1996-11-23", AS_OF), "30-39");
assert.equal(ageBandLabel("1986-01-01", AS_OF), "40-49");
assert.equal(ageBandLabel("1976-06-15", AS_OF), "50-59");
assert.equal(ageBandLabel("11/24/1956", AS_OF), "60-69");
assert.equal(ageBandLabel("1956-11-23", AS_OF), "70+");
assert.equal(ageBandLabel("1940-01-01", AS_OF), "70+");
assert.equal(ageBandLabel("", AS_OF), "No DOB");
assert.equal(ageBandLabel(undefined, AS_OF), "No DOB");
assert.equal(ageBandLabel("02/31/2000", AS_OF), "No DOB");
assert.equal(ageBandLabel("2030-01-01", AS_OF), "No DOB");
assert.equal(ageBandLabel("2026-11-23", AS_OF), "Under 18");

const agePatients: DemographicPatient[] = [
  { dob: "2015-01-01" },
  { dob: "2000-01-01" },
  { dob: "2000-05-01" },
  { dob: "1990-01-01" },
  { dob: "1982-01-01" },
  { dob: "1972-01-01" },
  { dob: "1962-01-01" },
  { dob: "1948-01-01" },
  { dob: "" },
  { dob: "not-a-date" },
  { dob: "2010-01-01", deleted: true },
];
const age = summarizeAge(agePatients, AS_OF);
assert.equal(age.total, 10);
assert.deepEqual(
  age.rows.map((row) => [row.label, row.count]),
  [
    ["Under 18", 1],
    ["18-29", 2],
    ["30-39", 1],
    ["40-49", 1],
    ["50-59", 1],
    ["60-69", 1],
    ["70+", 1],
    ["No DOB", 2],
  ],
);
assert.equal(age.rows[1].percent, 20);
assert.equal(age.rows[7].percent, 20);

assert.deepEqual(sectionsOpenedByLocationHash("#patients-by-location"), ["patientDemographics", "demographicsLocation"]);
assert.deepEqual(sectionsOpenedByLocationHash("#other"), []);

const registry = readFileSync(new URL("../../src/lib/cloud-key-registry.ts", import.meta.url), "utf8");
assert.match(registry, /"casemate\.dashboard\.sections-open\.v1": "user"/);
const remembered = readFileSync(new URL("../../src/components/remembered-open.tsx", import.meta.url), "utf8");
assert.match(remembered, /casemate\.dashboard\.sections-open\.v1/);
assert.match(remembered, /!== false/);
const section = readFileSync(new URL("../../src/components/patient-demographics-section.tsx", import.meta.url), "utf8");
assert.match(section, /id="patients-by-location"|PatientsByLocationCard/);
assert.match(section, /Male\/Female/);
assert.match(section, /title="Age"/);
const page = readFileSync(new URL("../../src/app/(portal)/dashboard/page.tsx", import.meta.url), "utf8");
assert.match(page, /PatientDemographicsSection/);
assert.match(page, /ATTORNEY_PERFORMANCE_SECTION/);
assert.match(page, />Attorney Performance</);

console.log("patient-demographics tests passed");
