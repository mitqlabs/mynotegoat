/**
 * Eval: @mentions in the G.O.A.T. input. Mock data only.
 * Run: npx tsx scripts/tests/goat-eval/at-mentions.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterMentionPeople, mentionInsert, mentionQueryAt, parseMentions } from "../../../src/lib/goat-mentions";
import { buildTeam, patientsMentionedInMessage } from "../../../src/lib/goat-message";

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };

const logins = [
  { userId: "owner", label: "Dr. Abi Mitchell", email: "Owner" },
  { userId: "u-mike", label: "Mike Galstyan", email: "m@example.com", doctor: true },
  { userId: "u-lei", label: "Leilani Duque", email: "l@example.com" },
  { userId: "u-han", label: "Hannah Mitchell", email: "h@example.com" },
  { userId: "u-greg", label: "Greg Sample", email: "g@example.com" },
];
const team = buildTeam([], logins);
const pool = [
  { id: "d", fullName: "Destiny Greer", caseStatus: "Active" },
  { id: "k1", fullName: "Kara Smith", caseStatus: "Active" },
  { id: "k2", fullName: "Kara Jones", caseStatus: "Active" },
  { id: "c", fullName: "Collin Elliott", caseStatus: "Active" },
];
const to = (q: string) => parseMentions(q, team)!.recipients.map((p) => p.userId);
const text = (q: string) => parseMentions(q, team)!.text;

// Picker
check("@ opens picker with everyone incl. owner", () => { const m = mentionQueryAt("@", 1); assert.deepEqual(m, { at: 0, query: "" }); assert.equal(filterMentionPeople(logins, "", null).length, 5); assert.ok(filterMentionPeople(logins, "", null).some((p) => p.email === "Owner")); });
check("picker excludes self", () => assert.ok(!filterMentionPeople(logins, "", "u-lei").some((p) => p.userId === "u-lei")));
check("@lei filters", () => assert.deepEqual(filterMentionPeople(logins, mentionQueryAt("hi @lei", 7)!.query, null).map((p) => p.userId), ["u-lei"]));
check("@Dr. A finds Dr. Abi", () => { const m = mentionQueryAt("@Dr. A", 6)!; assert.equal(m.query, "Dr. A"); assert.deepEqual(filterMentionPeople(logins, m.query, null).map((p) => p.userId), ["owner"]); });
check("@owner finds owner", () => assert.deepEqual(filterMentionPeople(logins, "owner", null).map((p) => p.userId), ["owner"]));
check("no picker mid-word", () => assert.equal(mentionQueryAt("email@x", 7), null));
check("no picker after a finished mention + space", () => assert.equal(mentionQueryAt("@Leilani Duque hi", 17), null));
check("insert label", () => assert.equal(mentionInsert("Leilani Duque"), "@Leilani Duque "));

// @ = tell
const ONE: Array<[string, string, string]> = [
  ["@Leilani testing testing", "u-lei", "testing testing"], ["@leilani testing testing", "u-lei", "testing testing"],
  ["@Dr. Abi testing testing", "owner", "testing testing"], ["@dr abi hey", "owner", "hey"], ["@abi can you sign the lien", "owner", "can you sign the lien"],
  ["@Dr. Mitchell call me", "owner", "call me"], ["@Dr. Abi Mitchell hi", "owner", "hi"], ["@Leilani Duque hi there", "u-lei", "hi there"],
  ["@abi mitchell hi", "owner", "hi"], ["@Dr. Mike fax is down", "u-mike", "fax is down"], ["@mike: lunch?", "u-mike", "lunch?"],
  ["@hannah collin elliott called", "u-han", "collin elliott called"], ["@Greg, lock up tonight", "u-greg", "lock up tonight"],
];
for (const [q, id, t] of ONE) check(`one: ${q}`, () => { assert.deepEqual(to(q), [id]); assert.equal(text(q), t); });

// General vs patient vs ambiguous
for (const q of ["@Leilani testing testing", "@Dr. Abi testing testing", "@greg hey how are you, just testing this new feature out", "@hannah thanks!"]) check(`general: ${q}`, () => assert.deepEqual(patientsMentionedInMessage(text(q), pool), []));
check("patient attached", () => assert.deepEqual(patientsMentionedInMessage(text("@hannah collin elliott called"), pool).map((p) => p.id), ["c"]));
check("ambiguous asks", () => assert.equal(patientsMentionedInMessage(text("@hannah kara called"), pool).length, 2));

// Multiple
const MULTI: Array<[string, string[], string]> = [
  ["@Hannah @Greg staff meeting at 5", ["u-han", "u-greg"], "staff meeting at 5"], ["@hannah @greg @leilani pizza in the break room", ["u-han", "u-greg", "u-lei"], "pizza in the break room"],
  ["@Hannah, @Greg: meeting moved", ["u-han", "u-greg"], "meeting moved"], ["@hannah and @greg call kara smith", ["u-han", "u-greg"], "call kara smith"],
  ["@Dr. Abi @Dr. Mike review collin's file", ["owner", "u-mike"], "review collin's file"], ["@greg @greg dup", ["u-greg"], "dup"],
];
for (const [q, ids, t] of MULTI) check(`multi: ${q}`, () => { assert.deepEqual(to(q), ids); assert.equal(text(q), t); });
check("unknown name reported", () => assert.deepEqual(parseMentions("@zed hi", team)!.unknown, ["zed"]));
check("not a mention", () => assert.equal(parseMentions("tell hannah hi", team), null));

// Wiring
const g = readFileSync("src/components/global-goat.tsx", "utf8");
check("wiring: @ routes into the tell path with all recipients", () => { assert.ok(g.includes("parseMentions(question, team)")); assert.ok(g.includes("opts?.to ?? matchRecipient(req.to, team)")); assert.ok(g.includes("alsoTo")); });
check("wiring: picker keys", () => { assert.ok(g.includes("data-goat-mention-picker")); for (const k of ["ArrowDown", "ArrowUp", "Escape"]) assert.ok(g.includes(`"${k}"`)); });
check("wiring: one message notifies everyone", () => assert.ok(g.includes("mentions: all.filter((p) => p.userId)")));

console.log(`at-mentions: ${pass}/${pass + fail} passed (mock data only)`);
if (fail) process.exit(1);
