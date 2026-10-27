/**
 * Patient questionnaire Forms: built from Objective macros, answers map 1:1.
 * Fictional data only.  Run:  npx tsx scripts/tests/patient-forms.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MacroTemplate } from "../../src/lib/macro-templates";
import { renderMacroTemplate } from "../../src/lib/macro-templates";
import {
  answersToMacroFills,
  answerSummary,
  displayStatus,
  findSectionMacro,
  blankForm,
  customAnswersHtml,
  customSection,
  duplicateForm,
  friendlyOptionLabel,
  isStaffOnlyOption,
  looksLikeDecompressionCase,
  macroNameKey,
  normalizeFormTemplate,
  normalizePatientForms,
  resolveForm,
  sendableForms,
  sanitizeAnswers,
  validateSnapshot,
  type FormTemplate,
} from "../../src/lib/patient-forms";
import { unionMerge } from "../../src/lib/kv-merge";
import { hashFormToken, isTokenShape, memoryRateOk, newFormToken } from "../../src/lib/patient-forms-server";
import { morningRundown } from "../../src/lib/goat-briefs";
import { applySql, dryRunSql, FORM_ID, OWNER_QUESTIONNAIRE } from "../seed/patient-forms-seed.mjs";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

// Fictional Objective macros shaped like a practice's own library.
const m = (id: string, buttonName: string, body: string, questions: MacroTemplate["questions"]): MacroTemplate => ({ id, section: "objective", buttonName, body, questions, active: true });
const MACROS: MacroTemplate[] = [
  m("mx-mvc", "MVC HX", "Seated as [[where_seated]]. Airbags [[airbag_deployed]]. Impact: [[impact_area]]. Vehicle: [[vehicle_type_driven]]. Ambulance: [[taken_ambulance]].", [
    { id: "where_seated", label: "Where were you seated?", options: ["driver", "front seat passenger"], multiSelect: false },
    { id: "airbag_deployed", label: "Did your airbags deploy?", options: ["did not deploy", "deployed"], multiSelect: false },
    { id: "impact_area", label: "Where was the area of impact?", options: ["rear end", "front end"], multiSelect: true },
    { id: "vehicle_type_driven", label: "What was the vehicle you were in?", options: [], multiSelect: false },
    { id: "taken_ambulance", label: "Were you taken by ambulance?", options: ["DELETE", "were taken by the ambulance from the scene."], multiSelect: false },
  ]),
  m("mx-sd", "MVC HX SD", "Seated as [[where_seated]]. Treatments: [[treatments]].", [
    { id: "where_seated", label: "Where were you seated?", options: ["front seat passenger", "driver"], multiSelect: false },
    { id: "treatments", label: "What treatments have you undergone after the accident?", options: ["chiropractic care", "physical therapy"], multiSelect: true },
  ]),
  m("mx-vitals", "Vitals", "Height [[height]], weight [[weight]], BP [[blood_pressure]].", [
    { id: "height", label: "Height", options: [] },
    { id: "weight", label: "Weight", options: [] },
    { id: "blood_pressure", label: "Blood Pressure", options: [] },
  ]),
  m("mx-med", "Medical & Family HX", "Allergies: [[allergies]] Habits: [[social_habits]]", [
    { id: "allergies", label: "Do you have any allergies?", options: ["Patient denies any allergies."] },
    { id: "social_habits", label: "Social Habits", options: ["denies smoking and drinking.", "states they smoke ___ pack a ___"], multiSelect: true },
  ]),
  m("mx-func", "Functional Limitation", "Limited with [[limits]].", [{ id: "limits", label: "Do you experience any of these limitations?", options: ["bending", "lifting objects over ten pounds"], multiSelect: true }]),
  m("mx-cc", "Chief Complaints", "Complaints: [[cc]].", [{ id: "cc", label: "What are your chief complaints?", options: ["neck", "low back", "left knee"], multiSelect: true }]),
];
// The owner's questionnaire is NOT shipped: it's a saved cloud form seeded per workspace.
const form = normalizeFormTemplate(OWNER_QUESTIONNAIRE)!;

test("nothing ships: a new practice starts with zero forms", () => {
  assert.deepEqual(normalizePatientForms([]), []);
  assert.deepEqual(normalizePatientForms(undefined), []);
  const lib = readFileSync("src/lib/patient-forms.ts", "utf8");
  assert.doesNotMatch(lib, /getDefaultPatientForms|New Patient Questionnaire|MVC HX SD/, "no owner form in app code");
  const panel = readFileSync("src/components/patient-forms-settings-panel.tsx", "utf8");
  assert.match(panel, /No forms yet/);
  assert.doesNotMatch(panel, /Restore default/);
});

test("owner seed form = the six named Objective macros, in order", () => {
  assert.equal(form.id, FORM_ID);
  assert.deepEqual(form.sections.map((s) => s.macroName), ["MVC HX", "MVC HX SD", "Vitals", "Medical & Family HX", "Functional Limitation", "Chief Complaints"]);
  assert.equal(form.sections[1].includeWhen, "decompression");
  for (const s of form.sections) assert.ok(findSectionMacro(s, MACROS), `macro found for ${s.macroName}`);
});

test("macro names match loosely (case, & / and, plural, history = hx)", () => {
  assert.equal(macroNameKey("Functional Limitations"), macroNameKey("Functional Limitation"));
  assert.equal(macroNameKey("Medical and Family History"), macroNameKey("Medical & Family HX"));
  assert.notEqual(macroNameKey("MVC HX SD"), macroNameKey("MVC HX"));
});

test("not a decompression case: MVC HX SD left out; Vitals only height + weight", () => {
  const { snapshot, missing } = resolveForm(form, MACROS, { decompression: false });
  assert.deepEqual(missing, []);
  assert.deepEqual(snapshot.sections.map((s) => s.macroName), ["MVC HX", "Vitals", "Medical & Family HX", "Functional Limitation", "Chief Complaints"]);
  assert.deepEqual(snapshot.sections[1].questions.map((q) => q.macroQuestionId), ["height", "weight"]);
});

test("decompression case: SD included, shared question asked once and fills both", () => {
  const { snapshot } = resolveForm(form, MACROS, { decompression: true });
  const sd = snapshot.sections.find((s) => s.macroName === "MVC HX SD")!;
  assert.deepEqual(sd.questions.map((q) => q.macroQuestionId), ["treatments"]);
  const seat = snapshot.sections[0].questions.find((q) => q.macroQuestionId === "where_seated")!;
  assert.deepEqual(seat.alsoFills, [{ sectionId: "mvc-hx-sd", macroQuestionId: "where_seated" }]);
});

test("options are the exact macro options; staff-only ones hidden", () => {
  const { snapshot } = resolveForm(form, MACROS, { decompression: false });
  const amb = snapshot.sections[0].questions.find((q) => q.macroQuestionId === "taken_ambulance")!;
  assert.deepEqual(amb.options.map((o) => o.value), ["were taken by the ambulance from the scene."]);
  const habits = snapshot.sections[2].questions.find((q) => q.macroQuestionId === "social_habits")!;
  assert.deepEqual(habits.options.map((o) => o.value), ["denies smoking and drinking."]);
  assert.ok(isStaffOnlyOption("DELETE") && isStaffOnlyOption("every ___.") && !isStaffOnlyOption("driver"));
  const vehicle = snapshot.sections[0].questions.find((q) => q.macroQuestionId === "vehicle_type_driven")!;
  assert.equal(vehicle.kind, "text");
});

test("patient wording is friendlier, value unchanged", () => {
  assert.equal(friendlyOptionLabel("Patient denies any allergies.", { onlyOption: true }), "No");
  assert.equal(friendlyOptionLabel("Patient denies any family history of illness."), "No family history of illness");
  assert.equal(friendlyOptionLabel("Patient states they are employed and still working."), "I am employed and still working");
  assert.equal(friendlyOptionLabel("struck their head on the headrest"), "Struck my head on the headrest");
  assert.equal(friendlyOptionLabel("driver"), "Driver");
});

test("owner overrides wording and hides a question", () => {
  const f: FormTemplate = structuredClone(form);
  f.sections[0].questions = { where_seated: { label: "Where were you sitting?", labelEs: "¿Dónde estaba sentado?", optionLabels: { driver: "I was driving" } }, impact_area: { hidden: true } };
  const { snapshot } = resolveForm(f, MACROS, { decompression: false });
  const q = snapshot.sections[0].questions[0];
  assert.equal(q.label, "Where were you sitting?");
  assert.equal(q.labelEs, "¿Dónde estaba sentado?");
  assert.equal(q.options.find((o) => o.value === "driver")!.label, "I was driving");
  assert.ok(!snapshot.sections[0].questions.some((x) => x.macroQuestionId === "impact_area"));
});

test("answers → macro fills 1:1, and the note text equals a click", () => {
  const { snapshot } = resolveForm(form, MACROS, { decompression: true });
  const answers = {
    "mvc-hx.where_seated": { picks: ["driver"] },
    "mvc-hx.impact_area": { picks: ["rear end", "front end"] },
    "mvc-hx.vehicle_type_driven": { other: "sedan" },
    "mvc-hx-sd.treatments": { picks: ["physical therapy"], other: "massage" },
    "vitals.height": { other: "5'8\"" },
    "medical-family-hx.allergies": { other: "penicillin" },
    "chief-complaints.cc": { picks: ["neck", "low back"] },
  };
  const fills = answersToMacroFills(snapshot, answers);
  const mvc = fills.find((f) => f.macroId === "mx-mvc")!;
  assert.deepEqual(mvc.answers, { where_seated: "driver", impact_area: ["rear end", "front end"], vehicle_type_driven: "sedan" });
  const sd = fills.find((f) => f.macroId === "mx-sd")!;
  assert.deepEqual(sd.answers, { where_seated: "driver", treatments: ["physical therapy", "massage"] });
  assert.deepEqual(fills.find((f) => f.macroId === "mx-med")!.answers, { allergies: "penicillin" });
  // Same answer map a staff click would produce → same text.
  const click = { where_seated: "driver", impact_area: ["rear end", "front end"], vehicle_type_driven: "sedan" };
  assert.equal(renderMacroTemplate(MACROS[0].body, mvc.answers, {}), renderMacroTemplate(MACROS[0].body, click, {}));
  assert.match(renderMacroTemplate(MACROS[5].body, fills.find((f) => f.macroId === "mx-cc")!.answers, {}), /neck and low back/);
  assert.ok(!fills.some((f) => f.macroId === "mx-func"), "unanswered section isn't inserted");
  const summary = answerSummary(snapshot, answers);
  assert.equal(summary[0].rows[0].answer, "Driver");
});

test("server keeps only answers to this form's questions and options", () => {
  const { snapshot } = resolveForm(form, MACROS, { decompression: false });
  const clean = sanitizeAnswers(snapshot, {
    "mvc-hx.where_seated": { picks: ["driver", "front seat passenger", "hacker"] },
    "mvc-hx.impact_area": { picks: ["rear end", "made up"], other: "x".repeat(5000) },
    "mvc-hx.vehicle_type_driven": { picks: ["driver"], other: "truck" },
    "not.a.question": { other: "nope" },
    "chief-complaints.cc": "neck",
  });
  assert.deepEqual(clean["mvc-hx.where_seated"], { picks: ["driver"] });
  assert.deepEqual(clean["mvc-hx.impact_area"].picks, ["rear end"]);
  assert.equal(clean["mvc-hx.impact_area"].other!.length, 1000);
  assert.deepEqual(clean["mvc-hx.vehicle_type_driven"], { other: "truck" });
  assert.ok(!("not.a.question" in clean) && !("chief-complaints.cc" in clean));
});

test("snapshot validation rejects junk and oversize", () => {
  const { snapshot } = resolveForm(form, MACROS, { decompression: false });
  assert.ok(validateSnapshot(JSON.parse(JSON.stringify(snapshot))));
  assert.equal(validateSnapshot({ version: 2, sections: [] }), null);
  assert.equal(validateSnapshot({ version: 1, sections: [{ id: "a", questions: [{ key: "a.b", kind: "evil", options: [] }] }] }), null);
  const huge = structuredClone(snapshot);
  huge.intro = "x".repeat(300_000);
  assert.equal(validateSnapshot(huge), null);
});

test("templates: nothing added, tombstones kept, two edits merge by id", () => {
  assert.equal(normalizePatientForms([]).length, 0);
  const deleted = normalizePatientForms([{ ...form, deleted: true }]);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].deleted, true);
  const a = [{ ...form, name: "Edited here", updatedAt: "2026-10-19T10:00:00Z" }];
  const b = [{ ...form, updatedAt: "2026-10-19T09:00:00Z" }, { ...form, id: "form-2", name: "Other computer", updatedAt: "2026-10-19T09:30:00Z" }];
  const merged = normalizePatientForms(unionMerge(a, b));
  assert.deepEqual(merged.map((f) => f.name).sort(), ["Edited here", "Other computer"]);
});

const CUSTOM: FormTemplate = {
  ...blankForm("form-mock-custom", "2026-10-19T00:00:00Z"),
  name: "Mock intake",
  sections: [
    {
      ...customSection("own"),
      title: "A few more questions",
      customQuestions: [
        { id: "q1", label: "Preferred name", type: "short", enabled: true },
        { id: "q2", label: "Anything else we should know?", type: "long", enabled: true },
        { id: "q3", label: "Have you had chiropractic care before?", type: "yesno", enabled: true },
        { id: "q4", label: "How did you hear about us?", type: "single", options: ["Friend", "", "Online", "Friend"], enabled: true },
        { id: "q5", label: "Best times to call", type: "multi", options: ["Morning", "Evening"], enabled: true },
        { id: "q6", label: "Pain today (0-10)", type: "number", enabled: true },
        { id: "q7", label: "Turned off question", type: "short", enabled: false },
        { id: "q8", label: "   ", type: "short", enabled: true },
        { id: "q9", label: "Choice with no choices", type: "single", options: [""], enabled: true },
      ],
    },
    { id: "mvc", kind: "macro", macroName: "MVC HX", title: "About the accident", enabled: true, includeWhen: "always", onlyQuestions: ["where_seated"] },
  ],
};

test("builder: custom questions of every type resolve; off / blank / no-choice ones skipped", () => {
  const { snapshot, missing } = resolveForm(CUSTOM, MACROS, { decompression: false });
  assert.deepEqual(missing, []);
  const own = snapshot.sections[0];
  assert.equal(own.custom, true);
  assert.equal(own.macroId, "");
  assert.deepEqual(own.questions.map((q) => q.macroQuestionId), ["q1", "q2", "q3", "q4", "q5", "q6"]);
  const [short, long, yn, one, many, num] = own.questions;
  assert.equal(short.kind, "text");
  assert.equal(short.input, undefined);
  assert.equal(long.input, "long");
  assert.equal(num.input, "number");
  assert.deepEqual(yn.options.map((o) => o.value), ["Yes", "No"]);
  assert.equal(yn.allowOther, false);
  assert.deepEqual(one.options.map((o) => o.value), ["Friend", "Online"], "blank + duplicate choices dropped");
  assert.equal(many.kind, "multi");
  assert.ok(validateSnapshot(JSON.parse(JSON.stringify(snapshot)))?.sections[0].custom, "custom flag survives the server check");
  assert.equal(validateSnapshot(JSON.parse(JSON.stringify(snapshot)))?.sections[0].questions[1].input, "long");
});

test("builder: custom answers go in as plain lines, never through a macro, HTML-escaped", () => {
  const { snapshot } = resolveForm(CUSTOM, MACROS, { decompression: false });
  const raw = {
    "own.q1": { other: "Sam <b>" },
    "own.q3": { picks: ["Yes"] },
    "own.q4": { picks: ["Online", "Friend"] },
    "own.q5": { picks: ["Morning", "Evening", "Never"] },
    "own.q6": { other: "7" },
    "mvc.where_seated": { picks: ["driver"] },
  };
  const answers = sanitizeAnswers(snapshot, raw);
  assert.deepEqual(answers["own.q4"], { picks: ["Online"] }, "pick one keeps one");
  assert.deepEqual(answers["own.q5"], { picks: ["Morning", "Evening"] });
  assert.deepEqual(sanitizeAnswers(snapshot, { "own.q6": { other: "seven" } }), {}, "number box only keeps numbers");
  const fills = answersToMacroFills(snapshot, answers);
  assert.deepEqual(fills.map((f) => f.macroId), ["mx-mvc"], "custom section is not a macro fill");
  const html = customAnswersHtml(snapshot, answers);
  assert.match(html, /<strong>A few more questions<\/strong>/);
  assert.match(html, /Preferred name: Sam &lt;b&gt;/);
  assert.match(html, /Have you had chiropractic care before\?: Yes/);
  assert.match(html, /Best times to call: Morning, Evening/);
  assert.doesNotMatch(html, /Anything else/, "blank answers left out");
  assert.equal(customAnswersHtml(snapshot, {}), "");
});

test("builder: saved shape round-trips; duplicate gets fresh ids; turned-off forms aren't sendable", () => {
  const back = normalizeFormTemplate(JSON.parse(JSON.stringify({ ...CUSTOM, disabled: true })))!;
  assert.equal(back.disabled, true);
  assert.equal(back.sections[0].kind, "custom");
  assert.equal(back.sections[0].customQuestions?.length, 9);
  assert.equal(back.sections[1].kind, "macro");
  // Old saved sections (no kind) are macro sections.
  assert.equal(normalizeFormTemplate({ id: "x", name: "Old", sections: [{ id: "s", macroName: "Vitals" }] })!.sections[0].kind, "macro");
  let n = 0;
  const copy = duplicateForm(CUSTOM, { form: "form-copy", next: () => `id-${n++}` }, "2026-10-19T01:00:00Z");
  assert.equal(copy.name, "Mock intake (copy)");
  assert.ok(copy.sections.every((s) => !CUSTOM.sections.some((o) => o.id === s.id)));
  assert.ok(copy.sections[0].customQuestions!.every((q) => !q.id.startsWith("q")));
  assert.equal(CUSTOM.sections[0].id, "own", "original untouched");
  assert.deepEqual(sendableForms([CUSTOM, back, { ...CUSTOM, id: "gone", deleted: true }]).map((f) => f.id), ["form-mock-custom"]);
});

test("owner seed: missing-only, merge-safe SQL; dry run is read-only", () => {
  const ws = ["00000000-0000-4000-8000-000000000001:main-office"];
  const apply = applySql(ws);
  assert.match(apply, /on conflict \(workspace_id, key\) do nothing/);
  assert.match(apply, /not exists \(select 1 from jsonb_array_elements\(value\) e where e->>'id' = 'form-new-patient-questionnaire'\)/);
  assert.match(apply, /value \|\| jsonb_build_array/, "appends, never replaces");
  assert.match(apply, /'seed-insert'/);
  assert.doesNotMatch(apply, /\bdelete\b|\btruncate\b|set value = jsonb_build_array/i);
  const dry = dryRunSql(ws);
  assert.doesNotMatch(dry, /^\s*(insert|update|delete|with ins)\b/im);
  assert.match(dry, /^-- DRY RUN/);
});

test("links: long random token, only its hash stored, shape-checked", () => {
  const t1 = newFormToken();
  const t2 = newFormToken();
  assert.ok(isTokenShape(t1) && t1 !== t2 && t1.length === 43);
  assert.notEqual(hashFormToken(t1), t1);
  assert.equal(hashFormToken(t1).length, 64);
  assert.ok(!isTokenShape("abc") && !isTokenShape(`${t1}/../x`));
});

test("rate limiter + status words", () => {
  for (let i = 0; i < 3; i++) assert.ok(memoryRateOk("t-bucket", 3, 60_000, 1000));
  assert.ok(!memoryRateOk("t-bucket", 3, 60_000, 1000));
  assert.ok(memoryRateOk("t-bucket", 3, 60_000, 70_000));
  const future = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(displayStatus({ status: "sent", expires_at: future }), "sent");
  assert.equal(displayStatus({ status: "started", expires_at: "2020-01-01T00:00:00Z" }), "expired");
  assert.equal(displayStatus({ status: "sent", expires_at: future, revoked_at: future }), "revoked");
  assert.ok(looksLikeDecompressionCase(["PI Office Visit", "Spinal Decompression L/S"]));
  assert.ok(!looksLikeDecompressionCase(["PI Office Visit", "Consider decompression"]));
});

test("Morning Rundown lists received questionnaires", () => {
  const a = morningRundown({ today: "2026-10-19", patients: [], appointments: [], tasks: [], locations: [], questionnaires: [{ patientId: "p1", patientName: "Jane Example", formName: "New Patient Questionnaire" }] });
  assert.match(a.textAfter ?? "", /1 questionnaire received: Jane Example/);
  assert.ok(a.links?.some((l) => l.href === "/patients/p1"));
  const none = morningRundown({ today: "2026-10-19", patients: [], appointments: [], tasks: [], locations: [] });
  assert.doesNotMatch(none.textAfter ?? "", /questionnaire/);
});

test("wiring: cloud-backed + merge-safe, token-scoped writes, insert reuses the macro path", () => {
  assert.match(readFileSync("src/lib/cloud-key-registry.ts", "utf8"), /"casemate\.patient-forms\.v1": "workspace"/);
  assert.match(readFileSync("src/lib/cloud-state.ts", "utf8"), /UNION_MERGE_KEYS[\s\S]*"casemate\.patient-forms\.v1"/);
  const pub = readFileSync("src/app/api/forms/public/[token]/route.ts", "utf8");
  assert.match(pub, /\.eq\("token_hash", hashFormToken\(token\)\)/);
  assert.match(pub, /\.in\("status", \["sent", "started"\]\)/);
  assert.doesNotMatch(pub, /patient_id|patientName/);
  const page = readFileSync("src/components/patient-form-page.tsx", "utf8");
  assert.doesNotMatch(page, /localStorage|sessionStorage|indexedDB/);
  const enc = readFileSync("src/components/encounter-workspace.tsx", "utf8");
  const fn = enc.slice(enc.indexOf("const applyQuestionnaire"), enc.indexOf("const buildPlanSnippets"));
  assert.match(fn, /renderMacroTemplateWithPromptSpans\(macro\.body/);
  assert.match(fn, /appendSoapSection\(selectedEncounter\.id, "objective"/);
  assert.match(fn, /addMacroRun\(/);
  assert.match(fn, /(appConfirm|window\.confirm)\(/);
  assert.doesNotMatch(fn, /setSoapSection\(/, "never replaces Objective");
  assert.match(fn, /customAnswersHtml\(snapshot, answers\)/);
  const sql = readFileSync("supabase/patient_form_requests.sql", "utf8");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.patient_form_requests from anon/);
  assert.doesNotMatch(sql, /grant select \([^)]*token_hash/);
});

console.log(`\n${passed} passed`);
