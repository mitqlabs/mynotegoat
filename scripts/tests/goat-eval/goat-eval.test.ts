/**
 * G.O.A.T. eval: questions that failed on the live site, answered by the rules from
 * mock files (expected-fact checks), plus what + mode is given (timeline + facts).
 * No network, no model, mock data only.
 *
 * Run:  npx tsx scripts/tests/goat-eval/goat-eval.test.ts
 */
import assert from "node:assert/strict";
import { askGoat } from "../../../src/lib/goat";
import { extractFileFacts } from "../../../src/lib/goat-facts";
import { factsForFiles, patientsToEvict, __resetFactsMemForTest } from "../../../src/lib/goat-facts-store";
import { buildTimeline, compactTimeline } from "../../../src/lib/goat-timeline";
import { buildFactSources } from "../../../src/lib/goat-ai/fact-sources";
import { buildSystemPrompt } from "../../../src/lib/goat-ai/prompt";
import { defaultModelFor } from "../../../src/lib/goat-ai/engine";
import { bookingReply, isBookingRequest } from "../../../src/lib/goat-howto";
import { FILES, mockContext } from "./mock-patient";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function evalCase(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: (e as Error).message.split("\n")[0] }); }
}
const ctx = mockContext();
const text = (q: string) => askGoat(ctx, q).answers.map((a) => [...a.lines, ...(a.groups ?? []).flatMap((g) => [g.lead, ...g.blocks.flatMap((b) => b.items)])].join("\n")).join("\n");
const has = (t: string, ...want: string[]) => want.forEach((w) => assert.ok(t.toLowerCase().includes(w.toLowerCase()), `missing "${w}" in: ${t.slice(0, 300)}`));

// --- facts ---------------------------------------------------------------
evalCase("facts: PM report", () => {
  const f = extractFileFacts(FILES[1]);
  assert.equal(f.docType, "specialist report");
  assert.equal(f.doctor, "Dr. Jane Mockerton");
  assert.equal(f.specialty, "pain management");
  assert.equal(f.mainDate, "02/25/2026");
  assert.ok(f.rom.length >= 3, f.rom.join("|"));
  assert.ok(f.recommendations.some((r) => /epidural steroid injection at L4-L5/.test(r)));
  assert.ok(f.diagnoses.some((d) => /M54\.2/.test(d)));
  assert.ok(f.medications.some((m) => /Ibuprofen 600 mg/.test(m)));
  assert.ok(f.followUp.some((m) => /4 weeks/.test(m)));
  assert.ok(f.dates.some((d) => d.label === "injury" || d.label === "visit"));
});
evalCase("facts: referral + XR", () => {
  const r = extractFileFacts(FILES[0]);
  assert.equal(r.docType, "referral");
  assert.ok(r.dates.some((d) => d.label === "referral" && d.date === "01/20/2026"));
  assert.ok(r.dates.some((d) => d.label === "injury" && d.date === "12/01/2025"));
  const x = extractFileFacts(FILES[2]);
  assert.equal(x.docType, "xray");
  assert.equal(x.mainDate, "12/10/2025");
  assert.ok(x.impressions.some((i) => /Straightening/.test(i)));
});
evalCase("facts: cached by id + hash, re-run when the file changes", () => {
  __resetFactsMemForTest();
  const a = factsForFiles(FILES)[2];
  assert.equal(factsForFiles(FILES)[2], a, "same object from cache");
  const changed = { ...FILES[2], pages: [FILES[2].pages![0].replace("12/10/2025", "12/11/2025")] };
  assert.equal(factsForFiles([changed])[0].mainDate, "12/11/2025");
});
evalCase("storage: least recently used patients evicted first", () => {
  const ps = [{ patientId: "a", lastUsed: 3, bytes: 100 }, { patientId: "b", lastUsed: 1, bytes: 100 }, { patientId: "c", lastUsed: 2, bytes: 100 }];
  assert.deepEqual(patientsToEvict(ps, { usage: 950, quota: 1000 }), ["b", "c"]);
  assert.deepEqual(patientsToEvict(ps, { usage: 850, quota: 1000 }), ["b"]);
  assert.deepEqual(patientsToEvict(ps, { usage: 100, quota: 1000 }), []);
  assert.deepEqual(patientsToEvict(ps, { usage: 0, quota: 0, maxPatients: 2 }), ["b"]);
  assert.deepEqual(patientsToEvict(ps, { usage: 990, quota: 1000, keep: "b" }), ["c", "a"]);
});

// --- questions that failed --------------------------------------------------
evalCase("referral + visit to PM", () => {
  const t = text("when was kara referred to pm and when did he go");
  has(t, "referred to pain management", "Dr. Jane Mockerton", "01/20/2026", "seen on 02/25/2026");
});
evalCase("XR date and findings", () => {
  const t = text("when was the xray done and what did it show");
  has(t, "12/10/2025", "Straightening of the cervical lordosis");
});
evalCase("PM appt date + ROM + recommendations", () => {
  const t = text("when was her pm appointment and what was the rom and recs");
  has(t, "02/25/2026", "Cervical flexion 35 degrees", "epidural steroid injection at L4-L5", "Follow up in 4 weeks");
});
evalCase("next visit", () => {
  const t = text("when is her next visit");
  has(t, "10/15/2026", "PI Re-Exam");
});
evalCase("scheduling intent", () => {
  assert.ok(isBookingRequest("book kara an appointment friday"));
  const r = bookingReply("book kara an appointment friday", "2026-10-12", "Kara Testpatient");
  has(r.text, "Kara Testpatient");
  assert.ok(r.links.length > 0);
});
evalCase("two-part question", () => {
  const r = askGoat(ctx, "when was the xray and when is the next visit");
  const t = r.answers.map((a) => a.lines.join(" ")).join("\n");
  has(t, "12/10/2025", "10/15/2026");
  assert.equal(r.sourcesCollapsed, true);
});
evalCase("missing data is said plainly", () => {
  const t = text("when was kara seen by ortho");
  assert.ok(!/02\/25\/2026/.test(t), "must not borrow the PM date for ortho");
});

// --- what + mode gets ----------------------------------------------------------
evalCase("+ mode: timeline + relevant facts, no raw excerpts", () => {
  const tl = compactTimeline(buildTimeline(ctx, factsForFiles(ctx.files)));
  has(tl, "12/01/2025", "01/20/2026", "02/25/2026", "12/10/2025", "10/15/2026");
  const src = buildFactSources(ctx, "what did pm recommend", []);
  assert.equal(src[0].title, "Patient timeline");
  const pm = src.find((s) => s.fileId === "f-pm");
  assert.ok(pm, src.map((s) => s.title).join(" | "));
  const body = pm!.lines.map((l) => l.text).join("\n");
  has(body, "recommendations:", "epidural");
  assert.ok(!/HISTORY: Neck and low back pain after MVA/.test(body), "facts, not raw text");
});
evalCase("+ mode prompt: warm direct answer, follow-ups, never invent", () => {
  const p = buildSystemPrompt({ showCosts: true, regionOrder: ["Cervical", "Lumbar"] }, ["visit"]);
  has(p, "one or two warm", "You could also ask", "Never guess or invent", "say plainly what's missing", "Earlier turns");
});
evalCase("model default: accurate when the device can hold it", () => {
  assert.equal(defaultModelFor({ maxBufferMb: 4096, freeMb: 10000 }), "accurate");
  assert.equal(defaultModelFor({ maxBufferMb: 256, freeMb: 10000 }), "fast");
  assert.equal(defaultModelFor({ maxBufferMb: 4096, freeMb: 1000 }), "fast");
});

const passed = results.filter((r) => r.ok).length;
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.err ? ` — ${r.err}` : ""}`);
console.log(`\nG.O.A.T. eval: ${passed}/${results.length} passed`);
if (passed !== results.length) process.exit(1);
