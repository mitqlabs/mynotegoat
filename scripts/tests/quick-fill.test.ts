/**
 * Quick Fill parses a pasted referral and feeds the same duplicate check.
 * Run: npx tsx scripts/tests/quick-fill.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quickFillFromText } from "../../src/lib/quick-fill";
import { findDuplicateCases } from "../../src/lib/patient-duplicate";

const text = `New patient referral
Patient: Daniela Romero Rojas
DOB: 04/12/1994
Phone: 818-555-0142
Address: 1428 Brand Blvd Apt 3B, Glendale, CA 91204
Date of injury: 09/25/2026
Attorney: Yepremyan Law Firm
First visit 11/10/2026 at 10:30 AM`;

const filled = quickFillFromText(text, {
  todayIso: "2026-11-09",
  attorneys: ["Yepremyan Law Firm", "CN Law Group"],
});
assert.equal(filled.dob, "04/12/1994");
assert.equal(filled.phone, "818-555-0142");
assert.match(filled.addressStreet ?? "", /1428 Brand Blvd/i);
assert.equal(filled.addressCity, "Glendale");
assert.equal(filled.addressState, "CA");
assert.equal(filled.addressZip, "91204");
assert.equal(filled.dateOfLoss, "09/25/2026");
assert.equal(filled.attorney, "Yepremyan Law Firm");
assert.equal(filled.evalDate, "11/10/2026");
assert.match(filled.evalTime ?? "", /10:30/);
assert.ok(filled.firstName && filled.lastName);

const dupes = findDuplicateCases(
  [{ id: "p1", fullName: `${filled.lastName}, ${filled.firstName}`, dateOfLoss: "2026-09-25" }],
  { firstName: filled.firstName ?? "", lastName: filled.lastName ?? "", dateOfLoss: filled.dateOfLoss },
);
assert.equal(dupes.length, 1);
assert.equal(
  findDuplicateCases(
    [{ id: "p1", fullName: `${filled.lastName}, ${filled.firstName}`, dateOfLoss: "2026-09-25" }],
    { firstName: filled.firstName ?? "", lastName: filled.lastName ?? "" },
  ).length,
  0,
);

const page = readFileSync(new URL("../../src/app/(portal)/patients/page.tsx", import.meta.url), "utf8");
assert.match(page, /QuickFillBox/);
assert.match(page, /DuplicateCaseWarning/);

console.log("quick-fill ok", filled);
