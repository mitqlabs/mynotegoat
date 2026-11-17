/**
 * SOAP macro chips, option A. Run: npx tsx scripts/tests/soap-macro-groups.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupSoapMacros, isBodyRegionMacroName, orderComplaintMacros, soapMacroChipClass } from "../../src/lib/soap-macro-groups";

const names = [
  "MVC HX",
  "MVC HX SD",
  "S&F HX",
  "SD Return",
  "Gap In Care",
  "Vitals",
  "Medical & Family HX",
  "Functional Limitation",
  "Chief Complaints",
  "Head",
  "Cervical",
  "Thoracic",
  "Lumbar",
  "Chest",
  "Shoulder",
  "Upper Extremity",
  "Elbow",
  "Wrist/Hand",
  "Lower Extremity",
  "Knee",
  "Ankle/Foot",
];

const groups = groupSoapMacros(names.map((buttonName, index) => ({ id: String(index), buttonName })));
assert.deepEqual(groups.map((group) => group.label), ["History", "Body regions"]);
assert.equal(groups[0].quiet, false);
assert.equal(groups[1].quiet, false);
assert.deepEqual(
  groups[0].macros.map((macro) => macro.buttonName),
  names.slice(0, 9),
);
assert.deepEqual(
  groups[1].macros.map((macro) => macro.buttonName),
  names.slice(9),
);
assert.equal(isBodyRegionMacroName("Pain Intake"), false);
assert.equal(isBodyRegionMacroName("Follow-Up Plan"), false);
assert.equal(soapMacroChipClass(true, false), soapMacroChipClass(false, false));
assert.match(soapMacroChipClass(false, false), /font-semibold/);
assert.doesNotMatch(soapMacroChipClass(true, false), /text-\[var\(--text-muted\)\]/);
assert.match(soapMacroChipClass(true, true), /opacity-40/);

const ordered = orderComplaintMacros(
  ["Knee", "Extra chip", "Headaches", "Cervical", "Ankle/Foot"].map((buttonName) => ({ buttonName })),
);
assert.deepEqual(ordered.map((macro) => macro.buttonName), ["Headaches", "Cervical", "Knee", "Ankle/Foot", "Extra chip"]);

const workspace = readFileSync(new URL("../../src/components/encounter-workspace.tsx", import.meta.url), "utf8");
assert.match(workspace, /groupSoapMacros\(group\.macros\)/);
assert.match(workspace, /orderComplaintMacros\(group\.macros\)/);
assert.match(workspace, /Complaints/);
assert.match(workspace, /xl:grid-cols-8/);
assert.doesNotMatch(workspace, />HISTORY<|>BODY REGIONS</);
assert.match(workspace, /soapMacroChipClass\(macroGroup\.quiet/);

const dx = readFileSync(new URL("../../src/components/dx-suggestions.tsx", import.meta.url), "utf8");
assert.match(dx, /casemate\.dx-suggestions-collapsed\.v1/);
assert.match(dx, /aria-expanded/);
const registry = readFileSync(new URL("../../src/lib/cloud-key-registry.ts", import.meta.url), "utf8");
assert.match(registry, /"casemate\.dx-suggestions-collapsed\.v1": "user"/);

const editor = readFileSync(new URL("../../src/components/rich-text-template-editor.tsx", import.meta.url), "utf8");
assert.doesNotMatch(editor, />\s*Undo\s*</);
assert.doesNotMatch(editor, />\s*Bullets\s*</);
assert.doesNotMatch(editor, />\s*Numbered\s*</);
assert.doesNotMatch(editor, />\s*Line Break\s*</);
assert.match(editor, /label="Undo"/);
assert.match(editor, /label="Bullets"/);
assert.match(editor, />Clear</);

console.log("soap-macro-groups ok");
