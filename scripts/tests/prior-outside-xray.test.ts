import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildFollowUpItems } from "../../src/lib/follow-up-queue";
import type { PatientRecord } from "../../src/lib/mock-data";

// Mock data only. X-ray "Completed Prior Care" must behave exactly like MRI.
const base = (id: string, xrayReferrals: unknown[] | undefined, matrix: PatientRecord["matrix"] = {}): PatientRecord => ({
  id,
  fullName: `Mock Patient ${id}`,
  dob: "01/01/1980",
  phone: "555-000-0000",
  attorney: "Mock Law",
  caseStatus: "Active" as PatientRecord["caseStatus"],
  dateOfLoss: "01/01/2026",
  lastUpdate: "2026-10-01",
  priority: "Normal" as PatientRecord["priority"],
  matrix: { initialExam: "01/05/2026", ...matrix },
  xrayReferrals,
});
const prior = { id: "xray-prior-1", modalityLabel: "X-Ray", isPrior: true, sentDate: "", center: "", regions: ["cervical"],
  lateralityByRegion: {}, flexExtRegions: [], scheduledDate: "", doneDate: "12/01/2025", reportReceivedDate: "",
  reportReviewedDate: "", findings: "Mock: loss of cervical lordosis." };
const strip = (items: ReturnType<typeof buildFollowUpItems>) =>
  items.filter((i) => /x-?ray/i.test(i.category)).map((i) => ({ ...i, id: "x", patientId: "x", patientName: "x", caseNumber: "x" }));

const none = strip(buildFollowUpItems([base("a", undefined)]));
assert.ok(none.length > 0, "baseline has an X-ray item");
const onlyPrior = strip(buildFollowUpItems([base("b", [prior], { xraySent: "2026-02-01" })]));
assert.deepEqual(JSON.parse(JSON.stringify(onlyPrior)), JSON.parse(JSON.stringify(none)), "prior X-ray ignored by Case Flow");

// UI + referral stats wiring: one shared renderer for both modalities.
const pcf = readFileSync("src/components/patient-case-file.tsx", "utf8");
assert.match(pcf, /renderPriorCareControls\("xray"\)/);
assert.match(pcf, /renderPriorCareControls\("mri"\)/);
assert.match(pcf, /if \(checked\) openPriorImagingEditor\(mode\)/);
const dash = readFileSync("src/app/(portal)/dashboard/page.tsx", "utf8");
assert.equal((dash.match(/if \(ref\.isPrior === true\) continue;/g) ?? []).length, 2, "referral stats skip prior X-ray and MRI");
console.log("PASS prior-outside-xray (mock data)");
