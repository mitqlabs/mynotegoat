/**
 * "When was the MRI?" must list only real MRI REPORTS:
 *  - a referral / order form is never an MRI report (even with MRI in its name, or "REFER" instead of "referral");
 *  - regions come only from what the report itself states (title / sub-headings / impression), never from a
 *    checklist, history or letterhead elsewhere in the file;
 *  - a report's date is its own — never borrowed from another file or from the MRI panel of a different study.
 * Mock text only.   Run: npx tsx scripts/tests/goat-mri-referral.test.ts
 */
import assert from "node:assert/strict";
import { classifyFactsDoc, extractFileFacts, isReferralForm } from "../../src/lib/goat-facts";
import { imagingFactsAnswer } from "../../src/lib/goat-facts-answer";
import { classifyDoc, type GoatFile } from "../../src/lib/goat-docs";
import type { GoatContext } from "../../src/lib/goat";

let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log(`ok - ${name}`); };
const file = (id: string, name: string, text: string) => ({ id, name, pages: [text], status: "read", uploaded: "2026-04-02T00:00:00Z" }) as unknown as GoatFile;

const REPORT = `Mockview Imaging Center
MRI CERVICAL AND LUMBAR SPINE WITHOUT CONTRAST
Patient: Sample, Pat
Exam Date: 03/29/2026
CLINICAL INDICATION: neck and low back pain, left hand numbness, right knee pain.
CERVICAL SPINE:
IMPRESSION:
1. C4-5 3 mm disc protrusion.
LUMBAR SPINE:
1. L4-L5 4 mm disc herniation.
`;
// Checklist-style order form: lists many body parts and a (different) date, no impression.
const REFERRAL = `MRI ORDER
Patient: Sample, Pat
Please schedule the following (check all that apply):
[ ] Cervical  [ ] Thoracic  [ ] Lumbar  [ ] Shoulder  [ ] Knee  [ ] Hip  [ ] Wrist/Hand
Referring provider: Dr. Mock
Signed 03/29/2026
`;
const plainForm = `Sample, Pat\nCervical Thoracic Lumbar Knee Hip Wrist Hand\nDate: 03/29/2026\n`;

test("'REFER' in the file name is a referral, not an MRI report", () => {
  assert.equal(classifyFactsDoc("020926XX Sample, Pat - MRI REFER BIC CL.pdf", plainForm), "referral");
  assert.equal(classifyFactsDoc("MRI referral.pdf", plainForm), "referral");
  assert.equal(classifyFactsDoc("MRI order form.pdf", plainForm), "referral");
  assert.equal(classifyFactsDoc("020926XX_MRI_REPORT_BIC_CL.pdf", REPORT), "mri");
  assert.equal(classifyFactsDoc("scan.pdf", REPORT), "mri");
});

test("referral wording in the text (no referral in the name) is a referral", () => {
  assert.equal(classifyFactsDoc("scan2.pdf", REFERRAL), "referral");
  assert.equal(isReferralForm("scan3.pdf", "MRI REFERRAL FORM\nDate of Referral: 03/01/2026"), true);
});

test("a real report that mentions the referral keeps its own type", () => {
  const rep = `MRI LUMBAR SPINE\nReferred to us by Dr. Mock for back pain.\nIMPRESSION:\n1. L4-5 bulge.\n`;
  assert.equal(classifyFactsDoc("lumbar.pdf", rep), "mri");
});

test("G.O.A.T.'s file classifier also treats 'REFER' names as referrals", () => {
  assert.equal(classifyDoc(file("a", "Sample - MRI REFER BIC.pdf", "Cervical Thoracic Lumbar Knee Hip")), "referral");
});

test("regions come only from the report's own title / sub-headings / impression", () => {
  const f = extractFileFacts(file("r1", "MRI_REPORT.pdf", REPORT));
  assert.deepEqual(f.regions, ["Cervical", "Lumbar"]); // not Hand / Knee from the clinical-indication line
  assert.equal(f.mainDate, "03/29/2026");
});

test("a knee MRI is a knee MRI (region literally in the title)", () => {
  const f = extractFileFacts(file("r2", "MRI_knee.pdf", "MRI LEFT KNEE WITHOUT CONTRAST\nExam Date: 04/01/2026\nIMPRESSION:\n1. Medial meniscus tear.\n"));
  assert.deepEqual(f.regions, ["Knee"]);
});

test("a referral form is classed as a referral (never an imaging report)", () => {
  const f = extractFileFacts(file("f1", "Sample - MRI REFER BIC.pdf", REFERRAL));
  assert.equal(f.docType, "referral");
});

const ctx = (imaging: unknown[]) => ({ patientName: "Sample, Pat", imaging }) as unknown as GoatContext;
const box = { modality: "MRI", center: "Mockview", regions: ["Lumbar"], doneDate: "2026-03-29", scheduledDate: "", findings: "", refused: false };

test("'when was the MRI' shows ONE report — the referral is not counted", () => {
  const facts = [file("r", "MRI_REPORT.pdf", REPORT), file("f", "Sample - MRI REFER BIC.pdf", REFERRAL)].map(extractFileFacts);
  const ans = imagingFactsAnswer(ctx([box]), "when was sample's mri", facts)!;
  const text = ans.lines.join("\n");
  assert.ok(!/reports on file/.test(text), text);
  assert.match(text, /Cervical, Lumbar MRI was done on 03\/29\/2026/);
  assert.ok(!/Knee|Hip|Wrist/.test(text));
  assert.deepEqual(ans.sources?.map((s) => s.name), ["MRI_REPORT.pdf"]);
});

test("a report with no date of its own doesn't borrow another file's / the panel's date when several files exist", () => {
  const undated = `MRI LUMBAR SPINE\nIMPRESSION:\n1. L4-5 bulge.\n`;
  const facts = [file("a", "MRI_one.pdf", undated), file("b", "MRI_two.pdf", REPORT)].map(extractFileFacts);
  const ans = imagingFactsAnswer(ctx([box]), "when was sample's mri", facts)!;
  const undatedLine = ans.lines.find((l) => /Lumbar MRI/.test(l) && !/Cervical/.test(l))!;
  assert.match(undatedLine, /no date found in the report/);
});

test("single report + single done study: panel date may fill the gap (same study)", () => {
  const facts = [file("a", "MRI_one.pdf", `MRI LUMBAR SPINE\nIMPRESSION:\n1. L4-5 bulge.\n`)].map(extractFileFacts);
  const ans = imagingFactsAnswer(ctx([box]), "when was sample's mri", facts)!;
  assert.match(ans.lines.join(" "), /done on 03\/29\/2026/);
});

console.log(`\n${n} passed`);
