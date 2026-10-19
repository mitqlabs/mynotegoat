/**
 * G.O.A.T. how-to answers from the full Handbook (offline index). Mock-free: reads the real Handbook data.
 * Run: npx tsx scripts/tests/goat-eval/handbook-search.test.ts
 */
import assert from "node:assert/strict";
import { answerHowToFull } from "../../../src/lib/goat-howto-handbook";
import { answerFromHandbook, searchHandbook, allHandbookChapters, taskHref } from "../../../src/lib/handbook-search";
import type { HandbookChapter } from "../../../src/lib/handbook-content";

const admin = { admin: true, manager: true };
const staff = { admin: false, manager: false };
let n = 0;
const ok = (name: string, f: () => void) => { f(); n++; console.log(`ok - ${name}`); };
const top = (q: string, r = admin) => searchHandbook(q, r)[0];

for (const [q, want] of [
  ["how do I send a form", /form/i],
  ["how do I add a case", /case/i],
  ["where do I change office hours", /hours|office|schedule/i],
  ["how to merge duplicate encounters", /merge|duplicate/i],
] as Array<[string, RegExp]>) {
  ok(q, () => {
    const a = answerHowToFull(q, admin);
    assert.ok(a.found, a.text);
    assert.ok(a.links.length >= 1);
    assert.match(`${a.text} ${a.links.map((l) => l.label).join(" ")}`, want);
  });
}
ok("links jump to the exact section", () => {
  const h = top("how to merge duplicate encounters")!;
  assert.match(h.href, /^\/handbook#task-[a-z0-9-]+-[a-z0-9-]+$/);
  assert.equal(h.href, taskHref(h.chapterId, h.task.heading));
});
ok("admin-only chapters never shown to staff", () => {
  const adminIds = new Set(allHandbookChapters().filter((c) => c.audience === "admin").map((c) => c.id));
  for (const q of ["how do i change a role", "how do i see the dashboard", "where are reports"]) for (const h of searchHandbook(q, staff)) assert.ok(!adminIds.has(h.chapterId), `${q} → ${h.chapterId}`);
});
ok("new sections are included automatically", () => {
  const extra: HandbookChapter = { id: "mock-new", title: "Mock Gadget", summary: "A brand new mock page.", audience: "all", tasks: [{ heading: "Polish the mock gadget", steps: ["Open Mock Gadget.", "Tap Polish."] }] };
  const a = answerFromHandbook("how do I polish the gadget", admin, [...allHandbookChapters(), extra]);
  assert.equal(a.kind, "answer");
  if (a.kind === "answer") assert.match(a.links[0].href, /task-mock-new-polish-the-mock-gadget/);
});
ok("nothing fits → short clarifying question", () => {
  const a = answerHowToFull("how do I zorblax the flimflam", admin);
  assert.equal(a.found, false);
  assert.match(a.text, /\?$/);
});
console.log(`${n} passed`);
