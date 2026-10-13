// Regression (2026-10-13): Close & Check Out stuck on "Closing…" while a big
// background batch / a hung request held the note write queue. Mock cloud only.
import assert from "node:assert/strict";
import { createNoteWriteQueue } from "../../src/lib/note-write-queue";

type Note = { id: string; text: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const pass = (m: string) => { passed++; console.log("PASS ", m); };

async function main() {
  // 1. saveNow jumps ahead of a 2,000-note background batch.
  {
    const order: string[] = [];
    const q = createNoteWriteQueue<Note>({ write: async (n) => { await sleep(2); order.push(n.id); }, setTimer: () => 0 });
    q.enqueue(Array.from({ length: 2000 }, (_, i) => ({ id: `bg-${i}`, text: "x" })));
    await sleep(5);
    const t0 = Date.now();
    const ok = await q.saveNow({ id: "close-me", text: "signed" });
    assert.equal(ok, true);
    assert.ok(Date.now() - t0 < 500, `saveNow waited ${Date.now() - t0}ms behind the batch`);
    assert.ok(order.indexOf("close-me") < 50, "close written near the front");
    pass("saveNow is not stuck behind a big background batch");
    await q.flush();
    assert.equal(q.pendingCount(), 0);
    assert.equal(order.length, 2001, "every background note still written");
    pass("background batch still fully written");
  }
  // 2. One hung request times out; nothing else stalls; the hung note is retried, not lost.
  {
    const timers: Array<() => void> = [];
    const written = new Map<string, string>();
    let hangOnce = true;
    const q = createNoteWriteQueue<Note>({
      writeTimeoutMs: 50,
      setTimer: (fn) => timers.push(fn),
      write: (n) => {
        if (n.id === "hung" && hangOnce) { hangOnce = false; return new Promise<void>(() => {}); }
        written.set(n.id, n.text); return Promise.resolve();
      },
    });
    q.enqueue([{ id: "hung", text: "a" }, ...Array.from({ length: 16 }, (_, i) => ({ id: `n${i}`, text: "b" }))]);
    const ok = await q.saveNow({ id: "close-me", text: "signed" });
    assert.equal(ok, true, "close lands despite a hung request");
    await sleep(100);
    assert.equal(written.size, 17, "16 others + close written");
    assert.ok(timers.length > 0, "retry scheduled for the hung note");
    assert.equal(q.pendingCount(), 1, "hung note kept in the queue, not dropped");
    timers.shift()!();
    await sleep(20);
    assert.equal(written.get("hung"), "a");
    assert.equal(q.pendingCount(), 0);
    pass("hung write times out, is retried and lands; other saves unaffected");
  }
  console.log(`\n${passed} passed, 0 failed (mock cloud only, 0 DB writes)`);
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });
