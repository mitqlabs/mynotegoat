/**
 * G.O.A.T. "Suggested from X-ray" (mock text only).
 * Run: npx tsx scripts/tests/dx-suggest-xray.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { suggestXrayDiagnoses, xrayInputFromGoat, XRAY_RULES, type XrayInput, type XraySuggestion } from "../../src/lib/dx-suggest-xray";
import { excludes1 } from "../../src/lib/dx-suggest-map";
import type { GoatFile } from "../../src/lib/goat-docs";

const asset = JSON.parse(readFileSync(new URL("../../public/icd10/icd10cm-2026.json", import.meta.url), "utf8")) as { codes: Array<[string, string]> };
const billable = new Map(asset.codes.map(([c, d]) => [c, d] as const));
const raw = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
const FLAGGED = new Set(["M419", "M19019", "M1710", "M438X9", "M4180", "M25469", "M25419", "M5130"]);

const runs: XraySuggestion[][] = [];
const base = (over: Partial<XrayInput>): XrayInput => ({ xray: [], files: null, clinical: [], library: [], existing: [], ...over });
const run = (over: Partial<XrayInput>) => {
  const r = suggestXrayDiagnoses(base(over));
  runs.push(r.list);
  return r;
};
const codes = (over: Partial<XrayInput>) => run(over).list.map((s) => s.code);
const x = (text: string, regions?: string[]) => ({ text, source: "X-ray findings (Imaging panel)", regions });

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};

test("cervical: loss of lordosis, DDD at C5-C6, no fracture", () => {
  const r = run({ xray: [x("Cervical spine: Loss of the normal cervical lordosis. Disc space narrowing at C5-C6 with anterior osteophytes. No acute fracture or dislocation.", ["Cervical"])] });
  const cs = r.list.map((s) => s.code);
  assert.ok(cs.includes("M43.8X2"), cs.join());
  assert.ok(cs.includes("M50.322"), cs.join());
  assert.ok(!r.heldBack.some((h) => h.code === "Fracture"), "negated fracture is not flagged");
  const lord = r.list.find((s) => s.code === "M43.8X2")!;
  assert.match(lord.evidence[0].text, /Loss of the normal cervical lordosis/);
  assert.ok(lord.why.length > 20);
  assert.ok(lord.others.some((o) => o.code === "M62.830"));
});

test("lumbar: levoscoliosis, L5-S1 anterolisthesis, spondylosis", () => {
  const cs = codes({ xray: [x("Lumbar spine: Mild levoscoliosis. Grade 1 anterolisthesis of L5 on S1.\nMultilevel lumbar spondylosis.", ["Lumbar"])] });
  for (const c of ["M41.86", "M43.17", "M47.816"]) assert.ok(cs.includes(c), `${c} in ${cs.join()}`);
});

test("normal straight wording is not over-read", () => {
  assert.deepEqual(codes({ xray: [x("Cervical spine: Normal lordosis. No scoliosis. Disc spaces are preserved. No fracture.", ["Cervical"])] }), []);
});

test("knee and shoulder: side required; effusion folded into OA", () => {
  const r = run({ xray: [x("Right knee: Moderate medial joint space narrowing with marginal osteophytes. Small joint effusion.", ["Right Knee"]), x("Left shoulder: AC joint arthrosis.", ["Left Shoulder"])] });
  const cs = r.list.map((s) => s.code);
  assert.ok(cs.includes("M17.11") && cs.includes("M19.012"), cs.join());
  assert.ok(!cs.includes("M25.461"), "effusion with OA of the same knee isn't coded");
  const knee = r.list.find((s) => s.code === "M17.11")!;
  assert.equal(knee.segment, "Right Knee");
  const r2 = run({ xray: [x("Knee: degenerative changes with joint space narrowing.")] });
  assert.equal(r2.list.length, 0);
  assert.ok(r2.heldBack.some((h) => /side isn't stated/.test(h.reason)));
  assert.deepEqual(codes({ xray: [x("Left knee: small joint effusion. No arthritis.", ["Left Knee"])] }), ["M25.462"]);
  assert.deepEqual(codes({ xray: [x("Bilateral knees: tricompartmental osteoarthritis.")] }), ["M17.0"]);
});

test("fracture: never coded, listed with the line", () => {
  const r = run({ xray: [x("Lumbar spine: Compression fracture of L1 vertebral body, age indeterminate.", ["Lumbar"])] });
  assert.ok(!r.list.some((s) => /^S|^M48\.5|^M80/.test(s.code)));
  assert.ok(r.heldBack.find((h) => h.code === "Fracture" && /code it by hand/.test(h.reason)));
  assert.ok(!run({ xray: [x("Possible fracture cannot be excluded. Recommend CT.", ["Lumbar"])] }).heldBack.some((h) => h.code === "Fracture"), "hedged fracture isn't flagged");
});

test("auto-hide once added; no repeat of MRI codes", () => {
  const t = [x("Cervical spine: Straightening of the cervical lordosis. Disc space narrowing at C5-C6.", ["Cervical"])];
  assert.ok(!codes({ xray: t, existing: [{ code: "M43.8X2" }] }).includes("M43.8X2"));
  assert.ok(!codes({ xray: t, alsoSuggested: ["M50.322"] }).includes("M50.322"));
});

test("uploaded X-ray report is read; MRI report is not", () => {
  const file = (name: string, text: string): GoatFile => ({ id: name, name, status: "read", pages: [text] } as unknown as GoatFile);
  const xr = file("XR Cervical Spine 3 views.pdf", "EXAM: X-ray cervical spine\nFINDINGS:\nReversal of the normal cervical lordosis.\nIMPRESSION:\nNo fracture.");
  const mri = file("MRI Lumbar Spine.pdf", "EXAM: MRI lumbar spine\nFINDINGS:\nMild levoscoliosis of the lumbar spine.");
  const r = run({ files: [xr, mri] });
  const cs = r.list.map((s) => s.code);
  assert.ok(cs.includes("M43.8X2"), cs.join());
  assert.ok(!cs.includes("M41.86"), "MRI file left to the MRI list");
  assert.match(r.list[0].evidence[0].source, /XR Cervical Spine 3 views\.pdf \(p\. 1\)/);
});

test("xrayInputFromGoat reads only X-ray records and the X-Ray box", () => {
  const ctx = {
    imaging: [
      { modality: "X-Ray", center: "Mock Imaging", regions: ["Lumbar"], findings: "Levoscoliosis.", refused: false },
      { modality: "MRI", center: "Mock MRI", regions: ["Lumbar"], findings: "L4-L5 disc herniation.", refused: false },
    ],
    xrayFindings: "Cervical: loss of lordosis.",
    notes: "", encounters: [], specialists: [], specialistRecommendations: "", files: null,
  } as unknown as Parameters<typeof xrayInputFromGoat>[0];
  const input = xrayInputFromGoat(ctx, [], []);
  assert.equal(input.xray.length, 2);
  const cs = suggestXrayDiagnoses(input).list.map((s) => s.code);
  assert.ok(cs.includes("M41.86") && cs.includes("M43.8X2") && !cs.some((c) => c.startsWith("M51.2")), cs.join());
});

test("AUDIT: every X-ray code is billable FY2026 with the exact official description; no flagged codes", () => {
  const all: Array<{ code: string; description: string }> = [];
  for (const r of XRAY_RULES) for (const m of [r.codes, r.others ?? {}, r.withRadiculopathy ?? {}, r.withMyelopathy ?? {}]) for (const list of Object.values(m)) all.push(...(list ?? []));
  for (const s of runs.flat()) all.push(s, ...s.others);
  for (const c of all) {
    assert.ok(billable.has(raw(c.code)), `${c.code} not billable FY2026`);
    assert.equal(c.description, billable.get(raw(c.code)), `${c.code} description`);
    assert.ok(!FLAGGED.has(raw(c.code)), `${c.code} is a flagged unspecified code`);
  }
  for (const list of runs) for (const a of list) for (const b of list) if (a !== b) assert.equal(excludes1(a.code, b.code), null, `${a.code}/${b.code}`);
});

console.log(`dx-suggest-xray: ${passed} passed`);
