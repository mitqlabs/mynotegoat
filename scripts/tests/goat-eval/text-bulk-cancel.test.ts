/**
 * G.O.A.T. /text and bulk cancel: phrasings, buttons-not-guesses, confirm-before-action, safety wiring. Mock data only.
 * Run: npx tsx scripts/tests/goat-eval/text-bulk-cancel.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { continueFlow, naturalCancelTurn, naturalTextTurn, startFlow, TOKEN, type FlowCtx, type FlowTurn } from "../../../src/lib/goat-slash-flow";
import { parseTextRequest, suggestedCancelText, dayLabel } from "../../../src/lib/goat-text";
import { parseBulkCancel, selectBulkCancel, type CancelableAppt } from "../../../src/lib/goat-bulk-cancel";
import { parseSlash, SLASH_COMMANDS } from "../../../src/lib/goat-briefs";
import { broadcastHelp } from "../../../src/lib/goat-broadcast-help";

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };
const TODAY = "2026-10-28"; // Wednesday
const ctx: FlowCtx = {
  today: TODAY,
  patients: [
    { id: "ann", fullName: "Ann Sample", caseStatus: "Active", phone: "817-555-0101" },
    { id: "bob", fullName: "Bob Mock", caseStatus: "Active" },
    { id: "bo2", fullName: "Bob Mock", caseStatus: "Paid" },
  ],
  contacts: [],
  openPatientId: null,
};
const text = (s: string) => naturalTextTurn(s, ctx);
const cancel = (s: string) => naturalCancelTurn(s, ctx);
const step = (t: string, prev: FlowTurn | null) => continueFlow(t, prev?.pending ?? null, ctx);
const labels = (t: FlowTurn | null) => (t?.choices ?? []).map((c) => c.label);

// ---------- /text: the audience chooser ----------
const s0 = startFlow("text", "", ctx)!;
check("/text asks who, with buttons", () => { assert.match(s0.say, /Who should get/); assert.deepEqual(labels(s0), ["All active patients", "Everyone scheduled tomorrow", "Everyone scheduled today", "One patient"]); assert.equal(s0.action, undefined); });
check("/text is a registered slash command", () => { assert.ok(SLASH_COMMANDS.some((c) => c.cmd === "text")); assert.deepEqual(parseSlash("/text all active that hi"), { cmd: "text", rest: "all active that hi" }); });
const act = step(s0.choices![0].token, s0)!;
check("All active → asks for the message; nothing queued yet", () => { assert.match(act.say, /What should the text say/); assert.deepEqual(act.pending, { k: "textMsg", audience: { kind: "active" } }); assert.equal(act.action, undefined); });
check("typing the message → confirm action (the card, not a send)", () => assert.deepEqual(step("We're closed Friday", act)!.action, { type: "textConfirm", audience: { kind: "active" }, message: "We're closed Friday" }));
check("a message that contains 'cancel' is still a message", () => assert.equal(step("Please cancel your Friday visit if you can't come", act)!.action?.type, "textConfirm"));
check("a message with a date/to-do shape is not re-read as anything else", () => assert.equal(step("remind me tomorrow call atty about the 10/30 visit", act)!.action?.type, "textConfirm"));
check("'never mind' stops: nothing sent", () => { const t = step("never mind", act)!; assert.equal(t.pending, null); assert.equal(t.action, undefined); assert.match(t.say, /Nothing was sent/); });
check("a new slash command replaces the text step", () => assert.equal(step("/todo", act), null));
const day = step(s0.choices![1].token, s0)!;
check("Everyone scheduled tomorrow → message step with that date", () => assert.deepEqual(day.pending, { k: "textMsg", audience: { kind: "booked", date: "2026-10-29" } }));
const one = step(s0.choices![3].token, s0)!;
check("One patient → the patient picker", () => { assert.equal(one.picker!.next, "text"); assert.deepEqual(one.pending, { k: "textPick" }); });
const typed = step("ann", one)!;
check("typed name → 'Is this the patient?' button, never a silent pick", () => { assert.equal(typed.say, "Is this the patient?"); assert.equal(typed.action, undefined); assert.equal(typed.choices!.length, 1); });
const picked = step(typed.choices![0].token, typed)!;
check("patient confirmed → asks the message", () => assert.deepEqual(picked.pending, { k: "textMsg", audience: { kind: "patients", ids: ["ann"], label: "Ann Sample" } }));
check("two same-name patients → asks which one", () => { const t = step("bob mock", one)!; assert.match(t.say, /Which patient\? \(2 match\)/); assert.equal(t.action, undefined); });
check("unknown name → picker prefilled, no action", () => { const t = step("zelda", one)!; assert.equal(t.action, undefined); assert.equal(t.picker!.prefill, "zelda"); });
check("typed day for 'scheduled'", () => { const t = text("text all patients scheduled")!; assert.match(t.say, /Which day/); assert.equal(t.action, undefined); assert.equal(step("friday", t)!.pending && (step("friday", t)!.pending as { audience: { date: string } }).audience.date, "2026-10-30"); });

// ---------- natural phrasing (no slash) ----------
const quoted = text('text everyone "Hey everyone we will be closed tomorrow"')!;
check('text everyone "…": everyone is ambiguous → buttons, message pulled out', () => {
  assert.equal(quoted.action, undefined);
  assert.deepEqual(labels(quoted), ["All active patients", "Everyone scheduled tomorrow", "One patient"]);
  assert.deepEqual(quoted.pending, { k: "textWho", message: "Hey everyone we will be closed tomorrow", dateHint: "2026-10-29" });
});
check("…tap All active → the Send card with the message pre-filled", () => assert.deepEqual(step(quoted.choices![0].token, quoted)!.action, { type: "textConfirm", audience: { kind: "active" }, message: "Hey everyone we will be closed tomorrow" }));
check("…tap Everyone scheduled tomorrow → pre-filled card, booked tomorrow", () => assert.deepEqual(step(quoted.choices![1].token, quoted)!.action, { type: "textConfirm", audience: { kind: "booked", date: "2026-10-29" }, message: "Hey everyone we will be closed tomorrow" }));
check("…tap One patient → picker, then the message is kept", () => { const o = step(quoted.choices![2].token, quoted)!; const t = step("ann", o)!; const p = step(t.choices![0].token, t)!; assert.deepEqual(p.action, { type: "textConfirm", audience: { kind: "patients", ids: ["ann"], label: "Ann Sample" }, message: "Hey everyone we will be closed tomorrow" }); });
for (const phrase of [`text everyone "we're closed tomorrow"`, `text everybody 'office closed Friday'`, `text all patients "see you soon"`, `tell all patients "we're closed tomorrow"`, `message all my patients "hi"`, `text all patients we're closed Friday`]) {
  check(`ambiguous group: ${phrase}`, () => { const t = text(phrase)!; assert.ok(t, "matched"); assert.equal(t.action, undefined); assert.equal(t.choices![0].label, "All active patients"); assert.ok((t.pending as { message?: string }).message); });
}
check("text all active patients that we're closed Friday → card (explicit group, no extra asking)", () => assert.deepEqual(text("text all active patients that we're closed Friday")!.action, { type: "textConfirm", audience: { kind: "active" }, message: "We're closed Friday" }));
check("text everyone scheduled tomorrow that … → booked tomorrow", () => assert.deepEqual(text("text everyone scheduled tomorrow that we open at 10")!.action, { type: "textConfirm", audience: { kind: "booked", date: "2026-10-29" }, message: "We open at 10" }));
check("text everyone scheduled today …", () => assert.deepEqual((text('text everyone scheduled today "running 15 late"')!.action as { audience: unknown }).audience, { kind: "booked", date: TODAY }));
check("text everyone scheduled on friday", () => assert.deepEqual((text('text everyone scheduled on friday "see you"')!.action as { audience: unknown }).audience, { kind: "booked", date: "2026-10-30" }));
check("text Ann Sample … → patient button, no card yet", () => { const t = text("text Ann Sample that her visit moved to 3pm")!; assert.equal(t.action, undefined); assert.equal(t.say, "Is this the patient?"); assert.equal(step(t.choices![0].token, t)!.action!.type, "textConfirm"); });
check("a quoted message is kept exactly as typed", () => assert.equal((parseTextRequest('text everyone "Hey, we\'re OPEN 9–5 Fri (pls come!)"', TODAY)!.message), "Hey, we're OPEN 9–5 Fri (pls come!)"));
check("a lone first name is a team message, not a patient text (no slash)", () => { for (const s of ["text bob can you call the lawyer", "text ann about john smith", "text hannah"]) assert.equal(text(s), null, s); });
check("…but /text with a first name still shows the patient button", () => { const t = startFlow("text", "ann see you tomorrow", ctx)!; assert.equal(t.say, "Is this the patient?"); assert.equal(t.action, undefined); });
check("everyone with no message → asks who first, then the message", () => { const t = text("text everyone")!; assert.equal(t.action, undefined); assert.deepEqual(labels(t).slice(0, 2), ["All active patients", "Everyone scheduled tomorrow"]); const a = step(t.choices![0].token, t)!; assert.match(a.say, /What should the text say/); });
for (const q of ["how do I text everyone", "how do i text all active patients", "can I text everyone?", "what happens if I text all patients", "who does broadcast send to", "text reminders are off", "why didn't my text go out", "message hannah about john", "tell hannah the mri is in", "let everyone know the fax is down", "let the team know we're closed tomorrow"]) {
  check(`not an action: ${q}`, () => { const t = text(q); assert.ok(!t || (t.action === undefined && !t.choices?.some((c) => c.label === "All active patients")), JSON.stringify(t)); });
}
check("a how-to question still gets the Handbook help (and never an action)", () => { assert.ok(broadcastHelp("how do I text everyone")); assert.equal(text("how do I text everyone"), null); });

// ---------- bulk cancel: understanding ----------
const q = (s: string) => parseBulkCancel(s, TODAY);
check("cancel all appointments for tomorrow", () => assert.deepEqual(cancel("cancel all appointments for tomorrow")!.action, { type: "bulkCancel", query: { date: "2026-10-29" } }));
check("cancel everything on Friday", () => assert.deepEqual(cancel("cancel everything on Friday")!.action, { type: "bulkCancel", query: { date: "2026-10-30" } }));
check("cancel Dr. Lee's 3pm–5pm today", () => { const a = cancel("cancel Dr. Lee's 3pm–5pm today")!.action as { query: { date: string; provider?: string; startMin?: number; endMin?: number } }; assert.equal(a.query.date, TODAY); assert.match(a.query.provider ?? "", /lee/i); assert.equal(a.query.startMin, 900); assert.equal(a.query.endMin, 1020); });
check("3-5pm (no am/pm on the first) reads as 3pm–5pm", () => { const r = q("cancel Dr. Lee's 3-5pm today")!; assert.equal(r.query.startMin, 900); assert.equal(r.query.endMin, 1020); });
check("polite and short forms", () => { for (const s of ["please cancel tomorrow's appointments", "cancel everyone scheduled today", "cancel all appts tomorrow", "can you cancel all the appointments on friday"]) assert.equal(cancel(s)!.action!.type, "bulkCancel", s); });
check("no day → asks with Today / Tomorrow buttons, no action", () => { const t = cancel("cancel all appointments")!; assert.equal(t.action, undefined); assert.deepEqual(labels(t), ["Today", "Tomorrow"]); assert.equal(step(t.choices![1].token, t)!.action!.type, "bulkCancel"); });
check("a typed day answers the ask", () => { const t = cancel("cancel everything")!; assert.deepEqual(step("friday", t)!.action, { type: "bulkCancel", query: { date: "2026-10-30" } }); });
check("a whole week is refused, one day at a time", () => { const t = cancel("cancel all appts this week")!; assert.equal(t.action, undefined); assert.match(t.say, /one day at a time/i); });
check("a past day is not offered", () => { const t = cancel("cancel all appointments yesterday")!; assert.equal(t.action, undefined); assert.match(t.say, /already passed/i); });
for (const s of ["cancel john smith's appointment tomorrow", "cancel the 3pm appointment", "how do I cancel all appointments", "can I cancel all appointments for tomorrow?", "cancel my subscription", "what if I cancel everything tomorrow", "cancel"]) {
  check(`not a bulk cancel: ${s}`, () => assert.equal(cancel(s), null, s));
}
check("'never mind' drops the day question", () => { const t = cancel("cancel everything")!; const n = step("never mind", t)!; assert.equal(n.pending, null); assert.equal(n.action, undefined); });

// ---------- bulk cancel: which visits ----------
const A = (id: string, name: string, start: string, status: string, date = "2026-10-29", provider = "Dr. Lee"): CancelableAppt => ({ id, patientId: `p-${id}`, patientName: name, provider, appointmentType: "Follow-up", date, startTime: start, status });
const appts = [
  A("1", "Zed Late", "16:00", "Scheduled"), A("2", "Amy Early", "09:00", "Scheduled"), A("3", "Cal Resched", "10:00", "Reschedule"),
  A("4", "Dee In", "11:00", "Check In"), A("5", "Eli Out", "12:00", "Check Out"), A("6", "Fay Gone", "13:00", "Canceled"), A("7", "Gil Ns", "14:00", "No Show"),
  A("8", "Hal Other Day", "09:00", "Scheduled", "2026-10-30"), A("9", "Ida Other Dr", "15:00", "Scheduled", "2026-10-29", "Dr. Kim"),
];
check("only Scheduled/Reschedule on that day, in time order", () => assert.deepEqual(selectBulkCancel(appts, { date: "2026-10-29" }).map((a) => a.id), ["2", "3", "9", "1"]));
check("window start inclusive, end exclusive", () => { assert.deepEqual(selectBulkCancel(appts, { date: "2026-10-29", startMin: 900, endMin: 1020 }).map((a) => a.id), ["9", "1"]); assert.deepEqual(selectBulkCancel(appts, { date: "2026-10-29", startMin: 900, endMin: 960 }).map((a) => a.id), ["9"], "a 4:00pm visit is not in 3–4pm"); assert.deepEqual(selectBulkCancel(appts, { date: "2026-10-29", startMin: 540, endMin: 600 }).map((a) => a.id), ["2"]); });
check("provider filter", () => assert.deepEqual(selectBulkCancel(appts, { date: "2026-10-29", provider: "Kim" }).map((a) => a.id), ["9"]));
check("nothing matching → empty list", () => assert.deepEqual(selectBulkCancel(appts, { date: "2026-11-02" }), []));

// ---------- wording ----------
check("labels", () => { assert.equal(dayLabel("2026-10-29", TODAY), "tomorrow"); assert.equal(dayLabel("2026-10-28", TODAY), "today"); assert.equal(dayLabel("2026-10-30", TODAY), "Fri 10/30"); });
check("suggested 'we canceled' text is plain and short", () => { const s = suggestedCancelText("2026-10-29", TODAY); assert.ok(s.length > 20 && s.length < 300); assert.match(s, /tomorrow/); });

// ---------- safety wiring (source-level, since the UI needs a login) ----------
const goat = readFileSync("src/components/global-goat.tsx", "utf8");
const cards = readFileSync("src/components/goat-text-cards.tsx", "utf8");
const handbook = readFileSync("src/lib/handbook-goat.ts", "utf8");
check("/text is admin-only and blocked in practice mode", () => { assert.match(goat, /sl\.cmd === "text" && !isGoatAdmin/); assert.match(goat, /const showTextCard[\s\S]{0,400}practiceOverride[\s\S]{0,400}!isGoatAdmin/); assert.match(goat, /const sendTextDraft[\s\S]{0,400}!isGoatAdmin \|\| practiceOverride/); });
check("bulk cancel needs a known role + schedule edit, and is blocked in practice mode", () => { assert.match(goat, /const showBulkCancel[\s\S]{0,300}practiceOverride[\s\S]{0,400}!roleKnown \|\| !canEditFeature\("appointments"\)/); assert.match(goat, /const confirmBulkCancel[\s\S]{0,400}practiceOverride \|\| !roleKnown \|\| !canEditFeature\("appointments"\)/); });
check("nothing queues or cancels except from the card buttons", () => { assert.equal((goat.match(/queueBroadcast\(/g) ?? []).length, 1); assert.equal((goat.match(/updateManyAppointments\(/g) ?? []).length, 2); assert.match(goat, /onSend=\{\(\) => void sendTextDraft\(m\)\}/); assert.match(goat, /onCancelVisits=\{\(\) => confirmBulkCancel\(m\)\}/); });
check("Send re-reads the list and never queues a changed one", () => assert.match(goat, /The list changed while you were looking/));
check("bulk cancel logs to the Activity Log and offers undo", () => { assert.match(goat, /appointment\.bulk_canceled/); assert.match(goat, /appointment\.bulk_cancel_undone/); assert.match(cards, />Undo</); });
check("the cards say nothing happens until the tap, with a red cancel button and Never mind", () => { assert.match(cards, /Nothing is sent until you tap Send/); assert.match(cards, /Nothing is canceled until you tap the red button/); assert.match(cards, /bg-red-600/); assert.match(cards, /Never mind/); });
check("the text card never receives phone numbers", () => assert.doesNotMatch(readFileSync("src/lib/goat-ai/global-chat.ts", "utf8").match(/textDraft\?: \{[\s\S]*?\n  \};/)![0].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), /\bphone(?:s|Number)?\??:/i));
check("'Also text these patients' texts exactly the canceled patients", () => { assert.match(goat, /kind: "patients", ids/); assert.match(cards, /Also text these patients/); });
check("queued line comes from queuedStatusText (iMac only if seen)", () => { assert.match(goat, /queuedStatusText\(r\.count, settings\.dryRun, mac\)/); assert.match(goat, /readMacSeen/); });
check("Handbook teaches both features", () => { assert.match(handbook, /Text patients from G\.O\.A\.T\. \(\/text\)/); assert.match(handbook, /Cancel a whole day of appointments/); assert.match(handbook, /Nothing is sent until you tap Send/); assert.match(handbook, /Undo/); });

console.log(`text-bulk-cancel: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
