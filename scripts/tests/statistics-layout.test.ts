/**
 * Statistics top: snapshot cards stay a 2×2 on the left, and Cases By Month,
 * Imaging Referrals, and Specialist Referrals sit beside them. Narrow screens
 * stack. Run: npx tsx scripts/tests/statistics-layout.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../src/app/(portal)/dashboard/page.tsx", import.meta.url), "utf8");
const topAt = src.indexOf('data-statistics-layout="top"');
assert.ok(topAt > 0, "statistics top grid marker");
const topOpen = src.slice(src.lastIndexOf("<section", topAt), topAt);
assert.match(topOpen, /grid-cols-1/);
assert.match(topOpen, /xl:grid-cols-\[minmax\(22rem,36rem\)_minmax\(0,1fr\)_minmax\(0,1\.15fr\)_minmax\(0,0\.95fr\)\]/);

const gridAt = src.indexOf('data-statistics-layout="2x2"');
assert.ok(gridAt > topAt, "2x2 sits inside the top grid");
const gridOpen = src.slice(src.lastIndexOf("<div", gridAt), gridAt);
assert.match(gridOpen, /sm:grid-cols-2/);
assert.doesNotMatch(gridOpen, /max-w-\[44rem\]/);
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

const monthAt = src.indexOf(">Cases By Month<", cursor);
const imagingAt = src.indexOf(">Imaging Referrals<", monthAt);
const specialistAt = src.indexOf(">Specialist Referrals<", imagingAt);
const attorneyAt = src.indexOf(">Attorney Performance<", specialistAt);
assert.ok(monthAt > cursor && imagingAt > monthAt && specialistAt > imagingAt && attorneyAt > specialistAt);
assert.match(src.slice(monthAt, attorneyAt), /overflow-y-auto/);
assert.doesNotMatch(src.slice(imagingAt, specialistAt), /bilateral BL extremity/);
assert.doesNotMatch(src.slice(specialistAt, attorneyAt), /Case counts only/);
assert.doesNotMatch(src.slice(attorneyAt, attorneyAt + 400), /Click any column heading/);
assert.equal(src.includes("Referral Totals"), false);
assert.match(src, /data-statistics-layout="2x2"/);

console.log("statistics-layout ok");
