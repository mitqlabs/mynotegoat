/**
 * ICD-10 clinical synonyms + spinal region/level narrowing, against the real
 * built-in FY2026 list (public/icd10/icd10cm-2026.json).
 * Run:  npx tsx scripts/tests/icd10-synonyms.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIcd10Index, searchIcd10 } from "../../src/lib/icd10";

const data = JSON.parse(readFileSync("public/icd10/icd10cm-2026.json", "utf8")) as { codes: Array<[string, string]> };
const index = buildIcd10Index(data.codes);
let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };
const codes = (q: string, n = 50) => searchIcd10(index, q, { limit: n }).map((e) => e.code);
const top = (q: string, n = 10) => codes(q, n);
const real = (c: string) => assert.ok(index.byRaw.has(c.replace(".", "")), `${c} not in FY2026 list`);

test("every code these tests expect is a real FY2026 code", () => {
  for (const c of ["M51.A0", "M51.A1", "M51.A2", "M51.A3", "M51.26", "M51.27", "M50.222", "M50.122", "M54.2", "M54.50", "S13.4XXA", "M47.812", "M47.816", "M48.02", "M48.061", "M54.12", "M54.16", "M54.6", "M50.322", "M51.369"]) real(c);
});
test("annular tear / fissure → annulus fibrosus defect", () => {
  const r = codes("annular tear");
  assert.ok(r.length >= 6 && r.every((c) => c.startsWith("M51.A")), r.join(","));
  assert.ok(codes("annular fissure lumbar").includes("M51.A0"));
  assert.ok(codes("annular tear L5-S1").every((c) => ["M51.A3", "M51.A4", "M51.A5"].includes(c)));
});
test("herniation / HNP / protrusion / extrusion → disc displacement, narrowed by region", () => {
  for (const q of ["lumbar herniation", "hnp lumbar", "lumbar disc protrusion", "extrusion lumbar"]) assert.ok(top(q).includes("M51.26"), q);
  assert.ok(top("cervical herniation", 15).some((c) => c.startsWith("M50.2")));
  assert.ok(codes("cervical herniation").every((c) => !c.startsWith("M51.2")));
});
test("levels: C5-6 → C5-C6 codes first; L4-5 → lumbar only", () => {
  assert.ok(top("herniation c5-6", 3).includes("M50.222"), top("herniation c5-6", 3).join(","));
  assert.ok(top("radiculopathy C5-C6", 5).includes("M50.122"));
  assert.ok(codes("herniation L4-5").every((c) => !/^M50/.test(c)));
  assert.ok(top("herniation L4-5").includes("M51.26"));
  assert.ok(top("disc bulge c5/6", 5).includes("M50.222") || top("disc bulge c5/6", 5).includes("M50.322"));
});
test("bulge → displacement and degeneration", () => {
  const r = codes("lumbar disc bulge", 50);
  assert.ok(r.includes("M51.26") && r.some((c) => c.startsWith("M51.36")), r.slice(0, 12).join(","));
});
test("neck pain / cervicalgia, LBP, whiplash", () => {
  assert.equal(top("neck pain", 1)[0], "M54.2");
  assert.equal(top("cervicalgia", 1)[0], "M54.2");
  assert.ok(top("lbp", 5).includes("M54.50"));
  assert.ok(top("whiplash", 5).includes("S13.4XXA"));
});
test("facet syndrome → spondylosis by region; radiculopathy, stenosis, spondylosis", () => {
  assert.ok(top("cervical facet syndrome", 5).includes("M47.812"));
  assert.ok(top("lumbar facet syndrome", 5).includes("M47.816"));
  assert.ok(top("cervical radiculopathy", 3).includes("M54.12"));
  assert.ok(top("lumbar radic", 3).includes("M54.16"));
  assert.ok(top("cervical stenosis", 3).includes("M48.02"));
  assert.ok(top("lumbar stenosis", 5).includes("M48.061"));
  assert.ok(top("mid back pain", 3).includes("M54.6"));
  assert.ok(top("pinched nerve neck", 5).includes("M54.12"));
});
test("unchanged: code search, plain words", () => {
  assert.equal(top("M54.2", 1)[0], "M54.2");
  assert.equal(top("C50", 1)[0].startsWith("C50"), true);
  assert.ok(top("S13.4").includes("S13.4XXA"));
  assert.ok(top("annulus lumbar").includes("M51.A0"));
  assert.ok(top("sciatica", 5).some((c) => c.startsWith("M54.3")));
});
console.log(`${passed} passed`);
