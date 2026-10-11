/**
 * G.O.A.T. "Suggested from MRI" — term → ICD-10-CM mapping (mock text only).
 *
 * Run:  npx tsx scripts/tests/dx-suggest.test.ts
 */
import assert from "node:assert/strict";
import { suggestDiagnoses, positiveMatch, levelsOf, segmentOfLevel, clinicalSupport, dxInputFromGoat, type DxSuggestInput } from "../../src/lib/dx-suggest";
import { DX_RULES } from "../../src/lib/dx-suggest-map";
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

const base = (over: Partial<DxSuggestInput>): DxSuggestInput => ({ imaging: [], files: null, clinical: [], library: [], existing: [], ...over });
const codes = (input: DxSuggestInput) => suggestDiagnoses(input).map((s) => s.code);

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

test("cervical: most superior level, bulge = displacement, foraminal stenosis", () => {
  const out = suggestDiagnoses(base({ imaging: [{ text: CERVICAL_MRI, source: "MRI findings (Imaging panel)" }] }));
  const list = out.map((s) => s.code);
  // C5-C6 bulge and C6-C7 protrusion → code to the most superior level only.
  assert.ok(list.includes("M50.222"), list.join(","));
  assert.ok(!list.includes("M50.223"));
  assert.ok(!list.includes("M50.20"));
  assert.ok(list.includes("M99.71"));
  // Negated lines never count.
  assert.ok(!list.includes("M48.02"));
  const disc = out.find((s) => s.code === "M50.222")!;
  assert.match(disc.evidence[0].text, /^C5-C6: 2\.0 mm disc bulge/);
  assert.equal(disc.evidence.length, 2, "C6-C7 line kept as evidence on the superior code");
  assert.equal(disc.segment, "Cervical");
});

test("lumbar: region per level, stenosis, listhesis, annular fissure, facets", () => {
  const list = codes(base({ imaging: [{ text: LUMBAR_MRI, source: "MRI" }] }));
  for (const c of ["M51.26", "M48.061", "M47.816", "M43.17", "M51.379", "M51.369", "M99.63"]) assert.ok(list.includes(c), `${c} in ${list.join(",")}`);
  assert.ok(!list.includes("M48.07"), "L5-S1 had no canal stenosis");
  assert.ok(!list.includes("M54.16"), "no radiculopathy without notes");
  assert.ok(!list.includes("M51.16"));
});

test("radiculopathy only when notes support it → combination code, never M54.1 next to it", () => {
  const input = base({
    imaging: [{ text: LUMBAR_MRI, source: "MRI" }],
    clinical: [{ text: "Pt reports sharp pain radiating down the left leg with numbness in the foot.", source: "Case notes" }],
  });
  const out = suggestDiagnoses(input);
  const list = out.map((s) => s.code);
  assert.ok(list.includes("M51.16"), list.join(","));
  assert.ok(list.includes("M51.17"), "L5-S1 annular fissure + radiculopathy → lumbosacral combo");
  assert.ok(!list.includes("M51.26"));
  assert.ok(!list.includes("M54.16") && !list.includes("M54.17"), "Excludes1: no M54.1- with M51.1-");
  // Spondylosis stays without-radiculopathy because the disc combo already covers it.
  assert.ok(list.includes("M47.816"));
  const combo = out.find((s) => s.code === "M51.16")!;
  assert.equal(combo.support?.kind, "radiculopathy");
  assert.equal(combo.support?.source, "Case notes");
});

test("radiculopathy in notes but only stenosis on MRI → M54.1-", () => {
  const out = codes(base({
    imaging: [{ text: "Lumbar:\nL3-L4: Moderate spinal canal stenosis.", source: "MRI" }],
    clinical: [{ text: "Assessment: lumbar radiculopathy.", source: "SOAP 01/02/2026 · A" }],
  }));
  assert.ok(out.includes("M48.061") && out.includes("M54.16"), out.join(","));
});

test("cervical radiculopathy from arm symptoms; lumbar notes don't change cervical codes", () => {
  const out = codes(base({
    imaging: [{ text: CERVICAL_MRI, source: "MRI" }],
    clinical: [{ text: "Tingling into the right hand and fingers.", source: "Case notes" }],
  }));
  assert.ok(out.includes("M50.122") && !out.includes("M50.222"), out.join(","));
  const lumbarOnly = codes(base({ imaging: [{ text: CERVICAL_MRI, source: "MRI" }], clinical: [{ text: "Sciatica down the left leg.", source: "Case notes" }] }));
  assert.ok(lumbarOnly.includes("M50.222"));
});

test("negated radiculopathy in notes is ignored", () => {
  const out = codes(base({ imaging: [{ text: LUMBAR_MRI, source: "MRI" }], clinical: [{ text: "Denies radiating pain. No numbness or tingling in the legs.", source: "Case notes" }] }));
  assert.ok(!out.includes("M51.16"), out.join(","));
  assert.equal(Object.keys(clinicalSupport([{ text: "No radiculopathy in the lumbar spine.", source: "x" }])).length, 0);
});

test("prefers the office's list among equivalent codes; skips codes already on the patient", () => {
  const imaging = [{ text: "Lumbar:\nL4-L5: Moderate central canal stenosis. Disc bulge.", source: "MRI" }];
  const out = suggestDiagnoses(base({ imaging, library: [{ code: "M99.53", description: "Disc stenosis of neural canal, lumbar (office wording)" }] }));
  const sten = out.find((s) => s.code === "M99.53")!;
  assert.ok(sten, out.map((s) => s.code).join(","));
  assert.equal(sten.inLibrary, true);
  assert.equal(sten.description, "Disc stenosis of neural canal, lumbar (office wording)");
  assert.ok(sten.others.some((o) => o.code === "M48.061"));
  const skipped = codes(base({ imaging, existing: [{ code: "m5126" }] }));
  assert.ok(!skipped.includes("M51.26"), "already on the patient (dots/case ignored)");
});

test("patient already has the combination code → plain code not suggested", () => {
  const out = codes(base({ imaging: [{ text: "L4-L5: disc herniation.", source: "MRI" }], existing: [{ code: "M51.16" }] }));
  assert.ok(!out.includes("M51.26"), out.join(","));
});

test("neurogenic claudication → M48.062", () => {
  const out = codes(base({ imaging: [{ text: "L4-L5: severe spinal stenosis.", source: "MRI" }], clinical: [{ text: "Neurogenic claudication after walking 1 block.", source: "Case notes" }] }));
  assert.ok(out.includes("M48.062") && !out.includes("M48.061"), out.join(","));
});

test("region from heading or record when no level; thoracic + Schmorl", () => {
  const out = codes(base({
    imaging: [
      { text: "Multilevel disc bulges.", source: "MRI", regions: ["Cervical"] },
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
  const out = suggestDiagnoses(base({ files: [file] }));
  const list = out.map((s) => s.code);
  assert.ok(list.includes("M51.26") && list.includes("M47.817"), list.join(","));
  assert.match(out[0].evidence[0].source, /MRI Lumbar Spine\.pdf \(p\. 1\)/);
  assert.equal(suggestDiagnoses(base({ files: null })).length, 0);
});

// Billable check (reads the generated JSON once).
import { readFileSync } from "node:fs";
const asset = JSON.parse(readFileSync(new URL("../../public/icd10/icd10cm-2026.json", import.meta.url), "utf8")) as { codes: Array<[string, string]> };
const billable = new Map(asset.codes.map(([c, d]) => [c, d] as const));
test("mapping codes exist, are billable, and descriptions match the official list", () => {
  const seen = new Set<string>();
  const visit = (m: Record<string, Array<{ code: string; description: string }> | undefined> | undefined) => {
    for (const list of Object.values(m ?? {})) for (const x of list ?? []) {
      const r = x.code.replace(".", "");
      assert.ok(billable.has(r), `${x.code} is not a billable FY2026 code`);
      assert.equal(x.description, billable.get(r), `${x.code} description`);
      seen.add(x.code);
    }
  };
  for (const r of DX_RULES) {
    visit(r.codes);
    visit(r.withRadiculopathy);
    visit(r.withMyelopathy);
    visit(r.withClaudication);
    visit(r.others);
    visit(r.variant?.codes);
  }
  assert.ok(seen.size > 50);
});

console.log(`dx-suggest: ${passed} tests passed`);
