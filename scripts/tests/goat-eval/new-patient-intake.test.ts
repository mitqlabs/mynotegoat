/**
 * New patients, plain-language to-dos and scheduling (fictional data only).
 * - "add to-do call vartan 555-555-8855 …" / "remind me to …" → to-do text (phone kept)
 * - "schedule new patient John Smith next Wednesday at 10", "schedule armen barmen for new appt …"
 *   → New Appointment in New-patient mode (prefilled), never created silently
 * - Existing patients ("schedule john smith for friday at 3") stay on the booking path
 * - New Patient form intake parser (/new, "I have a new patient for you …")
 * Run: npx tsx scripts/tests/goat-eval/new-patient-intake.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectNewPatientRequest, detectNewVisitBooking, detectPlainTodo, findTodoPhone, newPatientIntakeText, scheduleSlashToBooking, tidyTodoText } from "../../../src/lib/goat-intents";
import { checkIntakeAppointment, mdyToIso, newPatientVisitType, parseIntakeText, scheduleCaseLabel } from "../../../src/lib/new-patient-intake";
import { SLASH_COMMANDS, parseSlash, parseTodo } from "../../../src/lib/goat-briefs";
import { detectCommand, canonicalBooking } from "../../../src/lib/goat-commands";
import { isBookingRequest } from "../../../src/lib/goat-howto";
import { planBooking } from "../../../src/lib/goat-booking";
import { getDefaultScheduleSettings } from "../../../src/lib/schedule-settings";
import type { ScheduleAppointmentRecord } from "../../../src/lib/schedule-appointments";

const TODAY = "2026-10-19"; // Monday
const settings = getDefaultScheduleSettings();
const ATTYS = ["Ward Mock Law Firm", "Mock & Partners Law", "Sample Legal Group"];
let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };
const parse = (t: string) => parseIntakeText(t, { todayIso: TODAY, attorneys: ATTYS, settings });

// ── 1. Plain-language to-dos ──────────────────────────────────────────
const TODOS: Array<[string, string]> = [
  ["Add to-do call vartan 555-555-8855 to schedule new appt", "Call Vartan 555-555-8855 to schedule new appt"],
  ["add todo call vartan 555-555-8855 to schedule new appt", "Call Vartan 555-555-8855 to schedule new appt"],
  ["add a to-do: call vartan 555-555-8855 to schedule new appt", "Call Vartan 555-555-8855 to schedule new appt"],
  ["remind me to call armen barmen 555-555-5588", "Call Armen Barmen 555-555-5588"],
  ["add to-do call armen barmen 555-555-5588", "Call Armen Barmen 555-555-5588"],
  ["please add a task to text maria about her mri", "Text Maria about her mri"],
  ["can you add a todo to email the adjuster", "Email the adjuster"],
  ["make a to-do: fax Mock Law the bills", "Fax Mock Law the bills"],
  ["create a reminder to call back Ward Mock Law Firm", "Call back Ward Mock Law Firm"],
  ["new task call the attorney about records", "Call the attorney about records"],
  ["todo: request records from mock imaging", "Request records from mock imaging"],
  ["To-do - call jane mockley re balance", "Call Jane Mockley re balance"],
  ["add to do follow up with carla doe 817-555-0199", "Follow up with Carla Doe 817-555-0199"],
  ["put in a todo call dr mock 214 555 0101", "Call dr mock 214 555 0101"],
  ["add a new to-do text vartan (817) 555-0100", "Text Vartan (817) 555-0100"],
  ["remind me to check on the mri for alpha mock", "Check on the mri for alpha mock"],
  ["jot down a to-do: ask ana fake for her insurance card", "Ask Ana Fake for her insurance card"],
  ["add task: call armen 555.555.5588", "Call Armen 555.555.5588"],
];
for (const [q, want] of TODOS) check(`todo: ${q}`, () => {
  const t = detectPlainTodo(q);
  assert.ok(t, "not detected");
  assert.equal(t!.text, want);
  // The to-do card keeps the phone and isn't turned into a patient name.
  const p = parseTodo(t!.text, TODAY);
  assert.equal(p.name, null);
  assert.equal(p.title, want);
});
check("todo with a due day", () => { const t = parseTodo(detectPlainTodo("remind me to call the attorney friday")!.text, TODAY); assert.equal(t.title, "Call the attorney"); assert.equal(t.due, "2026-10-23"); });
check("bare add a to-do asks", () => assert.equal(detectPlainTodo("add a todo")?.text, ""));
for (const q of ["what's on my to-do list", "show my todos", "/todo call atty", "schedule john smith friday at 3", "do I have any to-dos today", "how do I add a to-do"]) check(`not a plain todo: ${q}`, () => assert.equal(detectPlainTodo(q), null));
check("tidy keeps 'the'", () => assert.equal(tidyTodoText("call the adjuster"), "Call the adjuster"));

// ── 2. New patient visit (New Appointment, New-patient mode) ──────────
type Want = { first?: string; last?: string; date?: string; time?: string; phone?: string; attorney?: string; newPt: boolean };
const VISITS: Array<[string, Want]> = [
  ["schedule armen barmen for new appt next Thursday at 3pm", { first: "Armen", last: "Barmen", date: "2026-10-29", time: "15:00", newPt: false }],
  ["Schedule new patient for next Wednesday", { date: "2026-10-28", newPt: true }],
  ["schedule john smith new patient", { first: "John", last: "Smith", newPt: true }],
  ["schedule new patient John Smith for next Wednesday at 10", { first: "John", last: "Smith", date: "2026-10-28", time: "10:00", newPt: true }],
  ["book a new patient Jane Mockley 817-555-0142 tomorrow at 3", { first: "Jane", last: "Mockley", date: "2026-10-20", time: "15:00", phone: "817-555-0142", newPt: true }],
  ["schedule new patient Carla Doe 10/22 2pm atty Ward Mock Law Firm", { first: "Carla", last: "Doe", date: "2026-10-22", time: "14:00", attorney: "Ward Mock Law Firm", newPt: true }],
  ["can you schedule a new patient tomorrow at 9", { date: "2026-10-20", time: "09:00", newPt: true }],
  ["please book new pt Ana Fake friday 11am", { first: "Ana", last: "Fake", date: "2026-10-23", time: "11:00", newPt: true }],
  ["set up a new patient eval for Ben Sample on 10/27 at 4", { first: "Ben", last: "Sample", date: "2026-10-27", time: "16:00", newPt: true }],
  ["book armen barmen a new appointment tomorrow 10:30", { first: "Armen", last: "Barmen", date: "2026-10-20", time: "10:30", newPt: false }],
  ["schedule Dana Mock as a new patient thursday at 2", { first: "Dana", last: "Mock", date: "2026-10-22", time: "14:00", newPt: true }],
];
for (const [q, w] of VISITS) check(`new visit: ${q}`, () => {
  const v = detectNewVisitBooking(q);
  assert.ok(v, "not detected");
  assert.equal(v!.saysNewPatient, w.newPt);
  const { draft } = parse(v!.text);
  assert.equal(draft.firstName, w.first);
  assert.equal(draft.lastName, w.last);
  assert.equal(draft.apptDate, w.date);
  assert.equal(draft.apptTime, w.time);
  if (w.phone) assert.equal(draft.phone, w.phone);
  if (w.attorney) assert.equal(draft.attorney, w.attorney);
});
for (const q of ["schedule john smith for friday at 3", "book maria next tuesday", "what's on the schedule tomorrow", "how do I add a new patient", "add to-do call vartan 555-555-8855 to schedule new appt", "new patients this month?"]) check(`not a new visit: ${q}`, () => assert.equal(detectNewVisitBooking(q), null));
check("no-name new patient asks for the name", () => assert.ok(parse(detectNewVisitBooking("Schedule new patient for next Wednesday")!.text).ask.some((a) => /name/i.test(a))));

// Phone from a matching open "call …" to-do
const tasks = [
  { id: "t1", title: "Call Armen Barmen 555-555-5588", done: false },
  { id: "t2", title: "Call Vartan 555-555-8855 to schedule new appt", done: false },
  { id: "t3", title: "Call Ana Fake 214-555-0101", done: true },
];
check("todo phone: armen", () => assert.deepEqual(findTodoPhone({ firstName: "Armen", lastName: "Barmen" }, tasks), { taskId: "t1", phone: "555-555-5588" }));
check("todo phone: first name only", () => assert.deepEqual(findTodoPhone({ firstName: "Vartan" }, tasks), { taskId: "t2", phone: "555-555-8855" }));
check("todo phone: done to-dos ignored", () => assert.equal(findTodoPhone({ firstName: "Ana", lastName: "Fake" }, tasks), null));
check("todo phone: no match", () => assert.equal(findTodoPhone({ firstName: "Zed", lastName: "Nobody" }, tasks), null));
check("todo phone: partial word doesn't match", () => assert.equal(findTodoPhone({ firstName: "Arm" }, tasks), null));

// ── 3. New Patient form intake (/new, "I have a new patient for you") ──
const INTAKE: Array<[string, (r: ReturnType<typeof parse>) => void]> = [
  ["/new Jane Mockley 817-555-0142 atty Ward Mock Law Firm DOI 10/12 rear-ended on I-30, neck pain. appt tomorrow at 3", ({ draft: d }) => {
    assert.equal(d.firstName, "Jane"); assert.equal(d.lastName, "Mockley"); assert.equal(d.phone, "817-555-0142");
    assert.equal(d.attorney, "Ward Mock Law Firm"); assert.equal(d.dateOfInjury, "10/12/2026"); assert.equal(d.apptDate, "2026-10-20"); assert.equal(d.apptTime, "15:00");
  }],
  ["I have a new patient for you. Doe, John. Attorney is Mock & Partners", ({ draft: d }) => { assert.equal(d.lastName, "Doe"); assert.equal(d.firstName, "John"); assert.equal(d.attorney, "Mock & Partners Law"); }],
  ["new patient cash Mia Sample hurt yesterday, today 4:30p", ({ draft: d }) => { assert.equal(d.nonPi, true); assert.equal(d.dateOfInjury, "10/18/2026"); assert.equal(d.apptTime, "16:30"); }],
  ["/new Carlos 817-555-0123", ({ draft: d, ask }) => { assert.equal(d.firstName, "Carlos"); assert.ok(ask.some((a) => /last name/i.test(a))); }],
  ["/new Ann Lee Sample, lawyer Unknown Legal", ({ ask }) => { assert.ok(ask.length >= 1); }],
  ["Hi I have a new patient for you Ana Fake 214-555-0101 doi 10/10 can come in thursday 11", ({ draft: d }) => { assert.equal(d.firstName, "Ana"); assert.equal(d.lastName, "Fake"); assert.equal(d.apptDate, "2026-10-22"); assert.equal(d.apptTime, "11:00"); assert.equal(d.dateOfInjury, "10/10/2026"); }],
];
for (const [q, fn] of INTAKE) check(`intake: ${q}`, () => fn(parse(newPatientIntakeText(q))));
for (const q of ["/new Jane Doe", "I have a new patient for you Ana Fake", "new patient: Bo Mock 817-555-0100", "we got a new pt for you"]) check(`new patient request: ${q}`, () => assert.ok(detectNewPatientRequest(q)));
for (const q of ["how do I add a new patient", "how many new patients this month", "add to-do call new patient jane", "who are my new patients"]) check(`not a new patient request: ${q}`, () => assert.equal(detectNewPatientRequest(q), false));

// ── 4. Existing patients stay on the normal booking path ─────────────
const BOOKINGS = [
  "schedule john smith for friday at 3", "book maria next tuesday", "book kara tmrw at 3", "schedule jane sample 10/22 at 9:30am",
  "can you book collin elliott friday", "please schedule john miller next monday at 2", "book jane sample for a follow up thursday 11",
  "put john davis in on friday at 10", "set up an appointment for kara jones tomorrow at 4", "reschedule collin to wednesday 3pm",
];
for (const q of BOOKINGS) check(`booking: ${q}`, () => { assert.equal(detectCommand(q), "book"); assert.equal(detectNewVisitBooking(q), null); assert.equal(detectPlainTodo(q), null); });
check("/schedule → booking wording", () => { assert.equal(scheduleSlashToBooking("John Smith friday at 3"), "book John Smith friday at 3"); assert.ok(isBookingRequest(canonicalBooking(scheduleSlashToBooking("John Smith friday at 3")))); });
check("booking plan: friday at 3 → draft", () => {
  const step = planBooking({ question: "book john smith friday at 3", patient: { id: "p1", fullName: "Smith, John" }, todayIso: TODAY, appointments: [], settings });
  assert.equal(step.kind, "draft");
  if (step.kind === "draft") { assert.equal(step.draft.date, "2026-10-23"); assert.equal(step.draft.time, "15:00"); }
});
check("booking plan: no time → asks", () => assert.equal(planBooking({ question: "book maria next tuesday", patient: { id: "p2", fullName: "Mock, Maria" }, todayIso: TODAY, appointments: [], settings }).kind, "needTime"));

// ── 5. Helpers ────────────────────────────────────────────────────────
check("visit type: New Patient (not cash)", () => assert.equal(newPatientVisitType([{ name: "Follow-Up Visit", durationMin: 15, isDefault: true }, { name: "Cash New Patient", durationMin: 30 }, { name: "New Patient", durationMin: 45 }])?.name, "New Patient"));
check("visit type: falls back to default", () => assert.equal(newPatientVisitType([{ name: "Follow-Up Visit", durationMin: 15, isDefault: true }])?.name, "Follow-Up Visit"));
check("mdyToIso", () => { assert.equal(mdyToIso("10/12/2026"), "2026-10-12"); assert.equal(mdyToIso("10/12"), ""); });
check("case label", () => assert.equal(scheduleCaseLabel("2026-10-12", "Mockley, Jane"), "101226MOJA"));
check("slot check: taken slot suggests times", () => {
  const appts = [{ id: "a1", patientId: "x", patientName: "Taken, Tom", provider: "", location: "", appointmentType: "New Patient", caseLabel: "", room: "", date: "2026-10-20", startTime: "15:00", durationMin: 30, status: "Scheduled", note: "" }] as unknown as ScheduleAppointmentRecord[];
  const one = { ...settings, maxAppointmentsPerSlot: 1 };
  const r = checkIntakeAppointment({ apptDate: "2026-10-20", apptTime: "15:00", appointmentType: "New Patient", durationMin: 30 }, appts, one);
  assert.ok(r.taken);
});

// ── 6. Registry, Handbook and wiring ─────────────────────────────────
check("slash registry has /new and /schedule", () => { for (const c of ["new", "schedule"]) assert.ok(SLASH_COMMANDS.some((x) => x.cmd === c), c); });
check("parseSlash /new", () => assert.deepEqual(parseSlash("/new Jane Doe"), { cmd: "new", rest: "Jane Doe" }));
check("parseSlash /schedule", () => assert.deepEqual(parseSlash("/schedule john smith fri 3"), { cmd: "schedule", rest: "john smith fri 3" }));
const read = (f: string) => readFileSync(f, "utf8");
const sched = read("src/app/(portal)/appointments/page.tsx");
const pts = read("src/app/(portal)/patients/page.tsx");
const goat = read("src/components/global-goat.tsx");
const hb = read("src/lib/handbook-goat.ts") + read("src/lib/handbook-content.ts");
check("schedule: Existing / New patient toggle", () => { assert.ok(sched.includes('data-testid="patient-mode-toggle"')); assert.ok(sched.includes('"New patient"')); assert.ok(!sched.includes("Create Patient")); assert.ok(!sched.includes("Quick New Patient")); });
check("schedule: new patient fields grid", () => { for (const k of ["new-pt-${key}", "new-pt-dob", "new-pt-notes"]) assert.ok(sched.includes(k), k); assert.ok(!sched.includes('data-testid="new-pt-attorney"') && !sched.includes('data-testid="new-pt-doi"'), "attorney / DOI go on the patient page (+ Case)"); assert.ok(/data-row="new-patient-fields"/.test(sched)); });
check("schedule: one Save creates patient + visit (Initial Exam)", () => { assert.ok(!/createPatientRecord\(\{[\s\S]{0,400}initialExam:/.test(sched), "Initial Exam comes from the visit while blank, never saved at booking"); assert.ok(sched.includes("newPatientVisitType(appointmentTypes)")); });
check("schedule: checkboxes wrap instead of colliding", () => assert.ok(/flex flex-wrap items-center gap-x-6 gap-y-2" data-row="appointment-flags"/.test(sched)));
check("schedule: offers to mark the to-do done", () => assert.ok(sched.includes('data-testid="done-task-offer"') && sched.includes("toggleTaskDone")));
check("modal component: checkboxes wrap", () => assert.ok(read("src/components/new-appointment-modal.tsx").includes('data-row="appointment-flags"')));
check("patients: New Patient popup has no evaluation date/time (first visit is booked on the Schedule)", () => { assert.ok(!pts.includes('data-testid="new-patient-eval-date"')); assert.ok(!pts.includes('data-testid="new-patient-eval-time"')); assert.ok(pts.includes('data-testid="new-patient-add-case"')); });
check("goat: plain intents routed before briefs", () => { const i = goat.indexOf("tryPlainIntent(question)) return;"); assert.ok(i > 0 && i < goat.indexOf("detectBrief(question)) {")); });
check("goat: form buttons", () => assert.ok(goat.includes("data-goat-form") && goat.includes('formRouter.push("/appointments?new=1")') && goat.includes('formRouter.push("/patients?new=1")')));
check("handbook: new flows", () => { for (const t of ["remind me to call armen barmen", "schedule new patient John Smith", "Existing patient Armen Barmen, or a new patient?", "+ Case", "New patient"]) assert.ok(hb.includes(t), t); });

console.log(`new-patient-intake: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
