import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installMockWindow, PARTIAL_SAVED, snapshotEffectiveDefaults } from "./fixtures/effective-defaults-snapshot";
import {
  BLANK_STARTER_CUTOFF_ISO,
  makeBlankStarterMarker,
  parseWorkspaceStarter,
  shouldMarkBlankStarter,
  WORKSPACE_STARTER_KEY,
} from "../../src/lib/workspace-starter";
import { cloudBackingFor } from "../../src/lib/cloud-key-registry";

// Mock data only (fictional workspaces, no real ids or names).

async function main() {
// ── 1. EXISTING workspaces: effective settings are exactly what main shows ──
// legacy-effective-defaults.json was produced by running the snapshot against
// origin/main before this change. No marker = legacy = byte-for-byte the same.
const golden = JSON.parse(readFileSync("scripts/tests/fixtures/legacy-effective-defaults.json", "utf8"));
const now = await snapshotEffectiveDefaults();
assert.deepEqual(now, golden, "existing workspace (no marker): effective settings unchanged");

// A broken / unknown marker is also legacy, never blank.
async function snapshotWithMarker(marker: unknown) {
  const appt = await import("../../src/lib/schedule-appointment-types");
  const billing = await import("../../src/lib/billing-macros");
  const sched = await import("../../src/lib/schedule-settings");
  installMockWindow(marker === null ? {} : { [WORKSPACE_STARTER_KEY]: marker });
  return {
    types: appt.loadAppointmentTypes().length,
    tx: billing.loadBillingMacroLibrary().treatments.length,
    mon: sched.loadScheduleSettings().officeHours[1],
  };
}
for (const bad of ["legacy", "{not json", { starter: "Blank" }, { starter: true }, "", null]) {
  const s = await snapshotWithMarker(bad);
  assert.equal(s.types, 8, `marker ${JSON.stringify(bad)} → legacy appointment types`);
  assert.equal(s.tx, 6, `marker ${JSON.stringify(bad)} → legacy charges`);
  assert.equal(s.mon.end, "18:00");
}

// ── 2. NEW practice (blank marker): starts clean ──
{
  installMockWindow({ [WORKSPACE_STARTER_KEY]: makeBlankStarterMarker(new Date("2026-11-01T00:00:00Z")) });
  const appt = await import("../../src/lib/schedule-appointment-types");
  const sched = await import("../../src/lib/schedule-settings");
  const billing = await import("../../src/lib/billing-macros");
  const macros = await import("../../src/lib/macro-templates");
  const soap = await import("../../src/lib/soap-macros");
  const docs = await import("../../src/lib/document-templates");
  const reports = await import("../../src/lib/report-templates");
  const statuses = await import("../../src/lib/case-statuses");
  const sms = await import("../../src/lib/sms-templates");

  assert.deepEqual(appt.loadAppointmentTypes(), [], "no appointment types");
  assert.deepEqual(appt.normalizeAppointmentTypes([]), [], "an emptied list stays empty");
  const b = billing.loadBillingMacroLibrary();
  assert.deepEqual([b.treatments.length, b.diagnoses.length, b.bundles.length, b.packages.length], [0, 0, 0, 0], "no charges/prices/Dx/bundles");
  assert.deepEqual(b.diagnosisFolders.map((f) => f.name), ["General"], "only the General folder");
  // A new practice saving its first own code does NOT get anyone else's codes merged in.
  const own = billing.normalizeBillingMacroLibrary(PARTIAL_SAVED["casemate.billing-macros.v1"]);
  assert.deepEqual(own.diagnoses.map((d) => d.code), ["M54.2"]);
  assert.deepEqual(own.treatments.map((t) => t.procedureCode), ["99203"]);
  const m = macros.loadMacroLibrary();
  assert.equal(m.templates.length, 0, "no SOAP macros");
  assert.notEqual(m.setName, "Default PI Macros");
  assert.deepEqual(soap.loadSoapMacros(), { subjective: [], objective: [], assessment: [], plan: [] });
  assert.equal(reports.loadNarrativeReportLibrary().templates.length, 0, "no narrative report");
  const d = docs.loadDocumentTemplateLibrary();
  assert.deepEqual(d.templates.map((t) => t.scope), ["specialistReferral", "imagingRequest"], "the two letters the referral/imaging buttons need");
  assert.ok(d.templates.every((t) => t.body.length < 200), "…as short skeletons, not the full letters");
  const hours = sched.loadScheduleSettings().officeHours;
  assert.deepEqual(hours.filter((h) => h.enabled).map((h) => h.dayOfWeek), [1, 2, 3, 4, 5], "Mon–Fri open");
  assert.ok(hours.every((h) => h.start === "09:00" && h.end === "17:00"), "9–5");
  // Kept: case statuses (Case Flow depends on them).
  assert.deepEqual(statuses.loadCaseStatusSettings().statuses.map((s) => s.name), ["Active", "Discharged", "Ready To Submit", "Submitted", "Dropped", "Paid"]);
  // Texts sign off with the practice's own name.
  assert.equal(sms.getDefaultReminderBody(), sms.NEUTRAL_REMINDER_BODY);
  const all = JSON.stringify({ a: appt.loadAppointmentTypes(), b, m, d, r: reports.loadNarrativeReportLibrary(), s: sms.getDefaultSmsTemplates() });
  for (const leak of ["Prime Spine", "Glendale", "818-", "91205", "Personal Injury"]) {
    assert.ok(!all.includes(leak), `no "${leak}" in a new practice's defaults`);
  }
}

}

void (async () => {
// ── 3. Who gets the blank marker ──
const before = "2026-10-05T18:56:34Z"; // like every account that exists today
const after = "2026-11-02T10:00:00Z";
const base = { isOwner: true, userCreatedAt: after, cloudKeys: [] as string[] | null, cloudMarker: undefined, localMarker: null };
assert.equal(shouldMarkBlankStarter(base), true, "brand-new owner, empty workspace");
assert.equal(shouldMarkBlankStarter({ ...base, userCreatedAt: before }), false, "existing account stays legacy");
assert.equal(shouldMarkBlankStarter({ ...base, userCreatedAt: BLANK_STARTER_CUTOFF_ISO }), true, "cutoff is inclusive");
assert.equal(shouldMarkBlankStarter({ ...base, userCreatedAt: undefined }), false, "unknown age → legacy");
assert.equal(shouldMarkBlankStarter({ ...base, isOwner: false }), false, "a team member never decides");
assert.equal(shouldMarkBlankStarter({ ...base, cloudKeys: null }), false, "cloud unreadable → never guess");
assert.equal(shouldMarkBlankStarter({ ...base, cloudKeys: ["casemate.office-settings.v1"] }), false, "has saved settings → legacy");
assert.equal(shouldMarkBlankStarter({ ...base, cloudKeys: ["casemate.user-prefs.v1.u.abc"] }), true, "per-user prefs don't count as practice data");
assert.equal(shouldMarkBlankStarter({ ...base, cloudKeys: ["casemate.referral-checked.v2.u.abc"] }), true, "per-user referral ticks don't count as practice data");
assert.equal(shouldMarkBlankStarter({ ...base, cloudKeys: ["casemate.user-prefs.v1.u.abc", "casemate.tasks.v1"] }), false, "any real practice data keeps it legacy");
assert.equal(
  shouldMarkBlankStarter({ ...base, cloudKeys: ["casemate.office-settings.v1"], localMarker: JSON.stringify(makeBlankStarterMarker()) }),
  true,
  "re-saves a blank decision this browser made when the first cloud write failed",
);
assert.equal(shouldMarkBlankStarter({ ...base, cloudMarker: makeBlankStarterMarker() }), false, "already marked");
assert.equal(shouldMarkBlankStarter({ ...base, cloudMarker: { starter: "legacy" } }), false, "an explicit non-blank marker is respected");
assert.equal(parseWorkspaceStarter(JSON.stringify(makeBlankStarterMarker())), "blank");
assert.equal(parseWorkspaceStarter(undefined), "legacy");
assert.ok(Date.parse(BLANK_STARTER_CUTOFF_ISO) > Date.parse(before), "cutoff is after every existing account");

// ── 4. Wiring: marker is cloud-backed and pulled at boot; decided before first-run push ──
assert.equal(cloudBackingFor(WORKSPACE_STARTER_KEY), "workspace");
const cs = readFileSync("src/lib/cloud-state.ts", "utf8");
assert.ok(cs.includes('"casemate.workspace-starter.v1",'), "marker hydrates with the other workspace keys");
assert.ok(cs.indexOf("await decideWorkspaceStarter(remoteKv)") < cs.indexOf("if (remoteKv.size === 0)"), "decision runs before the first-run push");

await main();
console.log("workspace-starter: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
