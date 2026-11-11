/**
 * Shift handoff columns. Run: npx tsx scripts/tests/goat-handoff.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildHandoff } from "../../src/lib/goat-handoff";

const handoff = buildHandoff({
  officeName: "Main Office",
  dateLabel: "Monday, Nov 9, 2026",
  seen: 8,
  noShows: [{ name: "Brooks, Marcus" }],
  intake: [{ name: "New, Nora", missing: ["date of injury", "attorney"] }],
  waiting: [{ id: "rb:1", kind: "rb", patientId: "1", patientName: "Bill, Bea", href: "/patients/1", title: "R&B not sent", detail: "" }],
  openings: ["8:00 AM", "8:15 AM"],
  tomorrowClosed: false,
  rebooks: [{ name: "Okoro, Amara", when: "2026-11-10 2:00 PM" }],
});

assert.match(handoff.title, /Main Office handoff/);
assert.equal(handoff.left[0].text, "Seen: 8");
assert.equal(handoff.left[1].children[0], "Brooks, Marcus");
assert.match(handoff.right[0].children[0], /missing date of injury, attorney/);
assert.match(handoff.right[1].children[0], /R&B not sent/);
assert.deepEqual(handoff.right[2].children, ["8:00 AM", "8:15 AM"]);
assert.match(handoff.right[3].children[0], /Okoro, Amara/);

const view = readFileSync(new URL("../../src/components/goat-handoff.tsx", import.meta.url), "utf8");
const printCss = readFileSync(new URL("../../src/lib/print-goat-handoff.ts", import.meta.url), "utf8");
assert.match(view, /printGoatHandoff/);
assert.match(printCss, /window\.print/);
assert.match(printCss, /@media print/);
assert.match(printCss, /goat-print-root/);
assert.doesNotMatch(printCss, /visibility:\s*hidden/);
assert.match(view, /sm:grid-cols-2/);

console.log("goat-handoff ok");
