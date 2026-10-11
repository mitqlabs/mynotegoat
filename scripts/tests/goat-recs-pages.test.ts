/**
 * G.O.A.T. recommendations from a multi-page EMR report (synthetic, real layout):
 * Dr. Armen Haroutunian's Plan/Orders breaks across a page, so the PDF text
 * has the letterhead and "[Page 5 of 6] E-signed by …" in the middle of the
 * Plan. That footer used to end the Plan after its first item. Also: a
 * practice contact ("JHS Medical Center") must never be credited with
 * another doctor's report because its last word ("Center") appears in it.
 * Report text only (fixture file); no network, no database.
 *
 * Run:  npx tsx scripts/tests/goat-recs-pages.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { askGoat, type GoatContext } from "../../src/lib/goat";
import { isOrganizationName, personNamedIn, surnameOf, type GoatFile, type GoatPerson } from "../../src/lib/goat-docs";
import { extractRecommendations, planSection, recommendationBlocksFrom, recommendationsText, stripPageFurniture } from "../../src/lib/goat-recs";
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

// Synthetic 6-page report in the exact shape pdf.js gives G.O.A.T. for the real one (pages joined with "\n"):
// letterhead + "[Page n of 6] E-signed by …" on every page, Plan/Orders wording verbatim, no patient data (public repo).
const ARMEN = fs.readFileSync(path.join(__dirname, "fixtures", "armen-plan-page-break.txt"), "utf8");

const EXPECTED = `Cervical
- Cervical C7/T1 interlaminar epidural steroid injection.

Lumbar
- L5/S1 lumbar interlaminar epidural steroid injection.

Alternatives
- Alternative to Injection Therapy: 4 sessions of cervical and 4 sessions of lumbar Biowave percutaneous electrical nerve stimulation (PENS) for amplified pain.
- Alternative to Pain Management: Intermittent Disc Decompression (IDD) therapy.

Medications
- Robaxin 250 TID PRN.

Follow up
- 2-4 weeks.`;

const EXPECTED_COSTS = `${EXPECTED}

Costs
- Cervical: Professional fees are approximately $8,000. If performed in a surgical center then fees are approximately $15,000.
- Lumbar: Professional fees are approximately $8,000. If performed in a surgical center then fees are approximately $15,000.
- Alternative to Injection Therapy: Medical expenses are $1500 per treatment session.
- Alternative to Pain Management: The estimated cost is $15,000.`;

const text = (t: string, showCosts = false) => recommendationsText(recommendationBlocksFrom(extractRecommendations(t), { showCosts }));

test("Plan that breaks across a page: every item, nothing after the sign-off", () => {
  const out = text(ARMEN, true);
  console.log(out);
  assert.equal(out, EXPECTED_COSTS);
  assert.equal(text(ARMEN, false), EXPECTED);
});

test("The page break is really in the middle of the Plan (fixture guard)", () => {
  const plan = ARMEN.slice(ARMEN.indexOf("Plan/Orders:"));
  assert.match(plan, /lumbar radiculopathy[\s\S]*\[Page 5 of 6\] E-signed by[\s\S]*cervical radiculopathy/);
});

test("Page furniture is dropped; the doctor's own repeated fee line is kept", () => {
  const clean = stripPageFurniture(ARMEN);
  assert.doesNotMatch(clean, /\[Page \d of 6\]|This page was generated|Patient: Jane Sample DOB|Armen Haroutunian MD, INC\./);
  assert.equal((clean.match(/Professional fees are approximately \$8,000/g) ?? []).length, 2);
  assert.match(planSection(ARMEN), /Cervical C7\/T1[\s\S]*Intermittent Disc Decompression[\s\S]*2-4 weeks/);
  assert.doesNotMatch(planSection(ARMEN), /Thank you for allowing|ICD-10/);
});

test("Same report flattened into one line still reads every item", () => {
  assert.equal(text(ARMEN.replace(/\n/g, " "), false).split("\n").filter((l) => l.startsWith("- ")).length, 6);
});

test("A practice name has no surname or first name", () => {
  assert.equal(isOrganizationName("JHS Medical Center"), true);
  assert.equal(isOrganizationName("Premier Pain Solutions"), true);
  assert.equal(isOrganizationName("Dr. Armen Haroutunian"), false);
  assert.equal(isOrganizationName("Daniel Dermendjian"), false);
  assert.equal(surnameOf("JHS Medical Center"), "");
  assert.equal(surnameOf("Dr. Armen Haroutunian"), "Haroutunian");
  assert.equal(personNamedIn("jhs recs", { name: "JHS Medical Center" }), true);
  assert.equal(personNamedIn("jhs medical center report", { name: "JHS Medical Center" }), true);
  assert.equal(personNamedIn("surgical center fees", { name: "JHS Medical Center" }), false);
  assert.equal(personNamedIn("premier recs", { name: "Premier Pain Solutions" }), true);
  assert.equal(personNamedIn("dr armen recs", { name: "Dr. Armen Haroutunian" }), true);
});

// --- Through askGoat, with the office's real Pain Management contacts -----

function file(name: string, pageText: string, uploaded: string): GoatFile {
  return { id: name, name, folder: "Specialist", uploaded, status: "read", method: "text", pages: pageText.split(/(?=Armen Haroutunian MD, INC\.\n)/) };
}

const PEOPLE: GoatPerson[] = [
  { name: "Dr. Armen Haroutunian", specialty: "Pain Management", referred: true, referralSent: "05/01/2026" },
  { name: "JHS Medical Center", specialty: "Pain Management", referred: false },
  { name: "Daniel Dermendjian", specialty: "Pain Management", referred: false },
  { name: "Premier Pain Solutions", specialty: "Pain Management", referred: false },
];

function ctx(files: GoatFile[]): GoatContext {
  return {
    today: "2026-10-10",
    patientName: "Sample, Jane",
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
    people: PEOPLE,
    files,
  };
}

const ARMEN_FILE = file("Jane Sample 01-15-26.pdf", ARMEN, "2026-06-01T17:00:00Z");

for (const q of ["pm recs", "what was the pain management recs", "dr armen recs"]) {
  test(`askGoat "${q}": whole Plan, credited to Dr. Armen only (never JHS Medical Center)`, () => {
    const res = askGoat(ctx([ARMEN_FILE]), q);
    const rec = res.answers.find((a) => a.title === "Recommendations");
    assert.ok(rec, `no Recommendations card for "${q}"`);
    const lead = rec.groups?.[0]?.lead ?? "";
    if (q === "pm recs") console.log(lead, "\n" + rec.copyText);
    assert.ok(rec.copyText?.startsWith(EXPECTED), rec.copyText);
    assert.equal(lead, "Dr. Armen Haroutunian — Jane Sample 01-15-26.pdf");
  });
}

console.log(`goat-recs-pages: ${pass} tests pass`);
