/**
 * Statistics snapshot cards: a compact 2×2, in this order, with the
 * renamed titles. Run: npx tsx scripts/tests/statistics-layout.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../src/app/(portal)/dashboard/page.tsx", import.meta.url), "utf8");
const gridAt = src.indexOf('data-statistics-layout="2x2"');
assert.ok(gridAt > 0, "statistics 2x2 grid marker");
const open = src.lastIndexOf("<div", gridAt);
const gridOpen = src.slice(open, gridAt);
assert.match(gridOpen, /max-w-\[44rem\]/);
assert.match(gridOpen, /sm:grid-cols-2/);
assert.doesNotMatch(gridOpen, /xl:grid-cols-3/);

const titles = ["Total Cases", "Cycle Lengths", "Billing Snapshot", "Cash Snapshot"];
let cursor = gridAt;
for (const title of titles) {
  const at = src.indexOf(`>${title}<`, cursor);
  assert.ok(at > cursor, `expected ${title} after the previous card`);
  cursor = at;
}

assert.equal(src.includes("Total Reports"), false);
assert.equal(src.includes("Cycle Time Averages"), false);
assert.equal(src.includes("Cash Patients &amp; Packages"), false);
assert.equal(src.includes("Cash Patients & Packages"), false);

const rowAt = src.indexOf('data-statistics-layout="month-referrals"');
assert.ok(rowAt > gridAt, "month and referral cards follow the 2x2");
const rowOpen = src.slice(src.lastIndexOf("<section", rowAt), rowAt);
assert.match(rowOpen, /grid-cols-1/);
assert.match(rowOpen, /lg:grid-cols-3/);
const monthAt = src.indexOf(">Cases By Month<", rowAt);
const imagingAt = src.indexOf(">Imaging Referrals<", monthAt);
const specialistAt = src.indexOf(">Specialist Referrals<", imagingAt);
const attorneyAt = src.indexOf(">Attorney Performance<", specialistAt);
assert.ok(monthAt > rowAt && imagingAt > monthAt && specialistAt > imagingAt && attorneyAt > specialistAt);
assert.match(src.slice(imagingAt, specialistAt), /bilateral BL extremity counts as two/);
assert.match(src.slice(imagingAt, specialistAt), /overflow-y-auto/);
assert.equal(src.includes("Referral Totals"), false);
assert.match(src, /data-statistics-layout="2x2"/);

console.log("statistics-layout ok");
