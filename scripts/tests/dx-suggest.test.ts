/**
 * G.O.A.T. "Suggested from MRI" — term → ICD-10-CM mapping (mock text only).
 *
 * Run:  npx tsx scripts/tests/dx-suggest.test.ts
 */
import assert from "node:assert/strict";
import { suggestDiagnoses, suggestDiagnosesDetailed, positiveMatch, levelsOf, segmentOfLevel, clinicalSupport, dxInputFromGoat, type DxSuggestInput, type DxSuggestion } from "../../src/lib/dx-suggest";
import { DX_RULES, EXCLUDES1, RADICULOPATHY, excludes1 } from "../../src/lib/dx-suggest-map";
import { readFileSync } from "node:fs";
import type { GoatFile } from "../../src/lib/goat-docs";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

// Official FY2026 list (billable codes + exact descriptions).
const asset = JSON.parse(readFileSync(new URL("../../public/icd10/icd10cm-2026.json", import.meta.url), "utf8")) as { codes: Array<[string, string]> };
const billable = new Map(asset.codes.map(([c, d]) => [c, d] as const));
const rawc = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Every run's output is checked for Excludes1 pairs, official descriptions and a why line.
const allRuns: DxSuggestion[][] = [];
const run = (input: DxSuggestInput) => {
  const out = suggestDiagnoses(input);
  allRuns.push(out);
  return out;
};

const base = (over: Partial<DxSuggestInput>): DxSuggestInput => ({ imaging: [], files: null, clinical: [], library: [], existing: [], ...over });
const codes = (input: DxSuggestInput) => run(input).map((s) => s.code);

const CERVICAL_MRI = `Cervical:
1. C2-C3: Unremarkable.
2. C3-C4: No disc herniation, spinal stenosis or foraminal narrowing.
3. C4-C5: Normal.
4. C5-C6: 2.0 mm disc bulge with mild bilateral neural foraminal narrowing. No central canal stenosis.
5. C6-C7: 3.0 mm broad-based disc protrusion indenting the thecal sac.`;

const LUMBAR_MRI = `Lumbar:
1. L3-L4: Disc desiccation. No stenosis.
2. L4-L5: 4 mm disc herniation with moderate central canal stenosis. Facet arthropathy.
3. L5-S1: Grade 1 anterolisthesis of L5 on S1. Annular fissure. Mild left foraminal narrowing due to facet hypertrophy.`;

test("levels and segments", () => {
  assert.deepEqual(levelsOf("L4-5, L5S1, C7-T1, L5 on S1").map((l) => l.name), ["L4-L5", "L5-S1", "C7-T1"]);
  const seg = (t: string) => segmentOfLevel(levelsOf(t)[0]);
  assert.equal(seg("C5-6"), "Cervical");
  assert.equal(seg("C7-T1"), "Cervicothoracic");
  assert.equal(seg("T6-7"), "Thoracic");
  assert.equal(seg("T12-L1"), "Thoracolumbar");
  assert.equal(seg("L4-L5"), "Lumbar");
  assert.equal(seg("L5-S1"), "Lumbosacral");
});

test("negation and hedging", () => {
  const re = /herniation/gi;
  assert.equal(positiveMatch("No disc herniation", re), false);
  assert.equal(positiveMatch("without evidence of herniation", re), false);
  assert.equal(positiveMatch("No stenosis, mild disc herniation", re), true);
  assert.equal(positiveMatch("possible small herniation", re), false);
  assert.equal(positiveMatch("Disc herniation is not seen", re), false);
  assert.equal(positiveMatch("Herniation: none", re), false);
  assert.equal(positiveMatch("Compared to the prior study, the herniation is unchanged", re), true);
  assert.equal(positiveMatch("Rule out herniation", re), false);
  const st = /stenosis/gi;
  assert.equal(positiveMatch("No disc herniation, spinal stenosis or foraminal narrowing", st), false);
});


test("cervical: each stated level, foraminal → M48.02 (no M99 unless the office uses it), negated levels ignored", () => {
  const out = run(base({ imaging: [{ text: CERVICAL_MRI, source: "MRI findings (Imaging panel)" }] }));
  const list = out.map((s) => s.code);
  assert.ok(list.includes("M50.222") && list.includes("M50.223"), list.join(","));
  assert.ok(!list.includes("M50.20"), "no unspecified code when the level is stated");
  assert.ok(list.includes("M48.02"), "foraminal narrowing → spinal stenosis, cervical");
  assert.ok(!list.some((c) => c.startsWith("M99")), "M99 only when the office's list uses it and the cause is stated");
  assert.ok(!list.some((c) => /^M50\.(?:21|221)$/.test(c)), "C3-C4 / C4-C5 lines were negative");
  const bulge = out.find((s) => s.code === "M50.222")!;
  assert.match(bulge.evidence[0].text, /^C5-C6: 2\.0 mm disc bulge/);
  assert.match(bulge.why, /not an ICD-10-CM Index term/);
  assert.match(bulge.why, /Level C5-C6 is stated/);
  assert.equal(bulge.description, "Other cervical disc displacement at C5-C6 level");
});

test("level-specific cervical codes only when the level is stated", () => {
  let out = run(base({ imaging: [{ text: "Multilevel disc bulges.", source: "MRI", regions: ["Cervical"] }] }));
  assert.deepEqual(out.map((s) => s.code), ["M50.20"]);
  assert.match(out[0].why, /No cervical level is stated/);
  out = run(base({ imaging: [{ text: "Disc protrusion, most pronounced at C5-C6.", source: "MRI", regions: ["Cervical"] }] }));
  assert.deepEqual(out.map((s) => s.code), ["M50.222"]);
  // The level of a later item doesn't leak backwards into an earlier sentence.
  out = run(base({ imaging: [{ text: "Small disc protrusion. Mild facet arthropathy at C5-C6.", source: "MRI", regions: ["Cervical"] }] }));
  assert.ok(out.some((s) => s.code === "M50.20") && !out.some((s) => s.code === "M50.222"), out.map((s) => s.code).join(","));
});

test("lumbar: region per level; stenosis → M48.0-; listhesis; annular fissure; facets", () => {
  const list = codes(base({ imaging: [{ text: LUMBAR_MRI, source: "MRI" }] }));
  for (const c of ["M51.26", "M48.061", "M47.816", "M43.17", "M51.379", "M51.369", "M48.07", "M47.817"]) assert.ok(list.includes(c), `${c} in ${list.join(",")}`);
  assert.ok(!list.some((c) => c.startsWith("M99")), list.join(","));
  assert.ok(!list.includes("M54.16") && !list.includes("M51.16"), "no radiculopathy without notes");
});

test("M99.5-/6-/7-: only if the office's list has it AND the report states the cause", () => {
  const lib = (...c: string[]) => c.map((code) => ({ code, description: "office wording" }));
  // Canal stenosis caused by the disc + office uses M99.53 → M99.53, M48.061 offered as the other option.
  let out = run(base({ imaging: [{ text: "L4-L5: Disc herniation causing moderate central canal stenosis.", source: "MRI" }], library: lib("M99.53") }));
  const m99 = out.find((s) => s.code === "M99.53")!;
  assert.ok(m99, out.map((s) => s.code).join(","));
  assert.equal(m99.description, "Intervertebral disc stenosis of neural canal of lumbar region", "official description, not the office's");
  assert.ok(m99.others.some((o) => o.code === "M48.061"));
  assert.match(m99.why, /M99 note/);
  // "with" isn't a stated cause.
  out = run(base({ imaging: [{ text: "L4-L5: 4 mm disc herniation with moderate central canal stenosis.", source: "MRI" }], library: lib("M99.53") }));
  assert.ok(out.some((s) => s.code === "M48.061") && !out.some((s) => s.code === "M99.53"), out.map((s) => s.code).join(","));
  // Cause stated but the office doesn't use M99 → M48.0-.
  out = run(base({ imaging: [{ text: "L4-L5: Disc herniation causing moderate central canal stenosis.", source: "MRI" }] }));
  assert.ok(out.some((s) => s.code === "M48.061") && !out.some((s) => s.code.startsWith("M99")));
  // Foramina: bony cause → M99.63; disc cause → M99.73 (each only when in the list).
  out = run(base({ imaging: [{ text: "L5-S1: Mild left foraminal narrowing due to facet hypertrophy.", source: "MRI" }], library: lib("M99.63", "M99.73") }));
  assert.ok(out.some((s) => s.code === "M99.63") && !out.some((s) => s.code === "M99.73"), out.map((s) => s.code).join(","));
  out = run(base({ imaging: [{ text: "L4-L5: Bilateral foraminal narrowing secondary to a broad-based disc bulge.", source: "MRI" }], library: lib("M99.63", "M99.73") }));
  assert.ok(out.some((s) => s.code === "M99.73"), out.map((s) => s.code).join(","));
  out = run(base({ imaging: [{ text: CERVICAL_MRI, source: "MRI" }], library: lib("M99.71") }));
  assert.ok(!out.some((s) => s.code === "M99.71"), "“disc bulge with … foraminal narrowing” doesn't state the cause");
});

test("radiculopathy only when the notes name it → combination code; symptoms alone don't count", () => {
  const out = run(base({
    imaging: [{ text: LUMBAR_MRI, source: "MRI" }],
    clinical: [{ text: "Assessment: lumbar radiculopathy, left L5 distribution.", source: "SOAP 01/02/2026 · A" }],
  }));
  const list = out.map((s) => s.code);
  assert.ok(list.includes("M51.16") && list.includes("M51.17"), list.join(","));
  assert.ok(!list.includes("M51.26"));
  assert.ok(!list.some((c) => c.startsWith("M54.1")), "Excludes1: no M54.1- with M51.1-");
  assert.ok(list.includes("M47.816"), "spondylosis stays without radiculopathy where a disc combo exists");
  const combo = out.find((s) => s.code === "M51.16")!;
  assert.equal(combo.support?.kind, "radiculopathy");
  assert.match(combo.why, /combination code/);
  const symptoms = codes(base({
    imaging: [{ text: LUMBAR_MRI, source: "MRI" }],
    clinical: [{ text: "Pt reports sharp pain radiating down the left leg with numbness in the foot.", source: "Case notes" }],
  }));
  assert.ok(symptoms.includes("M51.26") && !symptoms.includes("M51.16"), symptoms.join(","));
});

test("radiculopathy in notes but only stenosis on MRI → M54.1-", () => {
  const out = codes(base({
    imaging: [{ text: "Lumbar:\nL3-L4: Moderate spinal canal stenosis.", source: "MRI" }],
    clinical: [{ text: "Assessment: lumbar radiculopathy.", source: "SOAP 01/02/2026 · A" }],
  }));
  assert.ok(out.includes("M48.061") && out.includes("M54.16"), out.join(","));
});

test("cervical radiculopathy named in notes; lumbar sciatica doesn't change cervical codes", () => {
  const out = codes(base({ imaging: [{ text: CERVICAL_MRI, source: "MRI" }], clinical: [{ text: "Dx: cervical radiculopathy, right C6.", source: "Case notes" }] }));
  assert.ok(out.includes("M50.122") && out.includes("M50.123") && !out.includes("M50.222"), out.join(","));
  const lumbarOnly = codes(base({ imaging: [{ text: CERVICAL_MRI, source: "MRI" }], clinical: [{ text: "Sciatica down the left leg.", source: "Case notes" }] }));
  assert.ok(lumbarOnly.includes("M50.222"));
});

test("negated radiculopathy in notes is ignored", () => {
  const out = codes(base({ imaging: [{ text: LUMBAR_MRI, source: "MRI" }], clinical: [{ text: "No radiculopathy. Denies sciatica.", source: "Case notes" }] }));
  assert.ok(!out.includes("M51.16"), out.join(","));
  assert.equal(Object.keys(clinicalSupport([{ text: "No radiculopathy in the lumbar spine.", source: "x" }])).length, 0);
});

test("Excludes1 with a code already on the patient → held back with the reason", () => {
  const input = base({
    imaging: [{ text: "L4-L5: 5 mm disc herniation.", source: "MRI" }],
    clinical: [{ text: "Assessment: lumbar radiculopathy.", source: "SOAP" }],
    existing: [{ code: "M54.16" }],
  });
  const r = suggestDiagnosesDetailed(input);
  allRuns.push(r.list);
  assert.ok(!r.list.some((s) => s.code === "M51.16"), r.list.map((s) => s.code).join(","));
  const held = r.heldBack.find((h) => h.code === "M51.16")!;
  assert.match(held.reason, /M54\.1 Excludes1.*M54\.16 is already on the patient/);
  // Traumatic disc rupture already coded → no M51 disc code.
  const injury = suggestDiagnosesDetailed(base({ imaging: [{ text: "L4-L5: 5 mm disc herniation.", source: "MRI" }], existing: [{ code: "S33.0XXA" }] }));
  assert.ok(!injury.list.some((s) => s.code === "M51.26"));
  assert.match(injury.heldBack[0].reason, /current injury/);
});

test("Excludes1 between suggestions: spondylolysis + spondylolisthesis → M43.1- only", () => {
  const r = suggestDiagnosesDetailed(base({ imaging: [{ text: "L5-S1: Bilateral pars defects with grade 1 anterolisthesis.", source: "MRI" }] }));
  allRuns.push(r.list);
  assert.deepEqual(r.list.map((s) => s.code), ["M43.17"]);
  assert.equal(r.heldBack[0].code, "M43.07");
  assert.match(r.list[0].note ?? "", /acute traumatic spondylolisthesis/);
});

test("not suggested: retrolisthesis, a lone osteophyte, cervical annular tear", () => {
  const out = codes(base({
    imaging: [{ text: "C5-C6: Annular fissure.\nC6-C7: Small anterior osteophytes.\nL2-L3: Grade 1 retrolisthesis.", source: "MRI" }],
  }));
  assert.deepEqual(out, []);
});

test("neurogenic claudication → M48.062 (M48.061 as the other option)", () => {
  const out = run(base({ imaging: [{ text: "L4-L5: severe spinal stenosis.", source: "MRI" }], clinical: [{ text: "Neurogenic claudication after walking 1 block.", source: "Case notes" }] }));
  const s = out.find((x) => x.code === "M48.062")!;
  assert.ok(s && !out.some((x) => x.code === "M48.061"), out.map((x) => x.code).join(","));
  assert.ok(s.others.some((o) => o.code === "M48.061"));
});

test("negated / hedged MRI findings → nothing", () => {
  const negatives = [
    "C3-C4: No disc herniation, spinal stenosis or foraminal narrowing.",
    "L4-L5: Disc herniation is not seen. No canal stenosis.",
    "L5-S1: Rule out annular tear.",
    "L3-L4: Possible small disc protrusion.",
    "L4-L5: Previously noted herniation has resolved.",
    "T7-T8: Unremarkable. Negative for spondylolisthesis.",
    "C5-C6: Without evidence of disc bulge or stenosis.",
    "Lumbar: Normal alignment. No spondylolysis.",
  ];
  for (const n of negatives) assert.deepEqual(codes(base({ imaging: [{ text: n, source: "MRI" }] })), [], n);
});

test("prefers the office's list among equivalent codes; skips codes already on the patient", () => {
  const imaging = [{ text: "Lumbar:\nL4-L5: Moderate central canal stenosis. Disc herniation.", source: "MRI" }];
  const out = run(base({ imaging, library: [{ code: "M48.061", description: "Lumbar stenosis (office wording)" }] }));
  const sten = out.find((s) => s.code === "M48.061")!;
  assert.equal(sten.inLibrary, true);
  assert.equal(sten.description, "Spinal stenosis, lumbar region without neurogenic claudication");
  const skipped = codes(base({ imaging, existing: [{ code: "m5126" }] }));
  assert.ok(!skipped.includes("M51.26"), "already on the patient (dots/case ignored)");
});

test("patient already has the combination code → plain code not suggested", () => {
  const out = codes(base({ imaging: [{ text: "L4-L5: disc herniation.", source: "MRI" }], existing: [{ code: "M51.16" }] }));
  assert.ok(!out.includes("M51.26"), out.join(","));
});

test("region from heading or record when no level; thoracic + Schmorl", () => {
  const out = codes(base({
    imaging: [
      { text: "Multilevel disc protrusions.", source: "MRI", regions: ["Cervical"] },
      { text: "Thoracic spine:\nT7-T8: Schmorl's node. Small disc protrusion.", source: "MRI" },
    ],
  }));
  assert.ok(out.includes("M50.20"), out.join(","));
  assert.ok(out.includes("M51.44") && out.includes("M51.24"));
});

test("non-spine sections and X-rays are ignored", () => {
  const out = codes(base({ imaging: [{ text: "Left Knee:\n1. Joint effusion. Meniscal tear.", source: "MRI" }] }));
  assert.equal(out.length, 0);
  const ctxIn = dxInputFromGoat(
    {
      imaging: [{ modality: "X-Ray", center: "", regions: ["Lumbar"], sentDate: "", scheduledDate: "", doneDate: "", reportReceivedDate: "", reportReviewedDate: "", findings: "L4-L5 disc space narrowing", refused: false }],
      mriFindings: "",
      notes: null,
      encounters: null,
      specialists: [],
      specialistRecommendations: "",
      files: null,
    },
    [],
    [],
  );
  assert.equal(ctxIn.imaging.length, 0);
});

test("uploaded MRI report: Findings/Impression read, history ignored; hidden files skipped", () => {
  const file: GoatFile = {
    id: "f1",
    name: "MRI Lumbar Spine.pdf",
    folder: "Imaging",
    uploaded: "2026-01-02T00:00:00Z",
    status: "read",
    pages: [
      "MRI LUMBAR SPINE WITHOUT CONTRAST\nCLINICAL HISTORY: Low back pain, rule out disc herniation.\nFINDINGS:\nL4-L5: There is a 3 mm disc protrusion.\nL5-S1: Mild bilateral facet arthropathy.\nIMPRESSION:\n1. L4-L5 disc protrusion.",
    ],
  };
  const out = run(base({ files: [file] }));
  const list = out.map((s) => s.code);
  assert.ok(list.includes("M51.26") && list.includes("M47.817"), list.join(","));
  assert.match(out[0].evidence[0].source, /MRI Lumbar Spine\.pdf \(p\. 1\)/);
  assert.equal(suggestDiagnoses(base({ files: null })).length, 0);
});

test("AUDIT: every mapped code is billable in FY2026 with the exact official description", () => {
  const seen = new Set<string>();
  const visit = (m: Record<string, Array<{ code: string; description: string }> | undefined> | undefined) => {
    for (const list of Object.values(m ?? {})) for (const x of list ?? []) {
      const r = rawc(x.code);
      assert.ok(billable.has(r), `${x.code} is not a billable FY2026 code`);
      assert.equal(x.description, billable.get(r), `${x.code} description`);
      seen.add(x.code);
    }
  };
  for (const r of DX_RULES) {
    assert.ok(r.why.length > 20, `${r.id} has a why line`);
    visit(r.codes);
    visit(r.withRadiculopathy);
    visit(r.withMyelopathy);
    visit(r.withClaudication);
    visit(r.others);
    for (const b of r.biomechanical ?? []) visit(b.codes);
  }
  visit(RADICULOPATHY);
  assert.ok(seen.size > 70, `${seen.size} codes`);
  // Excludes1 table points at real codes.
  for (const p of EXCLUDES1) {
    assert.ok([...billable.keys()].some((c) => c.startsWith(p.a)), p.a);
    assert.ok([...billable.keys()].some((c) => c.startsWith(p.b)), p.b);
  }
  assert.ok(excludes1("M54.16", "M51.16") && excludes1("M51.17", "M54.17") && !excludes1("M51.26", "M48.061"));
});

test("AUDIT: no run produced an Excludes1 pair, a non-official description, or a missing why line", () => {
  assert.ok(allRuns.length > 15);
  for (const out of allRuns) {
    for (const s of out) {
      assert.equal(s.description, billable.get(rawc(s.code)), `${s.code} description`);
      assert.ok(s.why.length > 20, `${s.code} why`);
    }
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) assert.equal(excludes1(out[i].code, out[j].code), null, `${out[i].code} + ${out[j].code}`);
  }
});

console.log(`dx-suggest: ${passed} tests passed`);
