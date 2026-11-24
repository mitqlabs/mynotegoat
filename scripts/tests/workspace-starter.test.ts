import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getDefaultAppointmentTypes } from "../../src/lib/schedule-appointment-types";
import { getDefaultScheduleSettings } from "../../src/lib/schedule-settings";
import { getDefaultSoapMacros } from "../../src/lib/soap-macros";
import { getDefaultBillingMacroLibrary } from "../../src/lib/billing-macros";
import { getDefaultMacroLibrary } from "../../src/lib/macro-templates";
import { getDefaultDocumentTemplateLibrary } from "../../src/lib/document-templates";
import { getDefaultNarrativeReportLibrary } from "../../src/lib/report-templates";
import { getDefaultMarketingReps } from "../../src/lib/marketing-reps";
import { getDefaultContactDirectory } from "../../src/lib/contact-directory";
import { defaultSmsReminderSettings, DEFAULT_BIRTHDAY_MESSAGE } from "../../src/lib/sms-reminders";
import { getDefaultSmsTemplates } from "../../src/lib/sms-templates";
import { DEFAULT_REMINDER_BODY } from "../../src/lib/sms-template-core";
import { planAutoTextMigration } from "../../src/lib/message-library";
import { getDefaultCaseStatuses } from "../../src/lib/case-statuses";
import {
  WORKSPACE_STARTER_KEY,
  creationFlagFromMetadata,
  resolveCreationFlag,
  shouldMarkBlankStarter,
  makeBlankStarterMarker,
} from "../../src/lib/workspace-starter";

const legacyTypes = getDefaultAppointmentTypes().map((type) => type.name);
const legacyMonday = getDefaultScheduleSettings().officeHours.find((day) => day.dayOfWeek === 1);
const legacySoap = getDefaultSoapMacros().subjective.slice();
const legacyBilling = getDefaultBillingMacroLibrary();
const legacyMacros = getDefaultMacroLibrary().templates.length;
const legacyDocs = getDefaultDocumentTemplateLibrary().templates.map((template) => template.body);
const legacyReports = getDefaultNarrativeReportLibrary().templates.length;
const legacyRep = getDefaultMarketingReps().map((rep) => rep.name);
const legacyBirthday = defaultSmsReminderSettings().birthdayMessage;
const legacyReminder = getDefaultSmsTemplates().find((template) => /remind/i.test(template.name))?.body;
const legacyCases = getDefaultCaseStatuses().map((status) => status.name);

assert.ok(legacyTypes.includes("Personal Injury Office Visit"));
assert.equal(legacyMonday?.start, "08:00");
assert.equal(legacyMonday?.end, "18:00");
assert.ok(legacySoap.includes("Headaches"));
assert.ok(legacyBilling.treatments.length > 0);
assert.ok(legacyBilling.diagnosisFolders.some((folder) => folder.name === "Cervical"));
assert.ok(legacyMacros > 0);
assert.ok(legacyDocs.some((body) => body.includes("specialist evaluation")));
assert.equal(legacyReports, 1);
assert.deepEqual(legacyRep, ["Dr. Mike"]);
assert.equal(legacyBirthday, DEFAULT_BIRTHDAY_MESSAGE);
assert.equal(legacyReminder, DEFAULT_REMINDER_BODY);
assert.ok(legacyCases.includes("Active"));
assert.equal(getDefaultContactDirectory().length, 0);

const store: Record<string, string> = {
  [WORKSPACE_STARTER_KEY]: JSON.stringify(makeBlankStarterMarker(new Date("2026-11-24T00:00:00.000Z"))),
};
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    },
  },
});

assert.deepEqual(getDefaultAppointmentTypes(), []);
const blankMonday = getDefaultScheduleSettings().officeHours;
assert.equal(blankMonday.find((day) => day.dayOfWeek === 1)?.start, "09:00");
assert.equal(blankMonday.find((day) => day.dayOfWeek === 1)?.end, "17:00");
assert.equal(blankMonday.find((day) => day.dayOfWeek === 0)?.enabled, false);
assert.equal(blankMonday.find((day) => day.dayOfWeek === 6)?.enabled, false);
assert.equal(getDefaultScheduleSettings().appointmentIntervalMin, 15);
assert.deepEqual(getDefaultSoapMacros(), { subjective: [], objective: [], assessment: [], plan: [] });
const blankBilling = getDefaultBillingMacroLibrary();
assert.deepEqual(blankBilling.treatments, []);
assert.deepEqual(blankBilling.diagnoses, []);
assert.deepEqual(blankBilling.bundles, []);
assert.deepEqual(blankBilling.diagnosisFolders.map((folder) => folder.name), ["General"]);
assert.equal(getDefaultMacroLibrary().templates.length, 0);
assert.equal(getDefaultNarrativeReportLibrary().templates.length, 0);
assert.deepEqual(getDefaultMarketingReps(), []);
assert.equal(getDefaultContactDirectory().length, 0);
const blankDocs = getDefaultDocumentTemplateLibrary();
assert.equal(blankDocs.templates.length, 2);
assert.ok(blankDocs.templates.every((template) => template.body.includes("{{OFFICE_NAME}}")));
assert.ok(blankDocs.templates.every((template) => !template.body.includes("specialist evaluation")));
assert.equal(defaultSmsReminderSettings().birthdayMessage, "Happy birthday, {first name}!");
const blankReminder = getDefaultSmsTemplates().find((template) => /remind/i.test(template.name))?.body ?? "";
assert.match(blankReminder, /\{\{OFFICE_NAME\}\}/);
assert.equal(blankReminder.includes("Prime Spine"), false);
assert.deepEqual(getDefaultCaseStatuses().map((status) => status.name), legacyCases);

const migration = planAutoTextMigration(defaultSmsReminderSettings(), [], "2026-11-24T00:00:00.000Z");
assert.ok(migration);
assert.equal(migration.addMessages.some((message) => message.body.includes("Prime Spine")), false);
assert.ok(migration.addMessages.some((message) => message.body.includes("{{OFFICE_NAME}}")));

const empty = { isOwner: true, isDemo: false, creationFlag: true, cloudKeys: [] as string[], cloudMarker: null, localMarker: null };
assert.equal(shouldMarkBlankStarter(empty), true);
assert.equal(shouldMarkBlankStarter({ ...empty, creationFlag: false }), false);
assert.equal(shouldMarkBlankStarter({ ...empty, isOwner: false }), false);
assert.equal(shouldMarkBlankStarter({ ...empty, isDemo: true }), false);
assert.equal(shouldMarkBlankStarter({ ...empty, cloudKeys: null }), false);
assert.equal(shouldMarkBlankStarter({ ...empty, cloudKeys: ["casemate.office-settings.v1"] }), false);
assert.equal(shouldMarkBlankStarter({ ...empty, cloudKeys: ["casemate.setup-walkthrough.v1", "casemate.onboarding.v1"] }), true);
assert.equal(shouldMarkBlankStarter({ ...empty, cloudKeys: [WORKSPACE_STARTER_KEY] }), false);
assert.equal(
  shouldMarkBlankStarter({
    ...empty,
    cloudKeys: ["casemate.office-settings.v1"],
    localMarker: makeBlankStarterMarker(),
  }),
  true,
);
assert.equal(creationFlagFromMetadata({ office_starter: "blank" }), true);
assert.equal(creationFlagFromMetadata({ selected_period: "monthly" }), false);
assert.equal(resolveCreationFlag({ metadataFlag: true, profileCleanStart: false }), false);
assert.equal(resolveCreationFlag({ metadataFlag: false, profileCleanStart: true }), true);
assert.equal(resolveCreationFlag({ metadataFlag: true, profileCleanStart: null }), true);
assert.equal(resolveCreationFlag({ metadataFlag: false, profileCleanStart: null }), false);

const signup = readFileSync("src/app/auth/signup/page.tsx", "utf8");
assert.match(signup, /OFFICE_STARTER_METADATA_KEY/);
assert.match(signup, /\$199\.99/);
assert.match(signup, /\$1,999\.99/);
const migrationSql = readFileSync("supabase/migrations/20261124010000_office_clean_start.sql", "utf8");
assert.match(migrationSql, /clean_start boolean not null default false/);
assert.match(migrationSql, /'pending', true/);

console.log("workspace-starter ok");
