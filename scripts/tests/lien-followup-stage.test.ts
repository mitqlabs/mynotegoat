import assert from "node:assert/strict";
import { lienFollowUpStage } from "../../src/lib/follow-up-queue";

// Default on a new case is "Pending": nobody has sent it, so it must not read "Sent".
for (const v of ["Pending", "pending", "Not Set", "Not Sent", "", "-", "  "]) {
  assert.equal(lienFollowUpStage(v), "Not sent yet", v);
}
assert.equal(lienFollowUpStage("Requested"), "Requested, waiting for received");
assert.equal(lienFollowUpStage("REQUESTED"), "Requested, waiting for received");
assert.equal(lienFollowUpStage("10/01/2026 Requested"), "Requested, waiting for received");
assert.equal(lienFollowUpStage("Sent"), "Sent, waiting for received");
assert.equal(lienFollowUpStage("Received"), "");
assert.equal(lienFollowUpStage("RECEIVED"), "");
console.log("lien follow-up stage OK");
