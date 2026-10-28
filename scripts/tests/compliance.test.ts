import assert from "node:assert/strict";
import {
  COMPLIANCE_OPTIONS,
  addComplianceOption,
  complianceColor,
  complianceLabel,
  complianceUsage,
  getDefaultComplianceOptions,
  mergeComplianceOptions,
  normalizeComplianceOptions,
  removeComplianceOption,
  renameComplianceOption,
  resetComplianceOptions,
  resolveComplianceOption,
  setComplianceOptionColor,
  setComplianceOptionShown,
  liveComplianceOptions,
  shownComplianceOptions,
  complianceAccess,
  compliancePillStyle,
  complianceDisplay,
  compliancePatchValue,
  complianceRank,
  matchesComplianceFilter,
  normalizeCompliance,
  COMPLIANCE_NOT_SET,
} from "../../src/lib/compliance";
import { softPillStyle } from "../../src/lib/color-utils";
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
assert.equal(normalizeCompliance("Maybe"), "Maybe", "any text is kept: it may be a custom option id");
assert.equal(normalizeCompliance("   "), undefined);
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
assert.equal(rowToPatient({ ...row, compliance: "c-custom1" } as never).compliance, "c-custom1", "a custom option id survives the cloud round trip");
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


// ---- Editable Compliance Categories ----
const T1 = "2026-10-27T20:00:00.000Z", T2 = "2026-10-27T21:00:00.000Z", T3 = "2026-10-27T22:00:00.000Z";
const defs = getDefaultComplianceOptions();
assert.deepEqual(defs.map((o) => o.label), [...COMPLIANCE_OPTIONS]);
assert.ok(defs.every((o) => o.show && /^#[0-9a-f]{6}$/.test(o.color)), "defaults have colors and are shown");
assert.equal(complianceColor("DNS ATM", defs), "#f0a43f", "existing colors unchanged");
assert.equal(complianceColor(undefined, defs), null);
// old saved values (the label) keep resolving: default id === original label
assert.equal(resolveComplianceOption("Non-Compliant", defs)?.id, "Non-Compliant");
assert.equal(resolveComplianceOption("yes", defs)?.id, "Yes");

// add (name + color), no duplicates, blank ignored
let opts = addComplianceOption(defs, "Partially Compliant", "#112233", T1, "c-abc");
assert.equal(opts.length, 6);
assert.equal(opts[5].id, "c-abc");
assert.equal(complianceColor("c-abc", opts), "#112233");
assert.equal(addComplianceOption(opts, "  partially   compliant ", "#000000", T2), opts, "duplicate name ignored");
assert.equal(addComplianceOption(opts, "   ", "#000000", T2), opts);

// rename keeps the id, so a patient storing the id is NOT orphaned
opts = renameComplianceOption(opts, "c-abc", "Mostly Compliant", T2);
assert.equal(complianceLabel("c-abc", opts), "Mostly Compliant");
assert.equal(resolveComplianceOption("c-abc", opts)?.id, "c-abc");
opts = renameComplianceOption(opts, "Yes", "Compliant", T2);
assert.equal(complianceLabel("Yes", opts), "Compliant", "a patient saved as Yes shows the new name");
assert.equal(matchesComplianceFilter("Yes", "Yes", opts), true);
assert.equal(renameComplianceOption(opts, "No", "compliant", T3), opts, "can't rename onto an existing name");
// color + show
opts = setComplianceOptionColor(opts, "No", "#010203", T2);
assert.equal(complianceColor("No", opts), "#010203");
assert.equal(setComplianceOptionColor(opts, "No", "red", T3), opts, "bad color ignored");
opts = setComplianceOptionShown(opts, "DNS ATM", false, T2);
assert.ok(!shownComplianceOptions(opts).some((o) => o.id === "DNS ATM"), "hidden = not offered");
assert.equal(complianceLabel("DNS ATM", opts), "DNS ATM", "…but a patient that has it still displays it");
// in-use counts (warn before remove)
const usage = complianceUsage(["Yes", "Yes", "c-abc", "", undefined, "garbage"], opts);
assert.equal(usage.get("Yes"), 2);
assert.equal(usage.get("c-abc"), 1);
assert.equal(usage.get("No"), undefined);
// remove = tombstone; value is not rewritten, shows as Not set; filter "not set" catches it
opts = removeComplianceOption(opts, "c-abc", T3);
assert.equal(liveComplianceOptions(opts).some((o) => o.id === "c-abc"), false);
assert.equal(resolveComplianceOption("c-abc", opts), undefined);
assert.equal(matchesComplianceFilter("c-abc", COMPLIANCE_NOT_SET, opts), true);
assert.ok(complianceRank("c-abc", opts) === liveComplianceOptions(opts).length);
// adding the same name back revives the removed option (same id → those patients are restored)
opts = addComplianceOption(opts, "Mostly Compliant", "#445566", "2026-10-27T23:00:00.000Z");
assert.equal(resolveComplianceOption("c-abc", opts)?.id, "c-abc");
// reset: defaults back (names, colors, order), customs removed
const reset = resetComplianceOptions(opts, "2026-10-28T00:00:00.000Z");
assert.deepEqual(liveComplianceOptions(reset).map((o) => o.label), [...COMPLIANCE_OPTIONS]);
assert.equal(complianceColor("No", reset), "#c9423a");
assert.equal(resolveComplianceOption("c-abc", reset), undefined);

// cloud: junk / partial data is safe; builtins can't vanish; round trip
assert.deepEqual(normalizeComplianceOptions(null).map((o) => o.id), [...COMPLIANCE_OPTIONS]);
assert.deepEqual(normalizeComplianceOptions([]).map((o) => o.id), [...COMPLIANCE_OPTIONS]);
assert.equal(normalizeComplianceOptions([{ id: "c-x", label: "Custom", color: "#abcdef", show: true, sort: 0 }]).length, 6, "missing built-ins are added back");
assert.deepEqual(normalizeComplianceOptions(JSON.parse(JSON.stringify(opts))), normalizeComplianceOptions(opts));
// merge-safe: two devices edit different options → both survive; newer edit of the same option wins; remove wins if newer
const devA = renameComplianceOption(addComplianceOption(defs, "From A", "#111111", T1, "c-a"), "Yes", "Compliant", T2);
const devB = addComplianceOption(setComplianceOptionColor(defs, "No", "#222222", T2), "From B", "#333333", T2, "c-b");
const merged = mergeComplianceOptions(devA, devB);
const ids = liveComplianceOptions(merged).map((o) => o.id);
assert.ok(ids.includes("c-a") && ids.includes("c-b"), "both devices' new options kept");
assert.equal(complianceLabel("Yes", merged), "Compliant");
assert.equal(complianceColor("No", merged), "#222222");
const removedLater = removeComplianceOption(devA, "c-a", T3);
assert.equal(resolveComplianceOption("c-a", mergeComplianceOptions(removedLater, devA)), undefined, "newer remove beats older copy");
assert.equal(resolveComplianceOption("c-a", mergeComplianceOptions(devA, removedLater)), undefined);

// Patient save keeps working with custom ids
assert.equal(compliancePatchValue("c-abc", undefined), "c-abc");
assert.equal(patientToRow(mock({ compliance: "c-abc" }), "ws-mock").compliance, "c-abc");

// Pill colors: the configured color applies, found by stable id or by legacy label
{
  const T = "2026-10-27T00:00:00.000Z";
  let o = renameComplianceOption(getDefaultComplianceOptions(), "DNS ATM", "Do Not Schedule", T);
  o = setComplianceOptionColor(o, "DNS ATM", "#112233", T);
  o = setComplianceOptionColor(o, "No", "#d11f1f", T);
  // stored id and the legacy text value both land on the renamed, recolored option
  for (const stored of ["DNS ATM", "dns atm", "Do Not Schedule"]) {
    const opt = resolveComplianceOption(stored, o);
    assert.equal(opt?.id, "DNS ATM", `${stored} resolves to the renamed option`);
    assert.equal(compliancePillStyle(opt).backgroundColor, "rgba(17, 34, 51, 0.2)", `${stored} uses the configured color (soft tint)`);
  }
  // Compliance is the SAME pill as Case Status: identical style function for the same color
  for (const opt of liveComplianceOptions(o)) {
    assert.deepEqual(compliancePillStyle(opt), softPillStyle(opt.color), `${opt.id} pill == status pill`);
  }
  // text is always readable on its own tint (WCAG AA 4.5:1), dark or light or mid-tone colors
  const lum = (r: number, g: number, b: number) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (const color of ["#112233", "#0d79bf", "#1f9d60", "#c9423a", "#f0a43f", "#f4e526", "#80e74b", "#5f75ff", "#8e3b8f", "#ffffff", "#000000"]) {
    const st = softPillStyle(color);
    const [r, g, b] = rgbOf(color);
    const bg = [r, g, b].map((v) => 255 + (v - 255) * 0.2) as [number, number, number];
    const fg = rgbOf(st.color);
    const ratio = (lum(...bg) + 0.05) / (lum(fg[0], fg[1], fg[2]) + 0.05);
    assert.ok(ratio >= 4.5, `${color} text ${st.color} readable on tint (${ratio.toFixed(2)})`);
  }
  // unset / cleared / unknown / removed → neutral, readable, never blank
  const gone = removeComplianceOption(o, "Non-Compliant", T);
  for (const stored of [undefined, "", "   ", "no-such-option", "Non-Compliant"]) {
    const style = compliancePillStyle(resolveComplianceOption(stored, stored === "Non-Compliant" ? gone : o));
    assert.deepEqual(style, { backgroundColor: "#eef1f4", color: "#475569" }, `unset-like value ${JSON.stringify(stored)} is neutral`);
  }
  // what the list shows: never an empty label
  assert.deepEqual(complianceDisplay(undefined, o).label, "Not set");
  assert.deepEqual(complianceDisplay("   ", o).label, "Not set");
  assert.equal(complianceDisplay("Yes", o).option?.id, "Yes");
  assert.equal(complianceDisplay(" yes ", o).option?.id, "Yes", "whitespace/case still maps to the option");
  assert.equal(complianceDisplay("Non-Compliant", gone).label, "Non-Compliant", "a removed option keeps its name");
  assert.equal(complianceDisplay("Non-Compliant", gone).option, undefined);
  assert.equal(complianceDisplay("c-abc123", o).label, "Unknown option", "an unknown generated id isn't shown raw");
  assert.equal(complianceDisplay("legacy thing", o).label, "legacy thing", "plain legacy text shows as typed");
  for (const v of [undefined, "", " ", "x", "c-zz", "Yes", "No"]) assert.ok(complianceDisplay(v, o).label.trim().length > 0, `label for ${JSON.stringify(v)} is never blank`);
}

console.log("PASS compliance (mock data)");
