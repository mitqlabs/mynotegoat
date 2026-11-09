/**
 * Assistant matching and confirm-card states.
 * Run: npx tsx scripts/tests/goat-assistant-match.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findPatient, understand } from "../../src/lib/goat-understand";
import { emptyDialog, goatTurn, type DialogCtx } from "../../src/lib/goat-dialog";
import { getDefaultScheduleSettings } from "../../src/lib/schedule-settings";
import type { PracticeData } from "../../src/lib/goat-practice";

const TODAY = "2026-11-09";
const patients = [
  { id: "t", fullName: "Smith, Tyler", caseStatus: "Active" },
  { id: "k", fullName: "Testpatient, Kara", caseStatus: "Active" },
  { id: "h", fullName: "Hall, Brianna", caseStatus: "Active" },
  { id: "j1", fullName: "Ramsey, John", caseStatus: "Active" },
  { id: "j2", fullName: "Marks, John", caseStatus: "Active" },
];
const u = (q: string, lastPatientId?: string) => understand(q, { today: TODAY, patients, lastPatientId });

const typo = u("book tylr smith tomorrow at 3");
assert.equal(typo.patient?.fullName, "Smith, Tyler");
assert.equal(typo.typo, true);
assert.equal(typo.ask, null);

const exact = u("book tyler smith tomorrow at 3");
assert.equal(exact.patient?.fullName, "Smith, Tyler");
assert.equal(exact.typo, false);

// "call" is an everyday word. It must never be read as Hall.
const call = findPatient("call tomorrow", patients);
assert.equal(call.patient, null);
const callHall = findPatient("call Hall tomorrow", patients);
assert.equal(callHall.patient?.fullName, "Hall, Brianna");
const callTyler = findPatient("todo call tyler smith", patients);
assert.equal(callTyler.patient?.fullName, "Smith, Tyler");

// A typed name beats the open chart. A pronoun uses the remembered patient.
const named = u("book kara tomorrow at 3", "t");
assert.equal(named.patient?.fullName, "Testpatient, Kara");
const remembered = u("book her tomorrow at 3", "k");
assert.equal(remembered.patient?.fullName, "Testpatient, Kara");
assert.equal(remembered.typo, false);

const several = u("book john tomorrow at 3");
assert.equal(several.patient, null);
assert.equal(several.ask, "Which patient?");
assert.ok(several.ambiguous.length >= 2);

const none = u("book Zzzzzz tomorrow at 3");
assert.equal(none.patient, null);
assert.equal(none.ask, "No match");
assert.equal(none.ambiguous.length, 0);

const data: PracticeData = {
  today: TODAY,
  patients: patients.map((p) => ({ id: p.id, fullName: p.fullName, caseStatus: "Active", attorney: "" })) as PracticeData["patients"],
  tasks: [],
  contacts: [],
  appointments: [],
};
const ctx: DialogCtx = { data, team: [], openPatientId: null, settings: getDefaultScheduleSettings() };
const blocked = goatTurn("move her appointment to friday", emptyDialog(), ctx);
assert.equal(blocked.reply.kind, "unsupported");
if (blocked.reply.kind === "unsupported") assert.match(blocked.reply.say, /^I can't do that yet/);

const popup = readFileSync(new URL("../../src/components/global-goat.tsx", import.meta.url), "utf8");
assert.match(popup, /Saving…/);
assert.match(popup, />Retry</);
assert.match(popup, /u\.ask === "Which patient\?"/);
assert.match(popup, /Using \$\{who\.fullName\}/);
assert.match(popup, /question: `\$\{p\.fullName\} \$\{typed\}`/);

console.log("goat assistant match ok");
