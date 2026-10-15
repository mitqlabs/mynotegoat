/**
 * G.O.A.T. briefs (greeting chips, Morning Rundown, Appointment Check, Know Your
 * Business) and "/" commands. Mock data only.
 * Run: npx tsx scripts/tests/goat-eval/briefs-slash.test.ts
 */
import assert from "node:assert/strict";
import { CHIPS, appointmentCheck, detectBrief, endOfWeek, greetingFor, knowYourBusiness, morningRundown, noteWording, parseSlash, parseTodo, slashMatches, slashQuery, startOfWeek, takeDueDate, type BriefData } from "../../../src/lib/goat-briefs";
import { emptyDialog, goatTurn, type DialogCtx } from "../../../src/lib/goat-dialog";
import { getDefaultScheduleSettings } from "../../../src/lib/schedule-settings";
import type { PracticeData } from "../../../src/lib/goat-practice";

const TODAY = "2026-10-15"; // Thursday
let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };
let n = 0;
const A = (patientId: string, patientName: string, date: string, status = "Scheduled", location = "Mock North", startTime = "09:00") => ({ id: `a${n++}`, patientId, patientName, date, startTime, status, location, appointmentType: "Follow-Up Visit" });
const data: BriefData = {
  today: TODAY,
  locations: [{ id: "L1", name: "Mock North Office", nickname: "Mock North" }, { id: "L2", name: "Mock South Office", nickname: "Mock South" }],
  patients: [
    { id: "p1", fullName: "Alpha Mock", caseStatus: "Active", locationId: "L1", firstVisit: "2026-10-02" },
    { id: "p2", fullName: "Bravo Mock", caseStatus: "Active", locationId: "L1", firstVisit: "2026-08-01" },
    { id: "p3", fullName: "Charlie Mock", caseStatus: "Active", locationId: "L2", firstVisit: "2026-10-10" },
    { id: "p4", fullName: "Delta Mock", caseStatus: "Submitted", locationId: "L2", billed: 3000 },
    { id: "p5", fullName: "Echo Mock", caseStatus: "Paid", locationId: "L2", billed: 2000, paid: 1500, paidDate: "10/05/2026" },
    { id: "p6", fullName: "Foxtrot Mock", caseStatus: "Active", locationId: "L1" },
    { id: "p7", fullName: "Golf Mock", caseStatus: "Paid", locationId: "L1", paid: 900, paidDate: "09/20/2026" },
  ],
  appointments: [
    A("p1", "Alpha Mock", TODAY, "Scheduled", "Mock North", "10:30"), // this week only → needs scheduling
    A("p2", "Bravo Mock", "2026-10-17"), A("p2", "Bravo Mock", "2026-10-21"), // booked next week → fine
    A("p3", "Charlie Mock", "2026-10-16", "Scheduled", "Mock South", "08:00"), A("p3", "Charlie Mock", "2026-10-22", "Canceled"), // only canceled future → needs
    A("p4", "Delta Mock", "2026-10-16", "Scheduled", "Mock South"), // not active → skip
    A("p6", "Foxtrot Mock", TODAY, "No Show"), // no live visit this week → skip
    A("p2", "Bravo Mock", "2026-10-13", "Check Out"), // earlier this week (visit counts)
    A("p1", "Alpha Mock", "2026-10-01", "Check Out"),
  ],
  tasks: [
    { id: "t1", title: "Call Mock Law", done: false, dueDate: TODAY },
    { id: "t2", title: "Fax records", done: false, dueDate: "2026-10-10", assignee: "Hannah" },
    { id: "t3", title: "Future thing", done: false, dueDate: "2026-10-30" },
    { id: "t4", title: "Done thing", done: true, dueDate: TODAY },
  ],
  unreadMessages: 3,
};

// Greeting
check("greet 7", () => assert.equal(greetingFor(7), "Good morning!"));
check("greet 0", () => assert.equal(greetingFor(0), "Good morning!"));
check("greet 12", () => assert.equal(greetingFor(12), "Good afternoon!"));
check("greet 16", () => assert.equal(greetingFor(16), "Good afternoon!"));
check("greet 17", () => assert.equal(greetingFor(17), "Good evening!"));
check("greet 23", () => assert.equal(greetingFor(23), "Good evening!"));
check("chips", () => assert.deepEqual([...CHIPS], ["Morning Rundown", "Appointment Check", "Know Your Business"]));
check("week end thu", () => assert.equal(endOfWeek(TODAY), "2026-10-18"));
check("week end sun", () => assert.equal(endOfWeek("2026-10-18"), "2026-10-18"));
check("week start", () => assert.equal(startOfWeek(TODAY), "2026-10-12"));
check("week start mon", () => assert.equal(startOfWeek("2026-10-12"), "2026-10-12"));

// detectBrief phrasings
const BRIEFS: Array<[string, ReturnType<typeof detectBrief>]> = [
  ["Morning Rundown", "rundown"], ["morning rundown", "rundown"], ["rundown", "rundown"], ["give me the rundown", "rundown"], ["whats the rundown", "rundown"],
  ["morning briefing", "rundown"], ["daily summary", "rundown"], ["how does my day look", "rundown"], ["how does today look?", "rundown"], ["what's my day look like", "rundown"],
  ["Appointment Check", "apptCheck"], ["appt check", "apptCheck"], ["who needs to be scheduled", "apptCheck"], ["who needs scheduled", "apptCheck"],
  ["who isn't scheduled for next week", "apptCheck"], ["who needs to be rebooked", "apptCheck"], ["patients not booked next week", "apptCheck"],
  ["Know Your Business", "business"], ["know my business", "business"], ["how's business", "business"], ["how is business", "business"],
  ["business numbers", "business"], ["practice stats", "business"], ["office overview", "business"], ["how are we doing", "business"], ["show kpis", "business"],
  ["how many submitted cases do we have", null], ["mark smith paid 3200", null], ["what's john smith's dob", null], ["add a note for john", null],
  ["whats on the schedule today", null], ["hi", null], ["schedule john smith next tuesday", null],
];
for (const [q, want] of BRIEFS) check(`detect "${q}"`, () => assert.equal(detectBrief(q), want));

// Appointment Check
const ac = appointmentCheck(data);
check("ac list", () => { assert.match(ac.text, /^2 active patients need to be scheduled/); assert.match(ac.text, /Alpha Mock/); assert.match(ac.text, /Charlie Mock/); });
check("ac excludes", () => { for (const x of ["Bravo", "Delta", "Foxtrot", "Echo"]) assert.doesNotMatch(ac.text, new RegExp(x)); });
check("ac links", () => assert.deepEqual(ac.links?.map((l) => l.href), ["/patients/p1", "/patients/p3"]));
check("ac none", () => assert.match(appointmentCheck({ ...data, appointments: [] }).text, /^Everyone active/));
check("ac last date", () => assert.match(ac.text, /Alpha Mock \(last this week: 10\/15\/2026\)/));

// Morning Rundown
const mr = morningRundown(data);
check("mr visits", () => assert.match(mr.text, /Today \(10\/15\/2026\): 1 visit\n- 10:30 AM Alpha Mock · Follow-Up Visit · Mock North/));
check("mr no-show hidden", () => assert.doesNotMatch(mr.text, /Foxtrot/));
check("mr todos", () => { assert.match(mr.text, /To-dos due: 2/); assert.match(mr.text, /Fax records \(overdue, 10\/10\/2026\) · Hannah/); assert.doesNotMatch(mr.text, /Future thing|Done thing/); });
check("mr unread", () => assert.match(mr.text, /3 unread/));
check("mr caught up", () => assert.match(morningRundown({ ...data, unreadMessages: 0 }).text, /all caught up/));
check("mr counts", () => assert.match(mr.text, /4 active · 0 ready to submit · 1 submitted/));
check("mr links", () => assert.deepEqual(mr.links?.map((l) => l.label), ["Open Schedule", "Open To-Do", "Open Messages"]));
check("mr empty", () => assert.match(morningRundown({ ...data, appointments: [], tasks: [] }).text, /Nothing on the schedule[\s\S]*Nothing due/));

// Know Your Business
const kyb = knowYourBusiness(data).text;
const section = (label: string) => kyb.split("\n\n").find((s) => s.startsWith(label)) ?? "";
check("kyb total", () => { assert.match(kyb, /4 active · 1 submitted/); assert.match(kyb, /2 new patients this month/); assert.match(kyb, /\$1,500 collected this month/); });
check("kyb visits", () => assert.match(kyb, /2 visits this week · 3 this month/));
check("kyb north", () => { const s = section("Mock North"); assert.match(s, /3 active · 0 submitted/); assert.match(s, /1 new patients/); assert.match(s, /2 visits this week · 3 this month/); assert.match(s, /\$0 collected/); });
check("kyb south", () => { const s = section("Mock South"); assert.match(s, /1 active · 1 submitted/); assert.match(s, /\$1,500 collected/); assert.match(s, /0 visits this week · 0 this month/); });
check("kyb one office", () => assert.doesNotMatch(knowYourBusiness({ ...data, locations: [data.locations[0]] }).text, /Mock South/));
check("kyb no office", () => assert.match(knowYourBusiness({ ...data, patients: [...data.patients, { id: "x", fullName: "X Mock", caseStatus: "Active" }] }).text, /No office set: 1 patient/));

// Slash menu
check("sq /", () => assert.equal(slashQuery("/"), ""));
check("sq /no", () => assert.equal(slashQuery("/no"), "no"));
check("sq space", () => assert.equal(slashQuery("/note "), null));
check("sq plain", () => assert.equal(slashQuery("note"), null));
check("sq mid", () => assert.equal(slashQuery("a/b"), null));
check("sm all", () => assert.deepEqual(slashMatches("").map((c) => c.cmd), ["note", "todo"]));
check("sm n", () => assert.deepEqual(slashMatches("n").map((c) => c.cmd), ["note"]));
check("sm T", () => assert.deepEqual(slashMatches("T").map((c) => c.cmd), ["todo"]));
check("sm x", () => assert.deepEqual(slashMatches("x"), []));
check("ps note", () => assert.deepEqual(parseSlash("/note john smith: hi"), { cmd: "note", rest: "john smith: hi" }));
check("ps NOTE", () => assert.deepEqual(parseSlash("  /NOTE  "), { cmd: "note", rest: "" }));
check("ps todo", () => assert.deepEqual(parseSlash("/todo call atty"), { cmd: "todo", rest: "call atty" }));
check("ps unknown", () => assert.equal(parseSlash("/foo bar"), null));
check("ps none", () => assert.equal(parseSlash("note bar"), null));
check("nw colon", () => assert.equal(noteWording("john smith: spoke to atty"), "add a note for john smith: spoke to atty"));
check("nw dash", () => assert.equal(noteWording("john smith - spoke to atty"), "add a note for john smith: spoke to atty"));
check("nw name", () => assert.equal(noteWording("john smith"), "add a note for john smith"));
check("nw empty", () => assert.equal(noteWording(""), "add a note"));

// Due dates / parseTodo
const DUE: Array<[string, string, string]> = [
  ["call atty today", "2026-10-15", "call atty"], ["call atty tomorrow", "2026-10-16", "call atty"], ["call atty tmrw", "2026-10-16", "call atty"],
  ["call atty friday", "2026-10-16", "call atty"], ["call atty by monday", "2026-10-19", "call atty"], ["call atty thursday", "2026-10-22", "call atty"],
  ["call atty 10/20", "2026-10-20", "call atty"], ["call atty due 1/5", "2027-01-05", "call atty"], ["call atty 11/02/2026", "2026-11-02", "call atty"],
  ["call atty in 3 days", "2026-10-18", "call atty"], ["call atty next week", "2026-10-19", "call atty"], ["call atty", "", "call atty"],
];
for (const [t, due, rest] of DUE) check(`due "${t}"`, () => assert.deepEqual(takeDueDate(t, TODAY), { due, rest }));
check("todo name", () => assert.deepEqual(parseTodo("John Smith: request records friday", TODAY), { name: "John Smith", title: "request records", due: "2026-10-16" }));
check("todo plain", () => assert.deepEqual(parseTodo("order supplies", TODAY), { name: null, title: "order supplies", due: "" }));
check("todo trailing comma", () => assert.deepEqual(parseTodo("order supplies, tomorrow", TODAY), { name: null, title: "order supplies", due: "2026-10-16" }));
check("todo empty", () => assert.equal(parseTodo("", TODAY).title, ""));

// /note → the existing note dialog
const pd: PracticeData = {
  today: TODAY,
  patients: [
    { id: "p-collin", fullName: "Collin Elliott", caseStatus: "Active", attorney: "Mock Law", listYear: 2026 },
    { id: "p-js1", fullName: "John Smithmock", caseStatus: "Active", attorney: "", listYear: 2026 },
    { id: "p-js2", fullName: "John Smithmock", caseStatus: "Submitted", attorney: "", listYear: 2025 },
  ] as PracticeData["patients"],
  tasks: [], appointments: [], contacts: [],
};
const ctx: DialogCtx = { data: pd, team: [], openPatientId: null, settings: getDefaultScheduleSettings() };
const turn = (slash: string) => goatTurn(noteWording(parseSlash(slash)!.rest), emptyDialog(), ctx);
check("/note confirm", () => { const r = turn("/note collin elliott: spoke to atty").reply; assert.equal(r.kind, "noteConfirm"); if (r.kind === "noteConfirm") { assert.equal(r.patientId, "p-collin"); assert.match(r.text, /spoke to atty/); } });
check("/note ambiguous", () => assert.equal(turn("/note john smithmock: left vm").reply.kind, "choose"));
check("/note asks text", () => assert.equal(turn("/note collin elliott").reply.kind, "ask"));
check("/note then text", () => { const t1 = turn("/note collin elliott"); const t2 = goatTurn("spoke to atty about reduction", t1.state, ctx).reply; assert.equal(t2.kind, "noteConfirm"); });
check("/note bare asks", () => assert.equal(turn("/note").reply.kind, "ask"));

console.log(`briefs-slash: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
