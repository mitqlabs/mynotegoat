/**
 * Settings "Save to Cloud": really writes this device's unconfirmed changes, never overwrites newer
 * cloud data, reports failures. Mock cloud only.
 * Run:  npx tsx scripts/tests/settings-push.test.ts
 */
import assert from "node:assert/strict";
import { pushPendingSettings, type SettingsPushDeps } from "../../src/lib/settings-push";

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => { await fn(); passed++; console.log(`ok - ${name}`); };

const T0 = Date.parse("2026-10-27T20:00:00Z"); // when this device changed things
const iso = (ms: number) => new Date(ms).toISOString();

function harness(opts: {
  local: Record<string, unknown>;
  dirty: string[];
  cloud: Record<string, { value: unknown; updatedAt: string }>;
  held?: number;
  notReady?: string;
  failUpsertFor?: string;
  dropWrites?: boolean; // cloud silently ignores writes
}) {
  const cloud = new Map(Object.entries(opts.cloud));
  const dirty = new Map(opts.dirty.map((k) => [k, T0] as [string, number]));
  const writes: string[] = [];
  const deps: SettingsPushDeps = {
    notReady: () => opts.notReady ?? null,
    dirtyKeys: () => new Map(dirty),
    localRaw: (k) => (k in opts.local ? JSON.stringify(opts.local[k]) : null),
    fetchCloud: async (keys) => new Map(keys.filter((k) => cloud.has(k)).map((k) => [k, cloud.get(k)!])),
    upsert: async (k, v) => {
      if (opts.failUpsertFor === k) throw new Error("network down");
      writes.push(k);
      if (!opts.dropWrites) cloud.set(k, { value: JSON.parse(JSON.stringify(v)), updatedAt: iso(T0 + 60_000) });
    },
    flushHeldWrites: async () => opts.held ?? 0,
    markClean: (k) => { dirty.delete(k); },
  };
  return { deps, cloud, dirty, writes };
}

async function main() {
  await test("writes a changed setting that the cloud doesn't have", async () => {
    const h = harness({ local: { "casemate.a": { x: 1 } }, dirty: ["casemate.a"], cloud: {} });
    const r = await pushPendingSettings(h.deps);
    assert.deepEqual(r.pushed, ["casemate.a"]);
    assert.deepEqual(h.cloud.get("casemate.a")?.value, { x: 1 });
    assert.equal(h.dirty.size, 0);
  });

  await test("overwrites an OLDER cloud copy (cloud not touched since our change)", async () => {
    const h = harness({
      local: { "casemate.case-statuses.v1": { complianceEnabled: true } }, dirty: ["casemate.case-statuses.v1"],
      cloud: { "casemate.case-statuses.v1": { value: { complianceEnabled: false }, updatedAt: iso(T0 - 3_600_000) } },
    });
    const r = await pushPendingSettings(h.deps);
    assert.deepEqual(r.pushed, ["casemate.case-statuses.v1"]);
    assert.deepEqual(h.cloud.get("casemate.case-statuses.v1")?.value, { complianceEnabled: true });
  });

  await test("does NOT overwrite a cloud copy another device saved after our change", async () => {
    const h = harness({
      local: { "casemate.k": { v: "mine" } }, dirty: ["casemate.k"],
      cloud: { "casemate.k": { value: { v: "theirs" }, updatedAt: iso(T0 + 120_000) } },
    });
    const r = await pushPendingSettings(h.deps);
    assert.deepEqual(r.pushed, []);
    assert.deepEqual(r.keptNewerCloud, ["casemate.k"]);
    assert.deepEqual(h.cloud.get("casemate.k")?.value, { v: "theirs" });
    assert.equal(h.writes.length, 0);
  });

  await test("savedAt blobs: newer savedAt wins in both directions", async () => {
    const h = harness({
      local: { "casemate.office.a": { name: "L", savedAt: 200 }, "casemate.office.b": { name: "L", savedAt: 100 } },
      dirty: ["casemate.office.a", "casemate.office.b"],
      cloud: {
        // cloud row timestamps are irrelevant when savedAt exists on both sides
        "casemate.office.a": { value: { name: "C", savedAt: 100 }, updatedAt: iso(T0 + 999_000) },
        "casemate.office.b": { value: { name: "C", savedAt: 200 }, updatedAt: iso(T0 - 999_000) },
      },
    });
    const r = await pushPendingSettings(h.deps);
    assert.deepEqual(r.pushed, ["casemate.office.a"]);
    assert.deepEqual(r.keptNewerCloud, ["casemate.office.b"]);
    assert.equal((h.cloud.get("casemate.office.b")?.value as { name: string }).name, "C");
  });

  await test("only writes keys this device changed; ignores everything else", async () => {
    const h = harness({
      local: { "casemate.mine": { a: 1 }, "casemate.stale-copy": { old: true } }, dirty: ["casemate.mine"],
      cloud: { "casemate.stale-copy": { value: { old: false }, updatedAt: iso(T0 + 5_000) } },
    });
    await pushPendingSettings(h.deps);
    assert.deepEqual(h.writes, ["casemate.mine"]);
    assert.deepEqual(h.cloud.get("casemate.stale-copy")?.value, { old: false });
  });

  await test("identical cloud value → no write, marked clean, key order ignored", async () => {
    const h = harness({
      local: { "casemate.k": { a: 1, b: { c: 2 } } }, dirty: ["casemate.k"],
      cloud: { "casemate.k": { value: { b: { c: 2 }, a: 1 }, updatedAt: iso(T0 - 1) } },
    });
    const r = await pushPendingSettings(h.deps);
    assert.equal(h.writes.length, 0);
    assert.equal(r.alreadySaved, 1);
    assert.equal(h.dirty.size, 0);
  });

  await test("nothing pending → clean no-op (no cloud reads or writes needed)", async () => {
    const h = harness({ local: {}, dirty: [], cloud: {} });
    const r = await pushPendingSettings(h.deps);
    assert.deepEqual(r, { pushed: [], keptNewerCloud: [], alreadySaved: 0 });
  });

  await test("a failed write is reported (so the button turns red + Retry) and stays pending", async () => {
    const h = harness({ local: { "casemate.k": { a: 1 } }, dirty: ["casemate.k"], cloud: {}, failUpsertFor: "casemate.k" });
    await assert.rejects(pushPendingSettings(h.deps), /network down/);
    assert.equal(h.dirty.has("casemate.k"), true);
    // retry after the connection returns
    const h2 = harness({ local: { "casemate.k": { a: 1 } }, dirty: ["casemate.k"], cloud: {} });
    assert.deepEqual((await pushPendingSettings(h2.deps)).pushed, ["casemate.k"]);
  });

  await test("held (failed earlier) writes still waiting → error, nothing claimed saved", async () => {
    const h = harness({ local: { "casemate.k": { a: 1 } }, dirty: ["casemate.k"], cloud: {}, held: 2 });
    await assert.rejects(pushPendingSettings(h.deps), /2 changes are still waiting/);
  });

  await test("not signed in / no workspace → error, no false success", async () => {
    const h = harness({ local: { "casemate.k": { a: 1 } }, dirty: ["casemate.k"], cloud: {}, notReady: "not signed in" });
    await assert.rejects(pushPendingSettings(h.deps), /not signed in/);
  });

  await test("read-back catches a write the cloud silently dropped", async () => {
    const h = harness({ local: { "casemate.k": { a: 1 } }, dirty: ["casemate.k"], cloud: {}, dropWrites: true });
    await assert.rejects(pushPendingSettings(h.deps), /didn't confirm 1 setting/);
    assert.equal(h.dirty.has("casemate.k"), true);
  });

  await test("two keys: one conflict + one push in the same click", async () => {
    const h = harness({
      local: { "casemate.a": { n: 1 }, "casemate.b": { n: 1 } }, dirty: ["casemate.a", "casemate.b"],
      cloud: { "casemate.b": { value: { n: 9 }, updatedAt: iso(T0 + 30_000) } },
    });
    const r = await pushPendingSettings(h.deps);
    assert.deepEqual(r.pushed, ["casemate.a"]);
    assert.deepEqual(r.keptNewerCloud, ["casemate.b"]);
  });

  console.log(`\n${passed} passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
