import assert from "node:assert/strict";
import {
  COMPLIANCE_OPTIONS,
  complianceAccess,
  compliancePatchValue,
  complianceRank,
  matchesComplianceFilter,
  normalizeCompliance,
  COMPLIANCE_NOT_SET,
} from "../../src/lib/compliance";
import { getDefaultCaseStatusSettings, normalizeCaseStatusSettings } from "../../src/lib/case-statuses";
import { patientToRow, rowToPatient } from "../../src/lib/patients-cloud";
import { autoMergeRecord } from "../../src/lib/patient-merge";
import { editedPatch, flatten } from "../../src/lib/field-merge";
import type { PatientRecord } from "../../src/lib/mock-data";

// Mock data only.
const mock = (over: Partial<PatientRecord> = {}): PatientRecord =>
  ({ id: "p-mock-1", fullName: "Sample Patient", dob: "1990-01-01", phone: "555-0100", attorney: "Sample Legal", caseStatus: "Active", dateOfLoss: "2026-01-01", lastUpdate: "2026-10-01", ...over }) as PatientRecord;

// The five options, in order.
assert.deepEqual([...COMPLIANCE_OPTIONS], ["New Patient", "Yes", "No", "DNS ATM", "Non-Compliant"]);
assert.equal(normalizeCompliance("dns atm"), "DNS ATM");
assert.equal(normalizeCompliance("Maybe"), undefined);
assert.equal(normalizeCompliance(undefined), undefined);

// Setting is OFF by default, survives a save/load round trip, and junk reads as off.
assert.equal(getDefaultCaseStatusSettings().complianceEnabled, false);
const on = normalizeCaseStatusSettings({ ...getDefaultCaseStatusSettings(), complianceEnabled: true });
assert.equal(on.complianceEnabled, true);
assert.equal(normalizeCaseStatusSettings(JSON.parse(JSON.stringify(on))).complianceEnabled, true, "cloud blob round trip keeps it on");
assert.equal(normalizeCaseStatusSettings({ complianceEnabled: "yes" }).complianceEnabled, false);
assert.equal(normalizeCaseStatusSettings({}).complianceEnabled, false, "old blob without the key = off");
assert.equal(normalizeCaseStatusSettings(null).complianceEnabled, false);

// OWNER (edit access): sees column + field, can edit — only when switched on.
assert.deepEqual(complianceAccess(true, true), { showColumn: true, showField: true, canEdit: true });
assert.deepEqual(complianceAccess(false, true), { showColumn: false, showField: false, canEdit: false }, "off = hidden for the owner");
// TEAM MEMBER with edit access sees what the office switched on; view-only member sees it but can't edit; off = hidden for everyone.
assert.deepEqual(complianceAccess(true, true), { showColumn: true, showField: true, canEdit: true });
assert.deepEqual(complianceAccess(true, false), { showColumn: true, showField: true, canEdit: false });
assert.deepEqual(complianceAccess(false, false), { showColumn: false, showField: false, canEdit: false });

// Cloud row: a patient who never had a value sends NO compliance column (safe before the migration).
assert.equal("compliance" in patientToRow(mock(), "ws-mock"), false);
assert.equal(patientToRow(mock({ compliance: "Yes" }), "ws-mock").compliance, "Yes");
assert.equal(patientToRow(mock({ compliance: "" }), "ws-mock").compliance, null, "cleared = null in the cloud");
// Reading back (owner and team member read the same row).
const row = patientToRow(mock({ compliance: "Non-Compliant" }), "ws-mock");
assert.equal(rowToPatient(row as never).compliance, "Non-Compliant");
assert.equal(rowToPatient({ ...row, compliance: null } as never).compliance, undefined);
assert.equal(rowToPatient({ ...row, compliance: "garbage" } as never).compliance, undefined);
assert.equal(rowToPatient({ ...row, compliance: undefined } as never).compliance, undefined, "row from a DB without the column");

// Patient-file save: nothing is sent unless compliance was edited; a clear is sent as "".
assert.equal(compliancePatchValue("", undefined), undefined);
assert.equal(compliancePatchValue("Yes", undefined), "Yes");
assert.equal(compliancePatchValue("", "Yes"), "");
const loaded = mock();
const base = flatten({ caseStatus: loaded.caseStatus, compliance: compliancePatchValue("", loaded.compliance) });
assert.equal(editedPatch({ caseStatus: "Active", compliance: compliancePatchValue("", loaded.compliance) }, base), null, "untouched = not written");
assert.deepEqual(editedPatch({ caseStatus: "Active", compliance: compliancePatchValue("No", loaded.compliance) }, base), { compliance: "No" });
// Stale tab: another user set "Yes"; this tab only edited status → its save never sends compliance.
assert.deepEqual(editedPatch({ caseStatus: "Paid", compliance: compliancePatchValue("", loaded.compliance) }, base), { caseStatus: "Paid" });

// Filter + sort.
assert.equal(matchesComplianceFilter("Yes", "ALL"), true);
assert.equal(matchesComplianceFilter("Yes", "Yes"), true);
assert.equal(matchesComplianceFilter("Yes", "No"), false);
assert.equal(matchesComplianceFilter(undefined, COMPLIANCE_NOT_SET), true);
assert.equal(matchesComplianceFilter("", COMPLIANCE_NOT_SET), true);
assert.equal(matchesComplianceFilter("DNS ATM", COMPLIANCE_NOT_SET), false);
assert.ok(complianceRank("New Patient") < complianceRank("Non-Compliant") && complianceRank("Non-Compliant") < complianceRank(undefined));

// Merging duplicate patients keeps a value from either record.
assert.equal(autoMergeRecord(mock({ compliance: "Yes" }), mock({ compliance: "No" })).compliance, "Yes");
assert.equal(autoMergeRecord(mock(), mock({ compliance: "No" })).compliance, "No");
assert.equal(autoMergeRecord(mock(), mock()).compliance, undefined);

console.log("PASS compliance (mock data)");
