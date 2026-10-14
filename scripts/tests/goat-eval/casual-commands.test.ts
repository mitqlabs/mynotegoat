/**
 * Casual-phrasing eval for G.O.A.T. action commands (mock data only).
 * Add note, team message, booking and bill lookup: ≥40 phrasings each,
 * plus the exact add-note messages that failed live on 2026-10-13.
 *
 * Run: npx tsx scripts/tests/goat-eval/casual-commands.test.ts
 */
import assert from "node:assert/strict";
import { canonicalTell, continueAddNote, detectCommand, findNameAnywhere, planAddNote, type AddNoteStep, type CommandPatient } from "../../../src/lib/goat-commands";
import { parseTell } from "../../../src/lib/goat-message";

export const MOCK_PATIENTS: CommandPatient[] = [
  { id: "p-collin", fullName: "Collin Elliott", active: true },
  { id: "p-kara-s", fullName: "Kara Smith", active: true },
  { id: "p-kara-j", fullName: "Kara Jones", active: true },
  { id: "p-john-m", fullName: "John Miller", active: true },
  { id: "p-john-d", fullName: "John Davis", active: true },
  { id: "p-jane", fullName: "Jane Sample", active: true },
  { id: "p-old", fullName: "Olivia Oldcase", active: false },
];
const P = MOCK_PATIENTS;
const collin = P[0];

const results: Array<{ group: string; q: string; ok: boolean; err?: string }> = [];
function check(group: string, q: string, fn: () => void) {
  try { fn(); results.push({ group, q, ok: true }); } catch (e) { results.push({ group, q, ok: false, err: (e as Error).message.split("\n")[0] }); }
}
const confirmFor = (s: AddNoteStep<CommandPatient> | null, id: string, textHas?: RegExp) => {
  assert.ok(s, "no plan");
  assert.equal(s!.kind, "confirm", `kind ${s!.kind}`);
  if (s!.kind !== "confirm") return;
  assert.equal(s.patient.id, id);
  assert.ok(s.text.length > 0 && !/^that\b/i.test(s.text), `text "${s.text}"`);
  if (textHas) assert.match(s.text, textHas);
};

// ── Exact live failures ───────────────────────────────────────────────
for (const q of [
  "add a note for collin elliott that i spoke to atty about red req",
  "add a note for collin that i spoke with the atty negotiating red req",
  "add a note for collin that i spoke to atty about redreq",
]) check("live", q, () => { assert.equal(detectCommand(q), "addNote"); confirmFor(planAddNote(q, P, null), "p-collin", /^i spoke/i); });
check("live", "open patient: add a note that i spoke to atty about red req", () => confirmFor(planAddNote("add a note that i spoke to atty about red req", P, collin), "p-collin", /^i spoke to atty about red req$/i));
check("live", "pending + 'collin elliott i spoke to atty about red req'", () => {
  const first = planAddNote("add a note", P, null);
  assert.equal(first?.kind, "askPatient");
  if (first?.kind !== "askPatient") return;
  confirmFor(continueAddNote("collin elliott i spoke to atty about red req", first.pending, P), "p-collin", /^i spoke to atty about red req$/i);
});
check("live", "pending + 'collin elliott' alone → asks for the note, not a file lookup", () => {
  const s = continueAddNote("collin elliott", { text: null, patientId: null }, P);
  assert.equal(s?.kind, "askText");
});
for (const reply of ["collin", "i just told you Collin", "Collin Elliott is there"]) {
  check("live", `pending text + '${reply}'`, () => confirmFor(continueAddNote(reply, { text: "spoke to atty about red req", patientId: null }, P), "p-collin", /red req/));
}
check("live", "several match → asks which", () => {
  const s = planAddNote("add a note for kara: called atty", P, null);
  assert.equal(s?.kind, "choose");
  if (s?.kind === "choose") assert.equal(s.candidates.length, 2);
});

// ── Add note: 45 casual phrasings (Collin by name, or open patient) ─────
const NOTE_NAMED = [
  "add a note for collin elliott that i spoke to atty about red req",
  "add note for collin: spoke to atty re red req",
  "add a note to collin saying atty called",
  "add a note on collin - atty wants records",
  "pls add a note for collin that atty sent lop",
  "can you add a note for Collin Elliott: pt called to resched",
  "could you add a note to collin elliott's file that the atty called",
  "put a note in collin's file that atty faxed lop",
  "put a note in collin elliott's chart: red req sent",
  "note for collin: atty asked for bill",
  "note for collin elliott - left vm for atty",
  "note to collin: pt says neck is better",
  "ad a note for collin that i spoke w atty abt red req",
  "add a nte for collin: atty called back",
  "add a noet for collin that we sent the bill",
  "pls ad note for collin - red req pending",
  "write a note for collin that atty approved red req",
  "leave a note for collin saying call atty monday",
  "log a note for collin: atty on vacation til 10/20",
  "jot down a note for collin that pt will be late",
  "drop a note on collin: check came in",
  "add a quick note for collin: atty asked for narrative",
  "hey goat, add a note for collin that atty called",
  "goat add a note for collin: spoke to adjuster",
  "add note for collin elliott that i spoke to atty negotiating red req",
  "add a note for Collin that I spoke with the atty negotiating red req",
  "add a note for collin that i spoke to atty about redreq",
  "add a note for collin, atty wants an update",
  "add a note for collin re atty called about reduction",
  "add a note for colin that atty called",
  "add a note for collin elliot that atty called",
  "can u add a note for collin that the atty called pls",
  "i need you to add a note for collin: lop received",
  "please put a note in collin's file: pt dropped off mri cd",
  "add a note to collin elliott: rb sent 10/12",
  "add a note for collin about the red req: atty countered 40%",
];
for (const q of NOTE_NAMED) check("addNote", q, () => { assert.equal(detectCommand(q), "addNote", "not detected"); confirmFor(planAddNote(q, P, null), "p-collin"); });
const NOTE_OPEN = [
  "add a note that i spoke to atty about red req",
  "add a note: atty called",
  "add note - pt rescheduled",
  "pls add a note saying atty wants records",
  "note: left vm for atty",
  "can you add a note that the check came in",
  "add a quick note that pt will bring mri",
  "ad a note that atty called back",
  "write a note: red req sent",
  "jot a note saying spoke to adjuster",
];
for (const q of NOTE_OPEN) check("addNote", `(open patient) ${q}`, () => { assert.equal(detectCommand(q), "addNote", "not detected"); confirmFor(planAddNote(q, P, collin), "p-collin"); });

// ── Team message: 42 phrasings → "tell <Hannah|Greg> …" ──────────────────
const TELL = [
  ["tell hannah i need notes for kara smith", "hannah"],
  ["tell hanna to call collin's atty", "hanna"],
  ["pls tell greg kara smith is running late", "greg"],
  ["can you tell hannah that john miller cancelled", "hannah"],
  ["message hannah: need the lop for jane", "hannah"],
  ["msg greg re collin's red req", "greg"],
  ["text hannah call the atty for jane", "hannah"],
  ["let greg know collin is here", "greg"],
  ["let hannah know that kara jones paid", "hannah"],
  ["send hannah a message saying the check came in", "hannah"],
  ["send a message to greg: book jane for friday", "greg"],
  ["shoot greg a quick message that the fax is down", "greg"],
  ["send greg a text: pull collin's xrays", "greg"],
  ["ping hannah about collin", "hannah"],
  ["remind greg to send the bill for kara smith", "greg"],
  ["ask hannah to fax records for john miller", "hannah"],
  ["tell hannah: collin called", "hannah"],
  ["tel hannah collin called", "hannah"],
  ["mesage greg about jane's lop", "greg"],
  ["msg hannah kara smith needs a call back", "hannah"],
  ["dm greg check on collin's red req", "greg"],
  ["please message greg that atty called for collin", "greg"],
  ["could you tell hannah to email the atty for kara", "hannah"],
  ["hey goat tell greg the mri cd is at the front", "greg"],
  ["tell greg jane sample no showed", "greg"],
  ["let greg know john davis wants to reschedule", "greg"],
  ["have hannah know collin brought his lop", "hannah"],
  ["message hannah and say the atty called about collin", "hannah"],
  ["text greg and tell him jane is here", "greg"],
  ["tell hannah i spoke to atty abt red req for collin", "hannah"],
  ["tell greg to resend the bill to kara smith's atty", "greg"],
  ["msg hannah: pls call john miller back", "hannah"],
  ["send greg a message - collin's check came", "greg"],
  ["shoot hannah a message saying kara jones paid", "hannah"],
  ["can u msg greg that the copier is jammed", "greg"],
  ["pls msg hannah - collin needs an appt", "hannah"],
  ["tell hannah thx for the help", "hannah"],
  ["remind hannah to call collin's atty tmrw", "hannah"],
  ["ask greg if collin's films came", "greg"],
  ["let hannah know jane cancelled", "hannah"],
  ["message greg, the atty for collin called", "greg"],
  ["text hannah: need red req status for collin", "hannah"],
];
for (const [q, to] of TELL) check("tell", q, () => {
  assert.equal(detectCommand(q), "tell", "not detected");
  const r = parseTell(canonicalTell(q));
  assert.ok(r, "no parse");
  assert.equal(r!.to.toLowerCase(), to);
  assert.ok(r!.text.length > 2, `text "${r!.text}"`);
});

// ── Booking: 42 phrasings ───────────────────────────────────────────────
const BOOK = [
  "book kara smith tomorrow at 3", "book collin tmrw 3pm", "can you book jane friday at 10",
  "pls book john miller monday 2:30", "schedule collin for tomorrow at 4", "schedule jane next tuesday 9am",
  "make an appointment for collin friday at 11", "make an appt for kara smith tmrw at 1",
  "set up an appointment for jane monday at 3", "add an appointment for collin thursday 10am",
  "book an appt for john davis at 4 tomorrow", "bok collin tmrw at 3", "boook jane friday 2pm",
  "can u book collin for 3 tmrw", "please schedule kara jones for monday at noon", "shedule collin friday 9",
  "get collin in tomorrow at 2", "put jane on the schedule friday at 1", "squeeze collin in at 4 today",
  "fit kara smith in tomorrow at 10", "pencil collin in for monday at 3", "rebook collin for next week tuesday at 3",
  "reschedule jane to friday at 2", "book collin", "book her tomorrow at 3", "book him for friday at 10",
  "can you schedule him tomorrow 4pm", "set up a visit for collin friday", "book a visit for jane tmrw at 9",
  "book collin elliott for an exam friday 10am", "book john miller for a re-exam monday at 3",
  "i need to book collin tomorrow at 3", "i want to book jane for friday", "go ahead and book collin tmrw 3p",
  "book collin 10/20 at 3", "book kara smith next monday", "make appt for collin tmrw 3", "book appt collin friday 2",
  "schedual collin for tmrw at 11", "book collin at the hulen office tomorrow at 3", "book jane at saginaw friday 9am",
  "can you put collin in for tomorrow at 3",
];
for (const q of BOOK) check("book", q, () => assert.equal(detectCommand(q), "book", "not detected"));

// ── Bill lookup: 42 phrasings ───────────────────────────────────────────
const BILL = [
  "what's kara smith's balance", "whats collin's bal", "how much does collin owe", "collin balance",
  "balance for jane", "what is john miller's bill", "show me collin's bill", "pull up jane's balance",
  "check collin's balance", "look up kara jones bill", "what does jane owe", "how much is collin's bill",
  "collin's bill?", "bill for collin", "what's the balance on collin elliott", "whats the blance for jane",
  "how much has collin paid", "did collin pay", "any payments from jane", "what are collin's charges",
  "what's outstanding for john miller", "collin elliott outstanding balance", "can you check jane's bill pls",
  "pls pull collin's ledger", "what's her balance", "how much does he owe", "what's his bill",
  "her balance?", "balance?", "what's the bill", "how much do they owe", "what's owed on collin",
  "whats colins balence", "kara smith bill pls", "jane's statement", "what was billed for collin",
  "has collin's rb been paid", "what's collin's balance after the reduction", "collin owes how much",
  "get me jane's balance", "tell me collin's balance", "give me the bill for john davis",
];
for (const q of BILL) check("bill", q, () => assert.equal(detectCommand(q), "bill", "not detected"));

// ── Not commands (must stay null so normal answers still run) ───────────
for (const q of ["when was collin's last visit", "what's collin's dob", "who's coming today", "how many active cases", "show my to-dos", "what did the mri say for jane", "kara smith attorney", "does collin have an lop"]) {
  check("negative", q, () => assert.equal(detectCommand(q), null, `detected ${detectCommand(q)}`));
}
check("names", "name anywhere", () => assert.equal(findNameAnywhere("did the atty call about collin elliott", P)?.matches[0].id, "p-collin"));

const byGroup = new Map<string, { ok: number; all: number }>();
for (const r of results) { const g = byGroup.get(r.group) ?? { ok: 0, all: 0 }; g.all++; if (r.ok) g.ok++; byGroup.set(r.group, g); }
for (const r of results.filter((x) => !x.ok)) console.log(`FAIL [${r.group}] ${r.q} — ${r.err}`);
for (const [g, v] of byGroup) console.log(`${g.padEnd(9)} ${v.ok}/${v.all}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed (mock data only)`);
if (failed) process.exit(1);
