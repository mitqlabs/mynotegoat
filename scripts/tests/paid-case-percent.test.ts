/**
 * % Paid uses only cases marked Paid. A Paid case with no paid amount is
 * left out of the ratio and counted. Run: npx tsx scripts/tests/paid-case-percent.test.ts
 */
import assert from "node:assert/strict";
import { paidCaseMissingLabel, paidCasePercent, type PaidCaseMoney } from "../../src/lib/paid-case-percent";

const ward: PaidCaseMoney[] = [
  { caseStatus: "Active", billed: 1000, paid: 0 },
  { caseStatus: "Submitted", billed: 2000, paid: 500 },
  { caseStatus: "Paid", billed: 4000, paid: 3000 },
  { caseStatus: "Paid", billed: 1000, paid: 0 },
];

// Before: every case's collected dollars / every case's billed dollars.
const oldBilled = ward.reduce((sum, row) => sum + row.billed, 0);
const oldCollected = ward.reduce((sum, row) => sum + row.paid, 0);
const oldAttorneyPercent = (oldCollected / oldBilled) * 100;
assert.equal(oldAttorneyPercent, 43.75);

// Before, the page summary also folded in any case that had a payment,
// plus every Paid case even when its paid amount was blank.
let oldSummaryBilled = 0;
let oldSummaryPaid = 0;
for (const row of ward) {
  if (row.paid > 0 || row.caseStatus === "Paid") {
    oldSummaryBilled += row.billed;
    oldSummaryPaid += row.paid;
  }
}
assert.equal((oldSummaryPaid / oldSummaryBilled) * 100, 50);

const next = paidCasePercent(ward);
assert.equal(next.paidCases, 2);
assert.equal(next.missingAmount, 1);
assert.equal(next.percent, 75);
assert.equal(paidCaseMissingLabel(next.missingAmount), "1 paid case missing amount");

const nonePaid = paidCasePercent([{ caseStatus: "Active", billed: 500, paid: 100 }]);
assert.equal(nonePaid.percent, null);
assert.equal(nonePaid.missingAmount, 0);
assert.equal(paidCaseMissingLabel(nonePaid.missingAmount), null);

const blankPaid = paidCasePercent([{ caseStatus: "Paid", billed: 800, paid: 0 }]);
assert.equal(blankPaid.percent, null);
assert.equal(blankPaid.missingAmount, 1);

const twoBlank = paidCasePercent([
  { caseStatus: "Paid", billed: 800, paid: 0 },
  { caseStatus: "Paid", billed: 900, paid: 0 },
  { caseStatus: "Paid", billed: 1000, paid: 250 },
]);
assert.equal(twoBlank.percent, 25);
assert.equal(twoBlank.missingAmount, 2);
assert.equal(paidCaseMissingLabel(2), "2 paid cases missing amount");

console.log("paid-case-percent ok", { oldAttorneyPercent, oldSummary: 50, next: next.percent });
