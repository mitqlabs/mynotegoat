/**
 * Built-in ICD-10-CM list: the generated asset and the search.
 *
 * Run:  npx tsx scripts/tests/icd10-search.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIcd10Index, buildLocalIndex, dottedCode, rawCode, sameCode, searchCombined, searchIcd10 } from "../../src/lib/icd10";

const asset = JSON.parse(readFileSync(new URL("../../public/icd10/icd10cm-2026.json", import.meta.url), "utf8")) as {
  version: string;
  count: number;
  codes: Array<[string, string]>;
};
assert.equal(asset.version, "FY2026");
assert.equal(asset.codes.length, asset.count);
assert.ok(asset.count > 70000, `only ${asset.count} codes`);

const index = buildIcd10Index(asset.codes);
const top = (q: string, n = 5) => searchIcd10(index, q, { limit: n }).map((e) => e.code);

let passed = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
};

test("code helpers", () => {
  assert.equal(dottedCode("M5412"), "M54.12");
  assert.equal(dottedCode("m54.12"), "M54.12");
  assert.equal(dottedCode("M545"), "M54.5");
  assert.equal(rawCode("s13.4xxa"), "S134XXA");
  assert.ok(sameCode("M51.26", "m5126"));
  assert.ok(!sameCode("", ""));
});

test("exact code, dotted or not", () => {
  assert.equal(top("M54.12")[0], "M54.12");
  assert.equal(top("m5412")[0], "M54.12");
  assert.equal(index.byRaw.get("M5412")?.description, "Radiculopathy, cervical region");
});

test("code prefix lists the category", () => {
  const r = searchIcd10(index, "M51.3", { limit: 50 }).map((e) => e.code);
  assert.ok(r.includes("M51.369") && r.includes("M51.34"));
  assert.ok(r.every((c) => c.startsWith("M51.3")));
});

test("words in any order, partial words", () => {
  assert.ok(top("lumbar stenosis").includes("M48.061"));
  assert.ok(top("stenosis lumbar").includes("M48.061"));
  assert.ok(top("lumb sten").includes("M48.061"));
  assert.ok(top("cervical radiculopathy").includes("M54.12"));
});

test("everyday words map to official wording", () => {
  assert.ok(searchIcd10(index, "herniated disc lumbar", { limit: 20 }).some((e) => e.code === "M51.26"));
  assert.ok(searchIcd10(index, "neck sprain", { limit: 20 }).some((e) => e.code === "S13.4XXA"));
});

test("code + word together", () => {
  const r = top("M50 C5-C6 displacement");
  assert.equal(r[0], "M50.222", r.join(","));
  assert.ok(searchIcd10(index, "L4-L5 subluxation", { limit: 20 }).some((e) => e.code === "S33.140A"));
});

test("nothing for empty / one-letter queries; billable only", () => {
  assert.equal(searchIcd10(index, "").length, 0);
  assert.equal(searchIcd10(index, "a").length, 0);
  assert.equal(searchIcd10(index, "M54").length > 0, true);
  assert.ok(!index.byRaw.has("M54"), "category headers are not billable");
  assert.ok(!index.byRaw.has("M5136"), "M51.36 needs a 6th character since FY2025");
});

test("search is fast enough for typing", () => {
  const t = performance.now();
  for (let i = 0; i < 20; i++) searchIcd10(index, "lumbar disc");
  const per = (performance.now() - t) / 20;
  assert.ok(per < 60, `${per.toFixed(1)} ms per search`);
});

test("one search: your codes first (labeled), ICD-10 below, no duplicates", () => {
  const local = buildLocalIndex([
    { code: "R51.9", description: "Headache, unspecified", group: "Misc." },
    { code: "G44.309", description: "Post-traumatic headache, unspecified, not intractable", group: "Misc." },
    { code: "M54.2", description: "Cervicalgia", group: "Cervical" },
  ]);
  const r = searchCombined(local, index, "headache", { limit: 50 });
  assert.deepEqual(r.local.map((h) => h.item.code).sort(), ["G44.309", "R51.9"]);
  assert.equal(r.local[0].item.group, "Misc.");
  assert.ok(r.icd.length > 0, "ICD-10 headache codes listed too");
  assert.ok(!r.icd.some((e) => e.raw === "R519" || e.raw === "G44309"), "codes in your list show once");
  // Your list isn't loaded-dependent: works before the ICD file arrives.
  assert.equal(searchCombined(local, null, "cervicalgia").local[0].item.code, "M54.2");
  // Code prefix, undotted.
  assert.equal(searchCombined(local, index, "m542").local[0].item.code, "M54.2");
  // No local list → plain ICD search.
  assert.deepEqual(searchCombined(null, index, "M54.12").icd.map((e) => e.code).slice(0, 1), ["M54.12"]);
});

console.log(`icd10-search: ${passed} tests passed`);
