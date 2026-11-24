import assert from "node:assert/strict";
import {
  addAdditionalDoi,
  doiTokens,
  extraDoisFor,
  isoToLongUs,
  isoToShortUs,
  withAllDoisLabel,
  parseAdditionalDois,
  serializeAdditionalDois,
  unionAdditionalDois,
  usInputToIso,
} from "../../src/lib/additional-dois";
import { autoMergeRecord } from "../../src/lib/patient-merge";
import { getDefaultBodyForDocumentScope, renderDocumentTemplate } from "../../src/lib/document-templates";

// parse: tolerant, sorted, unique, drops junk
assert.deepEqual(parseAdditionalDois(undefined), []);
assert.deepEqual(parseAdditionalDois(""), []);
assert.deepEqual(parseAdditionalDois("2026-11-02,2026-01-05, 2026-11-02;nonsense,2026-02-30"), ["2026-01-05", "2026-11-02"]);
assert.equal(serializeAdditionalDois(["2026-11-02", "2026-01-05", "2026-11-02"]), "2026-01-05,2026-11-02");
assert.equal(serializeAdditionalDois([]), "");

// typed input
assert.equal(usInputToIso("11/02/26"), "2026-11-02");
assert.equal(usInputToIso("1/2/2026"), "2026-01-02");
assert.equal(usInputToIso("2026-11-02"), "2026-11-02");
assert.equal(usInputToIso("02/30/26"), "");
assert.equal(usInputToIso("13/01/26"), "");
assert.equal(usInputToIso(""), "");

// display
assert.equal(isoToShortUs("2026-11-02"), "11/02/26");
assert.equal(isoToLongUs("2026-11-02"), "11/02/2026");

// add: refuses bad, duplicate, primary
assert.equal(addAdditionalDoi([], "2026-01-12", "zz").error, "Enter a real date, like 11/02/26.");
assert.match(addAdditionalDoi([], "2026-01-12", "01/12/26").error ?? "", /main date/);
assert.match(addAdditionalDoi(["2026-02-03"], "2026-01-12", "02/03/26").error ?? "", /already added/);
assert.deepEqual(addAdditionalDoi(["2026-03-01"], "2026-01-12", "02/03/26").list, ["2026-02-03", "2026-03-01"]);

// extras never repeat the primary
assert.deepEqual(extraDoisFor("2026-01-12", "2026-01-12,2026-02-03"), ["2026-02-03"]);

// tokens: mm/dd/yy, comma separated
assert.deepEqual(doiTokens("2026-01-12", ""), { ADDITIONAL_DATES_OF_INJURY: "", ALL_DATES_OF_INJURY: "01/12/26" });
assert.deepEqual(doiTokens("2026-01-05", "2026-02-20"), {
  ADDITIONAL_DATES_OF_INJURY: "02/20/26",
  ALL_DATES_OF_INJURY: "01/05/26, 02/20/26",
});
assert.equal(doiTokens("2026-01-12", "2026-02-03,2026-03-04").ALL_DATES_OF_INJURY, "01/12/26, 02/03/26, 03/04/26");
assert.deepEqual(doiTokens("", "2026-02-03"), { ADDITIONAL_DATES_OF_INJURY: "02/03/26", ALL_DATES_OF_INJURY: "02/03/26" });

// MRI / imaging request (the shipped default body) lists every date of injury
const mriBody = getDefaultBodyForDocumentScope("imagingRequest");
assert.match(mriBody, /Date of Injury: \{\{DATE_OF_INJURY\}\}/);
const ctxBase = { PATIENT_FULL_NAME: "Doe, John", DATE_OF_INJURY: "01/05/2026" };
const twoDois = renderDocumentTemplate(mriBody, { ...ctxBase, ...doiTokens("2026-01-05", "2026-02-20") });
assert.match(twoDois, /Dates of Injury: 01\/05\/26, 02\/20\/26/);
assert.doesNotMatch(twoDois, /\{\{/);
// one date: untouched, original wording and format
const oneDoi = renderDocumentTemplate(mriBody, { ...ctxBase, ...doiTokens("2026-01-05", "") });
assert.match(oneDoi, /Date of Injury: 01\/05\/2026/);
assert.doesNotMatch(oneDoi, /Dates of Injury/);
// the specialist referral and saved templates with HTML labels / sentences
const ref = renderDocumentTemplate(getDefaultBodyForDocumentScope("specialistReferral"), { ...ctxBase, ...doiTokens("2026-01-05", "2026-02-20") });
assert.match(ref, /Dates of Injury: 01\/05\/26, 02\/20\/26/);
assert.equal(
  withAllDoisLabel("<b>Date of Injury:</b> {{DATE_OF_INJURY}}"),
  "<b>Dates of Injury:</b> {{ALL_DATES_OF_INJURY}}",
);
assert.equal(withAllDoisLabel("DATE OF INJURY: {{DATE_OF_INJURY}}"), "DATES OF INJURY: {{ALL_DATES_OF_INJURY}}");
assert.equal(withAllDoisLabel("Date Of Injury: {{DATE_OF_INJURY}}"), "Dates Of Injury: {{ALL_DATES_OF_INJURY}}");
assert.equal(
  withAllDoisLabel("related to date of injury {{DATE_OF_INJURY}}."),
  "related to date of injury {{DATE_OF_INJURY}}.",
);

// merge union
assert.equal(unionAdditionalDois("2026-02-03", "2026-02-03,2026-01-01"), "2026-01-01,2026-02-03");
assert.equal(unionAdditionalDois(undefined, undefined), "");

// patient merge keeps every accident, including the other record's main DOI
const rec = (id: string, dateOfLoss: string, additionalDois: string) =>
  ({ id, fullName: "Doe, John", dob: "1990-01-01", phone: "1", attorney: "Self", caseStatus: "Active", compliance: "", lastUpdate: "2026-01-01", priority: "", dateOfLoss, matrix: { additionalDois } }) as never;
const merged = autoMergeRecord(rec("a", "2026-01-05", "2026-02-20"), rec("b", "2026-03-09", "2026-02-20,2026-04-01"));
assert.equal(merged.matrix?.additionalDois, "2026-02-20,2026-03-09,2026-04-01");

console.log("additional-dois: ok");
