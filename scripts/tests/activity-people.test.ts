/**
 * Activity Log "Person" filter: lists the WHOLE team (not only people with entries in the period) and
 * a person also matches entries about them. Mock data only.
 * Run:  npx tsx scripts/tests/activity-people.test.ts
 */
import assert from "node:assert/strict";
import { buildPersonOptions, entryMatchesPerson, type RosterPerson } from "../../src/lib/activity-people";
import type { ActivityEntry } from "../../src/lib/activity-log";

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  id: "e", createdAt: "2026-10-27T21:18:00Z", actorLabel: "Mike Galstyan", actorEmail: "mike@example.test", actorUserId: "u-mike", actorRole: "admin",
  category: "team", action: "x", summary: "", patientId: "", patientName: "", details: {}, ...over,
});
const roster: RosterPerson[] = [
  { userId: "u-owner", label: "Office Owner", email: "owner@example.test" },
  { userId: "u-mike", label: "Mike Galstyan", email: "mike@example.test" },
  { userId: "u-hannah", label: "Hannah Mitchell", email: "hannah@example.test" },
  { userId: "u-leilani", label: "Leilani Kahale", email: "leilani@example.test" },
  { userId: "u-keosha", label: "Keosha Moore", email: "keosha@example.test" },
];
let passed = 0;
const test = (n: string, f: () => void) => { f(); passed++; console.log(`ok - ${n}`); };

test("everyone on the roster is listed even with ZERO entries in the period (Hannah, Leilani, Keosha)", () => {
  const labels = buildPersonOptions([], roster).map((o) => o.label);
  for (const n of ["Hannah Mitchell", "Leilani Kahale", "Keosha Moore", "Mike Galstyan", "Office Owner"]) assert.ok(labels.includes(n), n);
});
test("a person in the log AND on the roster is listed once (matched by user id or email)", () => {
  const opts = buildPersonOptions([entry({}), entry({ actorUserId: "", actorEmail: "MIKE@example.test" })], roster);
  assert.equal(opts.filter((o) => o.label === "Mike Galstyan").length, 1);
  assert.equal(opts.length, roster.length);
});
test("someone only in the log (removed member) is still selectable", () => {
  const opts = buildPersonOptions([entry({ actorLabel: "Former Staff", actorEmail: "former@example.test", actorUserId: "u-gone" })], roster);
  assert.ok(opts.some((o) => o.label === "Former Staff"));
  assert.equal(opts.length, roster.length + 1);
});
test("selecting Hannah matches entries about her (Mike's rows) and ones she did", () => {
  const hannah = buildPersonOptions([], roster).find((o) => o.label === "Hannah Mitchell")!;
  assert.equal(entryMatchesPerson(entry({ summary: "Hannah Mitchell: changed main location" }), hannah), true);
  assert.equal(entryMatchesPerson(entry({ actorUserId: "u-hannah", actorLabel: "Hannah Mitchell", summary: "Signed a note" }), hannah), true);
  assert.equal(entryMatchesPerson(entry({ summary: "Keosha Moore: role set to staff" }), hannah), false);
  assert.equal(entryMatchesPerson(entry({ summary: "Opened a chart" }), hannah), false);
});
test("selecting Mike matches only what Mike did or what is about him", () => {
  const mike = buildPersonOptions([], roster).find((o) => o.label === "Mike Galstyan")!;
  assert.equal(entryMatchesPerson(entry({ summary: "Hannah Mitchell: role set to manager" }), mike), true); // he is the actor
  assert.equal(entryMatchesPerson(entry({ actorUserId: "u-hannah", actorLabel: "Hannah Mitchell", actorEmail: "hannah@example.test", summary: "Opened a chart" }), mike), false);
});
console.log(`\n${passed} passed`);
