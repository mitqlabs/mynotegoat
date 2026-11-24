/**
 * G.O.A.T. "pm findings": the PM doctor's clinical sections (Assessment / Plan),
 * not a bare heading or a letterhead line; the referral status says "seen" when
 * their report is in the files; only this patient's doctor is named.
 * Made-up doctor, patient and report text only. No network, no model.
 *
 * Run:  npx tsx scripts/tests/goat-findings.test.ts
 */
import assert from "node:assert/strict";
import { askGoat, type GoatContext } from "../../src/lib/goat";
import { answerFromFiles, clinicalSections, isLetterheadLine, reportFromDoctor, type GoatFile, type GoatPerson } from "../../src/lib/goat-docs";
import { DEFAULT_GOAT_TERM_GROUPS } from "../../src/lib/goat-terms";

let pass = 0;
function test(name: string, fn: () => void) {
  try { fn(); pass++; console.log("PASS", name); } catch (e) { console.log("FAIL", name); throw e; }
}

const LH = "Zed Mockstone MD, INC.\n1234 Example Blvd, Suite 100\nGlendale, CA 91203\nTel (818) 555-0100  Fax (818) 555-0101";
// ASSESSMENT is the last line of page 3; its content is on page 4 under the letterhead.
const pmReport: GoatFile = {
  id: "f-pm", name: "071826TEPA Testpatient, Pat - PM report.pdf", folder: "Specialists", uploaded: "2026-10-26T17:00:00Z", status: "read",
  pages: [
    `${LH}\nPAIN MANAGEMENT CONSULTATION\nPatient: Pat Testpatient\nHistory of Present Illness\nNeck and low back pain after MVA.`,
    `${LH}\nPhysical Exam\nTenderness over the lumbar paraspinals. Positive straight leg raise on the left.\nLumbar flexion 40/60 degrees with pain.\nLumbar extension 10/25 degrees.\nCervical rotation limited bilaterally.`,
    `${LH}\nReview of Systems\nNegative.\nASSESSMENT:`,
    `${LH}\nPatient: Pat Testpatient\n1. Lumbar radiculopathy (M54.16).\n2. Cervical disc herniation (M50.20).\n3. Myofascial pain.\nPLAN:\n1. Recommend lumbar epidural steroid injection at L4-L5.\n2. MRI of the cervical spine.\n3. Follow up in 4 weeks.\nSincerely,\nZed Mockstone, MD\nPage 4 of 4`,
  ],
};
const referral: GoatFile = {
  id: "f-ref", name: "Referral - Dr. Zed Mockstone.pdf", folder: "Specialists", uploaded: "2026-08-12", status: "read",
  pages: ["SPECIALIST REFERRAL FORM\nRefer to: Dr. Zed Mockstone - Pain Management\nDate of Referral: 08/12/2026\nReason for referral: low back pain"],
};

const people: GoatPerson[] = [
  { name: "Dr. Zed Mockstone", specialty: "Pain Management", referred: true, referralSent: "08/12/2026" },
  { name: "Dr. Una Otherdoc", specialty: "Pain Management", referred: false },
  { name: "Dr. Ivy Elsewhere", specialty: "Pain Management", referred: false },
];
const groups = DEFAULT_GOAT_TERM_GROUPS;
const pmGroup = groups.find((g) => g.id === "seed-pm")!;
const findingsGroup = groups.find((g) => g.terms.some((t) => /^findings$/i.test(t)));
const asked = [pmGroup, ...(findingsGroup ? [findingsGroup] : [])];
const q = (people: GoatPerson[]) => ({ question: "pm findings", words: ["pm", "findings"], asked, allGroups: groups, people });

test("letterhead lines are recognised", () => {
  assert.ok(isLetterheadLine('"Zed Mockstone MD, INC."'));
  assert.ok(isLetterheadLine("1234 Example Blvd, Suite 100"));
  assert.ok(isLetterheadLine("Tel (818) 555-0100  Fax (818) 555-0101"));
  assert.ok(isLetterheadLine("Page 4 of 4"));
  assert.ok(!isLetterheadLine("Lumbar radiculopathy (M54.16)."));
  assert.ok(!isLetterheadLine("Recommend lumbar epidural steroid injection at L4-L5."));
});

test("ASSESSMENT heading keeps its content from the next page", () => {
  const secs = clinicalSections(pmReport);
  const a = secs.find((s) => s.kind === "diagnosis")!;
  assert.equal(a.page, 3);
  assert.deepEqual(a.items.map((i) => i.text), ["Lumbar radiculopathy (M54.16)", "Cervical disc herniation (M50.20)", "Myofascial pain"]);
  assert.equal(a.items[0].page, 4);
  const p = secs.find((s) => s.kind === "recommendations")!;
  assert.deepEqual(p.items.map((i) => i.text), ["Recommend lumbar epidural steroid injection at L4-L5", "MRI of the cervical spine", "Follow up in 4 weeks"]);
  for (const s of secs) for (const i of s.items) assert.doesNotMatch(i.text, /INC|Suite|Tel|Sincerely|Page 4|Mockstone/);
});

test("pm findings: diagnoses + recommendations, no bare heading, no letterhead", () => {
  const r = answerFromFiles([pmReport, referral], q(people))!;
  assert.ok(r);
  const m = r.matches[0];
  assert.equal(m.fileId, "f-pm");
  const texts = m.lines.map((l) => `${l.heading ? "#" : "-"} ${l.text}`);
  console.log(texts.join("\n"));
  assert.equal(texts[0], "# Recommendations");
  assert.ok(texts.indexOf("# Range of motion") < texts.indexOf("# Diagnoses / impression"));
  assert.ok(texts.includes("- Lumbar flexion 40/60 degrees with pain"));
  assert.ok(texts.includes("- Cervical rotation limited bilaterally"));
  assert.ok(!texts.includes("- Tenderness over the lumbar paraspinals"));
  assert.ok(texts.includes("- Lumbar radiculopathy (M54.16)"));
  assert.ok(texts.includes("# Recommendations"));
  assert.ok(texts.includes("- Recommend lumbar epidural steroid injection at L4-L5"));
  assert.ok(!texts.some((t) => /INC\.|ASSESSMENT/.test(t)));
  // A heading is always followed by content.
  m.lines.forEach((l, i) => { if (l.heading) assert.ok(m.lines[i + 1] && !m.lines[i + 1].heading); });
});

test("only this patient's PM doctor is named; no '(in Contacts)'", () => {
  const r = answerFromFiles([pmReport, referral], q(people))!;
  console.log(r.notes);
  assert.equal(r.notes[0], "Pain management: Dr. Zed Mockstone, seen, report uploaded 10/26/2026.");
  assert.ok(!r.notes.some((n) => /in Contacts|Otherdoc|Elsewhere/.test(n)));
});

test("no PM doctor linked → plain sentence", () => {
  const r = answerFromFiles([], q(people.filter((p) => !p.referred)));
  const notes = r?.notes ?? [];
  assert.ok(notes.includes("No pain management doctor on this case."), JSON.stringify(r));
  assert.ok(!notes.some((n) => /Otherdoc|Elsewhere/.test(n)), notes.join(" | "));
});

test("reportFromDoctor finds the report uploaded after the referral, not the referral form", () => {
  const rep = reportFromDoctor([pmReport, referral], "Dr. Zed Mockstone", "08/12/2026");
  assert.equal(rep?.fileId, "f-pm");
  assert.equal(rep?.date, "10/26/2026");
  assert.equal(reportFromDoctor([referral], "Dr. Zed Mockstone", "08/12/2026"), null);
  assert.equal(reportFromDoctor([pmReport], "Dr. Zed Mockstone", "11/01/2026"), null);
});

test("Specialist answer says seen when their report is uploaded after the referral", () => {
  const ctx: GoatContext = {
    today: "2026-10-26", patientName: "Testpatient, Pat", dob: "", phone: "", email: "", address: "", alerts: [], attorney: "", caseStatus: "", lien: "", review: "", isCashPatient: false,
    doi: "2026-07-18", initialExam: "", priorCare: "", xrayFindings: "", mriFindings: "", specialistRecommendations: "", imaging: [],
    specialists: [{ name: "Dr. Zed Mockstone", sentDate: "2026-08-12", scheduledDate: "", completedDate: "", reportReceivedDate: "", reportReviewedDate: "", recommendations: "", refused: false }],
    notes: "", encounters: [], plans: [], diagnoses: [], details: null, billing: null, termGroups: groups, people, appointments: [], files: [pmReport, referral],
  };
  const r = askGoat(ctx, "specialist referrals");
  const all = JSON.stringify(r.answers);
  assert.match(all, /seen — report uploaded 10\/26\/2026/);
  assert.doesNotMatch(all, /not scheduled yet/);
});

test("ROM heading section is read as ROM", () => {
  const f: GoatFile = { id: "f-rom", name: "PM followup.pdf", folder: "Specialists", uploaded: "2026-10-20", status: "read",
    pages: ["FOLLOW UP\nCERVICAL RANGE OF MOTION:\nFlexion 30 degrees\nExtension 20 degrees\nPLAN:\nTrigger point injections."] };
  const secs = clinicalSections(f);
  const rom = secs.filter((s) => s.kind === "rom").flatMap((s) => s.items.map((i) => i.text));
  assert.deepEqual(rom, ["Flexion 30 degrees", "Extension 20 degrees"]);
  assert.deepEqual(secs.find((s) => s.kind === "recommendations")!.items.map((i) => i.text), ["Trigger point injections"]);
});

console.log(`\n${pass} passed`);
