/**
 * Smart mode gets the same recommendations the regular G.O.A.T. extracts from
 * a report's Plan (One Touch EMR "Plan" + diagnosis "comment:" blocks).
 * Mock report text only. Run:  npx tsx scripts/tests/goat-smart-plan-recs.test.ts
 */
import assert from "node:assert/strict";
import { buildAiSources, sourcesForPrompt } from "../../src/lib/goat-ai/sources";
import type { GoatContext } from "../../src/lib/goat";
import { DEFAULT_GOAT_TERM_GROUPS } from "../../src/lib/goat-terms";

const REPORT = `Premier Pain Solutions
Date of Service: 08/14/2026
Plan
1. Cervical Radiculopathy [M.54.12]
comment:
Considering MRI findings and correlation with physical exam, recommend cervical epidural steroid injection targeting C6 - C7 level. Risks and benefits reviewed in detail. Patient may require up to 3 epidurals to optimize pain management. Professional fee for cervical epidural steroid injection is $7000 per injection.
2. Cervical Disc Herniation [M.50.20]
comment:
MRI findings:
C4 - C5: 2.6 mm disc bulge. Bilateral neural foraminal stenosis.
3. Myofascial Pain [M79.18]
comment:
Recommend trigger point injection of upper neck and trapezius areas bilaterally, totaling 3 muscle groups for myofascial pain treatment. Professional fee including ultrasound use $2500.
Signed by Provider: Dr. Andre Yarian`;

const ctx: GoatContext = {
  today: "2026-10-10", patientName: "Patient, Test", dob: "", phone: "", email: "", address: "", alerts: [], attorney: "", caseStatus: "", lien: "", review: "", isCashPatient: false, doi: "", initialExam: "", priorCare: "", xrayFindings: "", mriFindings: "", specialistRecommendations: "", imaging: [], specialists: [], notes: "", appointments: [], encounters: [], plans: [], diagnoses: [], details: null, billing: null,
  termGroups: DEFAULT_GOAT_TERM_GROUPS,
  people: [{ name: "Premier Pain Solutions", specialty: "Pain Management", referred: true }],
  files: [{ id: "f1", name: "072426TEST Patient - Specialist Report - Premier Pain Solutions.pdf", folder: "Specialist", uploaded: "2026-08-20T17:00:00Z", status: "read", method: "text", pages: [REPORT] }],
};

const r = buildAiSources(ctx, "what was the pain management recs");
const text = sourcesForPrompt(r.sources);
console.log(text);
assert.ok(r.intents.includes("recommend"), "\"recs\" is a recommendation question");
const page = r.sources.find((s) => s.kind === "page" && s.title.startsWith("Recommendations"));
assert.ok(page, "regular G.O.A.T.'s extracted recommendations are a Smart mode source");
assert.match(text, /Cervical epidural steroid injection targeting C6-C7 level \(may require up to 3 epidurals\)\./);
assert.match(text, /Trigger point injection of upper neck and trapezius areas bilaterally, totaling 3 muscle groups\./);
assert.ok(r.sources.some((s) => s.kind === "file"), "the report itself is still a source");
console.log("goat-smart-plan-recs: pass");
