/** Column-divider math + saved-width parsing (pure). Run: npx tsx scripts/tests/resizable-columns.test.ts */
import assert from "node:assert/strict";
import { equalFractions, moveDivider, parseFractions } from "../../src/components/resizable-columns";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

const eq = equalFractions(4);
assert.deepEqual(eq, [0.25, 0.25, 0.25, 0.25]);

const moved = moveDivider(eq, 1, 0.1);
close(moved[1], 0.35); close(moved[2], 0.15); close(sum(moved), 1);
assert.equal(moved[0], 0.25); assert.equal(moved[3], 0.25);

const clampedRight = moveDivider(eq, 0, 5);
close(clampedRight[1], 0.1); close(sum(clampedRight), 1);
const clampedLeft = moveDivider(eq, 0, -5);
close(clampedLeft[0], 0.1); close(sum(clampedLeft), 1);

assert.deepEqual(parseFractions(null, 4), eq);
assert.deepEqual(parseFractions("not json", 4), eq);
assert.deepEqual(parseFractions("[0.5,0.5]", 4), eq); // wrong count
assert.deepEqual(parseFractions("[0.5,0.5,0,0]", 4), eq); // collapsed column
const ok = parseFractions("[0.4,0.2,0.2,0.2]", 4);
close(ok[0], 0.4); close(sum(ok), 1);
const norm = parseFractions("[2,1,1,1]", 4);
close(sum(norm), 1);
console.log("resizable-columns: ok");
