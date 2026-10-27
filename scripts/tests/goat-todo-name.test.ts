/**
 * "/todo call tyler smith": keep the whole task text, and file it under the patient the text names
 * (never a patient a verb happens to resemble). Mock data only.
 * Run:  npx tsx scripts/tests/goat-todo-name.test.ts
 */
import assert from "node:assert/strict";
import { splitNameAndText, startFlow } from "../../src/lib/goat-slash-flow";
import { tidyTodoTitle } from "../../src/lib/goat-intents";
import { resolveSlashTodo } from "../../src/lib/goat-todo-resolve";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };
const TODAY = "2026-10-27";
const base = [
  { id: "p1", fullName: "Hall, Brianna", dob: "", dateOfLoss: "", caseStatus: "Active" },
  { id: "p2", fullName: "Jones, Tyler", dob: "", dateOfLoss: "", caseStatus: "Active" },
  { id: "p3", fullName: "Smith, Jane", dob: "", dateOfLoss: "", caseStatus: "Active" },
  { id: "p4", fullName: "Sample, Maria", dob: "", dateOfLoss: "", caseStatus: "Active" },
];
const withTylerSmith = [...base, { id: "p5", fullName: "Smith, Tyler", dob: "", dateOfLoss: "", caseStatus: "Active" }];
const twoTylers = [...withTylerSmith, { id: "p6", fullName: "Smith, Tyler", dob: "1990-01-01", dateOfLoss: "2026-01-01", caseStatus: "Active" }];
const flowCtx = (patients: typeof base) => ({ today: TODAY, patients, contacts: [], openPatientId: "p1" });

test("a task verb is never read as a misspelled name (call ≠ Hall)", () => {
  assert.deepEqual(splitNameAndText("call tyler smith", base).matches, []);
  assert.equal(splitNameAndText("call tyler smith", base).text, "call tyler smith");
  assert.equal(startFlow("todo", "call tyler smith", flowCtx(base)), null);
  // …but a name that really leads still works, close spellings included.
  assert.deepEqual(splitNameAndText("brianna hall call atty", base).matches.map((p) => p.id), ["p1"]);
  assert.deepEqual(splitNameAndText("briana call atty", base).matches.map((p) => p.id), ["p1"]);
});
test("no Tyler Smith on file → full text kept, NO patient (not Hall, not the open patient)", () => {
  const plan = resolveSlashTodo("call tyler smith", TODAY, base);
  assert.equal(plan.kind, "card");
  if (plan.kind === "card") {
    assert.equal(plan.title, "Call Tyler Smith");
    assert.equal(plan.patient, null);
  }
});
test("one Tyler Smith on file → that patient, full text kept", () => {
  const plan = resolveSlashTodo("call tyler smith", TODAY, withTylerSmith);
  assert.equal(plan.kind, "card");
  if (plan.kind === "card") {
    assert.equal(plan.title, "Call Tyler Smith");
    assert.equal(plan.patient?.id, "p5");
  }
});
test("two Tyler Smiths → ask which", () => {
  const plan = resolveSlashTodo("call tyler smith", TODAY, twoTylers);
  assert.equal(plan.kind, "ask");
  if (plan.kind === "ask") assert.deepEqual(plan.shown.map((p) => p.id).sort(), ["p5", "p6"]);
});
test("'for <name>' tail still moves the name to the Patient line", () => {
  const plan = resolveSlashTodo("call atty for tyler smith tomorrow", TODAY, withTylerSmith);
  assert.equal(plan.kind, "card");
  if (plan.kind === "card") {
    assert.equal(plan.title, "Call Atty");
    assert.equal(plan.patient?.id, "p5");
    assert.ok(plan.due);
  }
});
test("explicit 'Name: text' and 'none:' still work", () => {
  const a = resolveSlashTodo("smith tyler: request records", TODAY, withTylerSmith);
  assert.equal(a.kind, "card");
  if (a.kind === "card") { assert.equal(a.patient?.id, "p5"); assert.equal(a.title, "Request records"); }
  const b = resolveSlashTodo("none: order supplies", TODAY, base);
  assert.equal(b.kind, "card");
  if (b.kind === "card") { assert.equal(b.patient, null); assert.equal(b.title, "Order supplies"); }
  assert.equal(resolveSlashTodo("zzzz qqqq: x", TODAY, base).kind, "notFound");
});
test("no name and no verb match → general to-do", () => {
  const plan = resolveSlashTodo("order supplies friday", TODAY, base);
  assert.equal(plan.kind, "card");
  if (plan.kind === "card") { assert.equal(plan.patient, null); assert.equal(plan.title, "Order supplies"); }
});
test("tidy capitalization", () => {
  assert.equal(tidyTodoTitle("call tyler smith"), "Call Tyler Smith");
  assert.equal(tidyTodoTitle("call tyler smith about records"), "Call Tyler Smith about records");
  assert.equal(tidyTodoTitle("order supplies"), "Order supplies");
  assert.equal(tidyTodoTitle("Call Dr. Mock"), "Call Dr. Mock");
  assert.equal(tidyTodoTitle("request records", "Smith, Tyler"), "Request records");
  assert.equal(tidyTodoTitle("send letter to smith", "Smith, Tyler"), "Send letter to Smith");
});
console.log(`\n${passed} passed`);
