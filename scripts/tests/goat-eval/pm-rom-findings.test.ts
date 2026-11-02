/**
 * "pm rom" lists every movement in report order; "pm findings" shows the doctor's
 * Findings card (exam findings), not a raw line dump. Made-up report text only.
 * Run: npx tsx scripts/tests/goat-eval/pm-rom-findings.test.ts
 */
import assert from "node:assert/strict";
import { askGoat } from "../../../src/lib/goat";
import { docUnits, romFromFiles, type GoatFile } from "../../../src/lib/goat-docs";
import { parseRegionQuery } from "../../../src/lib/goat-regions";
import { mockContext } from "./mock-patient";

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
const evalCase = (name: string, fn: () => void) => { try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: (e as Error).message.split("\n")[0] }); } };
const f = (id: string, name: string, pages: string[]): GoatFile => ({ id, name, folder: "Records", uploaded: "2026-03-01", status: "read", pages } as GoatFile);

const REPORT = [
  "MOCK PAIN CENTER\nJANE MOCKERTON, M.D.\nPatient: Kara Testpatient\nConsultation Visit 02/25/2026\nHISTORY OF PRESENT ILLNESS: She reports persistent neck pain that radiates into her bilateral shoulders, worse with cervical range of motion.\nFamily history: none.",
  "PHYSICAL EXAMINATION:\nGeneral: no acute distress.\nExtremity: Range of motion in within normal limits. No visible swelling or deformity.\nCervical spine: Tenderness to palpation over the paraspinal muscles. Spurling's test is positive on the right. Range of motion of the cervical spine is 40 degrees in anterior\nflexion with pain, 60 degrees in extension with pain, 80 degrees in the right lateral rotation with pain, 80 degrees in the\nleft lateral rotation with pain.\nLumbar spine: Positive facet loading bilaterally. Straight leg raise is negative. Range of motion of the lumbar spine is 60 degrees in anterior flexion with\npain, 20 degrees in extension with pain, 30 degrees of left lateral rotation without pain, 30 degrees of right lateral\nrotation with pain.\nOrthopedic tests: Patrick's test negative. Gaenslen's test negative.\nASSESSMENT:\nM54.2 Cervicalgia\nM54.50 Low back pain\nRECOMMENDATIONS:\nRecommend right L4/5 facet injections.",
];
const FILES = [
  f("r", "Specialist Referral - DR. JANE MOCKERTON.pdf", ["SPECIALIST REFERRAL FORM\nPatient: Testpatient, Kara\nRefer to: Dr. Jane Mockerton — Pain Management\nDate of Referral: 01/20/2026"]),
  f("p", "Specialist Report - DR. JANE MOCKERTON.pdf", REPORT),
];
const ctx = mockContext({ files: FILES });
const answers = (q: string, c = ctx) => askGoat(c, q);
const cardText = (a: { groups?: Array<{ blocks: Array<{ heading: string; items: string[] }> }> }) => (a.groups ?? []).flatMap((g) => g.blocks.flatMap((b) => [b.heading, ...b.items])).join(" | ");
const all = (q: string, c = ctx) => answers(q, c).answers.map((a) => `${a.title} | ${a.lines.join(" | ")} | ${cardText(a)}`).join("\n");
const order = (text: string, parts: RegExp[]) => {
  const at = parts.map((p) => text.search(p));
  assert.ok(at.every((n) => n >= 0), `missing ${parts.filter((_, i) => at[i] < 0).join(", ")} in: ${text}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, "not in report order: " + text);
};

const CERVICAL = [/40°.*anterior flexion.*with pain/, /60°.*extension.*with pain/, /80°.*right lateral rotation.*with pain/, /80°.*left lateral rotation.*with pain/];
const LUMBAR = [/60°.*anterior flexion.*with pain/, /20°.*extension.*with pain/, /30°.*left lateral rotation.*without pain/, /30°.*right lateral rotation.*with pain/];

for (const q of ["pm rom", "pm range of motion", "what was the range of motion from dr mockerton"]) {
  evalCase(`"${q}": every movement of both regions, wrapped PDF lines or not, in report order`, () => {
    const text = all(q);
    const cerv = text.slice(text.search(/cervical/i));
    order(cerv.slice(0, cerv.search(/lumbar/i) > 0 ? cerv.search(/lumbar/i) : undefined), CERVICAL);
    order(text.slice(text.search(/lumbar/i)), LUMBAR);
    assert.doesNotMatch(text, /facet loading|Spurling|Patrick|persistent neck pain/, "ROM answer must not carry the findings");
  });
}
evalCase("pm rom: Extremity 'within normal limits' shown because the report says it", () => {
  const text = all("pm rom");
  assert.match(text, /Extremity.*within normal limits/i, text);
});
evalCase("pm rom: no extremity statement in the report → none invented", () => {
  const noExt = REPORT.map((p) => p.replace(/Extremity: Range of motion in within normal limits\. /, ""));
  const c = mockContext({ files: [FILES[0], f("p", "Specialist Report - DR. JANE MOCKERTON.pdf", noExt)] });
  const text = all("pm rom", c);
  assert.doesNotMatch(text, /extremity|normal limits/i, text);
  assert.match(text, /40°/);
});
evalCase("pm rom: no raw 'From patient files' dump alongside", () => {
  const r = answers("pm rom");
  assert.ok(!r.files || r.files.matches.length === 0);
});

// The ROM card built straight from the report's lines (used when no visit facts answer the question):
// PDF-wrapped ROM sentences must come out whole — this is what dropped values before.
const romCard = (files: GoatFile[]) => {
  const c = mockContext({ files });
  const rom = romFromFiles(files, { question: "pm rom", words: [], asked: [], allGroups: c.termGroups ?? [], people: c.people ?? [], region: parseRegionQuery("pm rom", []) });
  return (rom?.blocks ?? []).map((b) => `${b.heading} | ${b.items.join(" | ")}`).join("\n");
};
evalCase("ROM card (wrapped PDF lines): all 4 + 4 movements with pain / no pain, in report order, Extremity WNL", () => {
  const t = romCard([FILES[1]]);
  order(t.slice(t.search(/Cervical/), t.search(/Lumbar/)), CERVICAL);
  order(t.slice(t.search(/Lumbar/)), LUMBAR);
  assert.match(t, /Extremity ROM \| Within normal limits/);
});
evalCase("ROM card: no extremity statement → none invented", () => {
  const noExt = REPORT.map((p) => p.replace(/Extremity: Range of motion in within normal limits\. /, ""));
  const t = romCard([f("p", "Specialist Report - DR. JANE MOCKERTON.pdf", noExt)]);
  assert.doesNotMatch(t, /extremity|normal limits/i, t);
  assert.match(t, /Cervical ROM/);
});
evalCase("a wrapped ROM sentence is one report unit (no value lost between lines)", () => {
  const units = docUnits(FILES[1]).map((u) => u.text);
  assert.ok(units.some((u) => /40 degrees in anterior flexion with pain, 60 degrees in extension with pain, 80 degrees in the right lateral rotation with pain, 80 degrees in the left lateral rotation with pain/.test(u)), units.join("\n"));
  assert.ok(units.some((u) => /60 degrees in anterior flexion with pain, 20 degrees in extension with pain, 30 degrees of left lateral rotation without pain, 30 degrees of right lateral rotation with pain/.test(u)));
});
evalCase("pm findings (report only): Findings card, not a ROM or raw card", () => {
  const r = answers("pm findings", mockContext({ files: [FILES[1]] }));
  assert.equal(r.answers[0]?.title, "Findings");
  assert.ok(!r.files || r.files.matches.length === 0);
});

evalCase("pm findings: a Findings card with recommendations, ROM, exam findings and diagnoses", () => {
  const r = answers("pm findings");
  const card = r.answers[0];
  assert.equal(card.title, "Findings");
  const t = cardText(card);
  order(t, [/Recommendations/, /Cervical ROM/, /Lumbar ROM/, /Cervical exam/, /Diagnoses/]);
  for (const re of [...CERVICAL, ...LUMBAR]) assert.match(t, re);
  assert.match(t, /Tenderness to palpation over the paraspinal/);
  assert.match(t, /Spurling's test is positive on the right/);
  assert.match(t, /Positive facet loading bilaterally/);
  assert.match(t, /Straight leg raise is negative/);
  assert.match(t, /Patrick's test negative/);
  assert.match(t, /M54\.2 Cervicalgia/);
  assert.match(t, /M54\.50 Low back pain/);
  assert.match(t, /facet injections/);
});
evalCase("pm findings: no raw line dump, and the history complaint is not passed off as ROM", () => {
  const r = answers("pm findings");
  assert.ok(!r.files || r.files.matches.length === 0, "raw file lines must not show");
  const t = cardText(r.answers[0]);
  assert.doesNotMatch(t, /persistent neck pain|worse with cervical range of motion|Family history/i, t);
  const rom = (r.answers[0].groups ?? []).flatMap((g) => g.blocks.filter((b) => /ROM$/.test(b.heading)).flatMap((b) => b.items)).join(" | ");
  assert.doesNotMatch(rom, /pain that radiates|shoulders/, rom);
});
evalCase("pm findings: ROM sentences stay out of the exam findings (no double listing)", () => {
  const exam = (answers("pm findings").answers[0].groups ?? []).flatMap((g) => g.blocks.filter((b) => /exam$|^Exam$/.test(b.heading)).flatMap((b) => b.items)).join(" | ");
  assert.doesNotMatch(exam, /degrees|°|range of motion/i, exam);
});
evalCase("pm findings: no exam section in the report → never invented; ROM + diagnoses only", () => {
  const bare = ["MOCK PAIN CENTER\nJANE MOCKERTON, M.D.\nConsultation Visit 02/25/2026", "ASSESSMENT:\nM54.2 Cervicalgia"];
  const c = mockContext({ files: [FILES[0], f("p", "Specialist Report - DR. JANE MOCKERTON.pdf", bare)] });
  const t = cardText(answers("pm findings", c).answers[0] ?? { groups: [] });
  assert.doesNotMatch(t, /exam|tender|spurling/i, t);
});

for (const r of results) console.log(r.ok ? "PASS" : "FAIL", r.name, r.err ?? "");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
