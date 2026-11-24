import assert from "node:assert/strict";
import { cloudBackingFor, isMirroredUserKey } from "../../src/lib/cloud-key-registry";
import { mergePrefs, prefsToRestore, syncUserPrefs } from "../../src/lib/user-prefs-cloud";

// Mock data only.
const a = { "casemate.contacts-sort.v1": { v: '{"key":"name"}', at: 100 }, "casemate.sidebar-collapsed": { v: "1", at: 50 } };
const b = { "casemate.contacts-sort.v1": { v: '{"key":"category"}', at: 200 }, "notegoat.sort.encounters-page": { v: "x", at: 10 } };
const m = mergePrefs(a, b);
assert.equal(m["casemate.contacts-sort.v1"].v, '{"key":"category"}', "newest wins");
assert.equal(Object.keys(m).length, 3, "nothing dropped");
assert.deepEqual(mergePrefs(b, a), m, "order-independent");
assert.deepEqual(mergePrefs({ bad: { v: 1 as unknown as string, at: 1 } }), {});

assert.equal(cloudBackingFor("casemate.cloud-sync-at.abc"), "system");
assert.equal(cloudBackingFor("notegoat.goat-chat.v1:patient-1"), "user");
assert.equal(cloudBackingFor("casemate.not-registered"), null);
assert.equal(isMirroredUserKey("casemate.contacts-sort.v1"), true);
assert.equal(isMirroredUserKey("casemate.referral-checked.v2"), false, "ticks have their own merge");
assert.equal(isMirroredUserKey("casemate.patient-billing.v1"), false, "workspace data not mirrored per user");
assert.equal(cloudBackingFor("casemate.sidebar-launch.v1"), "system", "tab launch flag is not practice data");
assert.equal(isMirroredUserKey("casemate.sidebar-launch.v1"), false);

const ORDER = "casemate.sidebar-order.v1";
const orderValue = '["caseList","patients"]';
const mirror = { [ORDER]: { v: orderValue, at: 100 } };
const stored = (map: Record<string, string>) => (key: string) => map[key] ?? null;

// The live key was wiped; the mirror still has the same timestamp. Restore it.
assert.deepEqual(
  prefsToRestore(stored({}), mirror, mirror),
  [{ key: ORDER, value: orderValue }],
  "missing key restores when the mirror timestamp matches",
);
// Same value already in localStorage: do not write again.
assert.deepEqual(prefsToRestore(stored({ [ORDER]: orderValue }), mirror, mirror), []);
// A different live value is replaced when the merged copy is equally new.
assert.deepEqual(
  prefsToRestore(stored({ [ORDER]: '["patients"]' }), mirror, mirror),
  [{ key: ORDER, value: orderValue }],
);
// A newer mirror entry is not overwritten by an older merged copy.
const older = { [ORDER]: { v: '["patients"]', at: 50 } };
assert.deepEqual(prefsToRestore(stored({ [ORDER]: orderValue }), mirror, older), []);
// No mirror entry at all: still restore.
assert.deepEqual(prefsToRestore(stored({}), {}, mirror), [{ key: ORDER, value: orderValue }]);
// A newer merged copy wins over the mirror.
const newer = { [ORDER]: { v: '["contacts","patients"]', at: 200 } };
assert.deepEqual(
  prefsToRestore(stored({ [ORDER]: orderValue }), mirror, newer),
  [{ key: ORDER, value: '["contacts","patients"]' }],
);

async function main() {
  // The real sync, with no cloud configured: a wiped key comes back from the mirror.
  const mem = new Map<string, string>();
  mem.set(
    "casemate.user-prefs-mirror.v1",
    JSON.stringify({ [ORDER]: { v: orderValue, at: 100 } }),
  );
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mem.set(key, value);
      },
    },
  };
  try {
    await syncUserPrefs();
    assert.equal(mem.get(ORDER), orderValue, "sync restores a wiped key from the mirror");
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previousWindow;
  }
  console.log("user-prefs-cloud: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
