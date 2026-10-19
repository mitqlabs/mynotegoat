import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  computeSetupProgress,
  isPracticeInfoDone,
  normalizeOnboardingState,
  shouldAutoOpenSetupGuide,
  type SetupProgressInput,
} from "../../src/lib/onboarding";

// Mock data only (fictional practice).
const office: SetupProgressInput["office"] = {
  officeName: "",
  phone: "",
  address: "",
  doctorName: "",
  multiLocation: false,
  locations: [],
  doctors: [],
};
const empty: SetupProgressInput = { office, appointmentTypeCount: 0, teamMemberCount: 0, patientCount: 0, confirmedSteps: [] };

const p0 = computeSetupProgress(empty);
assert.equal(p0.total, 6);
assert.equal(p0.doneCount, 0);
assert.equal(p0.nextStepId, "practice");

// The office name alone does NOT finish practice info (old popup's bug).
assert.equal(isPracticeInfoDone({ ...office, officeName: "Sample Chiropractic" }), false);
assert.equal(isPracticeInfoDone({ ...office, officeName: "Sample Chiropractic", phone: "(555) 555-0100" }), false);
assert.equal(isPracticeInfoDone({ ...office, officeName: "Sample Chiropractic", phone: "(555) 555-0100", address: "1 Main St, Anytown, ST 12345" }), true);
// Several offices: phone + address live per office.
assert.equal(
  isPracticeInfoDone({ ...office, officeName: "Sample", multiLocation: true, locations: [{ addr1: "1 Main St", phone: "(555) 555-0100" }] }),
  true,
);

const p3 = computeSetupProgress({
  ...empty,
  office: { ...office, officeName: "Sample", phone: "(555) 555-0100", address: "1 Main St", doctors: [{ id: "doc-1", name: "Dr. Sam Sample" }] },
  appointmentTypeCount: 2,
});
assert.equal(p3.doneCount, 3, "Setup 3/6");
assert.equal(p3.nextStepId, "offices", "hours need an explicit OK");
assert.equal(computeSetupProgress({ ...empty, confirmedSteps: ["offices", "team"] }).doneCount, 2, "confirm ticks count");
assert.equal(computeSetupProgress({ ...empty, teamMemberCount: 1 }).steps.find((s) => s.id === "team")?.done, true);
assert.equal(computeSetupProgress({ ...empty, patientCount: 1 }).steps.find((s) => s.id === "firstPatient")?.done, true);
assert.equal(computeSetupProgress({ ...empty, office: { ...office, doctorName: "Dr. Sam Sample" } }).steps.find((s) => s.id === "doctors")?.done, true);

// Auto-open: only a new (blank) practice's owner, until finished or closed.
const st = normalizeOnboardingState(null);
assert.equal(shouldAutoOpenSetupGuide({ isBlankStarter: true, isMember: false, state: st }), true);
assert.equal(shouldAutoOpenSetupGuide({ isBlankStarter: false, isMember: false, state: st }), false, "existing practices never get it popped up");
assert.equal(shouldAutoOpenSetupGuide({ isBlankStarter: true, isMember: true, state: st }), false, "team members never");
assert.equal(shouldAutoOpenSetupGuide({ isBlankStarter: true, isMember: false, state: { ...st, dismissedAt: "2026-11-01T00:00:00Z" } }), false, "closed with ×");
assert.equal(shouldAutoOpenSetupGuide({ isBlankStarter: true, isMember: false, state: { ...st, completedAt: "2026-11-01T00:00:00Z" } }), false);
// Old saved copies (skippedSteps/completedAt only) still load.
assert.deepEqual(normalizeOnboardingState({ skippedSteps: ["x"], completedAt: "2026-01-01" }), {
  skippedSteps: ["x"],
  confirmedSteps: [],
  completedAt: "2026-01-01",
  dismissedAt: undefined,
});

// The guide is closable, shrinks to a pill when it sends you to Settings, and can be reopened.
const modal = readFileSync("src/components/onboarding-modal.tsx", "utf8");
assert.ok(modal.includes('aria-label="Close setup guide"'));
assert.ok(modal.includes('setMode("minimized")'), "Settings links minimize the guide");
assert.ok(modal.includes("Back to setup"));
assert.ok(readFileSync("src/app/(portal)/settings/page.tsx", "utf8").includes("<SetupGuideButton />"), "reopen from Settings");
assert.ok(readFileSync("src/app/(portal)/dashboard/page.tsx", "utf8").includes("<SetupProgressCard />"), "reopen from Dashboard");
assert.ok(!/starter pack|Import Starter Pack/i.test(modal), "no pre-made macro pack");

// Signup: one plan, $199.99/month, no plan choice, no charge.
const signup = readFileSync("src/app/auth/signup/page.tsx", "utf8");
assert.ok(signup.includes('"$199.99"') && signup.includes('"/month"'));
assert.ok(!/1,999|Annual|PERIOD_OPTIONS|setSelectedPeriod/.test(signup), "no monthly/annual choice");
assert.ok(/Payment waived/.test(signup));
assert.ok(!/stripe|checkout/i.test(signup), "signup never starts a payment");

console.log("setup-guide: ok");
