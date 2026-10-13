/**
 * G.O.A.T. pop-up: which patient a question is about (fuzzy names, chips) and
 * answering only what was asked ("last visit" → the last visit, not a findings dump),
 * plus + mode routing (rules win; visit questions read appointments; summary only on "summarize").
 * Made-up patients only. No network, no database, no model.
 *
 * Run:  npx tsx scripts/tests/goat-patient-routing.test.ts
 */
import assert from "node:assert/strict";
import { askGoat, type GoatAppointment, type GoatContext } from "../../src/lib/goat";
import type { GoatFile } from "../../src/lib/goat-docs";
import { MAX_PATIENT_CHOICES, editDistance, findPatientsInQuestion, nameWords, stripPatientName, type ChatPatient } from "../../src/lib/goat-ai/global-chat";
import { buildAiSources, detectIntents } from "../../src/lib/goat-ai/sources";
import { buildSystemPrompt } from "../../src/lib/goat-ai/prompt";

let pass = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log("PASS", name);
  } catch (e) {
    console.log("FAIL", name);
    throw e;
  }
}

const P = (id: string, fullName: string): ChatPatient => ({ id, fullName, dob: "1980-01-01", dateOfLoss: "2026-06-01" });
const PATIENTS: ChatPatient[] = [
  P("p1", "Demoyan, Serik"),
  P("p2", "Sample, Maria"),
  P("p3", "Sample, Mario"),
  P("p4", "Lopez, Daniel"),
  P("p5", "Lopez, Danielle"),
  P("p6", "Testoyan, Anna"),
  P("p7", "Testoian, Ani"),
  P("p8", "Fakeyan, Narek"),
  P("p9", "Johnson, Jane"),
  P("p10", "Johnston, Janet"),
  P("p11", "Jonson, Jan"),
  P("p12", "Jansen, Jana"),
  P("p13", "Janssen, Janae"),
];
const ids = (r: ReturnType<typeof findPatientsInQuestion>) => r.candidates.map((c) => c.patient.id);

test("first name alone, one patient: answered right away", () => {
  const r = findPatientsInQuestion("when was serik last visit", PATIENTS);
  assert.equal(r.confident?.patient.id, "p1");
  assert.deepEqual(r.candidates, []);
});

test("last name, full name, possessive, capitalized or not", () => {
  assert.equal(findPatientsInQuestion("demoyan last visit", PATIENTS).confident?.patient.id, "p1");
  assert.equal(findPatientsInQuestion("When was Serik Demoyan's last visit?", PATIENTS).confident?.patient.id, "p1");
  assert.equal(findPatientsInQuestion("what did dr armen recommend for narek", PATIENTS).confident?.patient.id, "p8");
});

test("typos: full name with a typo is still sure; a lone typo asks", () => {
  assert.equal(findPatientsInQuestion("last visit for serik demoyna", PATIENTS).confident?.patient.id, "p1");
  const lone = findPatientsInQuestion("when was serek last visit", PATIENTS);
  assert.equal(lone.confident, null);
  assert.deepEqual(ids(lone), ["p1"]);
});

test("partial name asks with chips", () => {
  const r = findPatientsInQuestion("last visit for demo", PATIENTS);
  assert.equal(r.confident, null);
  assert.deepEqual(ids(r), ["p1"]);
});

test("several close names: up to 5 chips, best first", () => {
  const maria = findPatientsInQuestion("maria sample recs", PATIENTS);
  assert.equal(maria.confident?.patient.id, "p2", "exact full name beats the one-letter-off name");
  const daniel = findPatientsInQuestion("when was lopez last visit", PATIENTS);
  assert.equal(daniel.confident, null, "two Lopez");
  assert.deepEqual(ids(daniel).sort(), ["p4", "p5"]);
  const anna = findPatientsInQuestion("testoyan visits", PATIENTS);
  assert.equal(anna.confident, null, "Testoyan exact, Testoian one letter off: ask");
  assert.deepEqual(ids(anna), ["p6", "p7"]);
  const many = findPatientsInQuestion("jan last visit", PATIENTS);
  assert.ok(many.candidates.length <= MAX_PATIENT_CHOICES);
  assert.ok(many.candidates.length >= 2);
});

test("questions with no patient name don't match anyone", () => {
  for (const q of ["when was the last visit", "what did dr armen recommend", "lumbar mri findings", "summarize this case", "how many decompression visits", "pm recs", "driver or passenger"]) {
    const r = findPatientsInQuestion(q, PATIENTS);
    assert.equal(r.confident, null, q);
    assert.deepEqual(r.candidates, [], q);
  }
  assert.deepEqual(nameWords("what did Dr. Armen recommend for Serik"), ["Serik"]);
});

test("unknown name after 'for' is reported", () => {
  assert.equal(findPatientsInQuestion("last visit for Zzyzx", PATIENTS).named, "Zzyzx");
});

test("the name (as typed) is taken out before searching that patient's file", () => {
  assert.equal(stripPatientName("when was serik last visit", "Demoyan, Serik"), "when was last visit");
  assert.equal(stripPatientName("When was Serik Demoyna's last visit?", "Demoyan, Serik"), "When was last visit?");
  assert.equal(stripPatientName("pm recs for serek", "Demoyan, Serik"), "pm recs");
  assert.equal(editDistance("demoyan", "demoyna"), 1);
});

// --- Answer only what was asked ----------------------------------------------

const appt = (date: string, type: string, status: string): GoatAppointment => ({ date, startTime: "10:00", type, status, note: "" });
const REPORT = "Plan/Orders:\n1. Planned intervention:\n-For the patients lumbar radiculopathy: Recommend L5/S1 lumbar interlaminar epidural steroid injection.\nImaging\nMRI L-SPINE IMPRESSION: L4-L5 disc herniation.\nFollow up\n2-4 weeks";
const file: GoatFile = { id: "f1", name: "Specialist Report - Sample.pdf", folder: "Specialist", uploaded: "2026-09-30T18:00:00Z", status: "read", method: "text", pages: [`Serik Demoyan\n${REPORT}`] };
const ctx: GoatContext = {
  today: "2026-10-11", patientName: "Demoyan, Serik", dob: "", phone: "", email: "", address: "", alerts: [], attorney: "", caseStatus: "", lien: "", review: "", isCashPatient: false, doi: "2026-06-01", initialExam: "", priorCare: "", xrayFindings: "", mriFindings: "L4-L5 disc herniation.", specialistRecommendations: "", imaging: [], specialists: [], notes: "", encounters: [], plans: [], diagnoses: [], details: null, billing: null, termGroups: [], people: [],
  appointments: [appt("2026-09-28", "Spinal Decompression - L/S", "Check Out"), appt("2026-10-06", "Follow-Up Visit", "Check Out"), appt("2026-10-08", "Follow-Up Visit", "Canceled"), appt("2026-10-15", "PI Re-Exam", "Scheduled")],
  files: [file],
};

test('"last visit" → the last visit date and type, nothing else', () => {
  const q = stripPatientName("when was serik last visit", ctx.patientName);
  const r = askGoat(ctx, q);
  assert.equal(r.answers.length, 1, r.answers.map((a) => a.title).join(", "));
  const a = r.answers[0];
  assert.equal(a.title, "Last visit");
  assert.match(a.lines[0], /^Last visit: .*10\/06\/2026.* — Follow-Up Visit\.$/);
  assert.ok(a.lines.length <= 2, a.lines.join(" | "));
  assert.doesNotMatch(a.lines.join("\n"), /herniation|injection|appointments on file/i);
  assert.equal(r.files?.matches.length ?? 0, 0, "no report lines for a visit question");
});

test("first / next visit are just as short", () => {
  assert.deepEqual(askGoat(ctx, "first visit").answers[0].lines.length, 1);
  assert.match(askGoat(ctx, "next visit").answers[0].lines[0], /^Next visit: .*10\/15\/2026.*PI Re-Exam/);
});

test("+ mode routing: intents", () => {
  assert.deepEqual(detectIntents("when was the last visit"), ["visit"]);
  assert.deepEqual(detectIntents("when is the follow up visit"), ["visit"]);
  assert.ok(detectIntents("what did dr armen recommend").includes("recommend"));
  assert.ok(detectIntents("summarize this case").includes("summary"));
  assert.ok(!detectIntents("lumbar mri findings").includes("summary"));
});

test("+ mode routing: a visit question reads the appointments only, never report text", () => {
  const r = buildAiSources(ctx, "when was the last visit");
  assert.ok(r.sources.length > 0);
  assert.ok(r.sources.every((s) => s.section === "appointments"), r.sources.map((s) => s.title).join(" | "));
  assert.ok(!r.sources.some((s) => s.kind === "file"));
  const asked = buildSystemPrompt({ showCosts: true, regionOrder: [] }, r.intents);
  assert.match(asked, /Answer ONLY the question asked/);
  assert.match(asked, /Visits \/ appointments: answer from the Appointments source only/);
  assert.doesNotMatch(asked, /This is a request to summarize/);
});

test("+ mode routing: only 'summarize' gets the whole picture", () => {
  const r = buildAiSources(ctx, "summarize this case");
  assert.ok(r.intents.includes("summary"));
  assert.match(buildSystemPrompt({ showCosts: true, regionOrder: [] }, r.intents), /This is a request to summarize/);
  const recs = buildAiSources(ctx, "what are the recommendations");
  assert.ok(recs.sources.some((s) => s.kind === "file"), "a recommendations question still reads the report");
});

console.log(`goat-patient-routing: ${pass} passed`);
