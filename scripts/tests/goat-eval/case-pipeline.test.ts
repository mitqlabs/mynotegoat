/**
 * G.O.A.T. case pipeline + Case Review. Fictional data only.
 * Run: npx tsx scripts/tests/goat-eval/case-pipeline.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { caseReviewAnswer, detectPipeline, detectReview, pipelineAnswer, pipelineRows, reviewChip, type PipelineData } from "../../../src/lib/goat-pipeline";
import { buildFollowUpItems, type FollowUpItem } from "../../../src/lib/follow-up-queue";
import { clearedIdSet, followUpClearId, setCleared } from "../../../src/lib/cleared-tasks";
import { chipsFor, parseViewTarget, viewTargetsFor } from "../../../src/lib/goat-briefs";
import { breaksFlow } from "../../../src/lib/goat-slash-flow";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${n}: ${(e as Error).message.split("\n")[0]}`); } };

const it = (patientId: string, patientName: string, category: FollowUpItem["category"], stage: string, days: number | null): FollowUpItem => ({ id: `${patientId}-${category}-${stage}`, patientId, patientName, caseNumber: "", attorney: "", caseStatus: "Active", category, stage, anchorDate: "", daysFromAnchor: days, note: "" });
const d: PipelineData = {
  today: "2026-10-16",
  closedStatuses: ["Paid", "Dropped"],
  items: [
    it("a", "Alpha Mock", "MRI / CT", "Needs Referral", 10),
    it("b", "Bravo Mock", "MRI / CT", "Needs Referral", 40),
    it("c", "Charlie Mock", "MRI / CT", "Report Not Received", 5),
    it("c", "Charlie Mock", "Specialist", "Report Not Received", 20),
    it("d", "Delta Mock", "X-Ray", "Waiting for Report", 3),
    it("d", "Delta Mock", "X-Ray", "Needs Referral", 1),
    it("e", "Echo Mock", "MRI / CT", "Appt Not Scheduled", 7),
  ],
  patients: [
    { id: "a", fullName: "Alpha Mock", caseStatus: "Active", attorney: "Mock Law", dateOfLoss: "01/01/2026", initialExam: "01/05/2026" },
    { id: "b", fullName: "Bravo Mock", caseStatus: "Active", attorney: "", dateOfLoss: "", initialExam: "" },
    { id: "f", fullName: "Foxtrot Mock", caseStatus: "Ready To Submit", attorney: "Mock Law", dateOfLoss: "x", initialExam: "x", discharge: "09/01/2026" },
    { id: "g", fullName: "Golf Mock", caseStatus: "Ready To Submit", attorney: "Mock Law", dateOfLoss: "x", initialExam: "x", discharge: "2026-08-01" },
    { id: "h", fullName: "Hotel Mock", caseStatus: "Submitted", attorney: "Mock Law", dateOfLoss: "x", initialExam: "x", rbSent: "07/01/2026" },
    { id: "i", fullName: "India Mock", caseStatus: "Submitted", attorney: "Mock Law", dateOfLoss: "x", initialExam: "x", rbSent: "2026-09-16" },
    { id: "j", fullName: "Juliet Mock", caseStatus: "Paid", attorney: "", dateOfLoss: "", initialExam: "" },
    { id: "k", fullName: "Kilo Mock", caseStatus: "Active", attorney: "", dateOfLoss: "x", initialExam: "x", cash: true },
  ],
};
const names = (rows: { patientName?: string }[]) => rows.map((r) => r.patientName);

// Phrasings
const P: Array<[string, string | null]> = [
  ["show me which cases need MRI", "needsMri"], ["who needs an mri referral", "needsMri"], ["Who needs an MRI?", "needsMri"],
  ["waiting on mri results", "mriResults"], ["which mris are pending", "mriResults"], ["Waiting on MRI results?", "mriResults"],
  ["waiting for report", "waitingReport"], ["who is waiting for the narrative report", "waitingReport"], ["which reports are outstanding", "waitingReport"],
  ["what's ready to submit", "readyToSubmit"], ["ready to submit?", "readyToSubmit"],
  ["waiting for checks", "submitted"], ["who's submitted", "submitted"], ["Waiting for checks?", "submitted"],
  ["which cases have no attorney", "missing"], ["show cases missing date of loss", "missing"],
  ["case pipeline", "overview"],
  ["does kara need an mri", null], ["when was alex's mri", null], ["kara mri findings", null], ["add a note for john: ready to submit soon", null],
];
for (const [q, want] of P) check(`detect "${q}"`, () => assert.equal(detectPipeline(q), want));

// Lists use Case Flow rows / statuses; urgency order
check("needs MRI = MRI/CT Needs Referral, longest first", () => assert.deepEqual(names(pipelineRows("needsMri", d)), ["Bravo Mock", "Alpha Mock"]));
check("needs MRI shows days", () => assert.match(pipelineRows("needsMri", d)[0].after, /40 days/));
check("MRI results = Report Not Received only (not Appt Not Scheduled)", () => assert.deepEqual(names(pipelineRows("mriResults", d)), ["Charlie Mock"]));
check("waiting for report = x-ray/mri/specialist report rows", () => { const r = pipelineRows("waitingReport", d); assert.deepEqual(names(r), ["Charlie Mock", "Charlie Mock", "Delta Mock"]); assert.match(r[0].after, /Specialist/); });
check("ready to submit: earliest discharge first", () => assert.deepEqual(names(pipelineRows("readyToSubmit", d)), ["Golf Mock", "Foxtrot Mock"]));
check("submitted: oldest R&B Sent first with days waiting", () => { const r = pipelineRows("submitted", d); assert.deepEqual(names(r), ["Hotel Mock", "India Mock"]); assert.match(r[0].after, /sent 07\/01\/2026 · 107 days/); assert.match(r[1].after, /30 days/); });
check("missing: open, non-cash only, most gaps first", () => { const r = pipelineRows("missing", d); assert.deepEqual(names(r), ["Bravo Mock"]); assert.match(r[0].after, /no attorney, no date of injury, no initial exam/); });
check("names link to the patient", () => assert.equal(pipelineRows("needsMri", d)[0].patientHref, "/patients/b"));
check("answer: count + chips", () => { const a = pipelineAnswer("needsMri", d); assert.match(a.text, /Needs MRI referral \(2\):/); assert.deepEqual(a.choices.map((c) => c.label), ["Waiting on MRI results?", "Waiting for reports?"]); });
check("waiting report → ready to submit chip", () => assert.equal(pipelineAnswer("waitingReport", d).choices[0].label, "Ready to submit?"));
check("chips are detectable", () => { for (const k of ["needsMri", "mriResults", "waitingReport", "readyToSubmit", "submitted", "missing"] as const) for (const c of pipelineAnswer(k, d).choices) assert.ok(detectPipeline(c.question), c.question); });
check("empty list", () => assert.match(pipelineAnswer("mriResults", { ...d, items: [] }).text, /none right now/));
check("overview counts", () => assert.match(pipelineAnswer("overview", d).text, /Needs MRI referral: 2[\s\S]*Submitted \(checks waiting\): 2/));

// Cleared tasks respected (real queue)
{
  const pt = { id: "p1", fullName: "Mock A", dob: "01/01/1980", phone: "555-000-0000", attorney: "Mock Law", caseStatus: "Active", dateOfLoss: "01/01/2026", lastUpdate: "2026-10-01", priority: "Normal", matrix: { initialExam: "01/05/2026" } } as never;
  const all = buildFollowUpItems([pt], { clearedIds: new Set() });
  const cat = all[0].category;
  const cleared = buildFollowUpItems([pt], { clearedIds: clearedIdSet(setCleared([], followUpClearId("p1", cat), true, "Mock", "2026-10-16T00:00:00Z")) });
  check("cleared row not in review", () => assert.doesNotMatch(caseReviewAnswer({ mode: "summary" }, { ...d, items: cleared }).text, new RegExp(`${cat === "MRI / CT" ? "MRI/CT" : cat.split(" ")[0]}`)));
}

// Case Review
const R: Array<[string, unknown]> = [
  ["do a case review", { mode: "summary" }], ["Case Review", { mode: "summary" }], ["which cases are missing key info?", { mode: "summary" }], ["what's missing", { mode: "summary" }],
  ["case review for alpha mock", { mode: "patient", name: "alpha mock" }], ["what does bravo still need", { mode: "patient", name: "bravo" }],
  ["Case review: MRI/CT", { mode: "category", category: "MRI / CT" }], ["Case review: X-rays", { mode: "category", category: "X-Ray" }],
  ["kara's attorney", null],
];
for (const [q, want] of R) check(`review "${q}"`, () => assert.deepEqual(detectReview(q), want));
const rv = caseReviewAnswer({ mode: "summary" }, d);
check("review summary counts per need (cases)", () => { assert.match(rv.text, /X-rays: 1 case\n- MRI\/CT: 4 cases\n- Specialist: 1 case/); });
check("review chips expand", () => { assert.deepEqual(rv.choices.map((c) => c.label), ["X-rays: 1", "MRI/CT: 4", "Specialist: 1"]); assert.deepEqual(detectReview(rv.choices[1].question), { mode: "category", category: "MRI / CT" }); });
check("review category: longest open first", () => assert.deepEqual(names(caseReviewAnswer({ mode: "category", category: "MRI / CT" }, d).rows), ["Bravo Mock", "Alpha Mock", "Echo Mock", "Charlie Mock"]));
check("review patient: what it still needs", () => { const a = caseReviewAnswer({ mode: "patient", name: "delta" }, d, { id: "d", fullName: "Delta Mock" }); assert.match(a.text, /Delta Mock still needs \(2\):\n- X-rays: Waiting for Report · 3 days\n- X-rays: Needs Referral · 1 day/); });
check("review patient: nothing open", () => assert.match(caseReviewAnswer({ mode: "patient", name: "golf" }, d, { id: "g", fullName: "Golf Mock" }).text, /nothing open/));
check("review chip label", () => assert.equal(reviewChip("Lien / LOP"), "Case review: Lien/LOP"));

// Admin gating, chips, /view, flow break, wiring
check("greeting chip admin only", () => { assert.ok(chipsFor(true).includes("Case Review")); assert.ok(!chipsFor(false).includes("Case Review")); });
check("/view targets admin only", () => { assert.ok(viewTargetsFor(true).some((v) => v.word === "case review")); assert.ok(!viewTargetsFor(false).some((v) => v.target === "review" || v.target.startsWith("pipeline:"))); });
for (const [w, t] of [["case review", "review"], ["needs mri", "pipeline:needsMri"], ["mri results", "pipeline:mriResults"], ["reports", "pipeline:waitingReport"], ["ready to submit", "pipeline:readyToSubmit"], ["submitted", "pipeline:submitted"], ["missing", "pipeline:missing"], ["pipeline", "pipeline:overview"]]) check(`/view ${w}`, () => assert.equal(parseViewTarget(w), t));
check("pipeline phrases break a waiting step", () => { assert.ok(breaksFlow("who needs an mri referral", { k: "notePick" })); assert.ok(breaksFlow("Case Review", { k: "notePick" })); });
const ui = readFileSync("src/components/global-goat.tsx", "utf8");
check("admin gate in runPipeline + runReview", () => assert.equal((ui.match(/if \(!isGoatAdmin\) \{\n\s+push\(\{ role: "goat", text: statsGate\(\) \?\? ADMIN_ONLY_REPLY/g) ?? []).length, 2));
check("uses Case Flow's own options", () => { assert.match(ui, /caseFlowOptions\(loadDashboardWorkspaceSettings\(\)\.patientFollowUp/); assert.match(readFileSync("src/app/(portal)/patients/page.tsx", "utf8"), /\.\.\.caseFlowOptions\(followUpSettings, closedCaseStatuses, followUpOverridesByPatientId\)/); });
console.log(`case-pipeline: ${pass}/${pass + fail} passed (fictional data only)`);
if (fail) process.exit(1);
