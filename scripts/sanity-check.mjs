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
    // Open-gated listeners are the pattern Rule 6 asks for: a boolean
    // open/visible dep and an early `if (!open) return;` — at most one menu
    // listens at a time, and the cleanup is the same closure.
    const gated = (d) => /^(is)?(open|show|visible|expanded)\w*$/i.test(d) && new RegExp(String.raw`^\s*if\s*\(\s*!${d}\s*\)\s*return;`).test(body);
    const unstable = depList.filter((d) => !d.endsWith(".current") && !gated(d));
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

// Rule 4: every casemate.* / notegoat.* storage key must be registered as
// cloud-backed in src/lib/cloud-key-registry.ts. Nothing is browser-only.
{
  const regPath = join(ROOT, "lib", "cloud-key-registry.ts");
  const regSrc = readFileSync(regPath, "utf8");
  const registry = new Map(
    [...regSrc.matchAll(/^\s*"([^"]+)":\s*"(workspace|table|user|system)"/gm)].map((m) => [m[1], m[2]]),
  );
  const isPrefix = (k) => /[.:-]$/.test(k);
  const known = (key) =>
    registry.has(key) || [...registry.keys()].some((r) => isPrefix(r) && key.startsWith(r));
  const BARE = new Set(["casemate.", "notegoat.", "notegoat-"]);
  const files = [];
  (function collect(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) collect(full);
      else if (/\.(ts|tsx|js|mjs)$/.test(entry)) files.push(full);
    }
  })(ROOT);
  const unknown = new Map();
  for (const file of files) {
    if (file === regPath) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/["'`]((?:casemate\.|notegoat[.-])[A-Za-z0-9_.:-]*)/g)) {
      const key = m[1];
      if (BARE.has(key) || known(key)) continue;
      // IndexedDB database names / storage buckets, not localStorage keys.
      if (/^notegoat-(backup-?|big-cache|goat-facts|goat-text)$/.test(key)) continue;
      if (!unknown.has(key)) unknown.set(key, file.replace(ROOT, "src"));
    }
  }
  for (const [key, file] of unknown) {
    failures.push({
      file,
      rule: "storage key not registered as cloud-backed",
      hint: `"${key}" isn't in src/lib/cloud-key-registry.ts. Nothing may be browser-only: register it as workspace / table / user (mirrored to the user's cloud row) / system.`,
    });
  }
}

// Rule 5: G.O.A.T. office manager (src/lib/goat-om*.ts) is rules-only and
// cloud-backed only: no direct browser storage, no network / cloud AI, and its
// writes go through the app's registered cloud-backed stores.
{
  const libDir = join(ROOT, "lib");
  const omFiles = readdirSync(libDir).filter((f) => /^goat-om.*\.ts$/.test(f));
  const BANNED = [
    [/\b(localStorage|sessionStorage|indexedDB)\b/, "direct browser storage"],
    [/\bfetch\s*\(|XMLHttpRequest|\/api\//, "network call"],
    [/goat-ai\/(?!global-chat)|openai|anthropic|\bxai\b|\bllm\b|chat\/completions/i, "cloud AI"],
  ];
  const ALLOWED_STORES = new Set(["@/lib/patient-billing", "@/lib/mock-data", "@/lib/case-notes", "@/lib/local-sync", "@/lib/activity-log", "@/lib/goat-notes", "@/lib/goat-om", "@/lib/schedule-appointments", "@/lib/goat-ai/global-chat"]);
  for (const f of omFiles) {
    const src = readFileSync(join(libDir, f), "utf8").replace(/^\s*(\*|\/\/).*$/gm, "");
    for (const [re, what] of BANNED) {
      if (re.test(src)) failures.push({ file: `src/lib/${f}`, rule: `office manager: ${what}`, hint: "goat-om files are rules-only and may only write through cloud-backed stores (billing, patients, Case Notes)." });
    }
    for (const m of src.matchAll(/from\s+"(@\/[^"]+)"/g)) {
      if (!ALLOWED_STORES.has(m[1])) failures.push({ file: `src/lib/${f}`, rule: "office manager: unapproved import", hint: `${m[1]} isn't an approved cloud-backed store for the office manager. Add it to Rule 5 only if it is cloud-backed.` });
    }
  }
}

// Rule 6: no lifetime document/window input listeners per component instance.
// A component that can render once per list row (office pill, menus, pickers)
// must add document-level mousedown/click/keydown/... listeners only while it
// is open (useEffect gated on that state), or share one module-level listener.
// An effect with [] deps that installs one = one listener per row (the Texas
// "100 mousedown handlers" leak).
{
  const INPUT = /\b(document|window)\.addEventListener\(\s*["'](mousedown|mouseup|pointerdown|pointerup|click|keydown|keyup|touchstart|touchend)["']/g;
  // App-level singletons (mounted once), allowed to listen for their whole life.
  const SINGLETONS = new Set(["app/(portal)/layout.tsx", "components/fill-confirm-dialog.tsx", "components/checkout-note-guard.tsx"]);
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(f) ? [p] : []; });
  for (const file of walk(ROOT)) {
    const rel = file.slice(ROOT.length + 1);
    if (SINGLETONS.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(INPUT)) {
      const at = m.index ?? 0;
      const eff = src.lastIndexOf("useEffect(", at);
      if (eff < 0) continue; // module-level shared listener: fine
      // The effect's deps: the first "}, [ ... ])" after the listener.
      const deps = /\},\s*\[([^\]]*)\]\s*\)/.exec(src.slice(at));
      if (deps && deps[1].trim() === "") {
        failures.push({ file: `src/${rel}`, rule: "per-instance lifetime document listener", hint: `"${m[2]}" on ${m[1]} is added in a useEffect with [] deps. Add it only while open (useEffect(..., [open]) with an early return) or use one shared module-level listener; list rows render this hundreds of times.` });
      }
    }
  }
}

// Rule 7: every G.O.A.T. feature updates the Handbook (src/lib/handbook-goat.ts).
//   a) the chapter exists and is wired into the handbook;
//   b) the "/" list is generated from SLASH_COMMANDS (no hand-written copy);
//   c) when the branch changes G.O.A.T. feature code vs origin/main, it must
//      also change handbook-goat.ts. Skipped when git/origin isn't available.
{
  const hbPath = join(ROOT, "lib/handbook-goat.ts");
  let hb = "";
  try { hb = readFileSync(hbPath, "utf8"); } catch { /* reported below */ }
  if (!hb) failures.push({ file: "src/lib/handbook-goat.ts", rule: "G.O.A.T. handbook missing", hint: "Restore the Handbook → G.O.A.T. chapter." });
  else {
    if (!/SLASH_COMMANDS\.map/.test(hb)) failures.push({ file: "src/lib/handbook-goat.ts", rule: "G.O.A.T. handbook: command list not generated", hint: "Build the \"/\" command list from SLASH_COMMANDS so it stays in sync." });
    if (!readFileSync(join(ROOT, "lib/handbook-content.ts"), "utf8").includes("goatHandbookChapter")) failures.push({ file: "src/lib/handbook-content.ts", rule: "G.O.A.T. handbook not wired", hint: "Add goatHandbookChapter to a handbook chapter list." });
  }
  try {
    const { execSync } = await import("node:child_process");
    const base = execSync("git merge-base HEAD origin/main", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const changed = execSync(`git diff --name-only ${base} HEAD; git diff --name-only HEAD; git ls-files -o --exclude-standard src`, { stdio: ["ignore", "pipe", "ignore"], shell: "/bin/bash" }).toString().split("\n").filter(Boolean);
    const goatCode = changed.filter((f) => /^src\/(lib\/goat-[^/]+\.ts|lib\/goat-ai\/|components\/(global-goat|goat-)[^/]*\.tsx)/.test(f));
    if (goatCode.length && !changed.includes("src/lib/handbook-goat.ts")) {
      failures.push({ file: goatCode.slice(0, 3).join(", "), rule: "G.O.A.T. change without Handbook update", hint: "Every new G.O.A.T. feature must update Handbook → G.O.A.T. (src/lib/handbook-goat.ts). Add or adjust the task that describes it. See CONTRIBUTING.md." });
    }
  } catch {
    // No git / no origin (e.g. a tarball build): only a) and b) apply.
  }
}

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
