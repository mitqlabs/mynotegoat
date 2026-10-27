/**
 * G.O.A.T. name-matching regression eval (mock data only, no model, no network).
 *
 * Why it exists: "how many canceled appt do we have" was answered with "Which May — Shawn May, or
 * Mary Hardin?" because the fuzzy matcher read the everyday word "many" as a typo of May/Mary, and
 * "canceled" fired the cancel-a-visit action. Earlier, "/todo call tyler smith" matched Hall.
 * Every phrasing here must stay right as the matcher changes:
 *   A. office-wide count/list questions → an office answer, never a patient or a cancel action
 *   B. everyday words / EHR shorthand are never a name (exact word list × every name part)
 *   C. sentences full of those words never pick a patient
 *   D. real patient lookups, typos included, still work
 *   E. real commands (cancel/book a named patient) still work
 *
 * Run: npx tsx scripts/tests/goat-eval/name-matching.test.ts
 */
import assert from "node:assert/strict";
import { understand } from "../../../src/lib/goat-understand";
import { findPatientsInQuestion } from "../../../src/lib/goat-ai/global-chat";
import { answerOffice } from "../../../src/lib/goat-office";
import { emptyDialog, goatTurn, type DialogCtx } from "../../../src/lib/goat-dialog";
import { splitNameAndText } from "../../../src/lib/goat-slash-flow";
import { findNameAnywhere } from "../../../src/lib/goat-commands";
import { EHR_ABBREVIATIONS, isEverydayWord, matchNameToken } from "../../../src/lib/goat-name-guard";
import { getDefaultScheduleSettings } from "../../../src/lib/schedule-settings";
import type { ScheduleAppointmentRecord } from "../../../src/lib/schedule-appointments";
import type { PracticeData } from "../../../src/lib/goat-practice";

const TODAY = "2026-10-27"; // Tuesday; this week = Sun 10/25–Sat 10/31
const NAMES = ["May, Shawn", "Hardin, Mary", "Hall, Brianna", "Smith, Tyler", "Testpatient, Kara", "Cole, Will", "Hale, Dave", "Dale, Kate", "Page, Lisa", "Ramsey, John", "Ross, Pat", "Marks, Mari", "Mann, Manny"];
const patients = NAMES.map((fullName, i) => ({ id: `p${i}`, fullName, dob: "", dateOfLoss: "", caseStatus: "Active" }));
const idOf = (full: string) => patients.find((p) => p.fullName === full)!.id;

const ap = (id: string, name: string, date: string, status: string, type = "Follow-Up Visit"): ScheduleAppointmentRecord => ({
  id, patientId: idOf(name), patientName: name, provider: "Dr. Mock", location: "Mock Glendale", appointmentType: type, caseLabel: "", room: "", date, startTime: "10:00", durationMin: 30,
  status: status as ScheduleAppointmentRecord["status"], note: "", overrideOfficeHours: false,
});
const data: PracticeData = {
  today: TODAY,
  patients: patients.map((p) => ({ id: p.id, fullName: p.fullName, caseStatus: "Active", attorney: "" })) as PracticeData["patients"],
  tasks: [],
  contacts: [],
  appointments: [
    // canceled: this month 5 (this week 2, today 1), last month 2
    ap("c1", "May, Shawn", "2026-10-05", "Canceled"),
    ap("c2", "Hardin, Mary", "2026-10-13", "Canceled"),
    ap("c3", "Hall, Brianna", "2026-10-22", "Canceled"),
    ap("c4", "Smith, Tyler", "2026-10-26", "Canceled"),
    ap("c5", "Testpatient, Kara", "2026-10-27", "Canceled"),
    ap("c6", "Cole, Will", "2026-09-10", "Canceled"),
    ap("c7", "Hale, Dave", "2026-09-20", "Canceled"),
    // no-shows: this month 2 (this week 1)
    ap("n1", "Dale, Kate", "2026-10-14", "No Show"),
    ap("n2", "Page, Lisa", "2026-10-26", "No Show"),
    // normal
    ap("s1", "Smith, Tyler", "2026-10-27", "Scheduled"),
    ap("s2", "Ramsey, John", "2026-10-28", "Scheduled"),
    ap("s3", "Ross, Pat", "2026-10-20", "Check Out"),
  ],
};
const ctx: DialogCtx = { data, team: [], openPatientId: null, settings: getDefaultScheduleSettings() };
const u = (q: string) => understand(q, { today: TODAY, patients: data.patients.map((p) => ({ id: p.id, fullName: p.fullName, caseStatus: p.caseStatus })) });

let n = 0;
const ok = (name: string, f: () => void) => { f(); n++; console.log(`ok - ${name}`); };

// ---------------------------------------------------------------------------
// A. Office-wide count/list questions: office answer, no patient, no cancel action.
// ---------------------------------------------------------------------------
const OFFICE: Array<[string, RegExp]> = [
  ["how many canceled appt do we have", /^5 canceled appointments this month so far \(10\/01–10\/27\)\.[\s\S]*didn't give a timeframe, so I used this month so far/],
  ["how many cancelled appts do we have", /^5 canceled appointments this month so far/],
  ["how many canceled appointments do we have", /^5 canceled appointments/],
  ["how many appts were canceled this week", /^2 canceled appointments this week \(10\/25–10\/31\)\./],
  ["how many appts got canceled this week?", /^2 canceled appointments this week/],
  ["how many canceled appointments today", /^1 canceled appointment today/],
  ["how many canceled appts last month", /^2 canceled appointments last month \(09\/01–09\/30\)\./],
  ["how many cancellations in the last 30 days", /^7 canceled appointments the last 30 days|^\d+ canceled appointments the last 30 days/],
  ["how many canceled appts all time", /^7 canceled appointments all time/],
  ["how many appointments have been canceled ever", /^7 canceled appointments all time/],
  ["number of canceled appts this month", /^5 canceled appointments this month \(10\/01–10\/31\)/],
  ["count canceled appts this week", /^2 canceled appointments this week/],
  ["total cancellations this month", /^5 canceled appointments this month/],
  ["list canceled appointments this week", /^2 canceled appointments this week[\s\S]*Smith|^2 canceled appointments this week[\s\S]*Tyler/],
  ["show canceled appts this week", /^2 canceled appointments this week/],
  ["which appts were canceled this month", /^5 canceled appointments this month/],
  ["who canceled their appt this week", /^2 canceled appointments this week/],
  ["any canceled appts today?", /^1 canceled appointment today/],
  ["how many appts did we have canceled yesterday", /^1 canceled appointment yesterday/],
  ["how many no shows this week", /^1 no-show appointment this week/],
  ["how many no-shows do we have", /^2 no-show appointments this month so far/],
  ["how many patients no showed this month", /^2 no-show appointments this month/],
  ["how many appts were no shows last month", /^No no-show appointments last month/],
  ["list no shows this month", /^2 no-show appointments this month/],
  ["how many people didn't show up this week", /^1 no-show appointment this week/],
  ["how many patients have we seen this month", /^1 completed appointment this month/],
  ["how many checked out this week", /^No completed appointments this week/],
  ["how many appts were rescheduled this month", /^No rescheduled appointments this month/],
  ["HOW MANY CANCELED APPTS THIS WEEK", /^2 canceled appointments this week/],
  ["how many canceled appts this week", /^2 canceled appointments this week/],
  ["how many canceled visits this month", /^5 canceled appointments this month/],
  ["what's the number of canceled appts this week", /^2 canceled appointments this week/],
];
for (const [q, want] of OFFICE) {
  ok(`office: "${q}"`, () => {
    // 1) the understand step must not pick an action or a patient
    assert.equal(u(q), null, "understand() must not treat this as a patient/cancel action");
    // 2) patient lookup finds nobody
    const f = findPatientsInQuestion(q, patients);
    assert.equal(f.confident, null, `no patient: ${f.confident?.patient.fullName}`);
    assert.equal(f.candidates.length, 0);
    // 3) the office answer is the real count
    const a = answerOffice(q, data);
    assert.ok(a, "office answer");
    assert.match(a!.text, want, a!.text);
    assert.ok(!/^Which |Whose /i.test(a!.text));
    // 4) the full dialog turn gives the same office answer
    const t = goatTurn(q, emptyDialog(), ctx);
    assert.equal(t.reply.kind, "office", `dialog kind ${t.reply.kind}`);
    if (t.reply.kind === "office") assert.match(t.reply.say, want);
  });
}
ok("the default timeframe is stated and other timeframes are offered", () => {
  const a = answerOffice("how many canceled appt do we have", data)!;
  assert.match(a.text, /this month so far/);
  const labels = (a.choices ?? []).map((c) => c.label);
  assert.ok(labels.includes("This week") && labels.includes("All time") && labels.includes("Last month"));
  // each chip re-asks something this parser understands
  for (const c of a.choices ?? []) assert.match(answerOffice(c.question, data)!.text, /canceled appointments?|No canceled appointments/);
});

// ---------------------------------------------------------------------------
// B. Everyday words and EHR shorthand never match a name part (exact or typo).
// ---------------------------------------------------------------------------
const WORDS = [
  "appt", "appts", "apt", "apts", "pt", "pts", "dx", "rx", "tx", "hx", "f/u", "fu", "ie", "re", "mri", "pm", "rom", "ct", "np", "doi", "dob", "lop", "soap",
  "many", "much", "have", "has", "had", "call", "called", "calls", "will", "would", "when", "what", "who", "how", "much", "date", "dates", "case", "cases", "week", "weeks", "last", "next", "list", "show", "name", "time", "done", "mark", "send", "text", "make", "take", "find", "pull", "book", "visit", "visits",
  "canceled", "cancelled", "cancel", "total", "count", "number", "today", "tomorrow", "yesterday", "month", "year", "hall", "note", "notes", "chart", "bill", "paid", "balance", "status", "check", "confirm", "remind", "update", "attorney", "doctor",
];
ok("no everyday word / EHR abbreviation fuzzy-matches any name part", () => {
  const parts = NAMES.flatMap((n) => n.split(/,\s*/));
  const bad: string[] = [];
  for (const w of WORDS) for (const part of parts) {
    const m = matchNameToken(w, part);
    // The one allowed hit: a word that is itself the name part (Hall, Will, Mark…) matches exactly, never by typo or prefix.
    if (m && !(m === "exact" && w.toLowerCase() === part.toLowerCase())) bad.push(`${w}~${part}:${m}`);
    const p = matchNameToken(w, part, { allowPrefix: true });
    if (p && p !== "exact" && isEverydayWord(w)) bad.push(`${w}~${part}:${p}(prefix)`);
  }
  assert.deepEqual(bad, []);
});
ok("every listed EHR abbreviation is recognised as everyday", () => {
  for (const w of ["appt", "appts", "pt", "pts", "dx", "rx", "tx", "hx", "f/u", "ie", "re", "mri", "pm", "rom", "doi", "dob", "lop", "np"]) assert.ok(EHR_ABBREVIATIONS.has(w) || isEverydayWord(w), w);
});
ok("short tokens never fuzzy-match", () => {
  assert.equal(matchNameToken("jon", "john"), null);
  assert.equal(matchNameToken("kat", "kate"), null);
  assert.equal(matchNameToken("mar", "mary"), null);
  assert.equal(matchNameToken("tylr", "tyler"), "fuzzy");
  assert.equal(matchNameToken("tylr", "tyler") !== null, true);
  assert.equal(matchNameToken("manu", "mary"), null); // different first-letter family handled by distance
});
ok("both words need ≥ 4 letters and the same first letter for a typo", () => {
  assert.equal(matchNameToken("many", "mary"), null, "many is a dictionary word");
  assert.equal(matchNameToken("mani", "mary"), null, "d=2 on short words");
  assert.equal(matchNameToken("briana", "brianna"), "fuzzy");
  assert.equal(matchNameToken("xyler", "tyler"), null, "different first letter");
});

// ---------------------------------------------------------------------------
// C. Ordinary sentences full of those words never pick a patient.
// ---------------------------------------------------------------------------
const NO_PATIENT = [
  "how many appts do we have today", "how many pts did we see", "what appts do we have", "how many appt today", "many appts tomorrow",
  "when will the date be", "have we got any appts", "do we have any f/u this week", "list all appts", "show me all pts with a dx", "who needs a re exam",
  "any rx pending", "how many mri pending", "how many tx visits", "how much do we have", "what is the total", "call the attorney", "call atty about the case",
  "how many cases are active", "what's on the schedule", "what hall is that", "call back later", "make a note", "pull the chart", "mark it done",
  "how many appointments", "have many", "how many calls", "pm appts", "rom results", "any ie today", "will do", "may i see the schedule", "how many days", "many thanks",
];
for (const q of NO_PATIENT) {
  ok(`no patient: "${q}"`, () => {
    const f = findPatientsInQuestion(q, patients);
    assert.equal(f.confident, null, `confident ${f.confident?.patient.fullName}`);
    assert.equal(f.candidates.length, 0, `candidates ${f.candidates.map((c) => c.patient.fullName)}`);
    const r = u(q);
    assert.ok(!r || (!r.patient && r.ambiguous.length === 0), `understand picked ${r?.patient?.fullName ?? r?.ambiguous.map((x) => x.fullName)}`);
    assert.deepEqual(findNameAnywhere(q.toLowerCase(), patients)?.matches ?? [], []);
  });
}
ok("call ≠ Hall in the /todo and /note leading-name splitter", () => {
  assert.deepEqual(splitNameAndText("call tyler smith", patients).matches.map((p) => p.fullName), []);
  assert.deepEqual(splitNameAndText("appt tyler", patients).matches.map((p) => p.fullName), []);
  assert.deepEqual(splitNameAndText("many mary", patients).matches.map((p) => p.fullName), []);
});

// ---------------------------------------------------------------------------
// D. Real name lookups still work (typos included).
// ---------------------------------------------------------------------------
const LOOKUPS: Array<[string, string]> = [
  ["tylr smith appointments", "Smith, Tyler"],
  ["tyler smith appointments", "Smith, Tyler"],
  ["tyler smith's next visit", "Smith, Tyler"],
  ["when is tyler smith coming in", "Smith, Tyler"],
  ["smith tyler balance", "Smith, Tyler"],
  ["tyler smth chart", "Smith, Tyler"],
  ["when is mary hardin coming", "Hardin, Mary"],
  ["mary hardins balance", "Hardin, Mary"],
  ["mary hardin mri", "Hardin, Mary"],
  ["mery hardin visits", "Hardin, Mary"],
  ["hardin chart", "Hardin, Mary"],
  ["shawn may chart", "May, Shawn"],
  ["Shawn May's balance", "May, Shawn"],
  ["shawn may appointments", "May, Shawn"],
  ["Shawn's next visit", "May, Shawn"],
  ["brianna hall mri", "Hall, Brianna"],
  ["briana hall visits", "Hall, Brianna"],
  ["brianna's balance", "Hall, Brianna"],
  ["brianna hal chart", "Hall, Brianna"],
  ["kara testpatient notes", "Testpatient, Kara"],
  ["testpatient chart", "Testpatient, Kara"],
  ["kara balance", "Testpatient, Kara"],
  ["will cole balance", "Cole, Will"],
  ["john ramsey visits", "Ramsey, John"],
  ["ramsey chart", "Ramsey, John"],
  ["pat ross notes", "Ross, Pat"],
  ["dave hale appointments", "Hale, Dave"],
  ["kate dale chart", "Dale, Kate"],
  ["lisa page balance", "Page, Lisa"],
  ["how many visits has tyler smith had", "Smith, Tyler"],
  ["how many canceled appts does tyler smith have", "Smith, Tyler"],
  ["how many appts has mary hardin canceled", "Hardin, Mary"],
];
for (const [q, want] of LOOKUPS) {
  ok(`lookup: "${q}" → ${want}`, () => {
    const f = findPatientsInQuestion(q, patients);
    assert.equal(f.confident?.patient.fullName, want, `got ${f.confident?.patient.fullName ?? f.candidates.map((c) => c.patient.fullName)}`);
  });
}
ok("typo'd first name in a leading-name command still resolves", () => {
  assert.deepEqual(splitNameAndText("tylr smith call atty", patients).matches.map((p) => p.fullName), ["Smith, Tyler"]);
  assert.deepEqual(splitNameAndText("brianna hall call atty", patients).matches.map((p) => p.fullName), ["Hall, Brianna"]);
});
ok("patient questions that mention a count still go to the patient, not the office total", () => {
  for (const q of ["how many canceled appts does tyler smith have", "how many appts has mary hardin canceled", "how many canceled appts for tylr smith", "how many canceled appts does she have"]) {
    const a = answerOffice(q, data);
    assert.ok(!a || !/canceled appointments? (this|last|today|all)/.test(a.text), `${q} → ${a?.text}`);
  }
});

// ---------------------------------------------------------------------------
// E. Real commands on a named patient still work.
// ---------------------------------------------------------------------------
ok("cancel tyler smith tomorrow → cancel action for Tyler Smith", () => {
  const r = u("cancel tyler smith tomorrow");
  assert.equal(r?.action, "cancel");
  assert.equal(r?.patient?.fullName, "Smith, Tyler");
});
ok("cancel tylr smith's appt → cancel action for Tyler Smith (typo ok)", () => {
  const r = u("cancel tylr smiths appt tomorrow");
  assert.equal(r?.action, "cancel");
  assert.equal(r?.patient?.fullName, "Smith, Tyler");
});
ok("book kara thursday at 3 → book for Kara", () => {
  const r = u("book kara testpatient thursday at 3");
  assert.equal(r?.action, "book");
  assert.equal(r?.patient?.fullName, "Testpatient, Kara");
});
ok("cancel shawn may tomorrow → May is a real surname next to a first name", () => {
  const r = u("cancel shawn may tomorrow");
  assert.equal(r?.action, "cancel");
  assert.equal(r?.patient?.fullName, "May, Shawn");
});
ok("'may' alone, lower-case, is the verb not the patient", () => {
  const r = u("may i cancel an appt");
  assert.ok(!r?.patient && !r?.ambiguous.length);
});
ok("call tyler smith → no patient guessed from the verb", () => {
  const r = u("call tyler smith");
  assert.ok(!r || r.patient?.fullName !== "Hall, Brianna");
});

console.log(`\n${n} name-matching checks passed`);
