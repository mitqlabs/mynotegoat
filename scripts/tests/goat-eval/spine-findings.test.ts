/**
 * Structured spine impressions (MRI / CT / X-ray). Fictional report text only.
 * Run: npx tsx scripts/tests/goat-eval/spine-findings.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { structuredFindingBlocks } from "../../../src/lib/goat";
import { levelsInText, normalizeLevel, parseSpineFindings, sentence, spineBlocks } from "../../../src/lib/spine-findings";

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };
const blocks = (t: string) => spineBlocks(parseSpineFindings(t));
const line = (t: string, level: string) => blocks(t).flatMap((b) => b.items).find((i) => i.startsWith(`${level}:`)) ?? "";
const flat = (t: string) => blocks(t).map((b) => `${b.heading}\n${b.items.join("\n")}`).join("\n");

// Levels
for (const [raw, want] of [["C5-6", "C5-6"], ["C5-C6", "C5-6"], ["C5/6", "C5-6"], ["c5 6", "C5-6"], ["C56", "C5-6"], ["L5-S1", "L5-S1"], ["L5/S1", "L5-S1"], ["T12-L1", "T12-L1"], ["C7-T1", "C7-T1"], ["T11-12", "T11-12"], ["L4-L5", "L4-5"]] as const) {
  check(`level ${raw}`, () => assert.equal(normalizeLevel(raw), want));
}
check("not a level: date / T2", () => { assert.equal(normalizeLevel("T2 signal"), null); assert.deepEqual(levelsInText("seen 10/14/2026 on T2"), []); });
check("shared levels", () => assert.deepEqual(levelsInText("C5-6 & C6-7 disc herniations"), ["C5-6", "C6-7"]));
check("level list", () => assert.deepEqual(levelsInText("bulges at L3-4, L4-5 and L5-S1"), ["L3-4", "L4-5", "L5-S1"]));
check("range", () => assert.deepEqual(levelsInText("C4-5 through C6-7"), ["C4-5", "C5-6", "C6-7"]));
check("range across regions", () => assert.deepEqual(levelsInText("T11-12 to L1-2"), ["T11-12", "T12-L1", "L1-2"]));

// The user's example (all caps, sizes cut off, broken semicolon)
const EX = "MM LEFT PARACENTRAL C5-6 & C6-7 DISC HERNIATIONS STENOSING THE SPINAL CANAL, COMPRESSING; THE CERVICAL CORD & ENCROACHING THE LEFT > RIGHT NEUROFORAMEN...; MM LEFT PARACENTRAL L5-S1 DISC HERNIATION EFFACING THE VENTRAL THECAL SAC; DEGENERATION, DISC DESICCATION, MILD OSTEOPHYTOSIS, MODIC TYPE I ENDPLATE INFLAMMATION, POSTERIOR C6-7 ANNULAR TEAR & C5-6 FACET HYPERTROPHY; CORRELATION WITH CERVICALGIA IS RECOMMENDED";
const exB = blocks(EX);
check("example regions in order", () => assert.deepEqual(exB.map((b) => b.heading), ["Cervical", "Lumbar", "General"]));
check("example C5-6", () => assert.equal(line(EX, "C5-6"), "C5-6: Left paracentral disc herniation (size cut off in the report) — spinal canal stenosis, cord compression, neuroforaminal narrowing (L>R); facet hypertrophy"));
check("example C6-7", () => assert.equal(line(EX, "C6-7"), "C6-7: Left paracentral disc herniation (size cut off in the report) — spinal canal stenosis, cord compression, neuroforaminal narrowing (L>R); posterior annular tear"));
check("example L5-S1", () => assert.equal(line(EX, "L5-S1"), "L5-S1: Left paracentral disc herniation (size cut off in the report) — thecal sac effacement"));
check("example general", () => assert.deepEqual(exB.at(-1)!.items, ["Degeneration, disc desiccation, mild osteophytosis, Modic type I endplate inflammation"]));
check("example boilerplate dropped", () => { assert.doesNotMatch(flat(EX), /correlation/i); assert.equal(parseSpineFindings(EX).dropped.length, 1); });
check("no all caps left", () => assert.doesNotMatch(flat(EX), /\b(?!L>R)[A-Z]{4,}\b/));

// Real-world styles (fictional)
const S1 = "IMPRESSION:\n1. 3 MM POSTERIOR DISC BULGE AT L4-5 INDENTING THE THECAL SAC.\n2. 4.5 MM RIGHT PARACENTRAL DISC PROTRUSION AT L5-S1 ABUTTING THE RIGHT S1 NERVE ROOT.\n3. MILD BILATERAL FACET HYPERTROPHY AT L4-5.";
check("numbered L4-5", () => assert.equal(line(S1, "L4-5"), "L4-5: 3 mm posterior disc bulge — thecal sac indentation; mild bilateral facet hypertrophy"));
check("numbered L5-S1 root", () => assert.equal(line(S1, "L5-S1"), "L5-S1: 4.5 mm right paracentral disc protrusion — right S1 nerve root abutment"));
const S2 = "Impression: At C4-C5 there is a 2 mm broad-based disc bulge. At C5-C6 there is a 3 mm central disc protrusion with mild spinal canal stenosis. Straightening of the normal cervical lordosis, which may reflect muscle spasm.";
check("sentence style C4-5", () => assert.equal(line(S2, "C4-5"), "C4-5: 2 mm broad-based disc bulge"));
check("sentence style C5-6", () => assert.equal(line(S2, "C5-6"), "C5-6: 3 mm central disc protrusion — mild spinal canal stenosis"));
check("sentence style general", () => assert.match(flat(S2), /General\nStraightening of the normal cervical lordosis/));
const S3 = "L3-4, L4-5 AND L5-S1 DISC DESICCATION WITH 2 MM DIFFUSE DISC BULGES; GRADE I ANTEROLISTHESIS OF L4 ON L5; NO FRACTURE. CLINICAL CORRELATION IS ADVISED.";
check("shared desiccation+bulge", () => { for (const l of ["L3-4", "L4-5", "L5-S1"]) assert.match(line(S3, l), /2 mm disc desiccation|disc desiccation|disc bulge/); });
check("clinical correlation dropped", () => assert.doesNotMatch(flat(S3), /correlation/i));
const S4 = "Mild degenerative disc disease. C6/7 left foraminal disc osteophyte complex causing moderate left neural foraminal narrowing. Minimal C5/6 disc bulge.";
check("slash levels + DOC", () => assert.equal(line(S4, "C6-7"), "C6-7: Left foraminal disc-osteophyte complex — moderate neuroforaminal narrowing (left)"));
check("minimal bulge", () => assert.equal(line(S4, "C5-6"), "C5-6: Disc bulge"));
check("ddd general", () => assert.match(flat(S4), /General\nMild degenerative disc disease/));
const S5 = "6 MM LEFT PARACENTRAL EXTRUSION AT L5-S1 COMPRESSING THE TRAVERSING LEFT S1 NERVE ROOT AND SEVERELY NARROWING THE LEFT LATERAL RECESS. ANNULAR FISSURE AT L4-L5.";
check("extrusion", () => assert.match(line(S5, "L5-S1"), /^L5-S1: 6 mm left paracentral disc extrusion — lateral recess narrowing, .*nerve root compression/));
check("annular fissure", () => assert.equal(line(S5, "L4-5"), "L4-5: Annular tear"));
const S6 = "Thoracic spine: T7-8 small right paracentral disc herniation without cord compression is not seen... T11-T12 2 mm disc bulge.";
check("thoracic", () => { assert.ok(blocks(S6).some((b) => b.heading === "Thoracic")); assert.equal(line(S6, "T11-12"), "T11-12: 2 mm disc bulge"); });
const S7 = "CERVICAL X-RAY: Loss of disc height at C5-6 and C6-7 with anterior osteophytes. Reversal of cervical lordosis.";
check("x-ray wording", () => { assert.match(line(S7, "C5-6"), /disc space narrowing/i); assert.match(line(S7, "C6-7"), /disc space narrowing/i); });
const S8 = "CT: Acute compression fracture of L1 vertebral body. Mild T12-L1 facet arthropathy.";
check("CT fracture general + facet", () => { assert.equal(line(S8, "T12-L1"), "T12-L1: Mild facet hypertrophy"); assert.match(flat(S8), /General\nAcute compression fracture of L1 vertebral body/); });
const S9 = "Multilevel spondylosis most pronounced at C5-6 where there is moderate canal stenosis and severe bilateral foraminal stenosis. Recommend follow-up as clinically indicated.";
check("spondylosis effects", () => assert.match(line(S9, "C5-6"), /moderate spinal canal stenosis.*severe neuroforaminal narrowing \(bilateral\)/i));
check("follow-up dropped", () => assert.doesNotMatch(flat(S9), /follow/i));
const S10 = "4MM C3-4 AND 3MM C4-5 POSTERIOR DISC HERNIATIONS";
check("sizes per level (best effort)", () => { assert.match(line(S10, "C3-4"), /disc herniation/); assert.match(line(S10, "C4-5"), /disc herniation/); });
const S11 = "NO SIGNIFICANT ABNORMALITY. UNREMARKABLE MRI OF THE LUMBAR SPINE.";
check("normal study: no levels, general kept", () => { const p = parseSpineFindings(S11); assert.equal(p.levels.length, 0); assert.ok(p.general.length); });
const S12 = "c5-6: 2mm right foraminal protrusion, mild right neuroforaminal narrowing\nc6-7: 3 mm disc bulge effacing the ventral thecal sac";
check("lowercase lines", () => { assert.equal(line(S12, "C5-6"), "C5-6: 2 mm right foraminal disc protrusion — mild neuroforaminal narrowing (right)"); assert.equal(line(S12, "C6-7"), "C6-7: 3 mm disc bulge — thecal sac effacement"); });
const S13 = "Modic type 1 endplate changes at L4-5. Schmorl's node at L2.";
check("modic at level", () => assert.equal(line(S13, "L4-5"), "L4-5: Modic type I endplate changes"));
const S14 = "Electronically signed by: Dr. Mock Radiologist. Thank you for the referral.";
check("signature dropped", () => { assert.equal(blocks(S14).length, 0); assert.equal(parseSpineFindings(S14).dropped.length, 2); });

// Filtering
check("filter level", () => assert.deepEqual(spineBlocks(parseSpineFindings(EX), { levels: ["L5/S1"] }).map((b) => b.heading), ["Lumbar"]));
check("filter region", () => assert.deepEqual(spineBlocks(parseSpineFindings(EX), { regions: ["cervical"] }).map((b) => b.heading), ["Cervical", "General"]));

// sentence()
check("sentence case keeps levels", () => assert.equal(sentence("LEFT C5-6 DISC BULGE L>R"), "Left C5-6 disc bulge L>R"));
check("sentence case keeps mixed text", () => assert.equal(sentence("Mild disc bulge at L4-5"), "Mild disc bulge at L4-5"));

// Wiring: G.O.A.T. MRI answers use the structured lines, with the original behind a toggle.
{
  const raw = "3 MM LEFT PARACENTRAL C5-6 & C6-7 DISC HERNIATIONS COMPRESSING THE CERVICAL CORD; 4 MM L5-S1 DISC BULGE; DISC DESICCATION; CORRELATION WITH CERVICALGIA IS RECOMMENDED.";
  const sb = structuredFindingBlocks(raw, ["Cervical", "Lumbar"], null);
  check("answer is structured", () => { assert.ok(sb.structured); assert.deepEqual(sb.blocks.map((b) => b.heading), ["Cervical", "Lumbar", "General"]); });
  check("answer drops boilerplate", () => assert.doesNotMatch(JSON.stringify(sb.blocks), /CORRELATION|correlation/));
  check("lumbar ask narrows", () => assert.deepEqual(structuredFindingBlocks(raw, ["Cervical", "Lumbar"], { regions: ["Lumbar"], levels: [], modalities: [] }).blocks.map((b) => b.heading)[0], "Lumbar"));
  check("non-spine text falls back", () => assert.equal(structuredFindingBlocks("Mock: small joint effusion of the knee.", ["Knee"], null).structured, false));
  const ui = readFileSync("src/components/global-goat.tsx", "utf8");
  check("chat has Show original", () => assert.match(ui, /Show original/));
  check("panel has Show original", () => assert.match(readFileSync("src/components/goat-panel.tsx", "utf8"), /Show original/));
  check("facts answer uses the parser", () => assert.match(readFileSync("src/lib/goat-facts-answer.ts", "utf8"), /parseSpineFindings/));
}

console.log(`spine-findings: ${pass}/${pass + fail} passed (fictional reports only)`);
if (fail) process.exit(1);
