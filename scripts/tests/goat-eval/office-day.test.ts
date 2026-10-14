/**
 * Role-play eval: a day running a multi-location chiro/PI practice (Hulen +
 * Saginaw), talking to G.O.A.T. the way you'd talk to a front-desk assistant.
 * Every turn goes through goatTurn with mock data only.
 *
 * Run: npx tsx scripts/tests/goat-eval/office-day.test.ts   (add --transcripts to print them)
 */
import assert from "node:assert/strict";
import { emptyDialog, goatTurn, type DialogReply, type DialogState, type DialogCtx } from "../../../src/lib/goat-dialog";
import { getDefaultScheduleSettings } from "../../../src/lib/schedule-settings";
import type { ScheduleAppointmentRecord } from "../../../src/lib/schedule-appointments";
import type { PracticeData } from "../../../src/lib/goat-practice";

const TODAY = "2026-10-13";
const appt = (id: string, patientId: string, patientName: string, startTime: string, location: string, date = TODAY, status = "Scheduled", type = "Follow-Up Visit"): ScheduleAppointmentRecord => ({
  id, patientId, patientName, provider: "Dr. Mock", location, appointmentType: type, caseLabel: "", room: "", date, startTime, durationMin: 15, status: status as ScheduleAppointmentRecord["status"], note: "", overrideOfficeHours: false,
});
const data: PracticeData = {
  today: TODAY,
  patients: [
    { id: "p-collin", fullName: "Collin Elliott", caseStatus: "Active", attorney: "Mock & Mock Law" },
    { id: "p-kara-s", fullName: "Kara Smith", caseStatus: "Active", attorney: "Testing Legal" },
    { id: "p-kara-j", fullName: "Kara Jones", caseStatus: "Submitted", attorney: "Sample Law" },
    { id: "p-john-m", fullName: "John Miller", caseStatus: "Active", attorney: "Example LLP" },
    { id: "p-john-d", fullName: "John Davis", caseStatus: "Submitted", attorney: "" },
    { id: "p-jane", fullName: "Jane Sample", caseStatus: "Active", attorney: "Mock & Mock Law" },
  ] as PracticeData["patients"],
  tasks: [
    { id: "t1", title: "Call Testing Legal about Kara Smith", done: false, dueDate: TODAY } as never,
    { id: "t2", title: "Send R&B for John Davis", done: false, dueDate: "2026-10-12" } as never,
  ],
  appointments: [
    appt("a1", "p-collin", "Collin Elliott", "09:00", "Hulen"),
    appt("a2", "p-kara-s", "Kara Smith", "10:30", "Saginaw"),
    appt("a3", "p-john-m", "John Miller", "11:00", "Hulen"),
    appt("a4", "p-jane", "Jane Sample", "08:30", "Saginaw", TODAY, "No Show"),
    appt("a5", "p-john-d", "John Davis", "15:00", "Hulen", "2026-10-14"),
  ],
  contacts: [{ id: "c1", name: "Mock Imaging Center", phone: "555-0100", fax: "555-0101", email: "img@example.com" } as never],
};
const ctxBase: DialogCtx = { data, team: [{ firstName: "Hannah", label: "Hannah" }, { firstName: "Greg", label: "Greg" }], openPatientId: null, settings: getDefaultScheduleSettings() };

type Expect = (r: DialogReply) => void;
const kind = (k: DialogReply["kind"], more?: (r: DialogReply) => void): Expect => (r) => { assert.equal(r.kind, k, `got ${r.kind}: ${r.say}`); more?.(r); };
const pid = (id: string) => (r: DialogReply) => assert.equal((r as { patientId?: string | null }).patientId, id, `patient ${(r as { patientId?: string }).patientId}`);
const says = (...w: RegExp[]) => (r: DialogReply) => w.forEach((x) => assert.match(r.say, x));
const notNotFound: Expect = (r) => assert.ok(!/couldn't find that in this patient's file/i.test(r.say));

interface Scenario { name: string; open?: string; turns: Array<[string, Expect]> }
const S: Scenario[] = [
  { name: "Morning schedule check", turns: [["morning! whats on the schedule today", kind("office", says(/Collin Elliott|9:00/))], ["and tmrw?", kind("office", says(/John Davis|tomorrow/i))]] },
  { name: "Who's coming today and at which office", turns: [["who's coming in today and at which office", kind("office", says(/Hulen \(2\)/, /Saginaw \(1\)/))]] },
  { name: "Book, with a pronoun", turns: [["when is collin's next visit?", kind("fileQuestion", pid("p-collin"))], ["book him friday at 3", kind("booking", pid("p-collin"))]] },
  { name: "Move and cancel (not supported yet → points to Schedule)", turns: [["move kara smith's appt to 2", kind("unsupported", says(/Schedule/))], ["actually just cancel her appointment", kind("unsupported", pid("p-kara-s"))]] },
  { name: "No-show follow-up", turns: [["jane sample no showed this morning, add a note that we left a vm", kind("noteConfirm", pid("p-jane"))], ["tell hannah to call her and rebook", kind("messageConfirm", (r) => { assert.equal((r as { to: string }).to, "Hannah"); pid("p-jane")(r); })], ["book her tmrw at 10", kind("booking", pid("p-jane"))]] },
  { name: "Add a note across turns", turns: [["add a note", kind("ask", says(/Which patient/))], ["collin elliott", kind("ask", says(/What should the note/))], ["spoke to atty about red req", kind("noteConfirm", (r) => { pid("p-collin")(r); assert.equal((r as { text: string }).text, "spoke to atty about red req"); })]] },
  { name: "Add a note: name and note in the reply", turns: [["pls add a note", kind("ask")], ["collin elliott i spoke to atty about red req", kind("noteConfirm", pid("p-collin"))]] },
  { name: "Add a note: 'I just told you'", turns: [["add a note: atty called back", kind("noteConfirm", pid("p-collin"))]], open: "p-collin" },
  { name: "Messaging Hannah and Greg", turns: [["msg greg re collin's red req", kind("messageConfirm", pid("p-collin"))], ["let hannah know kara jones paid", kind("messageConfirm", pid("p-kara-j"))]] },
  { name: "Balances, with pronouns and shorthand", turns: [["whats kara smith's bal", kind("fileQuestion", pid("p-kara-s"))], ["and how much does she owe after the red req", kind("fileQuestion", pid("p-kara-s"))]] },
  { name: "Attorney / LOP status", turns: [["who's collin's atty", kind("fileQuestion", says(/Mock & Mock Law/))], ["does he have an lop on file", kind("fileQuestion", pid("p-collin"))]] },
  { name: "Cases waiting for checks", turns: [["how many cases are waiting on checks", kind("office", says(/Submitted|check/i))], ["list them", kind("office", says(/Kara Jones|John Davis/))]] },
  { name: "To-dos", turns: [["what's on my to do list", kind("office", says(/Testing Legal|R&B/))]] },
  { name: "Contacts", turns: [["whats the fax for mock imaging", kind("office", says(/555-0101/))]] },
  { name: "Correction: the other John", turns: [["whats john miller's balance", kind("fileQuestion", pid("p-john-m"))], ["no, the other john", kind("fileQuestion", pid("p-john-d"))]] },
  { name: "Correction from a which-one list", turns: [["add a note for kara: atty called", kind("choose")], ["kara jones", kind("noteConfirm", pid("p-kara-j"))]] },
  { name: "That one / him after a list", turns: [["book john tomorrow at 2", kind("choose")], ["john davis", kind("booking", pid("p-john-d"))], ["and whats that one's balance", kind("fileQuestion", pid("p-john-d"))]] },
  { name: "Statement naming a patient → clarifying question", turns: [["collin elliott atty sent lop", kind("clarify", (r) => { notNotFound(r); says(/note/)(r); })]] },
  { name: "Casual shorthand", turns: [["can u bok collin tmrw 3p pls", kind("booking", pid("p-collin"))], ["ad a note for him that pt was late", kind("noteConfirm", pid("p-collin"))]] },
];

let passed = 0, total = 0;
const failures: string[] = [];
const transcripts: string[] = [];
for (const sc of S) {
  let st: DialogState = emptyDialog();
  const ctx = { ...ctxBase, openPatientId: sc.open ?? null };
  const lines = [`### ${sc.name}${sc.open ? ` (On: ${data.patients.find((p) => p.id === sc.open)!.fullName})` : ""}`];
  let ok = true;
  for (const [msg, exp] of sc.turns) {
    total++;
    const { reply, state } = goatTurn(msg, st, ctx);
    st = state;
    lines.push(`You: ${msg}`, `G.O.A.T. [${reply.kind}]: ${reply.say.replace(/\n/g, "\n    ")}`);
    try { exp(reply); notNotFound(reply); passed++; } catch (e) { ok = false; failures.push(`${sc.name} / "${msg}": ${(e as Error).message.split("\n")[0]}`); }
  }
  transcripts.push(lines.join("\n"));
  console.log(`${ok ? "PASS" : "FAIL"}  ${sc.name}`);
}
if (process.argv.includes("--transcripts")) console.log(`\n${transcripts.join("\n\n")}`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(`\n${S.length} scenarios, ${passed}/${total} turns passed (mock data only)`);
if (failures.length) process.exit(1);

// File questions without a question word still go to the file (not a clarifying question).
{
  const r = goatTurn("kara smith last visit", emptyDialog(), ctxBase).reply;
  assert.equal(r.kind, "fileQuestion", r.say);
  const r2 = goatTurn("collin mri", emptyDialog(), ctxBase).reply;
  assert.equal(r2.kind, "fileQuestion", r2.say);
  console.log("PASS  file topics without a question word stay file questions");
}
