import assert from "node:assert/strict";
import { buildFollowUpItems } from "../../src/lib/follow-up-queue";
import type { PatientRecord } from "../../src/lib/mock-data";

// Mock data only. A prior / outside MRI (isPrior) holds findings but is
// not one of our referrals: Case Flow must treat the patient exactly as
// if no MRI entry existed.
const base = (id: string, mriReferrals: unknown[] | undefined, matrix: PatientRecord["matrix"] = {}): PatientRecord => ({
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
  mriReferrals,
});
const prior = { id: "mri-prior-1", modalityLabel: "MRI", isPrior: true, sentDate: "", center: "", regions: ["lumbar"],
  lateralityByRegion: {}, flexExtRegions: [], scheduledDate: "", doneDate: "12/01/2025", reportReceivedDate: "",
  reportReviewedDate: "", findings: "Mock: L4-5 disc protrusion 3mm." };
const strip = (items: ReturnType<typeof buildFollowUpItems>) =>
  items.filter((i) => i.category === "MRI / CT").map((i) => ({ ...i, id: "x", patientId: "x", patientName: "x", caseNumber: "x" }));

const none = strip(buildFollowUpItems([base("a", undefined)]));
const onlyPrior = strip(buildFollowUpItems([base("b", [prior], { mriSent: "2026-02-01" })]));
assert.deepEqual(JSON.parse(JSON.stringify(onlyPrior)), JSON.parse(JSON.stringify(none)),
  "prior-only patient gets the same MRI case flow as a patient with no MRI entries (stale matrix ignored)");
const ours = strip(buildFollowUpItems([base("c", [{ ...prior, isPrior: false, sentDate: "02/01/2026", center: "Mock Imaging" }], { mriSent: "2026-02-01" })]));
assert.notEqual(ours[0]?.stage, "Needs Referral", "a real referral of ours still advances Case Flow");
console.log("PASS prior-outside-mri (case flow ignores prior studies, mock data)");
