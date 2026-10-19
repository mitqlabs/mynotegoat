/**
 * Eval: G.O.A.T. opened on a patient's page (Mock "Smith, John"): pronouns and
 * name-less requests resolve to that patient; a different named patient wins.
 * Mock data only. Run: npx tsx scripts/tests/goat-eval/page-context.test.ts
 */
import assert from "node:assert/strict";
import { pickTodoPatient, todoTitleForPagePatient, detectPlainTodo } from "../../../src/lib/goat-intents";
import { emptyDialog, goatTurn, type DialogCtx } from "../../../src/lib/goat-dialog";
import { getDefaultScheduleSettings } from "../../../src/lib/schedule-settings";
import type { PracticeData } from "../../../src/lib/goat-practice";

let pass = 0;
const t = (name: string, fn: () => void) => { fn(); pass++; console.log(`ok - ${name}`); };

const john = { id: "p-john", fullName: "Smith, John" };
const jane = { id: "p-jane", fullName: "Doe, Jane" };

const CASES: Array<[string, string]> = [
  ["remind me to call for appointment", "Call John Smith for appointment"],
  ["remind me to call him for appointment", "Call John Smith for appointment"],
  ["remind me to text her tomorrow", "Text John Smith tomorrow"],
  ["remind me to call this patient about the MRI", "Call John Smith about the MRI"],
  ["remind me to follow up with them", "Follow up with John Smith"],
  ["remind me to send his records", "Send John Smith's records"],
];
for (const [q, want] of CASES)
  t(q, () => {
    const body = detectPlainTodo(q)!.text;
    const pick = pickTodoPatient({ text: body, page: john, confident: null, candidates: [] });
    assert.equal(pick.patient?.id, "p-john");
    assert.equal(todoTitleForPagePatient(body, john.fullName).replace(/\s+tomorrow$/i, " tomorrow"), want);
  });

t("names a different patient → that patient (not the page)", () => {
  const pick = pickTodoPatient({ text: "call Jane Doe for appointment", page: john, confident: jane, candidates: [jane] });
  assert.equal(pick.patient?.id, "p-jane");
});
t("pronoun beats a fuzzy other match", () => {
  const pick = pickTodoPatient({ text: "call her back", page: john, confident: null, candidates: [jane] });
  assert.equal(pick.patient?.id, "p-john");
});
t("ambiguous other names, no pronoun → ask", () => {
  const pick = pickTodoPatient({ text: "call Doe", page: john, confident: null, candidates: [jane, { id: "p-x", fullName: "Doe, Max" }] });
  assert.equal(pick.via, "ask");
});
t("no page open → unchanged behavior", () => {
  assert.equal(pickTodoPatient({ text: "call him", page: null, confident: null, candidates: [] }).via, "none");
});

const data: PracticeData = {
  today: "2026-10-19",
  patients: [
    { id: "p-john", fullName: "John Smith", caseStatus: "Active", attorney: "Mock Law", listYear: 2026 },
    { id: "p-jane", fullName: "Jane Doe", caseStatus: "Active", attorney: "Sample Law", listYear: 2026 },
  ] as PracticeData["patients"],
  tasks: [],
  appointments: [],
  contacts: [],
};
const ctx: DialogCtx = { data, team: [{ firstName: "Hannah", label: "Hannah" }], openPatientId: "p-john", settings: getDefaultScheduleSettings() };

t("team message about 'him' on John's page → about John", () => {
  const r = goatTurn("tell Hannah to call him about his MRI", emptyDialog(), ctx).reply as { kind: string; patientId?: string | null };
  assert.equal(r.kind, "messageConfirm");
  assert.equal(r.patientId, "p-john");
});
t("book him friday at 3 on John's page → books John", () => {
  const r = goatTurn("book him friday at 3", emptyDialog(), ctx).reply as { kind: string; patientId?: string };
  assert.equal(r.kind, "booking");
  assert.equal(r.patientId, "p-john");
});
t("note + lookup on John's page → John", () => {
  const n = goatTurn("add a note that he called", emptyDialog(), ctx).reply as { kind: string; patientId?: string };
  assert.deepEqual([n.kind, n.patientId], ["noteConfirm", "p-john"]);
  const q = goatTurn("when is his next appt", emptyDialog(), ctx).reply as { kind: string; patientId?: string };
  assert.equal(q.patientId, "p-john");
});
t("a different named patient on John's page → that patient", () => {
  const r = goatTurn("book Jane Doe friday at 3", emptyDialog(), ctx).reply as { kind: string; patientId?: string };
  assert.equal(r.patientId, "p-jane");
});

console.log(`\n${pass} passed`);
