/**
 * G.O.A.T. — driver / passenger / pedestrian / seat belt answers (mock data only).
 *
 * Run:  npx tsx scripts/tests/goat-mva.test.ts
 */
import assert from "node:assert/strict";
import { askGoat, type GoatContext, type GoatEncounter } from "../../src/lib/goat";
import { asksMvaRole, mvaRoleAnswer } from "../../src/lib/goat-mva";

const ctx = (over: Partial<GoatContext> = {}): GoatContext => ({
  today: "2026-03-01",
  patientName: "Test, Pat",
  dob: "",
  phone: "",
  email: "",
  address: "",
  alerts: [],
  attorney: "",
  caseStatus: "",
  lien: "",
  review: "",
  isCashPatient: false,
  doi: "",
  initialExam: "",
  priorCare: "",
  xrayFindings: "",
  mriFindings: "",
  specialistRecommendations: "",
  imaging: [],
  specialists: [],
  notes: "",
  appointments: [],
  encounters: [],
  plans: [],
  diagnoses: [],
  details: null,
  billing: null,
  ...over,
});

const enc = (objective: string, extra: Partial<GoatEncounter> = {}): GoatEncounter => ({
  id: "e1",
  date: "01/05/2026",
  type: "Initial Exam",
  signed: true,
  soap: { subjective: "", objective, assessment: "", plan: "" },
  treatments: [],
  charges: [],
  ...extra,
});

let passed = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
};

test("detects the question", () => {
  for (const q of ["was the patient the driver or passenger", "driver?", "was she wearing a seatbelt", "front seat passenger?", "was pt a pedestrian", "did the airbags deploy"]) assert.ok(asksMvaRole(q), q);
  assert.ok(!asksMvaRole("when is the next visit"));
  assert.equal(mvaRoleAnswer(ctx(), "what are the diagnosis codes"), null);
});

test("driver from the MVC HX SOAP wording, quoted with its source", () => {
  const a = mvaRoleAnswer(
    ctx({ encounters: [enc("Pat Test is a 34 year old female who stated that they were the driver in a sedan, wearing their seatbelt involved in a motor vehicle collision with a SUV.")] }),
    "was the patient the driver or passenger",
  )!;
  assert.equal(a.title, "Driver or passenger: Driver");
  assert.match(a.lines[0], /^Driver:\n• “Pat Test is a 34 year old female who stated that they were the driver/);
  assert.match(a.lines[0], /SOAP 01\/05\/2026 · O · Initial Exam/);
  assert.ok(a.lines.some((l) => l.startsWith("Wearing a seat belt:")));
  assert.equal(a.section, "appointments");
});

test("front / rear passenger, and impact wording doesn't count", () => {
  const a = mvaRoleAnswer(ctx({ notes: "Patient was the front seat passenger. Impact to the driver's side door." }), "driver or passenger?")!;
  assert.equal(a.title, "Driver or passenger: Front seat passenger");
  const b = mvaRoleAnswer(ctx({ notes: "Pt was the rear left seat passenger, restrained." }), "where was the patient seated")!;
  assert.equal(b.title, "Driver or passenger: Rear left seat passenger");
  const c = mvaRoleAnswer(ctx({ notes: "Rear-ended. Damage to passenger side bumper." }), "passenger?")!;
  assert.equal(c.title, "Driver or passenger");
  assert.match(c.lines[0], /couldn't find driver \/ passenger wording/);
});

test("other people's roles don't count", () => {
  const a = mvaRoleAnswer(ctx({ notes: "Her husband was the driver and she was the front seat passenger. The other driver ran a red light." }), "driver or passenger")!;
  assert.equal(a.title, "Driver or passenger: Front seat passenger");
  assert.equal(a.flag, undefined);
});

test("intake form in Patient Files; macro answer; pedestrian", () => {
  const a = mvaRoleAnswer(
    ctx({
      files: [{ id: "f", name: "Intake Form.pdf", folder: "Intake", uploaded: "", status: "read", pages: ["Accident details\nPosition in vehicle: Driver\nSeat belt: Yes\nAirbags did not deploy."] }],
    }),
    "was she the driver",
  )!;
  assert.match(a.lines[0], /Intake Form\.pdf \(p\. 1\)/);
  assert.ok(a.lines.some((l) => l.startsWith("Wearing a seat belt:")));
  assert.ok(a.lines.some((l) => l.startsWith("Airbags did not deploy:")));
  const m = mvaRoleAnswer(ctx({ encounters: [enc("", { treatments: [{ name: "MVC HX", answers: ["front seat passenger", "sedan"] }] })] }), "passenger?")!;
  assert.equal(m.title, "Driver or passenger: Front seat passenger");
  assert.match(m.lines[0], /MVC HX answer · SOAP 01\/05\/2026/);
  const p = mvaRoleAnswer(ctx({ notes: "Patient was a pedestrian struck by a car while crossing." }), "was the patient a pedestrian")!;
  assert.equal(p.title, "Driver or passenger: Pedestrian");
});

test("seat belt: not wearing wins for its own sentence; conflicting roles flagged", () => {
  const a = mvaRoleAnswer(ctx({ notes: "She was not wearing a seatbelt." }), "was she wearing a seat belt")!;
  assert.ok(a.lines.some((l) => l.startsWith("Not wearing a seat belt:")));
  assert.ok(!a.lines.some((l) => l.startsWith("Wearing a seat belt:")));
  const b = mvaRoleAnswer(ctx({ notes: "Pt was the driver.", encounters: [enc("Patient stated that they were the front seat passenger in a truck.")] }), "driver or passenger")!;
  assert.match(b.flag ?? "", /disagree/);
});

test("hidden sections are not read and are named", () => {
  const a = mvaRoleAnswer(ctx({ notes: null, encounters: null, files: null }), "driver or passenger")!;
  assert.ok(a.lines.some((l) => /hidden for your account\): case notes, SOAP notes, Patient Files/.test(l)));
});

test("askGoat returns the card", () => {
  const r = askGoat(ctx({ notes: "Pt states she was driving when she was rear-ended." }), "was the patient the driver or passenger?");
  assert.equal(r.answers[0]?.title, "Driver or passenger: Driver");
  const n = askGoat(ctx({ notes: "Pain with driving long distances." }), "driver or passenger?");
  assert.equal(n.answers[0]?.title, "Driver or passenger");
});

console.log(`goat-mva: ${passed} tests passed`);
