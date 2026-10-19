/**
 * G.O.A.T. office manager eval (money + cases), mock data only.
 * Run: npx tsx scripts/tests/goat-eval/office-manager.test.ts
 */
import assert from "node:assert/strict";
import { emptyOmMemory, matchName, omTurn, parseMoney, planChanges, rememberApplied, takeDate, type OmData, type OmMemory, type OmPlan, type OmReply } from "../../../src/lib/goat-om";

const TODAY = "2026-10-15"; // Thursday
const P = (id: string, fullName: string, caseStatus: string, attorney: string, billed = 0, paid = 0, paidDate = "", lastVisit = "") => ({ id, fullName, caseStatus, attorney, billed, paid, paidDate, lastVisit });
const data: OmData = {
  today: TODAY,
  attorneys: ["Sampleton Law", "Example Law Group", "Sample Legal", "Mock & Mock Law"],
  patients: [
    P("smith", "John Smith", "Submitted", "Sampleton Law", 3200, 0, "", "2026-09-01"),
    P("malex", "Alex Malex", "Submitted", "Sampleton Law", 5400),
    P("lee", "Kevin Lee", "Active", "Sample Legal", 0, 0, "", "2026-10-10"),
    P("lopez", "Maria Lopez", "Ready To Submit", "Mock & Mock Law", 4100),
    P("petro", "Ani Petrosyan", "Active", "Example Law Group", 0, 0, "", "2026-09-20"),
    P("jsmith", "Jane Smithers", "Active", "Sample Legal", 0, 0, "", ""),
    P("kara1", "Kara Jones", "Paid", "Sample Legal", 2000, 1800, "10/05/2026"),
    P("kara2", "Kara Jonas", "Submitted", "Sample Legal", 2600),
    P("paid1", "Tom Brady", "Paid", "Sampleton Law", 3000, 2500, "10/01/2026"),
    P("paid2", "Ray Allen", "Paid", "Sample Legal", 2200, 2200, "10/08/2026"),
    P("paid3", "Gina Carano", "Paid", "Sample Legal", 1500, 1500, "09/20/2026"),
    P("dave1", "David Kim", "Active", "Sample Legal", 0, 0, "", "2026-10-14"),
    P("dave2", "David Park", "Active", "Sample Legal", 0, 0, "", "2026-09-25"),
    P("ohan", "Ohanian, Rafi", "Submitted", "Example Law Group", 1500, 0, "", "2026-10-14"),
  ],
};

type Check = (r: OmReply | null, mem: OmMemory) => void;
const isConfirm = (kind: Exclude<OmPlan, { kind: "undo" }>["kind"], more?: (p: Exclude<OmPlan, { kind: "undo" }>) => void): Check => (r) => {
  assert.ok(r && r.kind === "confirm", `expected confirm ${kind}, got ${r ? r.kind + ": " + ("text" in r ? r.text : "") : "null"}`);
  assert.equal(r.plan.kind, kind);
  more?.(r.plan);
};
const rows = (...want: Array<[string | null, number?]>) => (p: Exclude<OmPlan, { kind: "undo" }>) => {
  assert.deepEqual(p.rows.map((r) => [r.patientId, r.amount]).map(([a, b]) => (b === undefined ? [a] : [a, b])), want.map(([a, b]) => (b === undefined ? [a] : [a, b])), JSON.stringify(p.rows));
};
const ids = (...want: string[]) => (p: Exclude<OmPlan, { kind: "undo" }>) => assert.deepEqual(p.rows.map((r) => r.patientId), want, JSON.stringify(p.rows));
const answer = (...res: RegExp[]): Check => (r) => {
  assert.ok(r && r.kind === "answer", `expected answer, got ${r ? r.kind + ": " + ("text" in r ? r.text : "") : "null"}`);
  res.forEach((x) => assert.match(r.text, x));
};
const notMine: Check = (r) => assert.equal(r, null, `should not be handled: ${r && "text" in r ? r.text : ""}`);
const status = (s: string, date?: string) => (p: Exclude<OmPlan, { kind: "undo" }>) => { assert.equal((p as { status: string }).status, s); if (date) assert.equal((p as { date: string }).date, date); };
const date = (d: string) => (p: Exclude<OmPlan, { kind: "undo" }>) => assert.equal((p as { date: string }).date, d);
const all = (...fs: Array<(p: Exclude<OmPlan, { kind: "undo" }>) => void>) => (p: Exclude<OmPlan, { kind: "undo" }>) => fs.forEach((f) => f(p));

const cases: Array<[string, Check]> = [
  // 1) Bulk mark paid, any format
  ["mark the following paid with the amount: John Smith, 3200 / Alex Malex 5400", isConfirm("markPaid", rows(["smith", 3200], ["malex", 5400]))],
  ["mark these paid: John Smith $3,200, Alex Malex $5,400", isConfirm("markPaid", rows(["smith", 3200], ["malex", 5400]))],
  ["mark paid\nJohn Smith\t3200\nAlex Malex\t5400", isConfirm("markPaid", rows(["smith", 3200], ["malex", 5400]))],
  ["Smith - 3.2k, Malex - 5.4k paid", isConfirm("markPaid", rows(["smith", 3200], ["malex", 5400]))],
  ["paid: smith 3200; malex 5400", isConfirm("markPaid", rows(["smith", 3200], ["malex", 5400]))],
  ["mark smith paid 3200", isConfirm("markPaid", rows(["smith", 3200]))],
  ["smith paid 3200", isConfirm("markPaid", rows(["smith", 3200]))],
  ["john smith paid $3,200 yesterday", isConfirm("markPaid", all(rows(["smith", 3200]), date("2026-10-14")))],
  ["got a check for smith 3200", isConfirm("markPaid", rows(["smith", 3200]))],
  ["check came in for malex, 5400", isConfirm("markPaid", rows(["malex", 5400]))],
  ["received 5400 for alex malex", isConfirm("markPaid", rows(["malex", 5400]))],
  ["mark paid 10/12: smith 3200, malex 5400", isConfirm("markPaid", all(rows(["smith", 3200], ["malex", 5400]), date("2026-10-12")))],
  ["smith 3200 malex 5400 all paid", isConfirm("markPaid", rows(["smith", 3200], ["malex", 5400]))],
  ["pls mark paid smith 3k and malex 5.4k", isConfirm("markPaid", rows(["smith", 3000], ["malex", 5400]))],
  ["mark paid: Smith, John 3200", isConfirm("markPaid", (p) => assert.equal(p.rows.find((r) => r.amount === 3200)?.patientId, "smith"))],
  ["log payments: lopez 4100 | malex 5400", isConfirm("markPaid", rows(["lopez", 4100], ["malex", 5400]))],
  ["payments received today smith 3200 malex 5400", isConfirm("markPaid", rows(["smith", 3200], ["malex", 5400]))],
  ["mark paid smth 3200", isConfirm("markPaid", rows(["smith", 3200]))],
  ["mark paid jon smith 3200", isConfirm("markPaid", rows(["smith", 3200]))],
  ["mark paid alex malix 5400", isConfirm("markPaid", rows(["malex", 5400]))],
  ["can you mark the following as paid: smith 3200, malex 5400 paid last friday", isConfirm("markPaid", all(rows(["smith", 3200], ["malex", 5400]), date("2026-10-09")))],
  ["record checks smith 3,200.50", isConfirm("markPaid", rows(["smith", 3200.5]))],
  ["mark paid on oct 3 smith 3200", isConfirm("markPaid", all(rows(["smith", 3200]), date("2026-10-03")))],
  ["mark paid smith 3200, nobody 999", isConfirm("markPaid", (p) => { assert.equal(p.rows[0].patientId, "smith"); assert.equal(p.rows[1].flag, "unmatched"); assert.equal(p.rows[1].patientId, null); })],
  ["mark paid kara 2600", isConfirm("markPaid", (p) => { assert.equal(p.rows[0].flag, "ambiguous"); assert.equal(p.rows[0].patientId, null); assert.ok(p.rows[0].candidates.includes("kara1") && p.rows[0].candidates.includes("kara2")); })],
  ["mark paid david 1000", isConfirm("markPaid", (p) => assert.equal(p.rows[0].flag, "ambiguous"))],
  ["mark paid smith 3200 and lee", isConfirm("markPaid", (p) => { assert.equal(p.rows[1].patientId, "lee"); assert.equal(p.rows[1].flag, "noAmount"); })],
  ["3200 smith, 5400 malex paid", isConfirm("markPaid", rows(["smith", 3200], ["malex", 5400]))],
  ["mark smith paid in full", isConfirm("markPaid", rows(["smith", 3200]))],
  ["smith and malex paid", isConfirm("markPaid", rows(["smith", 3200], ["malex", 5400]))],
  ["mark kara jonas paid 2600", isConfirm("markPaid", rows(["kara2", 2600]))],
  ["ok goat, mark paid smith 3200", isConfirm("markPaid", rows(["smith", 3200]))],
  ["Mark paid:\nJohn Smith - $3,200\nAlex Malex - $5,400\nMaria Lopez - $4,100", isConfirm("markPaid", rows(["smith", 3200], ["malex", 5400], ["lopez", 4100]))],
  ["smith 3200 paid yday", isConfirm("markPaid", all(rows(["smith", 3200]), date("2026-10-14")))],
  ["malex check for 5400 came in today", isConfirm("markPaid", rows(["malex", 5400]))],
  ["mark paid smith 3.2K", isConfirm("markPaid", rows(["smith", 3200]))],
  ["mark petrosyan paid 1,250", isConfirm("markPaid", rows(["petro", 1250]))],
  ["just mark lopez paid $4100 thanks", isConfirm("markPaid", rows(["lopez", 4100]))],
  ["mark paid rafi ohanian 1500", isConfirm("markPaid", rows(["ohan", 1500]))],
  ["ohanian paid 1500", isConfirm("markPaid", rows(["ohan", 1500]))],
  ["discharge rafi ohanian today", isConfirm("status", ids("ohan"))],
  ["we got paid on lopez 4100", isConfirm("markPaid", rows(["lopez", 4100]))],
  ["collected 4100 from lopez", isConfirm("markPaid", rows(["lopez", 4100]))],

  // 2) Reduction
  ["Sampleton paid 2800 on Smith, we asked 3200", isConfirm("reduction", (p) => { rows(["smith", 2800])(p); assert.equal((p as { asked: number }).asked, 3200); assert.equal((p as { payer: string }).payer, "Sampleton Law"); })],
  ["smith settled for 2800, we asked 3200", isConfirm("reduction", (p) => { rows(["smith", 2800])(p); assert.equal((p as { asked: number }).asked, 3200); })],
  ["smith paid 2800 instead of 3200", isConfirm("reduction", rows(["smith", 2800]))],
  ["reduction on smith: asked 3200 accepted 2800", isConfirm("reduction", rows(["smith", 2800]))],
  ["smith reduced from 3200 to 2800, paid today", isConfirm("reduction", rows(["smith", 2800]))],
  ["we accepted 2800 on smith, requested 3200", isConfirm("reduction", rows(["smith", 2800]))],
  ["sampleton paid 4800 for malex, we billed 5400", isConfirm("reduction", rows(["malex", 4800]))],
  ["malex paid 4.8k, asked for 5.4k", isConfirm("reduction", rows(["malex", 4800]))],
  ["they took 2800 on smith, we wanted 3200", isConfirm("reduction", rows(["smith", 2800]))],
  ["Sampleton Law paid $2,800 on John Smith yesterday, we asked $3,200", isConfirm("reduction", all(rows(["smith", 2800]), date("2026-10-14")))],
  ["lopez settled 3500 req was 4100", isConfirm("reduction", rows(["lopez", 3500]))],
  ["sample legal paid 2000 on kara jonas, we requested 2600", isConfirm("reduction", rows(["kara2", 2000]))],

  // 3) Money questions
  ["what's still waiting on checks from Sampleton", answer(/2 submitted cases/, /Sampleton Law/, /\$8,600/, /John Smith/, /Alex Malex/)],
  ["whats waiting on checks from sampleton law", answer(/Sampleton Law/, /\$8,600/)],
  ["what checks are we still waiting on", answer(/4 submitted cases/, /\$12,700/)],
  ["which cases are waiting on payment", answer(/submitted case/)],
  ["any checks pending from sample legal?", answer(/1 submitted case/, /Kara Jonas/)],
  ["what's sampleton still owe us", answer(/Sampleton Law/, /\$8,600/)],
  ["how much is sampleton still owing", answer(/Sampleton Law/)],
  ["checks still waiting from sampleton", answer(/Sampleton Law/, /2 submitted/)],
  ["which sampleton cases haven't paid yet", answer(/Sampleton Law/)],
  ["are we still waiting on any checks from examplar?", answer(/1 submitted case waiting on checks from Example Law Group/, /Ohanian/)],
  ["what's still out with sample legal", answer(/Kara Jonas/)],
  ["who still owes us", answer(/submitted case/)],
  ["how much came in this month", answer(/\$6,500/, /3 cases/)],
  ["how much did we collect last week", answer(/last week/)],
  ["how much came in in september", answer(/\$1,500/, /September/)],
  ["how much money came in this year", answer(/\$8,000/)],
  ["total collected today?", answer(/today/)],
  ["how much did we get yesterday", answer(/yesterday/)],
  ["who paid this month", answer(/3 paid this month/, /Tom Brady/, /Ray Allen/, /Kara Jones/)],
  ["who paid last month?", answer(/Gina Carano/)],
  ["show me who paid this week", answer(/this week/)],
  ["list the paid cases this month", answer(/paid this month/)],
  ["what came in last month", answer(/\$1,500/)],
  ["how much have we collected in the past 30 days", answer(/last 30 days/)],
  ["how much did we bring in so far this month", answer(/this month/)],

  // 4) Bulk status
  ["discharge Smith, Malex and Lee today", isConfirm("status", all(ids("smith", "malex", "lee"), status("Discharged", TODAY)))],
  ["discharge lee yesterday", isConfirm("status", all(ids("lee"), status("Discharged", "2026-10-14")))],
  ["dc kevin lee today", isConfirm("status", all(ids("lee"), status("Discharged")))],
  ["discharge petrosyan on 10/10", isConfirm("status", all(ids("petro"), status("Discharged", "2026-10-10")))],
  ["move lee and petrosyan to ready to submit", isConfirm("status", all(ids("lee", "petro"), status("Ready To Submit")))],
  ["mark lopez submitted", isConfirm("status", all(ids("lopez"), status("Submitted")))],
  ["set lopez to submitted", isConfirm("status", all(ids("lopez"), status("Submitted")))],
  ["change lee's status to dropped", isConfirm("status", all(ids("lee"), status("Dropped")))],
  ["drop kevin lee", isConfirm("status", all(ids("lee"), status("Dropped")))],
  ["reopen kara jones", isConfirm("status", all(ids("kara1"), status("Active")))],
  ["put lee back to active", isConfirm("status", all(ids("lee"), status("Active")))],
  ["submit lopez", isConfirm("status", all(ids("lopez"), status("Submitted")))],
  ["lopez was submitted today", isConfirm("status", all(ids("lopez"), status("Submitted")))],
  ["lee and petrosyan are ready to bill", isConfirm("status", all(ids("lee", "petro"), status("Ready To Submit")))],
  ["move smith malex to rts", isConfirm("status", status("Ready To Submit"))],
  ["discharge kara", isConfirm("status", (p) => assert.equal(p.rows[0].flag, "ambiguous"))],
  ["lee got discharged yesterday", isConfirm("status", all(ids("lee"), status("Discharged", "2026-10-14")))],

  // 5) Questions
  ["who's ready to bill", answer(/1 ready to submit/, /Maria Lopez/)],
  ["whos ready to bill?", answer(/Maria Lopez/)],
  ["who can we bill", answer(/Maria Lopez/)],
  ["what's ready to submit", answer(/Maria Lopez/)],
  ["who's ready for billing", answer(/Maria Lopez/)],
  ["who hasn't been seen in 2 weeks", answer(/not seen in 2 weeks/, /Ani Petrosyan/, /Jane Smithers/, /David Park/)],
  ["who hasnt been in for 2 weeks", answer(/not seen/)],
  ["which active patients haven't come in in a month", answer(/not seen in 1 month/, /Jane Smithers/)],
  ["who hasn't been seen in 10 days", answer(/not seen in 10 days/)],
  ["anyone not seen in three weeks?", answer(/not seen in 3 weeks/)],
  ["who hasn't come in for a couple weeks", answer(/not seen in 2 weeks/)],

  // 6) Attorney
  ["Smith switched to Examplar", isConfirm("attorney", (p) => { ids("smith")(p); assert.equal((p as { attorney: string }).attorney, "Example Law Group"); })],
  ["lee switched attorneys to sampleton", isConfirm("attorney", (p) => assert.equal((p as { attorney: string }).attorney, "Sampleton Law"))],
  ["change lee's attorney to sample legal", isConfirm("attorney", (p) => assert.equal((p as { attorney: string }).attorney, "Sample Legal"))],
  ["lee's new attorney is examplar", isConfirm("attorney", (p) => assert.equal((p as { attorney: string }).attorney, "Example Law Group"))],
  ["lee has a new attorney: sampleton", isConfirm("attorney", (p) => assert.equal((p as { attorney: string }).attorney, "Sampleton Law"))],
  ["set petrosyan's atty to sampleton law", isConfirm("attorney", ids("petro"))],
  ["kevin lee went with examplar", isConfirm("attorney", ids("lee"))],
  ["lee moved to unknown firm llp", isConfirm("attorney", (p) => assert.equal((p as { known: boolean }).known, false))],
  ["smith's atty is now sampletin", isConfirm("attorney", (p) => assert.equal((p as { attorney: string }).attorney, "Sampleton Law"))],
  ["switch smith's lawyer to examplar", isConfirm("attorney", ids("smith"))],

  ["what came in today", answer(/today/)],
  ["how much did we make this week", answer(/this week/)],
  ["who paid in september", answer(/Gina Carano/)],
  ["who sent checks this month", answer(/paid this month/)],
  ["show me the payments that came in last week", answer(/last week/)],
  ["mark paid: tom brady 2500 (10/01)", isConfirm("markPaid", rows(["paid1", 2500]))],
  ["paid Alex Malex   $5,400.00", isConfirm("markPaid", rows(["malex", 5400]))],
  ["mark paid for malex - 5,400 and lopez - 4,100 on monday", isConfirm("markPaid", all(rows(["malex", 5400], ["lopez", 4100]), date("2026-10-12")))],
  ["mark paid smith 3200 / malex 5400 / lee 900", isConfirm("markPaid", rows(["smith", 3200], ["malex", 5400], ["lee", 900]))],
  ["enter payment smith $3200", isConfirm("markPaid", rows(["smith", 3200]))],
  ["move lee to discharged", isConfirm("status", all(ids("lee"), status("Discharged", TODAY)))],
  ["mark lee and petrosyan discharged on 10/14", isConfirm("status", all(ids("lee", "petro"), status("Discharged", "2026-10-14")))],
  ["set smith, malex to submitted", isConfirm("status", all(ids("smith", "malex"), status("Submitted")))],
  ["please discharge ani petrosyan", isConfirm("status", all(ids("petro"), status("Discharged")))],
  ["lee is ready to submit", isConfirm("status", all(ids("lee"), status("Ready To Submit")))],
  ["switch lopez to submitted", isConfirm("status", all(ids("lopez"), status("Submitted")))],
  ["update lee's case status to discharged", isConfirm("status", all(ids("lee"), status("Discharged")))],
  ["who's not been seen in 14 days", answer(/not seen in 14 days/)],
  ["what can we bill", answer(/Maria Lopez/)],
  ["who needs to be submitted", answer(/Maria Lopez/)],
  ["attorney for lee is now examplar", isConfirm("attorney", ids("lee"))],
  ["petrosyan changed to sample legal", isConfirm("attorney", (p) => assert.equal((p as { attorney: string }).attorney, "Sample Legal"))],
  ["lee switched over to sampleton law", isConfirm("attorney", ids("lee"))],

  // not ours
  ["tell hannah smith paid", notMine],
  ["add a note to smith: paid 3200", notMine],
  ["book lee tomorrow at 3", notMine],
  ["what's kara smith's bal", notMine],
  ["when is lee's next visit", notMine],
  ["what's on the schedule today", notMine],
  ["hi", notMine],
  ["shoot hannah a message saying kara jones paid", notMine],
  ["how many cases are waiting on checks", answer(/4 submitted cases waiting on checks/, /\$12,700/)],
  ["how many checks are we waiting on from sampleton", answer(/2 submitted cases/, /Sampleton Law/)],
  ["how many cases are still owed", answer(/submitted cases/)],
  ["how many people paid this month", answer(/3 paid this month/)],
  ["how many are ready to bill", answer(/1 ready to submit/)],
  ["how many active patients haven't been seen in 2 weeks", answer(/not seen in 2 weeks/)],
  ["how many paid cases do we have", notMine],
  ["thanks", notMine],
];

let pass = 0;
const fails: string[] = [];
for (const [q, check] of cases) {
  if (!check) { pass++; continue; }
  try {
    check(omTurn(q, data, emptyOmMemory(), false), emptyOmMemory());
    pass++;
  } catch (e) {
    fails.push(`✗ ${JSON.stringify(q)}\n   ${(e as Error).message.slice(0, 300)}`);
  }
}

// 7) Conversation memory: these / her / same / add more / undo
type Turn = [string, Check];
const flows: Array<{ name: string; turns: Turn[] }> = [
  { name: "these = last listed", turns: [["who hasn't been seen in 2 weeks", answer(/Ani Petrosyan/)], ["move these to ready to submit", isConfirm("status", all(status("Ready To Submit"), (p) => assert.ok(p.rows.length >= 3)))]] },
  { name: "them after ready to bill", turns: [["who's ready to bill", answer(/Maria Lopez/)], ["mark them submitted", isConfirm("status", all(ids("lopez"), status("Submitted")))]] },
  { name: "add 500 more to her", turns: [["mark lopez paid 4100", isConfirm("markPaid", rows(["lopez", 4100]))], ["add 500 more to her", isConfirm("addPaid", rows(["lopez", 500]))]] },
  { name: "do the same for Lee", turns: [["discharge smith today", isConfirm("status", ids("smith"))], ["do the same for Lee", isConfirm("status", all(ids("lee"), status("Discharged")))]] },
  { name: "same for (amount carried)", turns: [["mark smith paid 3200", isConfirm("markPaid", rows(["smith", 3200]))], ["same for malex", isConfirm("markPaid", rows(["malex", 3200]))]] },
  { name: "undo that", turns: [["discharge smith today", isConfirm("status")], ["undo that", (r) => assert.equal(r?.kind, "undo")]] },
  { name: "oops undo", turns: [["mark smith paid 3200", isConfirm("markPaid")], ["oops undo", (r) => assert.equal(r?.kind, "undo")]] },
  { name: "take that back", turns: [["smith switched to examplar", isConfirm("attorney")], ["take that back", (r) => assert.equal(r?.kind, "undo")]] },
  { name: "and lee too", turns: [["move smith to ready to submit", isConfirm("status")], ["lee too", isConfirm("status", ids("lee"))]] },
  { name: "add another 250 to smith", turns: [["mark smith paid 3200", isConfirm("markPaid")], ["add another 250 to smith", isConfirm("addPaid", rows(["smith", 250]))]] },
];
for (const f of flows) {
  let mem = emptyOmMemory();
  for (const [q, check] of f.turns) {
    try {
      const r = omTurn(q, data, mem, true);
      check(r, mem);
      pass++;
      if (r?.kind === "answer") mem = { ...mem, listed: r.listed };
      if (r?.kind === "confirm") mem = rememberApplied(mem, r.plan);
    } catch (e) {
      fails.push(`✗ [${f.name}] ${JSON.stringify(q)}\n   ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

// Units: money, dates, names, change list
assert.equal(parseMoney("$3,200"), 3200);
assert.equal(parseMoney("3.2k"), 3200);
assert.equal(parseMoney("5400"), 5400);
assert.equal(takeDate("paid yesterday", TODAY).iso, "2026-10-14");
assert.equal(takeDate("10/12", TODAY).iso, "2026-10-12");
assert.equal(takeDate("12/30", TODAY).iso, "2025-12-30");
assert.equal(takeDate("last monday", TODAY).iso, "2026-10-12");
assert.deepEqual(matchName("Smith", data.patients).candidates, ["smith"]);
assert.deepEqual(matchName("kara", data.patients).candidates.sort(), ["kara1", "kara2"]);
{
  const r = omTurn("Sampleton paid 2800 on Smith, we asked 3200", data, emptyOmMemory(), false);
  assert.ok(r?.kind === "confirm");
  const ch = planChanges(r.plan, data);
  assert.equal(ch.length, 1);
  assert.deepEqual(ch[0].billing, { paidAmount: 2800, paidDate: "10/15/2026" });
  assert.deepEqual(ch[0].adjustment?.amount, 400);
  assert.equal(ch[0].caseStatus, "Paid");
  assert.match(ch[0].note, /reduction accepted/);
  const d = omTurn("discharge lee yesterday", data, emptyOmMemory(), false);
  assert.ok(d?.kind === "confirm");
  assert.deepEqual(planChanges(d.plan, data)[0].matrix, { discharge: "2026-10-14" });
  const a = omTurn("add 500 more to lopez", data, emptyOmMemory(), false);
  assert.ok(a?.kind === "confirm");
  assert.equal(planChanges(a.plan, data)[0].billing?.paidAmount, 500);
  const amb = omTurn("mark paid kara 2600", data, emptyOmMemory(), false);
  assert.ok(amb?.kind === "confirm");
  assert.equal(planChanges(amb.plan, data).length, 0, "ambiguous rows are never written");
}

const total = cases.length + flows.reduce((s, f) => s + f.turns.length, 0);
if (process.argv.includes("--verbose") || fails.length) console.log(fails.join("\n"));
console.log(`office-manager eval: ${pass}/${total} passed`);
assert.equal(fails.length, 0, `${fails.length} failing`);
