/**
 * Plain-language team messages (NoteGoat Messages, not SMS). Fictional data only.
 * Run: npx tsx scripts/tests/goat-eval/team-message.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEAM, caseQuestion, parseTeamMessage } from "../../../src/lib/goat-team-message";
import { matchRecipient, patientsMentionedInMessage, type TeamPerson } from "../../../src/lib/goat-message";
import { detectPlainTodo, detectNewVisitBooking } from "../../../src/lib/goat-intents";

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };

type W = { to: string; text: string; patient?: string | null };
const CASES: Array<[string, W]> = [
  ["message Hannah about John Smith", { to: "Hannah", text: "", patient: "John Smith" }],
  ["tell hannah john smith's MRI is in", { to: "hannah", text: "john smith's MRI is in", patient: null }],
  ["text hannah can you call Mock Law", { to: "hannah", text: "can you call Mock Law" }],
  ["txt hannah the fax came in", { to: "hannah", text: "the fax came in" }],
  ["msg greg please pull the x-rays", { to: "greg", text: "please pull the x-rays" }],
  ["ping greg re Jane Sample", { to: "greg", text: "", patient: "Jane Sample" }],
  ["please message hannah that kara jones called", { to: "hannah", text: "kara jones called" }],
  ["can you tell hannah to call kara jones back", { to: "hannah", text: "Can you call kara jones back?" }],
  ["ask hannah to call kara jones back", { to: "hannah", text: "Can you call kara jones back?" }],
  ["remind hannah to fax records for john smith", { to: "hannah", text: "Can you fax records for john smith?", patient: "john smith" }],
  ["let hannah know the MRI for collin elliott is in", { to: "hannah", text: "the MRI for collin elliott is in" }],
  ["let the team know the fax is down", { to: TEAM, text: "the fax is down" }],
  ["let everyone know we close at 3 today", { to: TEAM, text: "we close at 3 today" }],
  ["message the team: staff meeting at 5", { to: TEAM, text: "staff meeting at 5" }],
  ["tell the whole team the parking lot is closed", { to: TEAM, text: "the parking lot is closed" }],
  ["post to general: new fax number", { to: TEAM, text: "new fax number" }],
  ["send a message to hannah saying the MRI for John Smith came in", { to: "hannah", text: "the MRI for John Smith came in" }],
  ["send hannah a message", { to: "hannah", text: "" }],
  ["send hannah a message: call Mock Law", { to: "hannah", text: "call Mock Law" }],
  ["message hannah", { to: "hannah", text: "" }],
  ["tell Dr. Abi about Collin Elliott: needs re-exam", { to: "Dr. Abi", text: "needs re-exam", patient: "Collin Elliott" }],
  ["hey goat, tell greg the copier is jammed", { to: "greg", text: "the copier is jammed" }],
  ["message to hannah about Jane Sample - records requested", { to: "hannah", text: "records requested", patient: "Jane Sample" }],
  ["dm hannah lunch is here", { to: "hannah", text: "lunch is here" }],
];
for (const [q, w] of CASES) check(`parse: ${q}`, () => {
  const r = parseTeamMessage(q);
  assert.ok(r, "not detected");
  assert.equal(r!.to, w.to);
  assert.equal(r!.text, w.text);
  if (w.patient !== undefined) assert.equal(r!.patientName, w.patient);
});
for (const q of ["remind me to call armen barmen 555-555-5588", "tell the patient to come in", "what did hannah say", "show my messages", "/note john: hi", "@hannah hi", "schedule john smith friday at 3", "add to-do text hannah"]) check(`not a team message: ${q}`, () => assert.equal(parseTeamMessage(q), null));
check("todo still wins over 'remind me'", () => assert.ok(detectPlainTodo("remind me to text hannah")));
check("booking isn't a message", () => assert.equal(detectNewVisitBooking("message hannah about john smith"), null));

// Who: several Hannahs → ask; one → straight on; none → pick from the team.
const team: TeamPerson[] = [
  { firstName: "Hannah", label: "Hannah", lastName: "Mock", userId: "u1" },
  { firstName: "Hannah", label: "Hannah", lastName: "Sample", userId: "u2" },
  { firstName: "Greg", label: "Greg", userId: "u3" },
  { firstName: "Abi", label: "Dr. Abi", lastName: "Mitchell", doctor: true, userId: "u4" },
];
check("two Hannahs → both offered", () => assert.equal(matchRecipient("hannah", team).length, 2));
check("hannah sample → one", () => assert.equal(matchRecipient("hannah sample", team).length, 1));
check("greg → one", () => assert.equal(matchRecipient("greg", team)[0].userId, "u3"));
check("Dr. Abi → doctor", () => assert.equal(matchRecipient("Dr. Abi", team)[0].userId, "u4"));
check("nobody", () => assert.equal(matchRecipient("zed", team).length, 0));

// Which case: a named patient is found (and always confirmed by the chat).
const pool = [
  { id: "p1", fullName: "Smith, John", caseStatus: "Active" },
  { id: "p2", fullName: "Elliott, Collin", caseStatus: "Active" },
  { id: "p3", fullName: "Jones, Kara", caseStatus: "Active" },
];
check("mention in text finds the case", () => assert.deepEqual(patientsMentionedInMessage("john smith's MRI is in", pool).map((p) => p.id), ["p1"]));
check("no mention → no case", () => assert.equal(patientsMentionedInMessage("the fax is down", pool).length, 0));
check("case question: one", () => assert.equal(caseQuestion([{ label: "Smith, John (Active)" }]), "About Smith, John (Active)?"));
check("case question: several", () => assert.equal(caseQuestion([{ label: "a" }, { label: "b" }]), "Which case is this about?"));

// Wiring
const goat = readFileSync("src/components/global-goat.tsx", "utf8");
check("always confirms one match (Yes — …)", () => assert.ok(goat.includes("shown.length === 1 ? `Yes — ${choiceLabel(c)}`")));
check("asks for missing text", () => assert.ok(goat.includes("`What should I tell ${who}?`")));
check("asks which team member", () => assert.ok(goat.includes("`Which ${st.req.to}?`")));
check("team → General, no @", () => assert.ok(goat.includes('toLabel: st.to ? st.to.label : "Everyone (General)"') && goat.includes("draft.toTeam ? draft.text.trim()")));
check("linked case is clickable", () => assert.ok(/Case:[\s\S]{0,200}href=\{`\/patients\/\$\{encodeURIComponent\(draft\.patientId\)\}`\}/.test(goat)));
check("plain team message routed before briefs", () => { const i = goat.indexOf("tryTeamMessage(question)) return;"); assert.ok(i > 0 && i < goat.indexOf("detectBrief(question)) {")); });
check("greeting doesn't advertise /", () => { assert.ok(!goat.includes("Type / for commands")); assert.ok(goat.includes('placeholder="Ask or say anything…"')); });
const hb = readFileSync("src/lib/handbook-goat.ts", "utf8");
check("handbook: plain team messages + optional shortcuts", () => { for (const t of ["message Hannah about John Smith", "About Smith, John (Active)?", "What should I tell Hannah?", "optional shortcuts", "never an SMS"]) assert.ok(hb.includes(t), t); });

console.log(`team-message: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
