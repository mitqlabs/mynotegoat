/**
 * Smart mode reads the chosen report IN FULL for recommendations (not only the
 * lines the rules matched), Plan / Assessment first, and every model item is
 * checked against the report before it's shown in the regular format.
 * Mock data only (a made-up Premier Pain Solutions style report).
 * Run:  npx tsx scripts/tests/goat-ai-recs.test.ts
 */
import assert from "node:assert/strict";
import type { GoatContext } from "../../src/lib/goat";
import type { GoatFile } from "../../src/lib/goat-docs";
import { extractRecommendations, recommendationBlocksFrom, recommendationsText } from "../../src/lib/goat-recs";
import { chunkReport, chunkText, pickReport, reportLines } from "../../src/lib/goat-ai/report-text";
import { buildRecsMessages, grounded, mergeRecs, parseRecsJson, recsFromAi } from "../../src/lib/goat-ai/recs-ai";

const PREMIER = `PREMIER PAIN SOLUTIONS (MOCK)
Interventional Pain Management
Kevin Tran, M.D.
Patient: Lopez, Daniel (MOCK)   DOB: 02/11/1984
Date of Service: 09/30/2026
INITIAL PAIN MANAGEMENT CONSULTATION
CHIEF COMPLAINT:
Neck pain radiating into the right arm, upper back pain and low back pain after a motor vehicle collision on 07/14/2026.
HISTORY OF PRESENT ILLNESS:
The patient reports constant neck pain rated 7/10 with numbness and tingling into the
right forearm and thumb, and low back pain rated 5/10. He has completed 8 weeks of
chiropractic care with partial relief.
PHYSICAL EXAMINATION:
Cervical spine: Tenderness over the bilateral cervical paraspinals and upper trapezius
with palpable taut bands and referred pain. Spurling's test is positive on the right.
Decreased sensation in the right C6-C7 dermatomes.
Lumbar spine: Tenderness over the lumbar paraspinals. Straight leg raise negative
bilaterally.
DIAGNOSTIC STUDIES:
MRI of the cervical spine dated 08/20/2026 shows a 3 mm disc protrusion at C6-C7 with
right foraminal narrowing.
Plan
1. Cervical radiculopathy (M54.12)
comment: Given persistent radicular symptoms despite conservative care, I recommend cervical
epidural steroid injection targeting C6 - C7 level under fluoroscopic guidance. The
patient may require up to 3 epidurals spaced 2-4 weeks apart depending on his response.
The cost is $7000 per injection.
2. Myofascial pain syndrome (M79.18)
comment: Recommend trigger point injection of upper neck and trapezius areas bilaterally,
totaling 3 muscle groups. The cost is $2500.
3. Lumbar sprain/strain (S39.012A)
comment: Continue chiropractic care and home exercise program for the lumbar spine. If the low
back pain persists he would be a candidate for lumbar medial branch blocks at L4-L5 and
L5-S1 bilaterally. The cost is $4500.
4. Medications
comment: Cyclobenzaprine 10 mg at bedtime as needed for muscle spasm.
Follow up in 3 weeks or after the first injection.
Kevin Tran, M.D.`;

const premier: GoatFile = { id: "f-premier", name: "Premier_Pain_Solutions_09-30-2026.pdf", folder: "Specialist", uploaded: "2026-10-02T18:00:00.000Z", status: "read", method: "text", pages: [PREMIER] };
const mri: GoatFile = {
  id: "f-mri", name: "Cervical_MRI_08-20-2026.pdf", folder: "Imaging", uploaded: "2026-08-22T18:00:00.000Z", status: "read", method: "text",
  pages: ["MRI CERVICAL SPINE WITHOUT CONTRAST\nDate of exam: 08/20/2026\nFINDINGS:\nC6-C7: 3 mm disc protrusion with right foraminal narrowing.\nIMPRESSION:\n1. C6-C7 disc protrusion."],
};
const ctx = (people: GoatContext["people"]): GoatContext => ({
  today: "2026-10-10", patientName: "Lopez, Daniel", dob: "", phone: "", email: "", address: "", alerts: [], attorney: "", caseStatus: "", lien: "", review: "", isCashPatient: false, doi: "", initialExam: "", priorCare: "", xrayFindings: "", mriFindings: "", specialistRecommendations: "", imaging: [], specialists: [], notes: "", encounters: [], plans: [], diagnoses: [], details: null, billing: null, termGroups: [], people, appointments: [],
  files: [mri, premier],
});
let pass = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  pass++;
  console.log(`ok - ${name}`);
};

ok("picks the report by contact name, and the best candidate report when nothing is named", () => {
  const named = pickReport(ctx([{ name: "Premier Pain Solutions", specialty: "Pain Management", referred: true, referralSent: "09/10/2026" }]), "what did premier pain recommend");
  assert.equal(named?.file.id, "f-premier");
  assert.equal(named?.how, "doctor");
  const guess = pickReport(ctx([]), "what were the recommendations");
  assert.equal(guess?.file.id, "f-premier", "the imaging report is not a plan");
  assert.equal(guess?.how, "best guess");
});

ok("the full report goes to the model, Plan first, comment: blocks and wrapped lines kept whole", () => {
  const lines = reportLines(premier);
  const planLine = lines.find((l) => /trigger point injection/.test(l.text));
  assert.equal(planLine?.priority, 0);
  assert.ok(lines.some((l) => /medial branch blocks at L4-L5 and L5-S1 bilaterally/.test(l.text)), "wrapped 'and / L5-S1' rejoined");
  const big = chunkReport(premier, 7000);
  assert.equal(big.length, 1, "this report fits one pass");
  assert.ok(/cervical epidural steroid injection targeting C6 - C7/.test(chunkText(big[0])));
  assert.ok(/MRI of the cervical spine/.test(chunkText(big[0])), "the rest of the report is there too");
  const small = chunkReport(premier, 1200);
  assert.ok(small.length > 1);
  assert.equal(small[0].priority, 0, "first chunk is the Plan");
  assert.ok(/\$7000 per injection/.test(chunkText(small[0])) && /\$2500/.test(chunkText(small[0])) && /Cyclobenzaprine/.test(chunkText(small[0])));
  const msgs = buildRecsMessages(premier.name, chunkText(big[0]));
  assert.equal(msgs[0].role, "system");
  assert.ok(msgs.at(-1)!.content.includes("totaling 3 muscle groups"));
});

// The ACTUAL reply Qwen3-4B (the "More accurate" model) gave with this prompt for this report on the test
// machine (transformers.js, CPU). It missed the trigger point injection; the rules' item fills that gap.
const REPLY = `<think>

</think>

{"interventions":[{"region":"Cervical","text":"Cervical epidural steroid injection targeting C6 - C7 level under fluoroscopic guidance, may require up to 3 epidurals spaced 2-4 weeks apart depending on his response","cost":"$7000"}],"alternatives":[{"label":"If the low back pain persists","text":"Lumbar medial branch blocks at L4-L5 and L5-S1 bilaterally","cost":"$4500"}],"medications":["Cyclobenzaprine 10 mg at bedtime as needed for muscle spasm"],"followUp":["3 weeks or after the first injection"]}`;

ok("model JSON → checked items; made-up items and costs are dropped", () => {
  const j = parseRecsJson(REPLY);
  assert.ok(j);
  const withFake = { ...j!, interventions: [...(j!.interventions ?? []), { region: "Lumbar", text: "Lumbar radiofrequency ablation at L3-L4", cost: "$9000" }] };
  const { recs, dropped } = recsFromAi([withFake], PREMIER);
  assert.equal(recs.interventions.length, 1);
  assert.ok(dropped.some((d) => /radiofrequency/.test(d)));
  assert.equal(recs.alternatives.length, 1);
  assert.ok(!grounded("Cervical epidural steroid injection at C5-C6", PREMIER), "wrong level is not in the report");
  assert.ok(grounded("Cervical epidural steroid injection targeting C6-C7 level", PREMIER), "'C6 - C7' and 'C6-C7' match");
  assert.equal(parseRecsJson("sorry, no JSON"), null);
});

ok("merged with the rules (duplicates dropped) and rendered in the regular format, costs on and off", () => {
  const ai = recsFromAi([parseRecsJson(REPLY)!], PREMIER);
  const merged = mergeRecs(ai.recs, extractRecommendations(PREMIER));
  const on = recommendationsText(recommendationBlocksFrom(merged, { showCosts: true }));
  const expected = [
    "Cervical",
    "- Cervical epidural steroid injection targeting C6 - C7 level under fluoroscopic guidance, may require up to 3 epidurals spaced 2-4 weeks apart depending on his response.",
    "- Trigger point injection of upper neck and trapezius areas bilaterally, totaling 3 muscle groups.",
    "",
    "Alternatives",
    "- If the low back pain persists: Lumbar medial branch blocks at L4-L5 and L5-S1 bilaterally.",
    "",
    "Medications",
    "- Cyclobenzaprine 10 mg at bedtime as needed for muscle spasm.",
    "",
    "Follow up",
    "- 3 weeks or after the first injection.",
  ].join("\n");
  assert.equal(recommendationsText(recommendationBlocksFrom(merged, { showCosts: false })), expected);
  assert.equal(
    on,
    `${expected}\n\nCosts\n- Cervical (cervical epidural steroid injection): $7000 per injection.\n- Trigger point injection: $2500.\n- If the low back pain persists: $4500.`,
  );
  console.log(on);
});

ok("same procedure at another region / level stays a separate item (actual Qwen3-4B reply, Dr. Armen-style Plan)", () => {
  const armen = `{"interventions":[{"region":"Lumbar","text":"Left L5/S1 lumbar interlaminar epidural steroid injection","cost":"$8,000 (professional fees), $15,000 if performed in a surgical center"},{"region":"Cervical","text":"Left Cervical C7/T1 interlaminar epidural steroid injection","cost":"$8,000 (professional fees), $15,000 if performed in a surgical center"}],"alternatives":[{"label":"Alternative to injection therapy","text":"4 sessions of cervical and 4 sessions of lumbar Biowave percutaneous electrical nerve stimulation (PENS)","cost":"$1500 per treatment session"},{"label":"Alternative to pain management procedures","text":"Intermittent Disc Decompression (IDD) therapy","cost":"$15,000"}],"medications":[],"followUp":["2-4 weeks"]}`;
  const plan = "Plan/Orders: 1. Planned intervention:-For the patients lumbar radiculopathy: Recommend Left L5/S1 lumbar interlaminar epidural steroid injection. Professional fees are approximately $8,000. If performed in a surgical center then fees are approximately $15,000. -For the patients cervical radiculopathy: Recommend Left Cervical C7/T1 interlaminar epidural steroid injection. Professional fees are approximately $8,000. If performed in a surgical center then fees are approximately $15,000. -As an alternative to injection therapy, the patient is also a candidate for 4 sessions of cervical and 4 sessions of lumbar Biowave percutaneous electrical nerve stimulation (PENS) for amplified pain. Medical expenses are $1500 per treatment session.-As an alternative to pain management procedures, Intermittent Disc Decompression (IDD) therapy was discussed. The estimated cost is $15,000. 2. Medications None 3. Imaging None 4. Referrals None 5. Follow up 2-4 weeks";
  const { recs } = recsFromAi([parseRecsJson(armen)!], plan);
  assert.deepEqual(recs.interventions.map((i) => i.region), ["Lumbar", "Cervical"]);
  const text = recommendationsText(recommendationBlocksFrom(mergeRecs(recs, extractRecommendations(plan)), { showCosts: false }));
  assert.ok(text.startsWith("Cervical\n- Left Cervical C7/T1 interlaminar epidural steroid injection.\n\nLumbar\n- Left L5/S1 lumbar interlaminar epidural steroid injection.\n\nAlternatives\n"), text);
  assert.ok(!/\$/.test(text));
});

console.log(`goat-ai-recs: ${pass} passed`);
