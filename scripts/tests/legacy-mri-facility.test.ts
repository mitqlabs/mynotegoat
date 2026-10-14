import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isFacilityOnlyMriText, usableLegacyMriFindings } from "../../src/lib/legacy-mri";

// Mock names only.
for (const t of ["MOCK IMAGING CENTER", "Sample Diagnostic Imaging", "Demo MRI Centers of Nowhere", "ACME RADIOLOGY", "N/A", "Patient Refused", "COMPLETED PRIOR CARE", "EXAMPLE OPEN"])
  assert.equal(isFacilityOnlyMriText(t), true, t);
assert.equal(isFacilityOnlyMriText("Mock Place", ["mock place"]), true, "matches an entry's center");
for (const t of [
  "L4-L5 disc herniation 3 mm with mild foraminal narrowing",
  "C5-6 bulge",
  "Impression: unremarkable lumbar spine",
  "Mild stenosis at L3",
  "Small annular tear at L5-S1 seen at Mock Imaging Center",
])
  assert.equal(isFacilityOnlyMriText(t), false, `keeps real findings: ${t}`);
assert.equal(usableLegacyMriFindings("MOCK IMAGING CENTER"), "");
assert.equal(usableLegacyMriFindings(" C5-6 bulge "), "C5-6 bulge");
assert.equal(usableLegacyMriFindings(""), "");

// Importer no longer copies the facility into findings; UI/reports/G.O.A.T. use the filtered value.
assert.doesNotMatch(readFileSync("src/lib/casemate-sql-parser.ts", "utf8"), /matrix\.mriCtFindings\s*=\s*mriFacility/);
const pcf = readFileSync("src/components/patient-case-file.tsx", "utf8");
assert.match(pcf, /\{legacyMriFindingsUsable && \(/);
assert.match(pcf, /mriFindings: legacyMriFindingsUsable/);
assert.match(readFileSync("src/lib/goat-context.ts", "utf8"), /usableLegacyMriFindings\(m\.mriCtFindings/);
console.log("legacy-mri-facility: ok");
