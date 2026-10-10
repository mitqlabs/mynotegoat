/**
 * Regression test for the lost-close race (Checked Out visit, note still open).
 * Mock writer only: no network, no database.
 *
 * Run:  npx tsx scripts/tests/note-save-race.test.ts
 */
import assert from "node:assert/strict";
import { createNoteWriteQueue } from "../../src/lib/note-write-queue";

type Note = { id: string; signed: boolean; text: string; updatedAt: string };

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
let stamp = Date.parse("2026-10-05T23:08:00Z");
const nextStamp = () => new Date((stamp += 1000)).toISOString();

/** A fake cloud table + an upsert that can be slowed down or made to fail. */
function fakeCloud() {
  const rows = new Map<string, Note>();
  const log: string[] = [];
  let failNext = 0;
  let delayMs = 0;
  return {
    rows,
    log,
    failNextWrites(n: number) {
      failNext = n;
    },
    setDelay(ms: number) {
      delayMs = ms;
    },
    async upsert(note: Note) {
      await tick(delayMs);
      if (failNext > 0) {
        failNext--;
        log.push(`FAIL ${note.id} signed=${note.signed}`);
        throw new Error("Failed to fetch");
      }
      rows.set(note.id, { ...note });
      log.push(`OK   ${note.id} signed=${note.signed}`);
    },
  };
}

// ── The OLD algorithm, copied in miniature, to show the bug is real ──
function oldDualWrite(cloud: ReturnType<typeof fakeCloud>) {
  let previous = new Map<string, Note>();
  let inFlight: Promise<void> | null = null;
  let queued: { records: Note[]; prev: Map<string, Note> } | null = null;
  const runOnce = async (records: Note[], prev: Map<string, Note>) => {
    const changed = records.filter((n) => JSON.stringify(prev.get(n.id)) !== JSON.stringify(n));
    await Promise.allSettled(changed.map((n) => cloud.upsert(n)));
  };
  const serialized = (records: Note[], prev: Map<string, Note>): Promise<void> => {
    if (inFlight) {
      queued = { records, prev }; // REPLACES whatever was queued
      return inFlight;
    }
    const start = (a: { records: Note[]; prev: Map<string, Note> }): Promise<void> =>
      runOnce(a.records, a.prev).finally(() => {
        const n = queued;
        queued = null;
        inFlight = n ? start(n) : null;
      });
    inFlight = start({ records, prev });
    return inFlight;
  };
  return {
    save(records: Note[]) {
      void serialized(records, previous);
      previous = new Map(records.map((n) => [n.id, n])); // advanced BEFORE the write lands
    },
    idle: async () => {
      while (inFlight) await inFlight;
    },
  };
}

async function main() {
  const results: string[] = [];
  const pass = (name: string) => {
    results.push(`PASS  ${name}`);
  };

  // ── 1. Reproduce the bug with the old algorithm ──
  {
    const cloud = fakeCloud();
    const old = oldDualWrite(cloud);
    const base: Note = { id: "enc-1", signed: false, text: "S/O/A", updatedAt: nextStamp() };
    cloud.rows.set(base.id, { ...base });
    cloud.setDelay(30);
    const edit = { ...base, text: "S/O/A edited", updatedAt: nextStamp() };
    old.save([edit]); // write #1 in flight (slow)
    const closed = { ...edit, signed: true, updatedAt: nextStamp() };
    old.save([closed]); // queued
    const other: Note = { id: "enc-2", signed: false, text: "another note", updatedAt: nextStamp() };
    old.save([closed, other]); // replaces the queued save; its diff no longer contains enc-1
    await old.idle();
    assert.equal(cloud.rows.get("enc-1")?.signed, false, "old algorithm should lose the close");
    pass("OLD algorithm: edit + Close + one more save while a write is in flight → close LOST (bug reproduced)");

    const cloud2 = fakeCloud();
    const old2 = oldDualWrite(cloud2);
    cloud2.rows.set(base.id, { ...base });
    cloud2.failNextWrites(1);
    old2.save([{ ...base, signed: true, updatedAt: nextStamp() }]);
    await old2.idle();
    // The next autosave (an edit to another note) carries the same closed copy,
    // but the old diff thinks it was already saved, so it's never retried.
    const closedAgain = { ...base, signed: true, updatedAt: stamp ? new Date(stamp).toISOString() : "" };
    old2.save([closedAgain, { id: "enc-3", signed: false, text: "other", updatedAt: nextStamp() }]);
    await old2.idle();
    assert.equal(cloud2.rows.get("enc-1")?.signed, false);
    pass("OLD algorithm: one failed write → close never retried (bug reproduced)");
  }

  // ── 2. Same race with the new queue: close persists ──
  {
    const cloud = fakeCloud();
    const timers: Array<() => void> = [];
    const q = createNoteWriteQueue<Note>({
      write: (n) => cloud.upsert(n),
      setTimer: (fn) => timers.push(fn),
    });
    const base: Note = { id: "enc-1", signed: false, text: "S/O/A", updatedAt: nextStamp() };
    cloud.rows.set(base.id, { ...base });
    q.setConfirmed([base]);
    cloud.setDelay(30);

    const edit = { ...base, text: "S/O/A edited", updatedAt: nextStamp() };
    q.enqueue([edit]); // in flight
    const closed = { ...edit, signed: true, updatedAt: nextStamp() };
    q.enqueue([closed]); // rapid second save
    const other: Note = { id: "enc-2", signed: false, text: "another note", updatedAt: nextStamp() };
    cloud.failNextWrites(0);
    q.enqueue([closed, other]); // third save while the first is still in flight
    // Make the close's first attempt fail.
    await tick(35); // first write (edit) lands
    cloud.failNextWrites(1);
    await tick(80);
    assert.equal(cloud.rows.get("enc-1")?.signed, false, "first close attempt failed as simulated");
    assert.ok(timers.length > 0, "a retry was scheduled");
    timers.shift()!();
    await tick(80);
    assert.equal(cloud.rows.get("enc-1")?.signed, true, "close persisted after retry");
    assert.equal(cloud.rows.get("enc-1")?.text, "S/O/A edited", "edit persisted too");
    assert.equal(cloud.rows.get("enc-2")?.text, "another note");
    assert.equal(q.pendingCount(), 0);
    pass("NEW queue: two rapid saves + a third save + a FAILED write → close persists after retry");
  }

  // ── 3. saveNow waits for that exact version; check-out only after it lands ──
  {
    const cloud = fakeCloud();
    const timers: Array<() => void> = [];
    const q = createNoteWriteQueue<Note>({ write: (n) => cloud.upsert(n), setTimer: (fn) => timers.push(fn) });
    const base: Note = { id: "enc-9", signed: false, text: "x", updatedAt: nextStamp() };
    q.setConfirmed([base]);
    cloud.failNextWrites(1);
    const closed = { ...base, signed: true, updatedAt: nextStamp() };
    let appointmentStatus = "Check In";
    const ok1 = await q.saveNow(closed);
    if (ok1) appointmentStatus = "Check Out";
    assert.equal(ok1, false);
    await tick(0);
    assert.equal(appointmentStatus, "Check In", "not checked out when the close write failed");
    timers.shift()!(); // background retry
    await tick(20);
    assert.equal(cloud.rows.get("enc-9")?.signed, true, "background retry still lands the close");
    const ok2 = await q.saveNow(closed);
    assert.equal(ok2, true, "already confirmed → resolves true");
    pass("NEW saveNow: failed close → no check-out; background retry lands it; retry click succeeds");
  }

  // ── 4. Never write an older copy after a newer one (stale hook instance) ──
  {
    const cloud = fakeCloud();
    const q = createNoteWriteQueue<Note>({
      write: (n) => cloud.upsert(n),
      shouldSkip: (latest, next, local) =>
        Boolean(latest && local && Date.parse(next.updatedAt) < Date.parse(latest.updatedAt)),
    });
    const base: Note = { id: "enc-5", signed: false, text: "x", updatedAt: nextStamp() };
    q.setConfirmed([base]);
    const closed = { ...base, signed: true, updatedAt: nextStamp() };
    await q.saveNow(closed);
    q.enqueue([base]); // a stale copy from another hook instance
    await tick(10);
    assert.equal(cloud.rows.get("enc-5")?.signed, true, "stale unsigned copy was not pushed over the close");
    pass("NEW queue: a stale (older) copy from another component can't reopen a closed note");
  }

  // ── 5. Unchanged notes are not re-sent; changed ones are merged per id ──
  {
    const cloud = fakeCloud();
    const q = createNoteWriteQueue<Note>({ write: (n) => cloud.upsert(n) });
    const notes: Note[] = Array.from({ length: 50 }, (_, i) => ({
      id: `n${i}`,
      signed: true,
      text: "t",
      updatedAt: nextStamp(),
    }));
    q.setConfirmed(notes);
    q.enqueue(notes);
    await tick(5);
    assert.equal(cloud.log.length, 0, "nothing re-sent when unchanged");
    const changed = { ...notes[3], text: "t2", updatedAt: nextStamp() };
    q.enqueue([...notes.slice(0, 3), changed, ...notes.slice(4)]);
    q.enqueue([...notes.slice(0, 3), { ...changed, text: "t3" }, ...notes.slice(4)]);
    await tick(20);
    assert.equal(cloud.rows.get("n3")?.text, "t3");
    assert.ok(cloud.log.length <= 2, `only the changed note was written (${cloud.log.length} writes)`);
    pass("NEW queue: unchanged notes skipped; rapid edits to one note merged (≤2 writes, latest wins)");
  }

  console.log(results.join("\n"));
  console.log(`\n${results.length} passed, 0 failed (mock cloud only, 0 DB writes)`);
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
