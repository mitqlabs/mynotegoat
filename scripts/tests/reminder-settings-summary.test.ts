/**
 * Case Flow row summaries. Display text only — nothing is saved here.
 * Run: npx tsx scripts/tests/reminder-settings-summary.test.ts
 */
import assert from "node:assert/strict";
import { getDefaultDashboardWorkspaceSettings } from "../../src/lib/dashboard-workspace-settings";
import {
  lienRowSummary,
  mriRowSummary,
  specialistRowSummary,
  xrayRowSummary,
} from "../../src/lib/reminder-settings-summary";

const statuses = ["Active", "Discharged", "Ready To Submit", "Submitted", "Dropped", "Paid"];
const followUp = () => getDefaultDashboardWorkspaceSettings().patientFollowUp;

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

test("x-ray default counts the chips on screen, not the hidden reviewed flag", () => {
  assert.equal(xrayRowSummary(followUp(), statuses), "Appears on case creation · clears on 3 statuses");
});

test("x-ray off and a single status use the singular", () => {
  const next = followUp();
  next.xrayAppearAuto = false;
  next.xrayClearedBy = ["noXray"];
  next.xrayClearStatuses = ["Paid"];
  assert.equal(xrayRowSummary(next, statuses), "Does not appear on case creation · clears on 2 statuses");
});

test("mri days mode matches the compact summary", () => {
  const next = followUp();
  next.mriAppearMode = "days_from_initial";
  next.mriAppearDays = 25;
  next.mriNoScheduleWarningDays = 4;
  next.mriCtClearedBy = ["patientRefused", "noMri"];
  next.mriCtClearStatuses = ["Active", "Discharged", "Submitted", "Dropped", "Paid", "Ready To Submit"];
  assert.equal(
    mriRowSummary(next, statuses),
    "Appears after 25 days · warns after 4 days · clears on 8 statuses",
  );
});

test("one day stays singular", () => {
  const next = followUp();
  next.mriAppearMode = "days_from_initial";
  next.mriAppearDays = 1;
  next.mriNoScheduleWarningDays = 1;
  next.mriCtClearedBy = ["noMri"];
  next.mriCtClearStatuses = [];
  assert.equal(mriRowSummary(next, statuses), "Appears after 1 day · warns after 1 day · clears on 1 status");
});

test("specialist default names the appear rule", () => {
  assert.equal(
    specialistRowSummary(followUp(), statuses),
    "Appears after MRI completed · warns after 3 days · clears on 4 statuses",
  );
});

test("lien names the selected clear status", () => {
  assert.equal(lienRowSummary(followUp()), "Clears when Received");
  const empty = followUp();
  empty.lienLopClearStatuses = [];
  assert.equal(lienRowSummary(empty), "No clear status chosen");
});

console.log(`${passed} passed`);
