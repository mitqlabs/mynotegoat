import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SETUP_STEPS,
  doneCount,
  emptyProgress,
  isStepDone,
  mergeProgress,
  normalizeProgress,
  withDismissed,
  withStep,
} from "../../src/lib/setup-walkthrough";

const ids = SETUP_STEPS.map((step) => step.id);
assert.deepEqual(ids, [
  "office-info",
  "hours-closed",
  "staff-roles",
  "providers",
  "attorneys",
  "case-settings",
  "soap-macros",
  "templates",
  "diagnosis-codes",
  "schedule-types",
  "forms",
  "text-reminders",
  "goat",
  "goat-page",
  "documents-files",
  "patient-flow",
]);

for (const step of SETUP_STEPS) {
  assert.ok(step.lines.length >= 4, step.id);
  assert.ok(step.href.startsWith("/"), step.id);
  assert.equal(step.title.includes("phone"), false, step.id);
  assert.equal(step.lines.join(" ").includes("iPhone"), false, step.id);
  assert.equal(/Prime Spine|Dr\. Mike/.test(step.lines.join(" ")), false, step.id);
}

const reminders = SETUP_STEPS.find((step) => step.id === "text-reminders");
assert.match(reminders?.lines.join(" ") ?? "", /Device/);
assert.match(reminders?.href ?? "", /textReminders/);
assert.equal(SETUP_STEPS.find((step) => step.id === "goat")?.title, "G.O.A.T.");
assert.equal(SETUP_STEPS.find((step) => step.id === "goat-page")?.title, "G.O.A.T. Page");
assert.match(SETUP_STEPS.find((step) => step.id === "hours-closed")?.lines.join(" ") ?? "", /Closed/);
assert.match(SETUP_STEPS.find((step) => step.id === "patient-flow")?.lines.join(" ") ?? "", /New Patient/);

const at = "2026-11-24T00:00:00.000Z";
const later = "2026-11-24T01:00:00.000Z";
const marked = withStep(withStep(emptyProgress(), "office-info", true, at), "attorneys", true, at);
assert.equal(isStepDone(marked, "office-info"), true);
assert.equal(doneCount(marked), 2);
const unchecked = withStep(marked, "office-info", false, later);
const merged = mergeProgress(marked, unchecked);
assert.equal(isStepDone(merged, "office-info"), false);
assert.equal(isStepDone(merged, "attorneys"), true);
const dismissed = mergeProgress(withDismissed(emptyProgress(), at), marked);
assert.equal(dismissed.dismissedAt, at);
assert.equal(isStepDone(dismissed, "attorneys"), true);
const unknown = normalizeProgress({ checks: { "not-a-step": { on: true, at } }, dismissedAt: "  " });
assert.deepEqual(unknown, { checks: {} });

const ui = readFileSync("src/components/setup-walkthrough.tsx", "utf8");
const lib = readFileSync("src/lib/setup-walkthrough.ts", "utf8");
assert.match(lib, /dualWriteKvOrThrow/);
assert.match(lib, /fetchKvValue/);
assert.match(ui, /Mark done/);
assert.match(ui, /progressbar/);
assert.equal(ui.includes("localStorage"), false);
assert.equal(ui.includes("bg-blue-"), false);
assert.match(readFileSync("src/app/(portal)/settings/page.tsx", "utf8"), /openSetupWalkthrough/);
assert.match(readFileSync("src/lib/cloud-key-registry.ts", "utf8"), /"casemate\.setup-walkthrough\.v1": "workspace"/);

console.log("setup-walkthrough ok");
