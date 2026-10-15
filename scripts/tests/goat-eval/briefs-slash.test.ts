/**
 * G.O.A.T. briefs (greeting chips, Morning Rundown, Appointment Check, Know Your
 * Business) and "/" commands. Mock data only.
 * Run: npx tsx scripts/tests/goat-eval/briefs-slash.test.ts
 */
import assert from "node:assert/strict";
import { openTodos, parseViewTarget, viewMatches, viewMessages, viewQuery, viewSchedule, viewTargetsFor, viewTodos as viewTodosRaw, type BriefAnswer } from "../../../src/lib/goat-briefs";
import { ACCESS_LOADING_REPLY, adminStatsGate, isStatsOfficeKind } from "../../../src/lib/goat-briefs";
import { answerOffice } from "../../../src/lib/goat-office";
import { ADMIN_ONLY_REPLY, CHIPS, appointmentCheckGroups, briefAllowed, chipsFor, quickBiz, appointmentCheck, detectBrief, endOfWeek, greetingFor, knowYourBusiness, morningRundown as morningRundownRaw, noteWording, parseSlash, parseTodo, slashMatches, slashQuery, startOfWeek, takeDueDate, type BriefData } from "../../../src/lib/goat-briefs";
// Rendered like the chat: text, then each clickable to-do line, then textAfter.
const render = (a: BriefAnswer): BriefAnswer => ({ ...a, text: [a.text, ...(a.todoRows ?? []).map((r) => `- ${r.before}${r.patientName ?? ""}${r.after}`), ...(a.textAfter ? [a.textAfter] : [])].join("\n") });
const morningRundown = (d: Parameters<typeof morningRundownRaw>[0]) => render(morningRundownRaw(d));
const viewTodos = (d: Parameters<typeof viewTodosRaw>[0]) => render(viewTodosRaw(d));
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
check("chips", () => assert.deepEqual([...CHIPS], ["Morning Rundown", "Appointment Check", "Quick Biz"]));
// Roles: admins see all three, everyone else only Morning Rundown.
check("admin chips", () => assert.deepEqual(chipsFor(true), ["Morning Rundown", "Appointment Check", "Quick Biz"]));
check("staff chips", () => assert.deepEqual(chipsFor(false), ["Morning Rundown"]));
check("admin allowed all", () => { for (const k of ["rundown", "apptCheck", "business"] as const) assert.ok(briefAllowed(k, true)); });
check("staff rundown ok", () => assert.ok(briefAllowed("rundown", false)));
check("staff no apptCheck", () => assert.equal(briefAllowed("apptCheck", false), false));
check("staff no business", () => assert.equal(briefAllowed("business", false), false));
for (const q of ["Quick Biz", "how's business", "business numbers", "Appointment Check", "who needs to be scheduled", "know your business"]) {
  check(`staff typed "${q}" → admins only`, () => { const k = detectBrief(q); assert.ok(k && !briefAllowed(k, false)); assert.match(ADMIN_ONLY_REPLY, /for admins/); });
}
// Fail closed: unknown/loading role is never admin.
check("gate loading", () => { assert.equal(adminStatsGate(false, true), ACCESS_LOADING_REPLY); assert.equal(adminStatsGate(false, false), ACCESS_LOADING_REPLY); });
check("gate staff", () => assert.equal(adminStatsGate(true, false), ADMIN_ONLY_REPLY));
check("gate admin", () => assert.equal(adminStatsGate(true, true), null));
check("loading chips = staff chips", () => assert.deepEqual(chipsFor(false && true), ["Morning Rundown"]));
check("stats kinds", () => { assert.ok(isStatsOfficeKind("caseCount")); assert.ok(isStatsOfficeKind("caseSummary")); for (const k of ["schedule", "todo", "contact", undefined]) assert.equal(isStatsOfficeKind(k), false); });
{
  const od = { today: TODAY, patients: [{ id: "a", fullName: "Mock A", caseStatus: "Submitted", attorney: "Mock Law", listYear: 2026 }, { id: "b", fullName: "Mock B", caseStatus: "Active", attorney: "", listYear: 2026 }], tasks: [], appointments: [], contacts: [] } as never;
  for (const q of ["how many submitted cases", "how many submitted cases do we have", "how many active cases do we have", "how many cases do we have", "how many checks are we waiting on", "list submitted cases"]) {
    check(`older stat "${q}" is a gated kind`, () => assert.ok(isStatsOfficeKind(answerOffice(q, od, null)?.memory?.kind), String(answerOffice(q, od, null)?.memory?.kind)));
  }
  for (const q of ["whats on the schedule today", "show our to-dos"]) {
    check(`"${q}" stays open to staff`, () => assert.equal(isStatsOfficeKind(answerOffice(q, od, null)?.memory?.kind), false));
  }
}
check("quickBiz alias", () => assert.equal(quickBiz, knowYourBusiness));
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
  ["Quick Biz", "business"], ["quick biz", "business"], ["quickbiz", "business"], ["quick business stats", "business"], ["Know Your Business", "business"], ["know my business", "business"], ["how's business", "business"], ["how is business", "business"],
  ["business numbers", "business"], ["practice stats", "business"], ["office overview", "business"], ["how are we doing", "business"], ["show kpis", "business"],
  ["how many submitted cases do we have", null], ["mark smith paid 3200", null], ["what's john smith's dob", null], ["add a note for john", null],
  ["whats on the schedule today", null], ["hi", null], ["schedule john smith next tuesday", null],
];
for (const [q, want] of BRIEFS) check(`detect "${q}"`, () => assert.equal(detectBrief(q), want));

// Appointment Check (two groups)
const ac = appointmentCheck(data);
const g = appointmentCheckGroups(data);
check("ac running out", () => assert.deepEqual(g.runningOut.map((r) => r.patient.id), ["p1", "p3"]));
check("ac running out ignores canceled future", () => assert.equal(g.runningOut.find((r) => r.patient.id === "p3")?.lastThisWeek, "2026-10-16"));
check("ac none booked: no-show only = never seen", () => assert.deepEqual(g.noneBooked.map((r) => [r.patient.id, r.lastVisit, r.daysAgo]), [["p6", "", null]]));
check("ac booked next week excluded", () => assert.ok(![...g.noneBooked, ...g.runningOut].some((r) => r.patient.id === "p2")));
check("ac non-active excluded", () => assert.ok(![...g.noneBooked, ...g.runningOut].some((r) => ["p4", "p5", "p7"].includes(r.patient.id))));
check("ac text", () => { assert.match(ac.text, /^Appointment Check — 3 active patients need to be scheduled/); assert.match(ac.text, /No appointments booked \(1\)\n- Foxtrot Mock — ⚠ no visits ever/); assert.match(ac.text, /Running out this week \(2\)\n- Alpha Mock — last this week 10\/15\/2026, nothing after 10\/18\/2026/); });
check("ac links", () => assert.deepEqual(ac.links?.map((l) => l.href), ["/patients/p6", "/patients/p1", "/patients/p3"]));
check("ac none", () => assert.match(appointmentCheck({ ...data, patients: data.patients.filter((p) => p.id === "p2") }).text, /^Every active patient has a visit booked/));
// The reported miss: active, last visit 07/30/2026, nothing after (fictional patient).
{
  const d2: BriefData = {
    ...data,
    patients: [
      { id: "m1", fullName: "Mock Julyvisit", caseStatus: "Active" },
      { id: "m2", fullName: "Mock Augustvisit", caseStatus: "Active" },
      { id: "m3", fullName: "Mock Neverseen", caseStatus: "Active" },
      { id: "m4", fullName: "Mock Paidcase", caseStatus: "Paid" },
      { id: "m5", fullName: "Mock Lastweek", caseStatus: "Active" },
      { id: "m6", fullName: "Mock Future", caseStatus: "Active" },
    ],
    appointments: [
      A("m1", "Mock Julyvisit", "2026-07-30", "Check Out"), A("m1", "Mock Julyvisit", "2026-07-10", "Check Out"), A("m1", "Mock Julyvisit", "2026-11-02", "Canceled"),
      A("m2", "Mock Augustvisit", "2026-08-20", "Check Out"),
      A("m4", "Mock Paidcase", "2026-06-01", "Check Out"),
      A("m5", "Mock Lastweek", "2026-10-14", "Check Out"),
      A("m6", "Mock Future", "2026-07-01", "Check Out"), A("m6", "Mock Future", "2026-10-27"),
    ],
  };
  const g2 = appointmentCheckGroups(d2);
  check("07/30 case now listed", () => assert.ok(g2.noneBooked.some((r) => r.patient.id === "m1" && r.lastVisit === "2026-07-30" && r.daysAgo === 77)));
  check("urgency order", () => assert.deepEqual(g2.noneBooked.map((r) => r.patient.id), ["m3", "m1", "m2", "m5"]));
  check("yesterday counts as past", () => assert.equal(g2.noneBooked.find((r) => r.patient.id === "m5")?.daysAgo, 1));
  check("booked later excluded", () => assert.ok(!g2.noneBooked.some((r) => r.patient.id === "m6")));
  check("paid excluded", () => assert.ok(!g2.noneBooked.some((r) => r.patient.id === "m4")));
  check("07/30 text", () => assert.match(appointmentCheck(d2).text, /- Mock Julyvisit — last visit 07\/30\/2026 \(77 days ago\)/));
  check("no running out", () => assert.match(appointmentCheck(d2).text, /Running out this week \(0\)\n- None/));
}

// Morning Rundown
const mr = morningRundown(data);
check("mr visits", () => assert.match(mr.text, /Today \(10\/15\/2026\): 1 visit\n- 10:30 AM Alpha Mock · Follow-Up Visit · Mock North/));
check("mr no-show hidden", () => assert.doesNotMatch(mr.text, /Foxtrot/));
check("mr todos: all open", () => { assert.match(mr.text, /Open to-dos: 3/); assert.match(mr.text, /Fax records \(overdue, 10\/10\/2026\) · Hannah/); assert.match(mr.text, /Future thing \(due 10\/30\/2026\)/); assert.doesNotMatch(mr.text, /Done thing/); });
{
  const d3 = { ...data, tasks: [...data.tasks, { id: "t5", title: "Undated thing", done: false, dueDate: "" }, { id: "t6", title: "Call Mock Patient", done: false, dueDate: "", patientId: "p1", patientName: "Alpha Mock" }] };
  const m3 = morningRundown(d3).text;
  check("mr undated listed", () => { assert.match(m3, /Undated thing \(no due date\)/); assert.match(m3, /Call Mock Patient \(no due date\) · Alpha Mock/); });
  check("todo order", () => assert.deepEqual(openTodos(d3).map((t) => t.id), ["t2", "t1", "t3", "t6", "t5"]));
  check("mr caps at 15", () => assert.match(morningRundown({ ...data, tasks: Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, title: `Task ${i}`, done: false, dueDate: "" })) }).text, /…and 5 more \(\/view todo\)/));
  const vt = viewTodos(d3);
  check("view todo all", () => { assert.match(vt.text, /^Open to-dos \(5\):/); assert.match(vt.text, /Undated thing/); });
  // User 10/15: each to-do line opens that to-do; the patient name links to the patient; no separate link list.
  check("view todo: no separate link list", () => assert.equal(vt.links, undefined));
  check("view todo rows open the to-do", () => assert.deepEqual(vt.todoRows!.map((r) => r.href), ["t2", "t1", "t3", "t6", "t5"].map((id) => `/patients?view=toDo&task=${id}`)));
  check("view todo patient name links patient", () => { const r = vt.todoRows!.find((x) => x.id === "t6")!; assert.equal(r.patientName, "Alpha Mock"); assert.equal(r.patientHref, "/patients/p1"); });
  check("mr rows clickable", () => assert.equal(morningRundownRaw(d3).todoRows!.length, 5));
  check("view todo empty", () => assert.match(viewTodos({ ...data, tasks: [] }).text, /No open to-dos/));
}
check("view schedule", () => { const v = viewSchedule(data); assert.match(v.text, /Today \(10\/15\/2026\): 1 visit\n- 10:30 AM Alpha Mock/); assert.ok(v.links?.some((l) => l.href === "/patients/p1")); });
check("view schedule empty", () => assert.match(viewSchedule({ ...data, appointments: [] }).text, /Nothing on the schedule today/));
check("view messages", () => { assert.match(viewMessages(data).text, /3 unread/); assert.match(viewMessages({ ...data, unreadMessages: 0 }).text, /caught up/); });
const VT: Array<[string, string | null]> = [["todo", "todo"], ["todos", "todo"], ["to do", "todo"], ["tasks", "todo"], ["schedule", "schedule"], ["today", "schedule"], ["schedule today", "schedule"], ["messages", "messages"], ["unread", "messages"], ["appointment check", "apptCheck"], ["appt check", "apptCheck"], ["quick biz", "business"], ["quickbiz", "business"], ["business", "business"], ["", null], ["banana", null]];
for (const [q, want] of VT) check(`view target "${q}"`, () => assert.equal(parseViewTarget(q), want));
check("viewQuery", () => { assert.equal(viewQuery("/view "), ""); assert.equal(viewQuery("/view qu"), "qu"); assert.equal(viewQuery("/view"), null); assert.equal(viewQuery("see /view x"), null); });
check("view menu admin", () => assert.deepEqual(viewTargetsFor(true).map((v) => v.word), ["todo", "schedule", "messages", "appointment check", "quick biz"]));
check("view menu staff", () => assert.deepEqual(viewTargetsFor(false).map((v) => v.word), ["todo", "schedule", "messages"]));
check("view menu filter", () => { assert.deepEqual(viewMatches("q", true).map((v) => v.target), ["business"]); assert.deepEqual(viewMatches("q", false), []); assert.deepEqual(viewMatches("app", true).map((v) => v.target), ["apptCheck"]); });
check("mr unread", () => assert.match(mr.text, /3 unread/));
check("mr caught up", () => assert.match(morningRundown({ ...data, unreadMessages: 0 }).text, /all caught up/));
check("mr no case counts (moved to Quick Biz)", () => assert.doesNotMatch(mr.text, /active ·|submitted/));
check("mr links (no Open To-Do list — lines are clickable)", () => assert.deepEqual(mr.links?.map((l) => l.label), ["Open Schedule", "Open Messages"]));
check("mr empty", () => assert.match(morningRundown({ ...data, appointments: [], tasks: [] }).text, /Nothing on the schedule[\s\S]*Nothing open/));

// Know Your Business
const kyb = knowYourBusiness(data).text;
const section = (label: string) => kyb.split("\n\n").find((s) => s.startsWith(label)) ?? "";
check("kyb title", () => assert.match(kyb, /^Quick Biz \(10\/15\/2026\)/));
check("kyb counts", () => assert.match(kyb, /4 active · 1 submitted · 0 ready to submit/));
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
check("sm all", () => assert.deepEqual(slashMatches("").map((c) => c.cmd), ["note", "todo", "view", "contact"]));
check("sm v", () => assert.deepEqual(slashMatches("v").map((c) => c.cmd), ["view"]));
check("sm c", () => assert.deepEqual(slashMatches("c").map((c) => c.cmd), ["contact"]));
check("sq date text", () => { assert.equal(slashQuery("10/20"), null); assert.equal(slashQuery("see 10/"), null); assert.equal(parseSlash("call on 10/20"), null); });
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
