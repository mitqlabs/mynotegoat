/**
 * Theme text contrast. Run: npx tsx scripts/tests/theme-contrast.test.ts
 *
 * Every built-in theme, plus a custom red-on-black My Theme, must keep
 * body text, muted text, links, headings, buttons, badges and danger
 * at WCAG AA (4.5:1) on the surface they sit on.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PRESET_IDS,
  PRESET_TOKENS,
  badgeInk,
  contrast,
  dangerInk,
  inkOn,
  linkInk,
  mutedInk,
  resolvedTheme,
  type MyTheme,
} from "../../src/lib/brand";

const MIN = 4.5;

function checkPair(label: string, fg: string, bg: string) {
  const ratio = contrast(fg, bg);
  assert.ok(ratio >= MIN, `${label} ${fg} on ${bg} is ${ratio.toFixed(2)}, needs ${MIN}`);
}

for (const id of PRESET_IDS) {
  for (const mode of ["light", "dark"] as const) {
    const t = PRESET_TOKENS[id][mode];
    const where = `${id} ${mode}`;
    checkPair(`${where} text/surface`, t.text, t.surface);
    checkPair(`${where} text/background`, t.text, t.background);
    checkPair(`${where} text/shell`, t.text, t.shell);
    checkPair(`${where} muted/surface`, t.muted, t.surface);
    checkPair(`${where} link/surface`, t.ink, t.surface);
    checkPair(`${where} button`, t.onBrand, t.accent);
    for (const wash of t.wash) checkPair(`${where} text/wash`, t.text, wash);
  }
}

const custom: MyTheme = { accent: "#e11d2e", background: "#000000", surface: "#141414", text: "#ffffff" };
const r = resolvedTheme(custom);
checkPair("custom text/surface", r.text, r.surface);
checkPair("custom muted/surface", r.muted, r.surface);
checkPair("custom link/surface", r.link, r.surface);
checkPair("custom heading", inkOn(r.heading), r.heading);
checkPair("custom button", r.buttonText, r.button);
checkPair("custom badge", badgeInk(r.badge, r.text), r.badge);
checkPair("custom danger/surface", r.danger, r.surface);
assert.equal(r.link, linkInk(custom.accent, custom.surface, custom.text));
assert.equal(r.muted, mutedInk(custom.text, custom.surface));
assert.equal(r.danger, dangerInk(custom.surface, custom.text));

const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
assert.match(css, /\.callout/, "shared callout class exists");
assert.match(css, /\.bg-amber-50[\s\S]{0,400}var\(--bg-panel\)/, "amber-50 fill follows the surface");
assert.match(css, /\.bg-yellow-50/, "yellow-50 fill is themed");
assert.match(css, /\.bg-\\\[\\#fef9e7\\\]/, "cream #fef9e7 fill is themed");
const checklist = readFileSync(new URL("../../src/components/reminder-setup-checklist.tsx", import.meta.url), "utf8");
assert.equal(/bg-(?:amber|yellow)-50|bg-white|bg-\[#fef9e7\]/.test(checklist), false, "setup steps use theme fills only (no cream REQUIRED box)");

const samples = readFileSync(new URL("../../src/components/theme-page-samples.tsx", import.meta.url), "utf8");
assert.equal(samples.includes("text-[var(--brand-ink)]"), false, "sample names are not the accent");
assert.ok(samples.includes("Contacts"), "previews include Contacts");

console.log("theme contrast ok");
