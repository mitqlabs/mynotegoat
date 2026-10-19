/**
 * How-to answers only from real catalogs, booking requests, and
 * "No visits on file". Mock data only.  Run:  npx tsx scripts/tests/goat-howto-booking.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOWTO_QUESTION, HOWTO_UNSURE, answerHowTo, isBookingRequest, resolveRequestedDay } from "../../src/lib/goat-howto";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };
const MON = "2026-10-12"; // a Monday

test("how do I add a new patient -> real labels", () => {
  assert.ok(HOWTO_QUESTION.test("How do I add a new patient"));
  const a = answerHowTo("How do I add a new patient");
  assert.ok(a.found);
  assert.match(a.text, /Patient List/);
  assert.match(a.text, /New Patient/);
  assert.ok(!/settings page/i.test(a.text));
  assert.equal(a.links[0].href, "/patients");
});
test("labels in the catalog exist in the UI code", () => {
  const has = (f: string, label: string) => assert.ok(readFileSync(f, "utf8").includes(label), `${label} in ${f}`);
  has("src/app/(portal)/patients/page.tsx", "New Patient");
  has("src/app/(portal)/appointments/page.tsx", "New Appointment");
  has("src/app/(portal)/appointments/page.tsx", "New patient");
  has("src/app/(portal)/contacts/page.tsx", "Add Contact");
  has("src/components/patient-case-file.tsx", "+ To Do");
  has("src/components/patient-case-file.tsx", "Open Encounters For This Patient");
});
test("other how-tos", () => {
  assert.match(answerHowTo("how do i add a contact").text, /Add Contact/);
  assert.match(answerHowTo("how can I book an appointment").text, /New Appointment/);
  assert.equal(answerHowTo("where do I change office hours").found, true);
});
test("unknown how-to says not sure", () => {
  const a = answerHowTo("how do I fly the zeppelin");
  assert.equal(a.found, false);
  assert.equal(a.text, HOWTO_UNSURE);
});
test("booking intent (typos too), not schedule lookups", () => {
  assert.ok(isBookingRequest("schedule a new appointment for armen next thursdau"));
  assert.ok(isBookingRequest("can you schedule armen for thursday at 1pm"));
  assert.ok(isBookingRequest("book jane sample friday"));
  assert.ok(isBookingRequest("shedule john tomorrow"));
  assert.ok(isBookingRequest("add an appt for sam on 10/20"));
  assert.ok(!isBookingRequest("what's on the schedule today"));
  assert.ok(!isBookingRequest("who is on the schedule tomorrow"));
  assert.ok(!isBookingRequest("when is armen's next visit"));
});
test("date resolution", () => {
  const r = resolveRequestedDay("schedule armen next thursdau", MON)!;
  // Weekday rule: "next <day>" = the occurrence after the coming one; a bare weekday on that day = today.
  assert.equal(r.iso, "2026-10-22");
  assert.match(r.note, /10\/22\/2026/);
  assert.equal(resolveRequestedDay("book him thursday", "2026-10-15")!.iso, "2026-10-15");
  assert.equal(resolveRequestedDay("book tomorrow", MON)!.iso, "2026-10-13");
  assert.equal(resolveRequestedDay("book 10/20", MON)!.iso, "2026-10-20");
  assert.equal(resolveRequestedDay("book 01/05", MON)!.iso, "2027-01-05");
});
test("wiring: chips stay in the bubble; how-to before booking before lookups; schedule reads ?date", () => {
  const g = readFileSync("src/components/global-goat.tsx", "utf8");
  assert.ok(g.includes("picked: label"));
  assert.ok(!/choices: undefined/.test(g));
  assert.ok(g.indexOf("answerHowTo(question)") < g.indexOf("if (isBookingRequest(question))"));
  assert.ok(g.indexOf("if (isBookingRequest(question))") < g.indexOf("tryPractice(question, Boolean"));
  assert.ok(readFileSync("src/app/(portal)/appointments/page.tsx", "utf8").includes('.get("date")'));
  assert.ok(readFileSync("src/lib/goat.ts", "utf8").includes('"No visits on file."'));
});
console.log(`${passed} passed`);
