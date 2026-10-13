/**
 * "when was karen referred to pm and when did he go, what was the ROM and recs" (mock text):
 * referral + visit + ROM + recs in one answer; ROM as whole sentences per region (wrapped PDF
 * lines joined), regions in the office order; + mode parts enforced / backfilled; ROM shown from facts.
 *
 * Run:  npx tsx scripts/tests/goat-eval/multipart-rom.test.ts
 */
import assert from "node:assert/strict";
import { askGoat } from "../../../src/lib/goat";
import { goatPeople } from "../../../src/lib/goat-context";
import { extractFileFacts, extractRom, unwrapLines } from "../../../src/lib/goat-facts";
import { backfillParts, partsInstruction, questionParts, romGroupsFrom } from "../../../src/lib/goat-ai/parts";
import { regionRank } from "../../../src/lib/goat-region-order";
import type { GoatFile } from "../../../src/lib/goat-docs";
import { mockContext } from "./mock-patient";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
const evalCase = (name: string, fn: () => void) => { try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: (e as Error).message.split("\n")[0] }); } };
const f = (id: string, name: string, pages: string[]): GoatFile => ({ id, name, folder: "Records", uploaded: "2026-03-01", status: "read", pages } as GoatFile);

// Mock report: ROM written extremity-first, sentences wrapped across PDF lines.
const REPORT = [
  "Patient: Testpatient, Kara | DOB: 07/19/1979 | Sex: F\nProvider: Dr. Mock Haroyan, M.D. | Visit: 02/25/2026 9:15AM | Chart: 000\nCHIEF COMPLAINT: Consultation Visit Kara presents with neck and low back pain.",
  "PHYSICAL EXAMINATION:\nRANGE OF MOTION:\nRight shoulder: abduction 150 degrees with pain, flexion 160 degrees\nwithout pain.\nLumbar spine: flexion 50 degrees with pain, extension 15 degrees with\npain, lateral bending 20 degrees bilaterally.\nCervical spine: flexion 35 degrees with pain, extension 20 degrees with pain,\nrotation 60 degrees bilaterally with pain.\nASSESSMENT: 02/25/2026: Kara is a pleasant 47-year-old.\nRECOMMENDATIONS:\nRecommend cervical medial branch block at C4-C6.\nRecommend lumbar epidural steroid injection at L4-L5.\nFollow up in 6 weeks.",
];
const FILES = [
  f("r", "Specialist Referral - DR. MOCK HAROYAN.pdf", ["REFERRAL\nPatient: Testpatient, Kara\nDate of Referral: 01/14/2026"]),
  f("p", "Specialist Report - DR. MOCK HAROYAN.pdf", REPORT),
];
const people = goatPeople([], [{ name: "MOCK HAROYAN, MD", category: "Specialist", subCategory: "Pain Management" }]);
const ctx = mockContext({ files: FILES, people, specialists: [], termGroups: [], imaging: [], dob: "1979-07-19" });
const Q = "when was kara referred to pm and when did he go, what was the ROM and recs";
const all = (q: string) => askGoat(ctx, q).answers;
const romItems = (q: string) => all(q).flatMap((a) => (a.groups ?? []).filter((g) => /range of motion/i.test(g.lead) || /^range of motion/i.test(a.title)).flatMap((g) => g.blocks.flatMap((b) => [b.heading, ...b.items].filter(Boolean))));

evalCase("wrapped PDF lines are joined; ROM = whole sentences with their region", () => {
  const rom = extractRom(unwrapLines(REPORT[1]));
  assert.ok(rom.includes("Cervical: flexion 35° with pain, extension 20° with pain, rotation 60° bilaterally with pain."), rom.join(" | "));
  assert.ok(rom.some((r) => r.startsWith("Lumbar: flexion 50° with pain, extension 15° with pain, lateral bending 20° bilaterally.")), rom.join(" | "));
  assert.ok(rom.every((r) => /[.)]$/.test(r)), "no line cut mid-sentence: " + rom.join(" | "));
});
evalCase("the exact question: referral date, visit date, ROM and recs together", () => {
  const a = all(Q);
  const text = a.map((x) => x.lines.join(" ")).join(" ");
  assert.match(text, /referred to pain management .*on 01\/14\/2026 and was seen on 02\/25\/2026/, text);
  const rom = romItems(Q).join(" | ");
  assert.match(rom, /Cervical: flexion 35°/);
  const recs = a.flatMap((x) => (x.groups ?? []).filter((g) => /recommend/i.test(g.lead)).flatMap((g) => g.blocks.flatMap((b) => b.items))).join(" | ");
  assert.match(recs, /medial branch block/);
  assert.match(recs, /epidural steroid injection/);
  assert.doesNotMatch(text, /07\/19\/1979/);
});
evalCase("ROM regions in the office order (Cervical, Thoracic, Lumbar, then extremities)", () => {
  for (const q of [Q, "what was the rom and recs from pm", "range of motion and recs from dr haroyan"]) {
    const items = romItems(q);
    assert.ok(items.length, `no ROM for "${q}"`);
    const ranks = items.map((i) => regionRank(i));
    assert.deepEqual([...ranks].sort((x, y) => x - y), ranks, `"${q}": ${items.join(" | ")}`);
  }
  const custom = askGoat({ ...ctx, recFormat: { regionOrder: ["Lumbar", "Cervical", "Shoulder"] } }, Q).answers.flatMap((a) => (a.groups ?? []).flatMap((g) => g.blocks.flatMap((b) => b.items))).filter((i) => /°/.test(i));
  assert.match(custom[0], /^Lumbar/, custom.join(" | "));
});
evalCase("+ mode: every part has a heading; missing parts are added back from the facts", () => {
  const parts = questionParts(Q);
  assert.deepEqual(parts, ["referral", "visit", "rom", "recs"]);
  const ins = partsInstruction(parts, true);
  assert.match(ins, /"Referral date", "Visit date", "Recommendations"/);
  assert.match(ins, /do NOT write ROM numbers/);
  const base = askGoat(ctx, Q).answers;
  const modelText = "Recommendations\n- Cervical medial branch block at C4-C6\n- Lumbar epidural steroid injection at L4-L5";
  const out = backfillParts(modelText, parts, base);
  assert.deepEqual(out.added, ["referral", "visit", "rom"]);
  assert.match(out.text, /Referral date\n- Referred to .*01\/14\/2026/);
  assert.match(out.text, /Visit date\n- Seen on 02\/25\/2026/);
  assert.match(out.text, /Range of motion\n- Cervical: flexion 35°/);
  const ok = backfillParts("Kara was referred on 01/14/2026 and seen on 02/25/2026. ROM: flexion 35° … Recommend cervical medial branch block.", parts, base);
  assert.deepEqual(ok.added, []);
});
evalCase("+ mode: ROM card comes from the extracted facts (exact numbers), not the model", () => {
  const g = romGroupsFrom(askGoat(ctx, Q).answers);
  const items = g.flatMap((x) => x.blocks.flatMap((b) => b.items));
  assert.ok(items[0].startsWith("Cervical: flexion 35° with pain"), items.join(" | "));
});
evalCase("facts: report ROM ordered and complete", () => {
  const fx = extractFileFacts(FILES[1]);
  assert.equal(fx.rom.length, 3, fx.rom.join(" | "));
});

// Live bug: an organization contact in Pain Management must never become the doctor;
// the referral date must be found in form / two-column referral layouts.
const ORG_PEOPLE = goatPeople([], [
  { name: "Active Mock Sports Medicine Clinic", category: "Specialist", subCategory: "Pain Management" },
  { name: "Someone Else Mockdoc", category: "Specialist", subCategory: "Pain Management" },
]);
const REFERRAL_LAYOUTS: Array<[string, string]> = [
  ["two-column, value on the next line (written month)", "SPECIALIST REFERRAL\nDate of Referral: Patient Name:\nJanuary 14, 2026 Testpatient, Kara"],
  ["form, DOB value first", "Date of Referral: DOB: Specialty:\n07/19/1979 01/14/2026 Pain Management"],
  ["value before the label", "01/14/2026\nDate of Referral\nPatient: Testpatient, Kara"],
  ["plain", "Date of Referral: 01/14/2026"],
];
for (const [name, text] of REFERRAL_LAYOUTS) {
  evalCase(`referral date (${name}); doctor from the file, not an org contact`, () => {
    const files = [f("r", "Specialist Referral - DR. MOCK HAROYAN.pdf", [text]), f("p", "Specialist Report - DR. MOCK HAROYAN.pdf", REPORT)];
    const c = mockContext({ files, people: ORG_PEOPLE, specialists: [], termGroups: [], imaging: [], dob: "1979-07-19" });
    const t = askGoat(c, "when was he referred to pm").answers.map((a) => a.lines.join(" ")).join(" ");
    assert.match(t, /referred to pain management \(Dr\. Mock Haroyan\) on 01\/14\/2026/, t);
    assert.doesNotMatch(t, /Dr\. Active|Mockdoc|07\/19\/1979/, t);
  });
}
evalCase("basic G.O.A.T. (no + mode): full multi-part answer with an org contact on file", () => {
  const files = [f("r", "Specialist Referral - DR. MOCK HAROYAN.pdf", [REFERRAL_LAYOUTS[0][1]]), f("p", "Specialist Report - DR. MOCK HAROYAN.pdf", REPORT)];
  const c = mockContext({ files, people: ORG_PEOPLE, specialists: [], termGroups: [], imaging: [], dob: "1979-07-19" });
  const a = askGoat(c, "when was he referred to pm and when did he go, what was the ROM and recs").answers;
  const text = a.map((x) => x.lines.join(" ")).join(" ");
  assert.match(text, /referred to pain management \(Dr\. Mock Haroyan\) on 01\/14\/2026 and was seen on 02\/25\/2026/, text);
  const groups = a.flatMap((x) => x.groups ?? []);
  const rom = groups.filter((g) => /range of motion/i.test(g.lead)).flatMap((g) => g.blocks.flatMap((b) => b.items));
  assert.deepEqual(rom.map((r) => r.split(":")[0]), ["Cervical", "Lumbar", "Shoulder"], rom.join(" | "));
  assert.ok(groups.some((g) => /recommend/i.test(g.lead) && g.blocks.some((b) => b.items.some((i) => /medial branch/.test(i)))));
});
evalCase("an org name is never prefixed with Dr.", () => {
  const c = mockContext({ files: [], people: ORG_PEOPLE, specialists: [{ name: "Active Mock Sports Medicine Clinic", sentDate: "01/10/2026", scheduledDate: "", completedDate: "", reportReceivedDate: "", reportReviewedDate: "", recommendations: "", refused: false }], termGroups: [], imaging: [] });
  const t = askGoat(c, "when was she referred to active mock sports medicine clinic").answers.map((a) => a.lines.join(" ")).join(" ");
  assert.doesNotMatch(t, /Dr\. Active/, t);
});

const passed = results.filter((r) => r.ok).length;
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.err ? ` — ${r.err}` : ""}`);
console.log(`\nMulti-part / ROM eval: ${passed}/${results.length} passed`);
if (passed !== results.length) process.exit(1);
