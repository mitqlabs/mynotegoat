/**
 * Theme surfaces: saved imaging cards and the My Theme color row.
 * Run: npx tsx scripts/tests/theme-surfaces.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const patient = readFileSync(new URL("../../src/components/patient-case-file.tsx", import.meta.url), "utf8");
const encounter = readFileSync(new URL("../../src/components/encounter-workspace.tsx", import.meta.url), "utf8");
const themes = readFileSync(new URL("../../src/components/themes-section.tsx", import.meta.url), "utf8");
const samples = readFileSync(new URL("../../src/components/theme-page-samples.tsx", import.meta.url), "utf8");

assert.equal(patient.includes("bg-amber-50"), false, "patient page saved cards must not use a fixed amber fill");
assert.equal(patient.includes("bg-white/90"), false, "regions fields must not use a fixed white fill");
assert.ok(patient.includes("theme-field"), "regions read-only fields use the theme field fill");
assert.ok(patient.includes("tone-warn-badge"), "Patient Refused keeps a theme-mixed accent");
assert.equal(encounter.includes("bg-[#f6f9fc]"), false, "prior charges must not use a fixed light panel");
assert.equal(encounter.includes("bg-[#fef9e7]"), false, "encounter alert chips must not use a fixed beige fill");

const colorRow = themes.slice(themes.indexOf("function ColorRow"));
assert.ok(colorRow.startsWith("function ColorRow"), "ColorRow is present");
assert.equal(colorRow.includes("<label"), false, "the color row must not be a label, or the empty space opens the picker");
assert.ok(colorRow.includes('type="color"'), "the swatch is still a color input");
assert.ok(colorRow.includes("w-12"), "the swatch stays the small color box");
assert.equal(themes.includes("function LiveSamples"), false, "the three mini previews are gone");
assert.ok(themes.includes("<ThemePageSamples"), "My Theme shows the page samples");

for (const label of ["Patient Page", "Encounter", "Case List", "Patient List"]) {
  assert.ok(samples.includes(label), `sample tab ${label}`);
}
assert.ok(samples.includes("Jane Sample"), "samples use a fake patient name");
assert.ok(samples.includes("Case File"), "encounter sample names the case link Case File");
assert.match(encounter, /href=\{`\/patients\/\$\{selectedPatient\.id\}`\}[\s\S]{0,80}Case File/, "encounter header link to the case is labeled Case File");
assert.ok(samples.includes("Patient Refused"), "patient sample includes a refused X-ray entry");
assert.ok(samples.includes("No regions selected"), "patient sample includes the MRI regions field");
assert.equal(samples.includes("localStorage"), false, "samples do not touch browser storage");
assert.equal(samples.includes("supabase"), false, "samples do not touch the database");
