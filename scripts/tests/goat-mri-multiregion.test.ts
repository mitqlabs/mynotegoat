/**
 * G.O.A.T. combined Cervical + Lumbar MRI: every region's levels show (mock text only).
 * Run: npx tsx scripts/tests/goat-mri-multiregion.test.ts
 */
import assert from "node:assert/strict";
import { extractFileFacts } from "../../src/lib/goat-facts";
import { parseSpineFindings, spineBlocks } from "../../src/lib/spine-findings";
import type { GoatFile } from "../../src/lib/goat-docs";

const text = `MRI CERVICAL AND LUMBAR SPINE WITHOUT CONTRAST
Patient: Test Patient
CERVICAL SPINE:
IMPRESSION:
1. C3-4 2 mm disc bulge.
2. C4-5 3 mm disc protrusion effacing the thecal sac.
3. C5-6 disc osteophyte complex with mild foraminal narrowing.
4. Straightening of the cervical lordosis.
LUMBAR SPINE:
1. L3-L4 2 mm disc bulge.
2. L4-L5 4 mm disc herniation indenting the thecal sac.
3. L5/S1 3 mm disc protrusion with bilateral foraminal narrowing.
Lumbar Spine: L2-3 mild facet hypertrophy.
`;
const f = extractFileFacts({ id: "mock", name: "MRI cervical lumbar.pdf", pages: [text] } as unknown as GoatFile);
const blocks = spineBlocks(parseSpineFindings(f.impressions.join("; ")));
const get = (h: string) => blocks.find((b) => b.heading === h)?.items.map((i) => i.split(":")[0]) ?? [];
assert.deepEqual(get("Cervical"), ["C3-4", "C4-5", "C5-6"]);
assert.deepEqual(get("Lumbar"), ["L2-3", "L3-4", "L4-5", "L5-S1"]);
assert.ok(blocks.find((b) => b.heading === "General"));

// Many lines: nothing truncated.
const many = `IMPRESSION:\n${Array.from({ length: 20 }, (_, i) => `${i + 1}. Finding number ${i + 1} disc bulge.`).join("\n")}`;
assert.equal(extractFileFacts({ id: "m2", name: "MRI lumbar.pdf", pages: [many] } as unknown as GoatFile).impressions.length, 20);
console.log("goat-mri-multiregion: ok");
