#!/usr/bin/env node
/**
 * Sanity check — runs before `npm run build` and on pre-push.
 *
 * Catches the exact categories of bug that caused the worst recent
 * incidents. Each rule is narrow and specific — we're not trying to
 * reinvent eslint, we're pinning down the three patterns that have
 * actually bitten us:
 *
 *   1. useEffect deps that include a frequently-changing primitive
 *      AND the effect body registers a window/document listener.
 *      That combo is the Chrome-OOM-fan-of-death pattern.
 *
 *   2. addEventListener / removeEventListener where the two calls
 *      pass non-identical function references (e.g. add uses
 *      `() => handleFoo()`, remove uses `handleFoo`). Cleanup
 *      silently no-ops, listeners accumulate.
 *
 *   3. Silent .catch(() => {}) on promises that come from dual-write
 *      / cloud paths. If the inner function's error-reporter doesn't
 *      run, the error vanishes.
 *
 * Exit 0 → clean, exit 1 → hits printed + fail the build.
 *
 * Run: `node scripts/sanity-check.mjs`
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath handles URL-encoded path segments (e.g. paths with
// spaces). `.pathname` leaves them as %20 which breaks readdirSync.
const ROOT = fileURLToPath(new URL("../src", import.meta.url));
const failures = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      checkFile(full);
    }
  }
}

function checkFile(path) {
  const src = readFileSync(path, "utf8");

  // ── Rule 1: matched-reference check for addEventListener/removeEventListener ──
  // Flag files that call addEventListener with an anonymous function
  // (arrow expression right in the call site) AND also call
  // removeEventListener — the shapes almost never match.
  const anonAddMatches = src.match(
    /addEventListener\(\s*["'][^"']+["']\s*,\s*\(/g,
  );
  const hasRemove = /removeEventListener\(/.test(src);
  if (anonAddMatches && hasRemove) {
    // Narrow to the case where an arrow like `() => foo()` is passed
    // inline — those cannot be cleaned up properly.
    const inlineArrow = /addEventListener\(\s*["'][^"']+["']\s*,\s*\([^)]*\)\s*=>\s*[^,)]/.test(src);
    if (inlineArrow) {
      failures.push({
        file: path,
        rule: "addEventListener with inline arrow function",
        hint:
          "Declare the handler in a const first, then pass the same reference " +
          "to both addEventListener and removeEventListener. Inline arrows " +
          "can't be cleaned up — each render adds a new listener.",
      });
    }
  }

  // ── Rule 2: silent fire-and-forget dual-write ──
  // Look for `.catch(() => {})` or `.catch(() => { /* ... */ })` that's
  // just swallowing without any reporter call inside.
  const silentCatch = src.match(
    /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*(?:\/\*[\s\S]*?\*\/\s*)?\}\s*\)/g,
  );
  if (silentCatch) {
    failures.push({
      file: path,
      rule: "Silent .catch(() => {}) swallowing promise errors",
      hint:
        "Route errors through reportCloudWriteError (or log them). Silent " +
        "catches make cloud-write failures invisible to the user — the exact " +
        "bug that lost 94 encounters.",
      count: silentCatch.length,
    });
  }

  // ── Rule 3: useEffect with frequently-changing deps that installs listeners ──
  // Find useEffects whose body contains addEventListener AND whose dep
  // array contains a lowercase identifier (i.e. a state/prop, not a
  // stable ref). Empty `[]` deps are safe. Refs are usually safe too.
  // This is heuristic — better to false-positive than false-negative.
  const useEffectRegex = /useEffect\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[([^\]]*)\]\s*\)/g;
  let match;
  while ((match = useEffectRegex.exec(src))) {
    const body = match[1];
    const deps = match[2].trim();
    if (!body.includes("addEventListener")) continue;
    if (deps === "" || deps === "/* eslint-disable */") continue;
    // Split deps on commas and count non-empty entries that look like
    // state/prop names (camelCase/identifier, not ending in .current).
    const depList = deps
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    const unstable = depList.filter((d) => !d.endsWith(".current"));
    if (unstable.length > 0) {
      failures.push({
        file: path,
        rule: "useEffect with listener and non-stable deps",
        hint:
          "An effect that registers a listener should have `[]` deps OR only " +
          "refs. A state/prop dep means the effect re-runs frequently and, if " +
          "the cleanup references don't match exactly, listeners accumulate. " +
          "This was the Chrome-OOM-fan-of-death pattern.",
        deps: unstable.join(", "),
      });
    }
  }
}

walk(ROOT);

if (failures.length === 0) {
  console.log("✓ sanity-check: all rules pass");
  process.exit(0);
}

console.error("✗ sanity-check FAILED — fix these before pushing:\n");
for (const f of failures) {
  console.error(`  [${f.rule}]`);
  console.error(`  ${f.file}`);
  if (f.count) console.error(`  occurrences: ${f.count}`);
  if (f.deps) console.error(`  deps: ${f.deps}`);
  console.error(`  → ${f.hint}`);
  console.error();
}
process.exit(1);
