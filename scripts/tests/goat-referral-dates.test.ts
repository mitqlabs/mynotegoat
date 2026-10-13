/**
 * G.O.A.T. rules: "when was X referred to PM and when did they go" → one sentence
 * (referral date from the referral file, visit date from the report), Specialist
 * box first, "when" answers lead and excerpts go behind "Show sources".
 * Made-up patient, doctor and file text only. No network, no model.
 *
 * Run:  npx tsx scripts/tests/goat-referral-dates.test.ts
 */
import assert from "node:assert/strict";
import { askGoat, type GoatContext } from "../../src/lib/goat";
import type { GoatFile } from "../../src/lib/goat-docs";
import { DEFAULT_GOAT_TERM_GROUPS } from "../../src/lib/goat-terms";
import { findReferralFacts, isReferralWhenQuestion, referralDateIn, referralFactLines, toMDY, visitDateIn } from "../../src/lib/goat-referrals";

let pass = 0;
function test(name: string, fn: () => void) {
  try { fn(); pass++; console.log("PASS", name); } catch (e) { console.log("FAIL", name); throw e; }
}

// Mock "PDF" text (as read from pages) — invented content.
const referralPdf: GoatFile = {
  id: "f-ref", name: "Specialist Referral - DR. JANE MOCKERTON.pdf", folder: "Specialists", uploaded: "2026-01-21", status: "read",
  pages: ["SPECIALIST REFERRAL FORM\nPatient: Testpatient, Kara\nRefer to: Dr. Jane Mockerton — Pain Management\nDate of Referral: 01/20/2026\nReason: cervical and lumbar pain"],
};
const reportPdf: GoatFile = {
  id: "f-rep", name: "Specialist Report - DR. JANE MOCKERTON.pdf", folder: "Specialists", uploaded: "2026-03-01", status: "read",
  pages: ["JANE MOCKERTON, M.D.\nInterventional Pain Management\nPatient: Kara Testpatient\nConsultation Visit\n\n02/25/2026\nHistory: neck pain after MVA.", "PLAN: Recommend lumbar ESI at L4-L5. Follow up in 4 weeks."],
};
const ortho: GoatFile = {
  id: "f-ortho", name: "Ortho Consult - DR. OTTO BONESMITH.pdf", folder: "Specialists", uploaded: "2026-04-01", status: "read",
  pages: ["Orthopedic consult\nDate of Service: April 2, 2026\nShoulder exam."],
};

const base: GoatContext = {
  today: "2026-10-12", patientName: "Testpatient, Kara", dob: "", phone: "", email: "", address: "", alerts: [], attorney: "", caseStatus: "", lien: "", review: "", isCashPatient: false,
  doi: "2025-12-01", initialExam: "", priorCare: "", xrayFindings: "", mriFindings: "", specialistRecommendations: "", imaging: [], specialists: [], notes: "", encounters: [], plans: [], diagnoses: [], details: null, billing: null,
  termGroups: [...DEFAULT_GOAT_TERM_GROUPS, { id: "pm", terms: ["PM", "pain management", "Mockerton"], updatedAt: "" }],
  people: [
    { name: "Dr. Jane Mockerton", specialty: "Pain Management" } as never,
    { name: "Dr. Otto Bonesmith", specialty: "Orthopedics" } as never,
  ],
  appointments: [],
  files: [referralPdf, reportPdf, ortho],
};

const Q = "when was kara referred to pm and when did he go";

test("date helpers", () => {
  assert.equal(toMDY("1/5/26"), "01/05/2026");
  assert.equal(toMDY("Sept 3, 2026"), "09/03/2026");
  assert.equal(referralDateIn("Date of Referral: 01/20/2026"), "01/20/2026");
  assert.equal(referralDateIn("Referred on\n3-4-2026"), "03/04/2026");
  assert.equal(visitDateIn("Consultation Visit\n\n02/25/2026"), "02/25/2026");
  assert.equal(visitDateIn("DOS: 05/06/2026"), "05/06/2026");
  assert.equal(visitDateIn("Date of Service: April 2, 2026"), "04/02/2026");
  assert.equal(referralDateIn("no dates here"), "");
});

test("question detection", () => {
  assert.ok(isReferralWhenQuestion(Q));
  assert.ok(isReferralWhenQuestion("when did she see pain management"));
  assert.ok(!isReferralWhenQuestion("what did pm recommend"));
});

test("PM referral + visit from the files: one sentence with both source links", () => {
  const r = askGoat(base, Q);
  assert.equal(r.answers.length, 1, r.answers.map((a) => a.title).join(", "));
  const a = r.answers[0];
  assert.equal(a.lines[0], "Kara was referred to pain management (Dr. Jane Mockerton) on 01/20/2026 and was seen on 02/25/2026.");
  assert.deepEqual(a.sources?.map((s) => s.fileId), ["f-ref", "f-rep"]);
  assert.equal(r.sourcesCollapsed, true);
  assert.equal(r.filesFirst, false);
});

test("works without a PM term group (specialty from Contacts)", () => {
  const r = askGoat({ ...base, termGroups: [] }, "when did kara go to pain management");
  assert.match(r.answers[0].lines[0], /pain management \(Dr\. Jane Mockerton\).*02\/25\/2026/);
});

test("Specialist box dates win over files", () => {
  const ctx = { ...base, specialists: [{ name: "Dr. Jane Mockerton", sentDate: "01/10/2026", scheduledDate: "", completedDate: "02/01/2026", reportReceivedDate: "", reportReviewedDate: "", recommendations: "", refused: false }] };
  const f = findReferralFacts(ctx, Q)!;
  assert.equal(f.referredOn, "01/10/2026");
  assert.equal(f.seenOn, "02/01/2026");
  assert.ok(f.fromBox);
});

test("other specialty picks its own doctor", () => {
  const r = askGoat(base, "when was she seen by ortho");
  assert.equal(r.answers[0].lines[0], "Kara was seen by orthopedics (Dr. Otto Bonesmith) on 04/02/2026. I didn't find the referral date.");
});

test("+ mode facts", () => {
  const lines = referralFactLines(findReferralFacts(base, Q)!);
  assert.ok(lines.some((l) => l.includes("Referred on 01/20/2026")));
  assert.ok(lines.some((l) => l.includes("Seen on 02/25/2026")));
});

test("non-referral 'when' question still leads with the answer", () => {
  const r = askGoat({ ...base, appointments: [{ date: "2026-10-01", type: "Follow-Up Visit", status: "Check Out" } as never] }, "when was the last visit");
  assert.equal(r.sourcesCollapsed, true);
});

console.log(`\n${pass} passed`);
