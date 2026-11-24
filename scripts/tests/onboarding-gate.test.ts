import assert from "node:assert/strict";
import { mayShowSetupWizard } from "../../src/lib/onboarding-gate";
const empty = { ok: true, patients: 0, appointments: 0, kvKeys: [] as string[] };
// Owner of a brand-new empty office: wizard allowed.
assert.equal(mayShowSetupWizard({ isTeamMember: false, localCompleted: false, probe: empty }), true);
// Owner with data (Glendale-like) after local cache cleared: never.
assert.equal(mayShowSetupWizard({ isTeamMember: false, localCompleted: false, probe: { ...empty, patients: 654, appointments: 5880 } }), false);
assert.equal(mayShowSetupWizard({ isTeamMember: false, localCompleted: false, probe: { ...empty, appointments: 1 } }), false);
// Cloud has setup flag / office settings only.
assert.equal(mayShowSetupWizard({ isTeamMember: false, localCompleted: false, probe: { ...empty, kvKeys: ["casemate.onboarding.v1"] } }), false);
assert.equal(mayShowSetupWizard({ isTeamMember: false, localCompleted: false, probe: { ...empty, kvKeys: ["casemate.office-settings.v1"] } }), false);
// Team member: never.
assert.equal(mayShowSetupWizard({ isTeamMember: true, localCompleted: false, probe: empty }), false);
// Unknown / offline / error: never.
assert.equal(mayShowSetupWizard({ isTeamMember: false, localCompleted: false, probe: null }), false);
assert.equal(mayShowSetupWizard({ isTeamMember: false, localCompleted: false, probe: { ...empty, ok: false } }), false);
assert.equal(mayShowSetupWizard({ isTeamMember: false, localCompleted: true, probe: empty }), false);
console.log("onboarding-gate ok");
