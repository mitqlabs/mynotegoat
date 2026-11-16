/**
 * Office themes: contrast, swatches, My Theme, and the no-flash script.
 * Mock data only. Run: npx tsx scripts/tests/brand.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BRAND_KEY,
  THEMES,
  brandFrom,
  checkMyTheme,
  contrast,
  deriveDark,
  lookOf,
  mineColors,
  modeOf,
  sameTheme,
  varsOf,
  withMode,
  withTheme,
  type MyTheme,
} from "../../src/lib/brand";
import { BRAND_BOOT_SCRIPT } from "../../src/lib/brand-boot";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const css = readFileSync("src/app/globals.css", "utf8");

function block(brand: string, tone: string): Record<string, string> {
  const re = new RegExp(`\\[data-brand="${brand}"\\]\\[data-tone="${tone}"\\]\\s*\\{([^}]+)\\}`);
  const m = re.exec(css);
  assert.ok(m, `missing CSS block ${brand} ${tone}`);
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const prop = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/);
    if (prop) out[prop[1]] = prop[2].trim();
  }
  return out;
}

function hexOnly(value: string): string | null {
  const m = value.match(/#[0-9a-f]{6}/i);
  return m ? m[0].toLowerCase() : null;
}

const PAIRS: Array<[string, string, string]> = [
  ["text", "--text-main", "--shell-bg"],
  ["text/panel", "--text-main", "--bg-panel"],
  ["muted/shell", "--text-muted", "--shell-bg"],
  ["muted/panel", "--text-muted", "--bg-panel"],
  ["faint/shell", "--text-faint", "--shell-bg"],
  ["faint/panel", "--text-faint", "--bg-panel"],
  ["link/shell", "--brand-link", "--shell-bg"],
  ["link/panel", "--brand-link", "--bg-panel"],
  ["button", "--btn-ink", "--brand-primary"],
  ["sidebar", "--sidebar-text", "--bg-sidebar"],
  ["sidebar muted", "--sidebar-muted", "--bg-sidebar"],
  ["nav from", "--nav-ink", "--nav-from"],
  ["nav to", "--nav-ink", "--nav-to"],
  ["box", "--box-header-text", "--box-header-bg"],
  ["goat from", "--goat-text", "--goat-from"],
  ["goat via", "--goat-text", "--goat-via"],
  ["goat to", "--goat-text", "--goat-to"],
];

test("every preset Light and Dark clears 4.5 on the chrome", () => {
  for (const theme of THEMES) {
    if (theme.id === "mine") continue;
    for (const tone of ["light", "dark"] as const) {
      const vars = block(theme.id, tone);
      for (const [label, fg, bg] of PAIRS) {
        const a = hexOnly(vars[fg] ?? "");
        const b = hexOnly(vars[bg] ?? "");
        assert.ok(a && b, `${theme.id} ${tone} ${label} missing hex`);
        const ratio = contrast(a, b);
        assert.ok(ratio >= 4.5, `${theme.id} ${tone} ${label} ${a} on ${b} = ${ratio.toFixed(2)}`);
      }
    }
  }
});

test("preview swatches match the CSS", () => {
  for (const theme of THEMES) {
    if (theme.id === "mine") continue;
    for (const tone of ["light", "dark"] as const) {
      const vars = block(theme.id, tone);
      const swatch = theme[tone];
      assert.equal(hexOnly(vars["--brand-primary"]), swatch.accent, `${theme.id} ${tone} accent`);
      assert.equal(hexOnly(vars["--shell-bg"]), swatch.background, `${theme.id} ${tone} background`);
      assert.equal(hexOnly(vars["--bg-panel"]), swatch.surface, `${theme.id} ${tone} surface`);
      assert.equal(hexOnly(vars["--text-main"]), swatch.text, `${theme.id} ${tone} text`);
    }
  }
});

test("NoteGoat Blue Light is today's brand color", () => {
  assert.equal(THEMES[0].id, "blue");
  assert.equal(THEMES[0].light.accent, "#0d79bf");
  const vars = block("blue", "light");
  assert.equal(vars["--brand-primary"], "#0d79bf");
  assert.equal(vars["--shell-bg"], "#ffffff");
  assert.equal(vars["--bg-sidebar"], "#0f2e46");
  assert.equal(vars["--goat-from"], "#ffe7a3");
  assert.equal(vars["--goat-via"], "#ffc48a");
  assert.equal(vars["--goat-to"], "#8fd4e2");
});

test("bad data falls back to NoteGoat Blue, and My Theme without colours cannot be selected", () => {
  assert.equal(brandFrom(null).theme, "blue");
  assert.equal(brandFrom({ theme: "nope" }).theme, "blue");
  assert.equal(brandFrom({ theme: "mine" }).theme, "blue");
  assert.equal(brandFrom({ theme: "sunset" }).theme, "sunset");
  assert.equal(brandFrom("dark").theme, "blue");
});

test("modes are per person and there is no Auto", () => {
  const brand = withMode(withMode(brandFrom({ theme: "sunset" }), "u-a", "dark"), "u-b", "light");
  assert.equal(modeOf(brand, "u-a"), "dark");
  assert.equal(modeOf(brand, "u-b"), "light");
  assert.equal(modeOf(brand, "u-c"), "light");
  assert.equal(modeOf(brand, "u-a", "light"), "dark");
  const junk = brandFrom({ theme: "blue", modes: { "u-a": "auto", "u-b": "dark" } });
  assert.equal(junk.modes?.["u-a"], undefined);
  assert.equal(modeOf(junk, "u-b"), "dark");
});

test("saving a theme keeps other people's modes", () => {
  const remote = withMode(brandFrom({ theme: "blue" }), "u-a", "dark");
  const next = withTheme(remote, { theme: "harbor", modes: { "u-a": "light" } });
  assert.equal(next.theme, "harbor");
  assert.equal(next.modes?.["u-a"], "dark");
  assert.equal(sameTheme(next, { theme: "harbor" }), true);
  assert.equal(sameTheme(next, remote), false);
});

test("My Theme rejects unreadable text and derives a readable Dark", () => {
  const pale: MyTheme = { accent: "#f26b3a", background: "#fff1ea", surface: "#fff5f0", text: "#ffd0c2" };
  const bad = checkMyTheme(pale);
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.length > 0);
  const start = THEMES.find((t) => t.id === "mine")!.light;
  assert.equal(checkMyTheme(start).ok, true);
  const dark = deriveDark(start);
  assert.equal(checkMyTheme(dark).ok, true);
  assert.ok(contrast(dark.text, dark.background) >= 4.5);
  const colors = mineColors({ theme: "mine", mine: start }, "dark");
  assert.equal(colors.text, dark.text);
});

function assertShades(c: MyTheme, label: string) {
  const v = varsOf(c);
  const pairs: Array<[string, string]> = [
    ["--my-text", "--my-bg"],
    ["--my-text", "--my-surface"],
    ["--my-muted", "--my-bg"],
    ["--my-muted", "--my-surface"],
    ["--my-faint", "--my-bg"],
    ["--my-link", "--my-surface"],
    ["--my-link", "--my-bg"],
    ["--my-btn-ink", "--my-accent"],
    ["--my-sidebar-text", "--my-sidebar"],
    ["--my-sidebar-muted", "--my-sidebar"],
    ["--my-nav-ink", "--my-nav-from"],
    ["--my-nav-ink", "--my-nav-to"],
    ["--my-box-text", "--my-box"],
    ["--my-goat-text", "--my-goat-from"],
    ["--my-goat-text", "--my-goat-via"],
    ["--my-goat-text", "--my-goat-to"],
  ];
  for (const [fg, bg] of pairs) {
    const ratio = contrast(v[fg], v[bg]);
    assert.ok(ratio >= 4.5, `${label} ${fg} on ${bg} = ${ratio.toFixed(2)} (${v[fg]} / ${v[bg]})`);
  }
}

test("My Theme shades stay readable for the starter, a derived Dark, and a coral set", () => {
  const start = THEMES.find((t) => t.id === "mine")!.light;
  assertShades(start, "start");
  assertShades(deriveDark(start), "derived");
  assertShades(
    { accent: "#f26b3a", background: "#fff1ea", surface: "#fff8f5", text: "#3a2118" },
    "coral",
  );
  const look = lookOf({ theme: "mine", mine: start }, "dark");
  assert.equal(look.id, "mine");
  assert.equal(look.dark, true);
  assert.ok(look.vars["--my-bg"]);
  assert.deepEqual(lookOf({ theme: "sunset" }, "light").vars, {});
});

test("the no-flash script paints from the workspace cache and does not invent a mode", () => {
  assert.ok(BRAND_BOOT_SCRIPT.includes(BRAND_KEY));
  assert.ok(BRAND_BOOT_SCRIPT.includes("data-brand"));
  assert.ok(BRAND_BOOT_SCRIPT.includes("data-tone"));
  const store = new Map<string, string>();
  const attrs = new Map<string, string>();
  const style = new Map<string, string>();
  const g = globalThis as typeof globalThis & {
    localStorage?: Storage;
    document?: Document;
  };
  const previousStorage = g.localStorage;
  const previousDocument = g.document;
  g.localStorage = {
    get length() {
      return store.size;
    },
    key(i: number) {
      return [...store.keys()][i] ?? null;
    },
    getItem(k: string) {
      return store.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      store.set(k, v);
    },
    removeItem(k: string) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
  } as Storage;
  g.document = {
    documentElement: {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
      style: {
        setProperty(name: string, value: string) {
          style.set(name, value);
        },
        removeProperty(name: string) {
          style.delete(name);
        },
      },
    },
  } as unknown as Document;
  try {
    eval(BRAND_BOOT_SCRIPT);
    assert.equal(attrs.get("data-brand"), "blue");
    assert.equal(attrs.get("data-tone"), "light");
    store.set(BRAND_KEY, JSON.stringify({ theme: "sunset", modes: { "user-1": "dark" } }));
    store.set("sb-test-auth-token", JSON.stringify({ user: { id: "user-1" } }));
    eval(BRAND_BOOT_SCRIPT);
    assert.equal(attrs.get("data-brand"), "sunset");
    assert.equal(attrs.get("data-tone"), "dark");
    store.set(
      BRAND_KEY,
      JSON.stringify({
        theme: "mine",
        mine: { accent: "#0d79bf", background: "#eef6fb", surface: "#ffffff", text: "#172a3a" },
        modes: { "user-1": "dark" },
      }),
    );
    eval(BRAND_BOOT_SCRIPT);
    assert.equal(attrs.get("data-brand"), "mine");
    assert.equal(attrs.get("data-tone"), "dark");
    assert.ok(style.get("--my-bg"));
    assert.ok(contrast(style.get("--my-text")!, style.get("--my-bg")!) >= 4.5);
  } finally {
    g.localStorage = previousStorage;
    g.document = previousDocument;
  }
});

console.log(`brand: ${passed} passed`);
