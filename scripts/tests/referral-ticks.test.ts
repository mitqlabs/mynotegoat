import assert from "node:assert/strict";
import { mergeTicks, parseTicks, referralTicksCloudKey, sameTicks, setTick, tickedKeys, ticksFromSafetyBackup } from "../../src/lib/referral-ticks";

// Mock data only. Regression: referral ticks lived only in this browser and
// were wiped on sign-out / workspace switch with no cloud copy to restore.

const legacy = parseTicks(["mock imaging::P1", "mock imaging::P2", 5, ""]);
assert.deepEqual([...tickedKeys(legacy)].sort(), ["mock imaging::P1", "mock imaging::P2"]);

// Stale remote (fewer ticks) never drops local ticks.
let local = setTick(legacy, "mock imaging::P3", true, 1000);
const staleRemote = parseTicks(["mock imaging::P1"]);
let merged = mergeTicks(staleRemote, local);
assert.equal(tickedKeys(merged).size, 3, "stale echo can't drop ticks");

// Newest change wins per tick: untick on computer B later beats old tick on A.
const b = setTick(merged, "mock imaging::P2", false, 2000);
merged = mergeTicks(local, b);
assert.equal(tickedKeys(merged).has("mock imaging::P2"), false, "later untick propagates");
// Tick again later on A wins over B's untick.
local = setTick(merged, "mock imaging::P2", true, 3000);
assert.equal(tickedKeys(mergeTicks(b, local)).has("mock imaging::P2"), true);
// Tie → ticked wins.
assert.equal(mergeTicks({ k: { on: false, at: 5 } }, { k: { on: true, at: 5 } }).k.on, true);
// setTick always advances time even if clock is behind.
assert.ok(setTick({ k: { on: true, at: 9000 } }, "k", false, 10).k.at > 9000);
// Order-independent merge.
assert.ok(sameTicks(mergeTicks(local, b, staleRemote), mergeTicks(staleRemote, b, local)));

// Safety-backup recovery only adds ticks.
const backup = JSON.stringify({ backedUpAt: "x", snapshot: { "casemate.referral-checked.v1": JSON.stringify(["mock imaging::P9"]) } });
assert.deepEqual(ticksFromSafetyBackup(backup), { "mock imaging::P9": { on: true, at: 0 } });
assert.deepEqual(ticksFromSafetyBackup(null), {});
assert.deepEqual(ticksFromSafetyBackup("garbage"), {});

assert.equal(referralTicksCloudKey("u1"), "casemate.referral-checked.v2.u.u1");
console.log("referral-ticks: ok");
