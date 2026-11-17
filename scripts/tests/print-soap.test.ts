/**
 * SOAP print layout: each visit starts on a new page, and short region
 * lines stay together. Run: npx tsx scripts/tests/print-soap.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSoapPrintDocument,
  buildSoapPrintFragment,
  prepareSoapPrintHtml,
  SOAP_PRINT_CSS,
  SOAP_PRINT_PAGE_CSS,
} from "../../src/lib/print-soap";

const office = {
  officeName: "Northside Spine Clinic",
  officeAddress: "100 Example Avenue",
  officePhone: "(512) 555-0148",
  officeFax: "",
  officeEmail: "records@example-clinic.test",
  logoDataUrl: "",
  patientName: "Hale, Jordan",
};

const encounters = [
  {
    encounterDate: "08/01/2026",
    provider: "Dr. Alex Rivera",
    appointmentType: "Personal Injury New Patient",
    soap: { subjective: "<p>Neck pain.</p>", objective: "", assessment: "", plan: "" },
  },
  {
    encounterDate: "08/15/2026",
    provider: "Dr. Alex Rivera",
    appointmentType: "Personal Injury Office Visit",
    soap: { subjective: "<p>Follow up.</p>", objective: "", assessment: "", plan: "" },
  },
  {
    encounterDate: "09/03/2026",
    provider: "Dr. Alex Rivera",
    appointmentType: "Personal Injury Discharge Visit",
    soap: { subjective: "<p>Much improved.</p>", objective: "", assessment: "", plan: "" },
  },
];

const doc = buildSoapPrintDocument({ ...office, encounters });
const fragment = buildSoapPrintFragment({ ...office, encounters });

assert.match(SOAP_PRINT_PAGE_CSS, /@page/);
assert.match(SOAP_PRINT_PAGE_CSS, /margin:\s*0\.7in/);
assert.match(doc, /@page/);
assert.match(SOAP_PRINT_CSS, /break-before:\s*page/);
assert.match(SOAP_PRINT_CSS, /page-break-before:\s*always/);
assert.match(SOAP_PRINT_CSS, /\.soap-label[\s\S]*break-after:\s*avoid/);
assert.match(SOAP_PRINT_CSS, /\.soap-keep[\s\S]*break-inside:\s*avoid/);
assert.doesNotMatch(SOAP_PRINT_CSS, /#0d79bf/);
assert.match(SOAP_PRINT_CSS, /color:\s*#111/);
assert.doesNotMatch(SOAP_PRINT_CSS, /break-before:\s*auto\s*!important/);

const articles = [...doc.matchAll(/<article class="([^"]+)">/g)].map((match) => match[1]);
assert.deepEqual(articles, ["encounter", "encounter encounter-new-page", "encounter encounter-new-page"]);
assert.match(doc, /09\/03\/2026/);
assert.match(doc, /Personal Injury Discharge Visit/);
assert.match(doc, /Provider:/);
assert.equal(fragment.includes("encounter-new-page"), true);
assert.equal((fragment.match(/encounter-new-page/g) || []).length, 2);

const region = prepareSoapPrintHtml("<p><strong>Cervical:</strong> tenderness at the joints.</p>");
assert.match(region, /class="soap-keep"/);
assert.doesNotMatch(region, /soap-heading/);

const heading = prepareSoapPrintHtml("<p><strong>Cervical:</strong></p>");
assert.match(heading, /soap-heading/);
assert.match(heading, /break-after|soap-heading/);

const split = prepareSoapPrintHtml("<p>Cervical: tight.<br>Lumbar: sore.</p>");
assert.equal((split.match(/soap-keep/g) || []).length, 2);
assert.match(split, /Cervical: tight\./);
assert.match(split, /Lumbar: sore\./);

const prompt = prepareSoapPrintHtml(
  '<p>Cervical: <span class="macro-prompt" contenteditable="false" data-prompt-id="q1">Adjustment</span> to the neck.</p>',
);
assert.match(prompt, /Adjustment/);
assert.doesNotMatch(prompt, /macro-prompt/);
assert.doesNotMatch(prompt, /contenteditable/);

const long = prepareSoapPrintHtml(`<p>${"word ".repeat(400)}</p>`);
assert.doesNotMatch(long, /soap-keep/);

assert.equal(prepareSoapPrintHtml("   "), '<p class="soap-keep">-</p>');
assert.equal(buildSoapPrintFragment({ ...office, encounters: [] }), "");

const workspace = readFileSync(new URL("../../src/components/encounter-workspace.tsx", import.meta.url), "utf8");
const caseFile = readFileSync(new URL("../../src/components/patient-case-file.tsx", import.meta.url), "utf8");
assert.match(workspace, /buildSoapPrintDocument/);
assert.match(caseFile, /buildSoapPrintFragment/);
assert.match(caseFile, /SOAP_PRINT_CSS/);
assert.doesNotMatch(workspace, /break-before:\s*auto\s*!important/);
assert.doesNotMatch(caseFile, /break-before:\s*auto\s*!important/);

console.log("print-soap ok");
