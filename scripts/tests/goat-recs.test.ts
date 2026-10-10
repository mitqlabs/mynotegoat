/**
 * G.O.A.T. recommendations out of a report's Plan (pure; mock report text only).
 * Run:  npx tsx scripts/tests/goat-recs.test.ts
 */
import assert from "node:assert/strict";
import { extractRecommendations, recommendationBlocksFrom, recommendationsText, regionForRec } from "../../src/lib/goat-recs";

// Dr. Armen-style pain-management Plan/Orders with fees (mock).
const FEES = `IMPRESSION:
1. Lumbar radiculopathy.
2. Cervical radiculopathy.
Plan/Orders: 1. Planned intervention:-For the patients lumbar radiculopathy: Recommend Left L5/S1 lumbar interlaminar epidural steroid injection. Professional fees are approximately $8,000. If performed in a surgical center then fees are approximately $15,000. -For the patients cervical
radiculopathy: Recommend Left Cervical C7/T1 interlaminar epidural steroid injection. Professional fees are approximately $8,000. If performed in a surgical center then fees are approximately $15,000. -As an alternative to injection therapy, the patient is also a candidate for 4 sessions of cervical and 4 sessions of lumbar Biowave percutaneous electrical nerve stimulation (PENS) for amplified pain. BioWave PENS is a FDA cleared device for treatment of nociceptive and neuropathic pain including painful spinal and joint conditions. The PENS (percutaneous electrical nerve stimulation) modality uses a patented sterile, single use, array of needles inserted through the skin to facilitate delivery of therapeutic signals into deep tissue. Treatment sessions are 30, minutes each, and must be performed in a physician's office, for a total of 4 treatment sessions per area, typically over 2 to 4 weeks. Medical expenses are $1500 per treatment session.-As an alternative to pain management procedures, Intermittent Disc Decompression (IDD) therapy was discussed in detail with the patient as a conservative approach in the management of the spinal injuries. This technology provides non-invasive treatment for spine discogenic pain. The protocol treatment includes 20 sessions of 30 minutes each over the course of six weeks. The estimated cost is $15,000. 2. Medications None 3. Imaging None 4. Referrals None 5. Follow up 2-4 weeks
Armen Haroutunian, M.D.`;

// Dr. Armen-style PRP Plan where the Planned Intervention items repeat (mock).
const PRP = `ASSESSMENT/PLAN:
1. Planned Intervention:
-For the patient's cervical radiculopathy: Recommend Right C6-C7 interlaminar epidural injection with leukocyte poor platelet rich plasma.
-For the patient's lumbar radiculopathy: Recommend Left L5-S1 lumbar interlaminar epidural injection with leukocyte poor platelet rich plasma.
-For the patient's right shoulder pain: Recommend Ultrasound guided right subacromial bursa PRP injection.
Planned Intervention: Right C6-C7 interlaminar epidural injection with leukocyte poor platelet rich plasma. Professional fees are approximately $6,500.
Planned Intervention: Left L5-S1 lumbar interlaminar epidural injection with leukocyte poor platelet rich plasma. Professional fees are approximately $6,500.
Planned Intervention: Ultrasound guided right subacromial bursa PRP injection. Professional fees are approximately $3,500.
-Alternative to Injection Therapy: As an alternative to injection therapy, the patient is also a candidate for Four sessions of cervical and four sessions of lumbar Biowave percutaneous electrical nerve stimulation (PENS). BioWave PENS is an FDA cleared device for treatment of nociceptive and neuropathic pain. Medical expenses are $1500 per treatment session.
-Alternative to Pain Management: As an alternative to pain management procedures, Intermittent Disc Decompression (IDD/Non-Surgical Spinal Decompression) was discussed in detail with the patient as a conservative approach. The estimated cost is $15,000.
2. Medications None
3. Imaging None
4. Referrals None
5. Follow up 2-4 weeks
Armen Haroutunian, M.D.`;

const prpText = recommendationsText(recommendationBlocksFrom(extractRecommendations(PRP), { showCosts: false }));
console.log(prpText, "\n----");
assert.equal(
  prpText,
  `Cervical
- Right C6-C7 interlaminar epidural injection with leukocyte poor platelet rich plasma.

Lumbar
- Left L5-S1 lumbar interlaminar epidural injection with leukocyte poor platelet rich plasma.

Right Shoulder
- Ultrasound guided right subacromial bursa PRP injection.

Alternatives
- Alternative to Injection Therapy: Four sessions of cervical and four sessions of lumbar Biowave percutaneous electrical nerve stimulation (PENS).
- Alternative to Pain Management: Intermittent Disc Decompression (IDD/Non-Surgical Spinal Decompression).

Follow up
- 2-4 weeks.`,
);

const prpCosts = recommendationsText(recommendationBlocksFrom(extractRecommendations(PRP)));
console.log(prpCosts, "\n----");
assert.match(prpCosts, /\nCosts\n- Cervical: Professional fees are approximately \$6,500\.\n- Lumbar: Professional fees are approximately \$6,500\.\n- Right Shoulder: Professional fees are approximately \$3,500\.\n- Alternative to Injection Therapy: Medical expenses are \$1500 per treatment session\.\n- Alternative to Pain Management: The estimated cost is \$15,000\.$/);

const fees = extractRecommendations(FEES);
const feesText = recommendationsText(recommendationBlocksFrom(fees));
console.log(feesText, "\n----");
assert.deepEqual(
  fees.interventions.map((i) => [i.region, i.text]),
  [
    ["Lumbar", "Left L5/S1 lumbar interlaminar epidural steroid injection."],
    ["Cervical", "Left Cervical C7/T1 interlaminar epidural steroid injection."],
  ],
);
assert.deepEqual(
  fees.alternatives.map((a) => `${a.label}: ${a.text}`),
  [
    "Alternative to Injection Therapy: 4 sessions of cervical and 4 sessions of lumbar Biowave percutaneous electrical nerve stimulation (PENS) for amplified pain.",
    "Alternative to Pain Management: Intermittent Disc Decompression (IDD) therapy.",
  ],
);
assert.deepEqual(fees.medications, []);
assert.deepEqual(fees.followUp, ["2-4 weeks."]);
assert.ok(feesText.startsWith("Cervical\n- Left Cervical C7/T1"), "regions in head-to-toe order");
assert.match(feesText, /- Lumbar: Professional fees are approximately \$8,000\. If performed in a surgical center then fees are approximately \$15,000\./);
assert.doesNotMatch(recommendationsText(recommendationBlocksFrom(fees, { showCosts: false })), /\$/);

// Other doctors' wording for alternatives.
const other = extractRecommendations(`Recommendations: Recommend right knee genicular nerve block. In lieu of injections, the patient could also benefit from 12 sessions of physical therapy. Another option is acupuncture for the lumbar spine. The patient may also consider a lumbar brace. Instead of surgery, conservative care with chiropractic treatment. Medications: Naproxen 500 mg twice daily. Return to clinic in 4 weeks.`);
console.log(JSON.stringify(other, null, 1));
assert.deepEqual(other.interventions.map((i) => [i.region, i.text]), [["Right Knee", "Right knee genicular nerve block."]]);
assert.equal(other.alternatives.length, 4);
assert.equal(other.alternatives[0].label, "Alternative to Injections");
assert.equal(other.alternatives[0].text, "12 sessions of physical therapy.");
assert.equal(other.alternatives[1].text, "Acupuncture for the lumbar spine.");
assert.equal(other.alternatives[2].text, "A lumbar brace.");
assert.equal(other.alternatives[3].label, "Alternative to Surgery");
assert.deepEqual(other.medications, ["Naproxen 500 mg twice daily."]);
assert.deepEqual(other.followUp, ["In 4 weeks."]);

assert.equal(regionForRec("Ultrasound guided right subacromial bursa PRP injection."), "Right Shoulder");
assert.equal(regionForRec("4 sessions of cervical and 4 sessions of lumbar PENS"), "Cervical and Lumbar");
console.log("goat-recs: all tests pass");
