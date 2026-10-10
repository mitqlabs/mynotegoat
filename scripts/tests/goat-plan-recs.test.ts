/**
 * G.O.A.T. recommendations from reports with no "Recommendations" heading:
 * One Touch EMR "Plan" with numbered diagnoses + "comment:" blocks (Premier
 * Pain Solutions style), other Plan headings, and rec sentences anywhere.
 * Mock report text only: no network, no database.
 *
 * Run:  npx tsx scripts/tests/goat-plan-recs.test.ts
 */
import assert from "node:assert/strict";
import { askGoat, type GoatContext } from "../../src/lib/goat";
import type { GoatFile } from "../../src/lib/goat-docs";
import { extractRecommendations, normalizeLevels, planSection, recommendationBlocksFrom, recommendationsText } from "../../src/lib/goat-recs";
import { DEFAULT_GOAT_TERM_GROUPS } from "../../src/lib/goat-terms";

let pass = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log("PASS", name);
  } catch (e) {
    console.log("FAIL", name);
    throw e;
  }
}

// Mock Premier Pain Solutions (One Touch EMR) Specialist Report.
const PLAN = `Plan
1. Cervical Radiculopathy [M.54.12]
comment:
Using a spinal model, spoke to patient at length regarding etiology of neck pain including disc herniation with concomitant inflammation/neural component compression, facet souce, cervical radiculopathy. Considering MRI findings and correlation with physical exam, recommend cervical epidural steroid injection targeting C6 - C7 level. Risks and benefits reviewed in detail. Patient may require up to 3 epidurals to optimize pain management. Professional fee for cervical epidural steroid injection is $7000 per injection.
2. Cervical Disc Herniation [M.50.20]
comment:
MRI findings:
C4 - C5: 2.6 mm disc bulge. Bilateral neural foraminal stenosis.
C5 - C6: 2.0 mm disc bulge. Indentation thecal sleeve.
3. Myofascial Pain [M79.18]
comment:
Recommend trigger point injection of upper neck and trapezius areas bilaterally, totaling 3 muscle groups for myofascial pain treatment. Risks and benefits reviewed in detail. Professional fee including ultrasound use $2500.
4. Person Injured In Unspecified Motor-vehicle Accident - Traffic - Initial Encounter [V89.2XXA]
comment:
After reviewing this patient's detailed history, it is my opinion within a reasonable degree of medical certainty that the motor vehicle accident on 7/24/2026 was the precipitating cause of the patient's injuries. The patient has failed conservative treatments including chiropractic therapy, activity modification, rest, and medication management.
Signed by Provider: Dr. Andre Yarian`;

const REPORT = `Premier Pain Solutions
Patient: Test Patient   Date of Service: 08/14/2026
History of Present Illness
The patient presents with neck pain radiating to the right arm following a motor vehicle accident.
Physical Exam
Spurling's test positive on the right. Tenderness over the upper trapezius bilaterally.
${PLAN}`;

const EXPECTED = `Cervical
- Cervical epidural steroid injection targeting C6-C7 level (may require up to 3 epidurals).
- Trigger point injection of upper neck and trapezius areas bilaterally, totaling 3 muscle groups.`;

const EXPECTED_COSTS = `${EXPECTED}

Costs
- Cervical epidural steroid injection: $7000 per injection.
- Trigger point injection: Professional fee including ultrasound use $2500.`;

const text = (t: string, showCosts = false) => recommendationsText(recommendationBlocksFrom(extractRecommendations(t), { showCosts }));

test("One Touch EMR Plan: recs per diagnosis comment, wording kept, note attached", () => {
  const out = text(REPORT);
  console.log(out);
  assert.equal(out, EXPECTED);
});

test("Costs go to Costs (only when Show costs is on)", () => {
  const out = text(REPORT, true);
  console.log(out);
  assert.equal(out, EXPECTED_COSTS);
  assert.doesNotMatch(text(REPORT, false), /\$/);
});

test("MRI findings and causation comments are not recommendations", () => {
  const r = extractRecommendations(REPORT);
  assert.equal(r.interventions.length, 2);
  assert.equal(r.alternatives.length, 0);
  assert.deepEqual(r.unplaced, []);
  for (const i of r.interventions) assert.doesNotMatch(i.text, /disc bulge|precipitating|failed conservative|mm/i);
});

test("Spaced levels are normalized, never cut at the dash", () => {
  assert.equal(normalizeLevels("targeting C6 - C7 level, L4 – 5"), "targeting C6-C7 level, L4-L5");
  assert.match(planSection(REPORT), /^\s*1\. Cervical Radiculopathy/);
});

test("Same Plan flattened by the PDF reader (one long line)", () => {
  assert.equal(text(REPORT.replace(/\n/g, " ")), EXPECTED);
});

for (const head of ["Assessment and Plan", "A/P:", "Treatment Plan", "Impression/Plan", "Recommendations", "Orders"]) {
  test(`Heading "${head}"`, () => {
    assert.equal(text(REPORT.replace(/^Plan$/m, head)), EXPECTED);
  });
}

test("No heading at all: recommendation sentences anywhere in the report", () => {
  const r = extractRecommendations(
    `Pain consult. Exam: lumbar paraspinal tenderness. I recommend a left L4 - L5 transforaminal epidural steroid injection. The patient is advised to continue home exercises. We will schedule a lumbar medial branch block if no relief.`,
  );
  assert.deepEqual(
    r.interventions.map((i) => [i.region, i.text]),
    [
      ["Lumbar", "Left L4-L5 transforaminal epidural steroid injection."],
      ["", "The patient is advised to continue home exercises."],
      ["Lumbar", "We will schedule a lumbar medial branch block if no relief."],
    ],
  );
});

// --- Through askGoat, as the user asked it --------------------------------

function file(name: string, pageText: string): GoatFile {
  return { id: name, name, folder: "Specialist", uploaded: "2026-08-20T17:00:00Z", status: "read", method: "text", pages: [pageText] };
}

function ctx(files: GoatFile[]): GoatContext {
  return {
    today: "2026-10-10",
    patientName: "Patient, Test",
    dob: "",
    phone: "",
    email: "",
    address: "",
    alerts: [],
    attorney: "",
    caseStatus: "",
    lien: "",
    review: "",
    isCashPatient: false,
    doi: "",
    initialExam: "",
    priorCare: "",
    xrayFindings: "",
    mriFindings: "",
    specialistRecommendations: "",
    imaging: [],
    specialists: [],
    notes: "",
    appointments: [],
    encounters: [],
    plans: [],
    diagnoses: [],
    details: null,
    billing: null,
    termGroups: DEFAULT_GOAT_TERM_GROUPS,
    people: [{ name: "Premier Pain Solutions", specialty: "Pain Management", referred: true, referralSent: "07/30/2026" }],
    files,
  };
}

const FILE = file("072426TEST Patient - Specialist Report - Premier Pain Solutions.pdf", REPORT);

for (const q of ["what was the pain management recs", "what did PM recommend", "premier pain solutions plan", "what did dr yarian recommend"]) {
  test(`askGoat: "${q}"`, () => {
    const res = askGoat(ctx([FILE]), q);
    const rec = res.answers.find((a) => a.title === "Recommendations");
    assert.ok(rec, `no Recommendations card for "${q}"`);
    assert.ok(rec.copyText?.startsWith(EXPECTED), rec.copyText);
    assert.match(rec.source, /Premier Pain Solutions/);
    const allNotes = [...(res.files?.notes ?? []), ...res.answers.flatMap((a) => a.lines), ...res.answers.flatMap((a) => a.groups?.map((g) => g.note ?? "") ?? [])];
    assert.ok(!allNotes.some((n) => /(doesn't|don't) mention|couldn't find/i.test(n)), allNotes.join(" | "));
    if (q === "what was the pain management recs") console.log(rec.copyText);
  });
}

test("askGoat: a report with truly no recs says which report was checked", () => {
  const bare = file("081026TEST Patient - Specialist Report - Premier Pain Solutions.pdf", `Premier Pain Solutions\nDate of Service: 08/10/2026\nPlan\n1. Cervical Disc Herniation [M.50.20]\ncomment:\nMRI findings:\nC4 - C5: 2.6 mm disc bulge.`);
  const res = askGoat(ctx([bare]), "what was the pain management recs");
  const rec = res.answers.find((a) => a.title === "Recommendations");
  assert.ok(rec);
  const msg = rec.lines.join(" ");
  console.log(msg);
  assert.match(msg, /I checked 081026TEST Patient - Specialist Report - Premier Pain Solutions\.pdf \(dated 08\/10\/2026\)/);
});

console.log(`goat-plan-recs: ${pass} tests pass`);
