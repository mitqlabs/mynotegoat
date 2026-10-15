import assert from "node:assert/strict";
import { normalizeReferralDates, normalizeReferralList } from "../../src/lib/imaging-dates";

const e = { id: "a", center: "X", sentDate: "2025-06-02", doneDate: "6/9/25", reportReceivedDate: "06/20/2025", reportReviewedDate: "", findings: "2025-01-01 note" };
const n = normalizeReferralDates(e);
assert.equal(n.sentDate, "06/02/2025");
assert.equal(n.doneDate, "06/09/2025");
assert.equal(n.reportReceivedDate, "06/20/2025");
assert.equal(n.reportReviewedDate, "");
assert.equal(n.findings, "2025-01-01 note"); // non-date fields untouched
assert.equal(e.sentDate, "2025-06-02"); // input not mutated
const keep = { sentDate: "pending" };
assert.equal(normalizeReferralDates(keep), keep); // free text kept, same object
assert.deepEqual(normalizeReferralList([{ completedDate: "2024-12-31" }]), [{ completedDate: "12/31/2024" }]);
console.log("imaging-dates OK");
