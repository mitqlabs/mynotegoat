import assert from "node:assert/strict";
import { runPool, splitByChunkCache, withStallWatchdog, emitBootProgress, withBootLock } from "../../src/lib/boot-progress";
import { createNoteWriteQueue } from "../../src/lib/note-write-queue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. Pool never exceeds the limit and keeps order.
  let inFlight = 0, peak = 0;
  const tasks = Array.from({ length: 30 }, (_, i) => async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    await sleep(5); inFlight--; return i;
  });
  const prog: number[] = [];
  const out = await runPool(tasks, 5, (d) => prog.push(d));
  assert.equal(peak, 5);
  assert.deepEqual(out, Array.from({ length: 30 }, (_, i) => i));
  assert.equal(prog.at(-1), 30);
  // A failed chunk fails the whole download (falls back, never half-loads).
  assert.equal(await runPool([async () => 1, async () => null, async () => 3], 2), null);

  // 2. Resume cache reuses a row ONLY when the cloud stamp is unchanged.
  const cache = new Map([
    ["a", { stamp: "t1", row: { id: "a", v: "cloud-a" } }],
    ["b", { stamp: "t1", row: { id: "b", v: "old-b" } }],
  ]);
  const stamps = new Map([["a", "t1"], ["b", "t2"], ["c", "t1"]]);
  const split = splitByChunkCache(["a", "b", "c"], stamps, cache);
  assert.deepEqual(split.reused.map((r) => r.id), ["a"]);
  assert.deepEqual(split.toFetch, ["b", "c"]); // b changed in cloud, c never cached

  // 3. Watchdog waits while progress continues, fails only on a stall.
  const slow = (async () => { for (let i = 0; i < 6; i++) { await sleep(20); emitBootProgress({ phase: "notes", done: i, total: 6 }); } return "ok"; })();
  assert.equal(await withStallWatchdog(slow, 50, () => new Error("stall")), "ok");
  await assert.rejects(withStallWatchdog(new Promise(() => {}), 30, () => new Error("stall")), /stall/);

  // 4. No Web Locks (node): withBootLock just runs.
  assert.equal(await withBootLock("ws", async () => 7), 7);

  // 5. Root cause regression: cloud rows marked confirmed are NOT re-uploaded;
  //    an edited one still is.
  const writes: string[] = [];
  const q = createNoteWriteQueue<{ id: string; body: string }>({ write: async (r) => { writes.push(r.id); } });
  const cloudRows = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, body: "x" }));
  q.setConfirmed(cloudRows);
  const edited = cloudRows.map((r) => (r.id === "n7" ? { ...r, body: "edited" } : { ...r }));
  q.enqueue(edited);
  await sleep(20);
  assert.deepEqual(writes, ["n7"]);
  console.log("boot-progress: all tests passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
