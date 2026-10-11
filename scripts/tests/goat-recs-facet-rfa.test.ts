/**
 * G.O.A.T. recommendations from a Dr. Armen-style facet / RFA report (synthetic, real layout):
 *   - a conditional follow-on ("If the diagnostic injection provides >80% relief, then a
 *     thermal radiofrequency ablation ensues …") is its own bullet under the region, with the condition;
 *   - the Medications section is read whether the drug is on the same line, the next line
 *     ("2. Medications:" / "Methocarbamol …"), or only in the "Medications Prescribed" table;
 *   - filler like "No specific intervention mentioned." is never output;
 *   - Settings → G.O.A.T. (Show costs / fees, Region order) shape the text and its Copy.
 * Made-up report text only (public repo). No network, no database.
 *
 * Run:  npx tsx scripts/tests/goat-recs-facet-rfa.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { askGoat, type GoatContext } from "../../src/lib/goat";
import type { GoatFile } from "../../src/lib/goat-docs";
import { extractRecommendations, prescribedMedications, recommendationBlocksFrom, recommendationsText } from "../../src/lib/goat-recs";
import { DEFAULT_GOAT_REGION_ORDER, normalizeGoatAnswerPrefs, recFormatFromPrefs } from "../../src/lib/goat-answer-prefs";
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

const REPORT = fs.readFileSync(path.join(__dirname, "fixtures", "armen-facet-rfa.txt"), "utf8");

const EXPECTED = `Cervical
- Diagnostic cervical facet medial branch blocks from C3-C5.
- Thermal radiofrequency ablation (if diagnostic injection provides >80% relief).

Lumbar
- Diagnostic lumbar facet medial branch blocks from L4-S1.
- Thermal radiofrequency ablation (if diagnostic injection provides >80% relief).

Alternatives
- Alternative to Injection Therapy: 4 sessions of cervical and 4 sessions of lumbar Biowave percutaneous electrical nerve stimulation (PENS) for amplified pain.
- Alternative to Pain Management: Intermittent Disc Decompression (IDD) therapy.

Medications
- Methocarbamol 500 mg tablet One tablet TID.

Follow up
- 2-4 weeks.`;

const EXPECTED_COSTS = `${EXPECTED}

Costs
- Fluoroscopic guided diagnostic cervical facet medial branch block: Approximately $10,000.
- Cervical (thermal radiofrequency ablation): Cost estimate of approximately $15,000. If performed at an accredited surgical center, the facility fee is between $15,000-20,000.
- Fluoroscopic guided diagnostic lumbar facet medial branch block: Approximately $10,000.
- Lumbar (thermal radiofrequency ablation): Cost estimate of approximately $15,000. If performed at an accredited surgical center, the facility fee is between $15,000-20,000.
- Alternative to Injection Therapy: Medical expenses are $1500 per treatment session.
- Alternative to Pain Management: The estimated cost is $15,000.`;

const text = (t: string, showCosts = true) => recommendationsText(recommendationBlocksFrom(extractRecommendations(t), { showCosts }));

test("Facet blocks, conditional RFA, alternatives, Methocarbamol, follow up and costs", () => {
  const out = text(REPORT);
  console.log(out);
  assert.equal(out, EXPECTED_COSTS);
  assert.equal(text(REPORT, false), EXPECTED);
});

test("The conditional follow-on keeps its region and the condition", () => {
  const r = extractRecommendations(REPORT);
  const rfa = r.interventions.filter((i) => /radiofrequency/i.test(i.text));
  assert.deepEqual(rfa.map((i) => i.region), ["Cervical", "Lumbar"]);
  assert.ok(rfa.every((i) => i.text === "Thermal radiofrequency ablation (if diagnostic injection provides >80% relief)."));
});

test("Conditional wording without a fee, and other phrasings", () => {
  const out = text(
    "Plan: Recommend right C5-C6 cervical facet medial branch block. Should the patient respond with more than 50% relief, we would proceed with cervical radiofrequency ablation. Follow up 3 weeks.",
    false,
  );
  assert.equal(out, "Cervical\n- Right C5-C6 cervical facet medial branch block.\n- Cervical radiofrequency ablation (if patient respond with more than 50% relief).\n\nFollow up\n- 3 weeks.");
});

test('"If performed in a surgical center then fees …" is a fee, not a treatment', () => {
  const r = extractRecommendations("Plan: Recommend L5/S1 lumbar interlaminar epidural steroid injection. Professional fees are approximately $8,000. If performed in a surgical center then fees are approximately $15,000.");
  assert.equal(r.interventions.length, 1);
  assert.match(r.costs[0].text, /surgical center then fees are approximately \$15,000/);
});

test("Medications on the line under a heading with a colon", () => {
  const t = REPORT.replace("2. Medications\n", "2. Medications:\n");
  assert.deepEqual(extractRecommendations(t).medications, ["Methocarbamol 500 mg tablet One tablet TID."]);
  assert.equal(text(t, false), EXPECTED);
});

test("Plan says None / nothing under Medications: the prescription table is read", () => {
  for (const plan of ["2. Medications\nNone\n", "2. Medications\n"]) {
    const t = REPORT.replace("2. Medications\nMethocarbamol 500 mg tablet One tablet TID\n", plan);
    assert.deepEqual(extractRecommendations(t).medications, ["Methocarbamol 500 mg tablet One tablet TID."], plan);
  }
  assert.deepEqual(prescribedMedications("Medications Prescribed SIG PRN? Indication\nmethocarbamol 500 mg tablet Half tablet TID\nPRN No\nType Code Description"), [
    "Methocarbamol 500 mg tablet Half tablet TID.",
  ]);
  assert.deepEqual(prescribedMedications("Plan: Recommend lumbar ESI."), []);
});

test("The Plan's own medication wins over the prescription table", () => {
  const t = REPORT.replace("Methocarbamol 500 mg tablet One tablet TID\n3.", "Robaxin 250 TID PRN\n3.");
  assert.deepEqual(extractRecommendations(t).medications, ["Robaxin 250 TID PRN."]);
});

test("Same report flattened into one line still reads every item", () => {
  assert.equal(text(REPORT.replace(/\n/g, " "), false), EXPECTED);
});

test('Never "No specific intervention mentioned." or similar filler', () => {
  const r = extractRecommendations(
    "Plan:\n1. Planned intervention:\n-For the patients lumbar radiculopathy: Recommend L5/S1 lumbar interlaminar epidural steroid injection.\n-For the patients cervical radiculopathy: No specific intervention mentioned.\n2. Medications\nNot documented\n3. Follow up\nNone",
  );
  const out = recommendationsText(recommendationBlocksFrom(r));
  assert.equal(out, "Lumbar\n- L5/S1 lumbar interlaminar epidural steroid injection.");
  assert.doesNotMatch(out, /no specific|not documented|mentioned/i);
});

test("Settings: Region order and Show costs / fees (also what Copy gets)", () => {
  const prefs = normalizeGoatAnswerPrefs({ showCosts: false, regionOrder: ["Lumbar", "Cervical"] });
  assert.deepEqual(prefs.regionOrder.slice(0, 3), ["Lumbar", "Cervical", "Thoracic"]);
  assert.equal(prefs.regionOrder.length, DEFAULT_GOAT_REGION_ORDER.length);
  const out = recommendationsText(recommendationBlocksFrom(extractRecommendations(REPORT), recFormatFromPrefs(prefs)));
  assert.ok(out.startsWith("Lumbar\n- Diagnostic lumbar facet"), out);
  assert.ok(out.indexOf("Cervical\n") > out.indexOf("Lumbar\n"));
  assert.doesNotMatch(out, /\$|Costs/);
  // Defaults match today's live behavior: costs on, head to toe.
  const d = normalizeGoatAnswerPrefs(undefined);
  assert.equal(d.showCosts, true);
  assert.deepEqual(d.regionOrder, ["Cervical", "Thoracic", "Lumbar", "Shoulder", "Elbow", "Wrist/Hand", "Hip", "Knee", "Ankle/Foot"]);
  // Junk / unknown regions / old preview-only fields are dropped.
  const junk = normalizeGoatAnswerPrefs({ showCosts: "no", regionOrder: ["Nose", "Knee", "Knee"], showQuotes: true });
  assert.equal(junk.showCosts, true);
  assert.equal(junk.regionOrder[0], "Knee");
  assert.equal(new Set(junk.regionOrder).size, junk.regionOrder.length);
  assert.ok(!("showQuotes" in junk));
  // SI joint (Sacrum) stays right after Lumbar with an office order.
  const si = recommendationBlocksFrom(
    extractRecommendations("Plan: Recommend right sacroiliac joint injection. Recommend L4-L5 epidural steroid injection. Recommend right knee genicular nerve block."),
    { regionOrder: ["Knee", "Lumbar", "Cervical"] },
  ).map((b) => b.heading);
  assert.deepEqual(si, ["Right Knee", "Lumbar", "Sacrum"]);
});

test("Through askGoat: the Recommendations answer and its Copy text follow the settings", () => {
  const file: GoatFile = { id: "f1", name: "Specialist Report - DR. ARMEN HAROUTUNIAN.pdf", folder: "Specialist", uploaded: "2026-09-30T18:00:00Z", status: "read", method: "text", pages: [REPORT] };
  const ctx = (recFormat?: GoatContext["recFormat"]): GoatContext => ({
    today: "2026-10-11", patientName: "Sample, John", dob: "", phone: "", email: "", address: "", alerts: [], attorney: "", caseStatus: "", lien: "", review: "", isCashPatient: false, doi: "", initialExam: "", priorCare: "", xrayFindings: "", mriFindings: "", specialistRecommendations: "", imaging: [], specialists: [], notes: "", appointments: [], encounters: [], plans: [], diagnoses: [], details: null, billing: null,
    termGroups: DEFAULT_GOAT_TERM_GROUPS,
    people: [{ name: "Dr. Armen Haroutunian", specialty: "Pain Management", referred: true }],
    files: [file],
    recFormat,
  });
  const rec = (c: GoatContext) => askGoat(c, "pm recs").answers.find((a) => a.title === "Recommendations");
  assert.equal(rec(ctx())?.copyText, EXPECTED_COSTS);
  const off = rec(ctx({ showCosts: false, regionOrder: ["Lumbar", "Cervical"] }));
  assert.ok(off?.copyText?.startsWith("Lumbar\n"));
  assert.doesNotMatch(off?.copyText ?? "", /Costs/);
  assert.deepEqual(off?.groups?.[0].blocks.map((b) => b.heading), ["Lumbar", "Cervical", "Alternatives", "Medications", "Follow up"]);
});

console.log(`goat-recs-facet-rfa: ${pass} passed`);
