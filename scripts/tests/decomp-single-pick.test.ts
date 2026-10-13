/**
 * Spinal Decompression: one Targeted Segment and one program per section.
 * Mock data only.  Run:  npx tsx scripts/tests/decomp-single-pick.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDecompressionSinglePick } from "../../src/lib/treatment-plans";
import { renderMacroTemplate } from "../../src/lib/macro-templates";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };

test("detects the two single-pick prompts on decompression macros only", () => {
  assert.ok(isDecompressionSinglePick("Spinal Decompression", "Targeted Segment"));
  assert.ok(isDecompressionSinglePick("Spinal Decompression", "Which program"));
  assert.ok(!isDecompressionSinglePick("Spinal Decompression", "Weight"));
  assert.ok(!isDecompressionSinglePick("Massage", "Targeted Segment"));
});
test("macro text with one pick (array shape kept)", () => {
  const body = "Decompression to the [[seg]] using [[prog]].";
  assert.equal(renderMacroTemplate(body, { seg: ["L4-L5"], prog: ["Legacy 3"] }, {}), "Decompression to the L4-L5 using Legacy 3.");
});
test("legacy saved multi-pick still renders unchanged", () => {
  const out = renderMacroTemplate("to the [[seg]]", { seg: ["L4-L5", "L5-S1"] }, {});
  assert.match(out, /L4-L5.*L5-S1/);
});
test("UIs replace instead of toggling for single-pick prompts", () => {
  const enc = readFileSync("src/components/encounter-workspace.tsx", "utf8");
  assert.match(enc, /singlePick \? \(\s*<input[\s\S]*?\[question\.id\]: \[option\]/);
  const plan = readFileSync("src/components/treatment-plan-section.tsx", "utf8");
  assert.match(plan, /treatments: cur\.includes\(t\) && cur\.length === 1 \? \[\] : \[t\]/);
  assert.match(plan, /\{decompDef\.treatmentsLabel\} \(pick one\)/);
  const settings = readFileSync("src/components/macro-settings-panel.tsx", "utf8");
  assert.match(settings, /singlePick \? \(/);
});
console.log(`${passed} passed`);
