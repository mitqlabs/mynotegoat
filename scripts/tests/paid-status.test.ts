import assert from "node:assert/strict";
import { isPaidFilled } from "../../src/lib/paid-status";

assert.equal(isPaidFilled("10/01/2026", "1250.00"), true);
assert.equal(isPaidFilled("10/01/2026", 300), true);
assert.equal(isPaidFilled("", "1250"), false, "no paid date");
assert.equal(isPaidFilled("10/01/2026", ""), false, "no amount");
assert.equal(isPaidFilled("10/01/2026", "0"), false, "zero amount");
assert.equal(isPaidFilled("   ", "50"), false, "blank date");
// White on #1e7b4c contrast ≥ 4.5 (WCAG AA).
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = 1.05 / (lum("#1e7b4c") + 0.05);
assert.ok(ratio >= 4.5, `contrast ${ratio.toFixed(2)}`);
console.log(`PASS paid-status (7 checks, header contrast ${ratio.toFixed(2)}:1)`);
