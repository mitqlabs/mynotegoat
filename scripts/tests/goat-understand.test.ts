/**
 * G.O.A.T. understanding: 100+ messy phrasings → action + patient (mock data only).
 * Run: npx tsx scripts/tests/goat-understand.test.ts
 */
import assert from "node:assert/strict";
import { GOAT_ACTIONS, findDate, findPatient, findTime, phraseTemplate, understand, type ActionId, type UContext } from "../../src/lib/goat-understand";

const ctx: UContext = {
  today: "2026-10-20", // Tuesday
  patients: [
    { id: "P1", fullName: "Smith, John", caseStatus: "Active" },
    { id: "P2", fullName: "Rivera, Ana", caseStatus: "Active" },
    { id: "P3", fullName: "Kim, Cara", caseStatus: "Active" },
    { id: "P4", fullName: "Nazarian, Vahe", caseStatus: "Active" },
    { id: "P5", fullName: "Lopez, Ben", caseStatus: "Discharged" },
  ],
  lastPatientId: "P2",
  attorneys: ["Mock Injury Lawyers", "Test Legal LLP", "Sample Law Group APC"],
};

// [phrase, action, patient id or null]
const CASES: Array<[string, ActionId | null, string | null]> = [
  // book
  ["book john smith tmrw at 3", "book", "P1"],
  ["schedual jon smth wensday 2pm", "book", "P1"],
  ["can u get smith in next tues morning", "book", "P1"],
  ["set her up for friday", "book", "P2"],
  ["appt for john smith 10/24 9:30", "book", "P1"],
  ["Book Ana Rivera for a re-exam thursday 10am", "book", "P2"],
  ["pls book cara kim tomorrow", "book", "P3"],
  ["boook vahe nazarian fri 11", "book", "P4"],
  ["schedule nazarian for monday at 4", "book", "P4"],
  ["put rivera on the schedule wed at 1:30", "book", "P2"],
  ["make an appointment for kara kim next week", "book", "P3"],
  ["bring john in tomorrow at noon", "book", "P1"],
  ["book smith 3pm today", "book", "P1"],
  ["sched ana 11/2 at 10", "book", "P2"],
  ["schedule kim cara friday afternoon", "book", "P3"],
  ["could you book vahe tomorrow 9am", "book", "P4"],
  ["get ana rivera in thurs at 2", "book", "P2"],
  ["book jhon smith wed 4p", "book", "P1"],
  // reschedule
  ["reschedule john smith to friday at 10", "reschedule", "P1"],
  ["move jon smiths appt to tmrw 2pm", "reschedule", "P1"],
  ["push smith to next tuesday", "reschedule", "P1"],
  ["resched ana rivera thursday 3", "reschedule", "P2"],
  ["rescedule kim to 11/3 at 9", "reschedule", "P3"],
  ["move her appointment to monday", "reschedule", "P2"],
  ["bump nazarian to 4pm", "reschedule", "P4"],
  ["change cara kims appt to friday 10am", "reschedule", "P3"],
  ["can we move vahe's visit to wed", "reschedule", "P4"],
  ["reschedual john tmrw 11", "reschedule", "P1"],
  // cancel
  ["cancel john smiths appt tmrw", "cancel", "P1"],
  ["cxl smith friday", "cancel", "P1"],
  ["john smith cant make it tomorrow", "cancel", "P1"],
  ["cancle ana riveras visit", "cancel", "P2"],
  ["please cancel kim's appointment", "cancel", "P3"],
  ["call off nazarian thursday", "cancel", "P4"],
  ["cancel her appt", "cancel", "P2"],
  ["vahe cannot come in today", "cancel", "P4"],
  // check in / out / no show
  ["check in john smith", "checkIn", "P1"],
  ["smith is here", "checkIn", "P1"],
  ["jon smith arrived", "checkIn", "P1"],
  ["checkin ana", "checkIn", "P2"],
  ["cara kim just walked in", "checkIn", "P3"],
  ["chek in nazarian", "checkIn", "P4"],
  ["check out john smith", "checkOut", "P1"],
  ["smith is done", "checkOut", "P1"],
  ["checkout ana rivera", "checkOut", "P2"],
  ["kim finished", "checkOut", "P3"],
  ["mark john smith no show", "noShow", "P1"],
  ["smith didnt show today", "noShow", "P1"],
  ["vahe no-show", "noShow", "P4"],
  // notes
  ["note for john smith: pain down to 4/10", "note", "P1"],
  ["add a note to smith that he missed work", "note", "P1"],
  ["jot down for jon smith mri scheduled", "note", "P1"],
  ["note ana rivera - called about records", "note", "P2"],
  ["add note for kim: rx for ortho given", "note", "P3"],
  ["note: she cancelled pt twice", "note", "P2"],
  ["add a note to her file saying lawyer called", "note", "P2"],
  ["log that nazarian brought in his mri", "note", "P4"],
  // to-dos
  ["remind me to call john smiths lawyer tmrw", "todo", "P1"],
  ["todo call mock law re records friday", "todo", null],
  ["dont forget to fax smiths records", "todo", "P1"],
  ["remind me 2 call her back", "todo", "P2"],
  ["add a task to send the r&b to test legal", "todo", null],
  ["reminder: order mri for kim", "todo", "P3"],
  ["remind me friday to check on vahe's mri", "todo", "P4"],
  ["to-do email the adjuster", "todo", null],
  ["need to remember to call ana", "todo", "P2"],
  ["remind me tmrw to print smiths ledger", "todo", "P1"],
  // attorney
  ["change john smiths attorney to mock injury lawyers", "attorney", "P1"],
  ["smith switched to test legal", "attorney", "P1"],
  ["jon smith has a new lawyer sample law group", "attorney", "P1"],
  ["set ana riveras atty to test legal llp", "attorney", "P2"],
  ["kim's lawyer is now mock injury lawyers", "attorney", "P3"],
  ["update nazarian attorney to sample law", "attorney", "P4"],
  ["her attorney changed to test legal", "attorney", "P2"],
  // doi
  ["set john smith doi to 9/1/2026", "doi", "P1"],
  ["smiths accident was 8/30", "doi", "P1"],
  ["date of injury for jon smith 09/01/26", "doi", "P1"],
  ["ana rivera dol 7/4/2026", "doi", "P2"],
  ["kim got hurt on 10/1", "doi", "P3"],
  ["change her date of loss to 9/15", "doi", "P2"],
  // status
  ["discharge john smith", "status", "P1"],
  ["mark smith ready to submit", "status", "P1"],
  ["jon smith dropped", "status", "P1"],
  ["reopen smiths case", "status", "P1"],
  ["dischage ana rivera", "status", "P2"],
  ["set kim status to submitted", "status", "P3"],
  ["mark her rts", "status", "P2"],
  ["nazarian back to active", "status", "P4"],
  // open
  ["open john smiths case", "open", "P1"],
  ["pull up smith", "open", "P1"],
  ["take me to jon smith file", "open", "P1"],
  ["opn smith chart", "open", "P1"],
  ["go to ana riveras case", "open", "P2"],
  ["bring up kim", "open", "P3"],
  ["show me vahe's file", "open", "P4"],
  ["open her case", "open", "P2"],
  ["jump to nazarian", "open", "P4"],
  // lookups / lists
  ["when was jon smiths mri", "lookup", "P1"],
  ["did ana rivera get her x-ray", "lookup", "P2"],
  ["what is kims balance", "lookup", "P3"],
  ["whos coming in today", "schedule", null],
  ["schedule for tmrw", "schedule", null],
  ["appointments this week", "schedule", null],
  ["whats on my to do list", "todos", null],
  ["show my tasks", "todos", null],
  ["fax for mock imaging", "contact", null],
  ["mock injury lawyers phone number", "contact", null],
  // messages
  ["tell greg john smith is running late", "message", null],
  ["let abi know smith called", "message", null],
  // not an action (left to the rest of G.O.A.T.)
  ["thanks!", null, null],
  ["how do i add a new user", null, null],
  ["lol ok", null, null],
];

let pass = 0;
const fails: string[] = [];
for (const [q, action, pid] of CASES) {
  const u = understand(q, ctx);
  const gotA = u?.action ?? null;
  const pidOk = pid === null || u?.patient?.id === pid;
  if (gotA === action && pidOk) pass++;
  else fails.push(`  "${q}" → ${gotA} ${u?.patient?.id ?? "-"} (want ${action} ${pid ?? "-"})`);
}
const rate = Math.round((pass / CASES.length) * 1000) / 10;
console.log(`goat-understand: ${pass}/${CASES.length} phrasings understood (${rate}%)`);
if (fails.length) console.log(fails.join("\n"));

// Slots
assert.equal(findDate("next wed", "2026-10-20")?.iso, "2026-10-21");
assert.equal(findDate("friday", "2026-10-20")?.iso, "2026-10-23");
assert.equal(findDate("in 2 weeks", "2026-10-20")?.iso, "2026-11-03");
assert.equal(findDate("10/24", "2026-10-20")?.iso, "2026-10-24");
assert.equal(findTime("tmrw at 3")?.hhmm, "15:00");
assert.equal(findTime("9:30")?.hhmm, "09:30");
assert.equal(findTime("4p")?.hhmm, "16:00");
assert.equal(findPatient("jon smth", ctx.patients).patient?.id, "P1");
assert.equal(findPatient("call him", ctx.patients, "P3").patient?.id, "P3");
// Canonical phrases the existing paths take
assert.equal(understand("schedual jon smth wensday 2pm", ctx)?.canonical, "book John Smith wednesday 2pm");
assert.equal(understand("smith switched to test legal", ctx)?.canonical, "change John Smith's attorney to Test Legal LLP");
assert.equal(understand("mark smith ready to submit", ctx)?.canonical, "mark John Smith as ready to submit");
assert.equal(understand("note for john smith: pain down to 4/10", ctx)?.canonical, "add a note for John Smith: pain down to 4/10");
// One short question only when something required is missing
assert.equal(understand("cancel the appt", { ...ctx, lastPatientId: null })?.ask, "Whose visit should I cancel?");
assert.equal(understand("reschedule john smith", ctx)?.ask, "Move it to when?");
assert.equal(understand("book john smith tmrw at 3", ctx)?.ask, null);
// Templates: names, dates, times generalized (nothing patient-identifying saved)
const tpl = phraseTemplate("Get Jon Smith in tmrw at 3 pls", ctx.patients, ctx.today);
assert.equal(tpl, "get {patient} in {date} {time} please");
assert.ok(!/smith|john|jon/i.test(phraseTemplate("squeeze in John Smith friday", ctx.patients, ctx.today)));
// Learned mapping wins
assert.equal(understand("squeeze in john smith friday at 2", { ...ctx, learned: { [phraseTemplate("squeeze in john smith friday at 2", ctx.patients, ctx.today)]: "book" } })?.action, "book");
// Every catalog example is understood as its own action
for (const a of GOAT_ACTIONS) for (const ex of a.examples) assert.equal(understand(ex, ctx)?.action, a.id, `${a.id}: ${ex}`);
assert.ok(rate >= 95, `pass rate ${rate}% is under 95%`);
let total = CASES.length;
let totalOk = pass;

// Second set: written after the main set (fresh wording), checked the same way.
{
  const c: UContext = { today: "2026-10-20", patients: [{ id: "P1", fullName: "Smith, John" }, { id: "P2", fullName: "Rivera, Ana" }, { id: "P3", fullName: "Kim, Cara" }, { id: "P4", fullName: "Nazarian, Vahe" }], lastPatientId: "P3", attorneys: ["Mock Injury Lawyers", "Test Legal LLP"] };
  const H: Array<[string, string | null, string | null]> = [
["yo book smith for thurs 10", "book", "P1"], ["need john smith on the books friday", "book", "P1"], ["squeeze ana in tomorrow", "book", "P2"], ["pencil in kim monday 3", "book", "P3"],
["can you schedule vahe for next friday at 9", "book", "P4"], ["john smith wants to come in wed at 5", "book", "P1"], ["set up a re exam for rivera tues", "book", "P2"],
["move smith from tmrw to thursday", "reschedule", "P1"], ["shift ana to 3:30", "reschedule", "P2"], ["kim needs to reschedule to monday", "reschedule", "P3"], ["change the time for vahe to 11am", "reschedule", "P4"],
["smith cancelled", "cancel", "P1"], ["take ana off the schedule tomorrow", "cancel", "P2"], ["kim called to cancel", "cancel", "P3"], ["scratch vahe's friday appt", "cancel", "P4"],
["john is in the lobby", "checkIn", "P1"], ["ana checked in", "checkIn", "P2"], ["kim's here", "checkIn", "P3"], ["vahe left", "checkOut", "P4"], ["done with smith", "checkOut", "P1"],
["no show for ana today", "noShow", "P2"], ["kim never showed", "noShow", "P3"],
["put a note on smith: wants evening appts", "note", "P1"], ["note that ana brought mri cd", "note", "P2"], ["chart for kim - doing better", "note", "P3"],
["remind me monday to call vahe", "todo", "P4"], ["make a to do to request smith records", "todo", "P1"], ["i need to call ana's attorney tmrw remind me", "todo", "P2"],
["smith's new attorney is mock injury lawyers", "attorney", "P1"], ["ana went with test legal", "attorney", "P2"], ["switch kim's lawyer to mock injury", "attorney", "P3"],
["smith's doi is 8/2/2026", "doi", "P1"], ["ana accident date 9/9", "doi", "P2"],
["d/c smith", "status", "P1"], ["ana's case is ready to submit", "status", "P2"], ["drop kim", "status", "P3"],
["open smith", "open", "P1"], ["pull ana's file", "open", "P2"], ["show kim", "open", "P3"], ["go to vahe", "open", "P4"],
["who do we have tomorrow", "schedule", null], ["what's on the schedule today", "schedule", null], ["my todos", "todos", null], ["phone for test legal", "contact", null],
["when is smith's next appt", "lookup", "P1"], ["has ana been discharged?", "lookup", "P2"],
  ];
  let ok = 0;
  const bad: string[] = [];
  for (const [q, a, p] of H) {
    const u = understand(q, c);
    if ((u?.action ?? null) === a && (p === null || u?.patient?.id === p)) ok++;
    else bad.push(`  "${q}" → ${u?.action} ${u?.patient?.id ?? "-"}`);
  }
  console.log(`Second set: ${ok}/${H.length} (${Math.round((ok / H.length) * 1000) / 10}%)`);
  if (bad.length) console.log(bad.join("\n"));
  assert.ok(ok / H.length >= 0.9, "Second set under 90%");
  total += H.length;
  totalOk += ok;
}

// Third set: written after the main set (fresh wording), checked the same way.
{
  const c: UContext = { today: "2026-10-20", patients: [{ id: "P1", fullName: "Smith, John" }, { id: "P2", fullName: "Rivera, Ana" }, { id: "P3", fullName: "Kim, Cara" }, { id: "P4", fullName: "Nazarian, Vahe" }], lastPatientId: "P1", attorneys: ["Mock Injury Lawyers", "Test Legal LLP"] };
  const H: Array<[string, string | null, string | null]> = [
["hey goat can you book rivera next mon at 10:15", "book", "P2"], ["nazarain tmrw 2pm book pls", "book", "P4"], ["i want to schedule cara for a follow up thursday", "book", "P3"],
["put john in for friday 9", "book", "P1"], ["book him again next week same time", "book", "P1"], ["bk jon smth tmrw aftrnoon", "book", "P1"], ["mov ana lopez thurs appt to fri 11", "reschedule", "P2"], ["kara kim re exam 10/30 at 3", "book", "P3"],
["rescheduel ana to wed", "reschedule", "P2"], ["can you move smiths visit to 4", "reschedule", "P1"], ["push his appt back to friday", "reschedule", "P1"],
["cancell vahe tomorrow", "cancel", "P4"], ["ana rivera won't make it today", "cancel", "P2"], ["cancel everything for kim tomorrow", "cancel", "P3"],
["ana is here for her appt", "checkIn", "P2"], ["check-in smith", "checkIn", "P1"], ["check vahe out", "checkOut", "P4"], ["mark kim as no show", "noShow", "P3"],
["add note smith: no pain today", "note", "P1"], ["write a note for ana that she called", "note", "P2"], ["note to vahe's file: brought records", "note", "P4"],
["remind me to text kim tmrw", "todo", "P3"], ["todo: fax ana's records to mock injury", "todo", "P2"], ["set a reminder to call the adjuster friday", "todo", null],
["vahe's attorney is test legal now", "attorney", "P4"], ["change attorney for ana to mock injury lawyers", "attorney", "P2"],
["kim's date of injury is 9/20", "doi", "P3"], ["discharge him", "status", "P1"], ["ana rivera is discharged", "status", "P2"], ["submit kim's case", "status", "P3"],
["open vahe nazarian", "open", "P4"], ["pull up anas chart", "open", "P2"], ["who's on the schedule tmrw", "schedule", null], ["what's my to do list look like", "todos", null],
["what's the fax for test legal", "contact", null], ["when's ana's next visit", "lookup", "P2"], ["did smith get his mri", "lookup", "P1"],
  ];
  let ok = 0;
  const bad: string[] = [];
  for (const [q, a, p] of H) {
    const u = understand(q, c);
    if ((u?.action ?? null) === a && (p === null || u?.patient?.id === p)) ok++;
    else bad.push(`  "${q}" → ${u?.action} ${u?.patient?.id ?? "-"}`);
  }
  console.log(`Third set: ${ok}/${H.length} (${Math.round((ok / H.length) * 1000) / 10}%)`);
  if (bad.length) console.log(bad.join("\n"));
  assert.ok(ok / H.length >= 0.9, "Third set under 90%");
  total += H.length;
  totalOk += ok;
}
console.log(`ALL: ${totalOk}/${total} (${Math.round((totalOk / total) * 1000) / 10}%)`);
console.log("goat-understand ok");
