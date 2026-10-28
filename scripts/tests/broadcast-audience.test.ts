/**
 * "Message patients" audiences (mock data only).
 * Run: npx tsx scripts/tests/broadcast-audience.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BROADCAST_AUDIENCES,
  DEFAULT_BROADCAST_AUDIENCE,
  broadcastSendDay,
  decodeQueueItemId,
  isActiveCaseStatus,
  pickAudienceRecipients,
  pickBroadcastRecipients,
  broadcastTimeOk,
  type BroadcastPatient,
} from "../../src/lib/reminder-automation";
import { defaultSmsReminderSettings } from "../../src/lib/sms-reminders";
import { broadcastHelp } from "../../src/lib/goat-broadcast-help";
import { answerHowToFull } from "../../src/lib/goat-howto-handbook";

// Default audience + registry
assert.equal(DEFAULT_BROADCAST_AUDIENCE, "active");
assert.deepEqual(BROADCAST_AUDIENCES.map((a) => a.id), ["active", "booked"]);

// "Active" = status Active (any case) or no status
for (const s of ["Active", "active", " ACTIVE ", "", undefined, null]) assert.equal(isActiveCaseStatus(s), true, String(s));
for (const s of ["Discharged", "Ready to Submit", "Submitted", "Dropped", "Paid", "Inactive"]) assert.equal(isActiveCaseStatus(s), false, s);

const P = (id: string, name: string, phone: string, status = "Active", optedOut = false): BroadcastPatient => ({
  patientId: id, patientName: name, phone, caseStatus: status, optedOut,
});
const picked = pickAudienceRecipients("active", [
  P("p3", "Zed, Zoe", "(555) 000-0003"),
  P("p1", "Able, Amy", "555-000-0001"),
  P("p2", "Baker, Bo", "555-000-0002", "Discharged"), // not active
  P("p4", "Cole, Cy", "555-000-0004", "Active", true), // opted out
  P("p5", "Dunn, Di", "123"), // bad phone
  P("p6", "Eve, Ed", ""), // no phone
  P("p7", "Fox, Flo", "1 (555) 000-0001"), // same phone as p1 → deduped
  P("p8", "Gray, Gus", "555-000-0008", ""), // no status → active
  P("p1", "Able, Amy", "555-000-0001"), // same patient twice
  P("p9", "Hart, Hal", "555-000-0009", "Paid"),
]);
assert.deepEqual(picked.map((r) => r.patientId), ["p1", "p8", "p3"]);
assert.ok(picked.every((r) => r.appointmentId === "" && r.time === ""));

// No appointment needed in the queue: an empty visit time passes a broadcast with no window
assert.equal(broadcastTimeOk("", {}), true);
assert.equal(broadcastTimeOk("", { notBefore: "09:00" }), false); // a window is only ever set for Booked on a day

// Booked audience now also dedupes by phone (siblings on one phone get one text)
const booked = pickBroadcastRecipients(
  [
    { appointmentId: "a1", patientId: "k1", patientName: "Kid A", time: "09:00", status: "Scheduled", phone: "555-000-0100" },
    { appointmentId: "a2", patientId: "k2", patientName: "Kid B", time: "10:00", status: "Scheduled", phone: "(555) 000-0100" },
    { appointmentId: "a3", patientId: "k3", patientName: "Other", time: "11:00", status: "Scheduled", phone: "555-000-0101" },
  ],
  { excludeCanceled: true },
);
assert.deepEqual(booked.map((r) => r.patientId), ["k1", "k3"]);

// Send day: today, except the evening of quiet hours (then tomorrow, so it doesn't expire)
const s = { ...defaultSmsReminderSettings, timeZone: "America/Los_Angeles", quietStartHour: 21, quietEndHour: 8 };
assert.deepEqual(broadcastSendDay(new Date("2026-10-27T19:00:00Z"), s), { iso: "2026-10-27", deferred: false }); // noon PDT
assert.deepEqual(broadcastSendDay(new Date("2026-10-28T05:47:00Z"), s), { iso: "2026-10-28", deferred: true }); // 10:47 PM PDT
assert.deepEqual(broadcastSendDay(new Date("2026-10-27T10:00:00Z"), s), { iso: "2026-10-27", deferred: true }); // 3 AM PDT: still today
assert.deepEqual(broadcastSendDay(new Date("2026-10-27T15:30:00Z"), s), { iso: "2026-10-27", deferred: false }); // 8:30 AM PDT
assert.deepEqual(broadcastSendDay(new Date("2026-10-28T05:47:00Z"), { ...s, quietStartHour: 0, quietEndHour: 0 }), { iso: "2026-10-27", deferred: false }); // quiet hours off

// Queue ids for broadcast recipients are unchanged
assert.deepEqual(decodeQueueItemId("b:abc", "2026-10-27"), { kind: "broadcast", recipientId: "abc" });

// G.O.A.T.
const who = broadcastHelp("who does broadcast send to?");
assert.ok(who);
assert.match(who.text, /All active patients/);
assert.match(who.text, /Booked on a day/);
assert.match(who.text, /STOP/);
assert.ok(who.links.some((l) => l.href === "/handbook#chapter-message-patients"));
assert.ok(broadcastHelp("how do I text all active patients"));
assert.ok(broadcastHelp("can I broadcast that we're closed thursday"));
assert.equal(broadcastHelp("what's on the schedule tomorrow"), null);
assert.equal(broadcastHelp("tell Hannah to call the patient"), null);
assert.equal(broadcastHelp("/todo broadcast"), null);
assert.equal(broadcastHelp("who does broadcast send to?", { canSeeSettings: false })!.links.length, 1);

// Handbook: chapter exists and is findable
const hb = readFileSync("src/lib/handbook-content.ts", "utf8");
assert.match(hb, /id: "message-patients"/);
assert.match(hb, /Send to: All active patients/);
const ans = answerHowToFull("how do I send a broadcast text to all active patients", { admin: true, manager: true });
assert.ok(ans.found, ans.text);

console.log("broadcast audience tests passed");
