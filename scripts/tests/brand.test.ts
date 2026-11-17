/**
 * Themes: contrast on the main screens, CSS matches the palette, My Theme,
 * and the no-flash script. Mock data only.
 * Run: npx tsx scripts/tests/brand.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  PRESET_IDS,
  PRESET_TOKENS,
  THEMES,
  brandFrom,
  checkMyTheme,
  contrast,
  deriveDark,
  editMyThemeColor,
  mineColors,
  myThemeReadable,
  mix,
  sameTheme,
  screenPairs,
  toneFrom,
  toneReadbackOk,
  varsOf,
  type Mode,
} from "../../src/lib/brand";
import { THEME_SCRIPT } from "../../src/lib/theme-script";
import { settingsSearchCatalog } from "../../src/lib/settings-catalog";
import { SETTINGS_TABS } from "../../src/lib/settings-search";

const css = readFileSync("src/app/globals.css", "utf8");

function block(brand: string, tone: string): Record<string, string> {
  const re = new RegExp(`\\[data-brand="${brand}"\\]\\[data-tone="${tone}"\\]\\s*\\{([^}]+)\\}`);
  const found = css.match(re);
  assert.ok(found, `missing CSS for ${brand} ${tone}`);
  const vars: Record<string, string> = {};
  for (const part of found[1].split(";")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim().replace(/\s+/g, " ");
    if (key.startsWith("--")) vars[key] = value;
  }
  return vars;
}

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

test("NoteGoat Blue Light is today's palette", () => {
  const root = css.slice(css.indexOf(":root {"), css.indexOf("@theme inline"));
  for (const [name, value] of [
    ["--brand-primary", "#0d79bf"],
    ["--bg-canvas", "#eef6fb"],
    ["--bg-panel", "#fdfefe"],
    ["--bg-sidebar", "#0f2e46"],
    ["--text-main", "#172a3a"],
    ["--text-muted", "#57758b"],
    ["--shell-bg", "#ffffff"],
    ["--on-brand", "#ffffff"],
  ] as const) {
    assert.match(root, new RegExp(`${name}:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), name);
  }
  assert.match(css, /background:\s*var\(--shell-bg\)/);
  const blue = block("blue", "light");
  assert.equal(blue["--brand-primary"], "#0d79bf");
  assert.equal(blue["--bg-canvas"], "#eef6fb");
  assert.equal(blue["--bg-panel"], "#fdfefe");
  assert.equal(blue["--text-main"], "#172a3a");
  assert.equal(blue["--shell-bg"], "#ffffff");
  assert.equal(blue["--header-bg"], "rgba(255, 255, 255, 0.7)");
  assert.match(blue["--field-bg"], /#ffffff 0%, #f8fcff 100%/);
  assert.equal(blue["--sidebar-active"], "linear-gradient(90deg, #157bbf, #1a9ba9)");
});

test("every theme card matches the CSS, and the main screens stay readable", () => {
  for (const id of PRESET_IDS) {
    const info = THEMES.find((t) => t.id === id)!;
    for (const mode of ["light", "dark"] as Mode[]) {
      const tokens = PRESET_TOKENS[id][mode];
      const vars = block(id, mode);
      assert.equal(vars["--brand-primary"], tokens.accent, `${id} ${mode} accent`);
      assert.equal(vars["--brand-ink"], tokens.ink, `${id} ${mode} ink`);
      assert.equal(vars["--bg-canvas"], tokens.background, `${id} ${mode} background`);
      assert.equal(vars["--bg-panel"], tokens.surface, `${id} ${mode} surface`);
      assert.equal(vars["--text-main"], tokens.text, `${id} ${mode} text`);
      assert.equal(vars["--text-muted"], tokens.muted, `${id} ${mode} muted`);
      assert.equal(vars["--bg-sidebar"], tokens.sidebar, `${id} ${mode} sidebar`);
      assert.equal(vars["--on-brand"], tokens.onBrand, `${id} ${mode} button text`);
      assert.ok(vars["--sidebar-active"].includes(tokens.active1) && vars["--sidebar-active"].includes(tokens.active2));
      for (const stop of tokens.wash) assert.ok(vars["--shell-bg"].toLowerCase().includes(stop), `${id} ${mode} sky ${stop}`);
      assert.deepEqual(mode === "light" ? info.light : info.dark, {
        accent: tokens.accent,
        background: tokens.background,
        surface: tokens.surface,
        text: tokens.text,
      });
      for (const pair of screenPairs(tokens)) {
        const ratio = contrast(pair.a, pair.b);
        const knownShort =
          id === "blue" &&
          mode === "light" &&
          (pair.name === "muted on page" || pair.name === "accent text on page" || pair.name === "active end");
        if (knownShort) {
          assert.ok(ratio > 3, `${pair.screen} ${pair.name} slipped to ${ratio.toFixed(2)}`);
          continue;
        }
        assert.ok(ratio >= 4.5, `${id} ${mode} ${pair.screen} ${pair.name} is ${ratio.toFixed(2)}`);
      }
    }
  }
});

test("bad data falls back to NoteGoat Blue, and Dark is derived when unset", () => {
  assert.equal(brandFrom(null).theme, "blue");
  assert.equal(brandFrom({ theme: "nope" }).theme, "blue");
  assert.equal(brandFrom({ theme: "mine" }).theme, "blue");
  const custom = { accent: "#112233", background: "#f7f4ef", surface: "#fffdf8", text: "#1c1915" };
  const stored = brandFrom({ theme: "mine", mine: custom, savedAt: 5, extra: true });
  assert.equal(stored.theme, "mine");
  assert.deepEqual(stored.mine, custom);
  assert.equal(stored.mineDark, undefined);
  assert.deepEqual(mineColors(stored, "dark"), deriveDark(custom));
  assert.ok(checkMyTheme(deriveDark(custom)).ok, checkMyTheme(deriveDark(custom)).problems.join(" "));
  assert.equal(sameTheme(stored, { theme: "mine", mine: custom, mineDark: deriveDark(custom) }), false);
  assert.equal(sameTheme(stored, { theme: "sunset", mine: custom }), false);
  assert.equal(toneFrom(null, "dark"), "dark");
  assert.equal(toneFrom("light", "dark"), "light");
  assert.equal(toneFrom("nope", "nope"), "light");
});

test("My Theme refuses unreadable text and derives a readable Dark", () => {
  const pale = { accent: "#f4d7a1", background: "#fff8ee", surface: "#fffdf8", text: "#f6e7cf" };
  const bad = checkMyTheme(pale);
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.length > 0);
  const start = THEMES.find((t) => t.id === "mine")!.light;
  assert.equal(checkMyTheme(start).ok, true);
  const dark = deriveDark(start);
  assert.equal(checkMyTheme(dark).ok, true);
  const muted = mix(start.text, start.background, 0.32);
  assert.ok(contrast(muted, start.background) >= 4.5);
  assert.ok(contrast(muted, start.surface) >= 4.5);
  const ink = varsOf(start)["--my-accent-ink"];
  assert.ok(contrast(ink, start.surface) >= 4.5);
});

test("read-back accepts only the value that was saved", () => {
  const chosen = { theme: "sunset" as const, mine: THEMES[5].light };
  assert.equal(toneReadbackOk({ "casemate.theme-tone.v1": { v: "dark", at: 1 } }, "dark"), true);
  assert.equal(toneReadbackOk({ "casemate.theme-tone.v1": { v: "light", at: 1 } }, "dark"), false);
  assert.equal(toneReadbackOk({}, "dark"), false);
  assert.equal(sameTheme(brandFrom({ theme: "sunset", mine: chosen.mine, savedAt: 9 }), chosen), true);
  assert.equal(sameTheme(brandFrom({ theme: "blue" }), chosen), false);
});

test("the no-flash script sets data-brand and data-tone, and only reads the old browser value", () => {
  assert.equal(THEME_SCRIPT.includes("localStorage.setItem"), false);
  assert.ok(THEME_SCRIPT.includes("data-brand"));
  assert.ok(THEME_SCRIPT.includes("data-tone"));

  function run(storage: Record<string, string>, path = "/", search = "") {
    const attrs: Record<string, string> = {};
    const style = new Map<string, string>();
    const root = {
      setAttribute(name: string, value: string) {
        attrs[name] = value;
      },
      style: {
        setProperty(name: string, value: string) {
          style.set(name, value);
        },
        removeProperty(name: string) {
          style.delete(name);
        },
      },
    };
    vm.runInNewContext(THEME_SCRIPT, {
      document: { documentElement: root },
      localStorage: { getItem: (key: string) => (key in storage ? storage[key] : null) },
      location: { pathname: path, search },
      URLSearchParams,
    });
    return { attrs, style };
  }

  const fresh = run({});
  assert.equal(fresh.attrs["data-brand"], "blue");
  assert.equal(fresh.attrs["data-tone"], "light");

  const legacy = run({ "casemate.theme": "dark" });
  assert.equal(legacy.attrs["data-tone"], "dark");
  assert.equal(legacy.attrs["data-brand"], "blue");

  const chosen = run({ "casemate.theme": "dark", "casemate.theme-tone.v1": "light", "casemate.brand.v1": JSON.stringify({ theme: "sunset" }) });
  assert.equal(chosen.attrs["data-brand"], "sunset");
  assert.equal(chosen.attrs["data-tone"], "light");

  const light = THEMES[5].light;
  const derived = run({
    "casemate.theme-tone.v1": "dark",
    "casemate.brand.v1": JSON.stringify({ theme: "mine", mine: light }),
  });
  assert.equal(derived.attrs["data-brand"], "mine");
  assert.equal(derived.style.get("--my-bg"), deriveDark(light).background);
  assert.equal(derived.style.get("--my-accent"), deriveDark(light).accent);
  assert.equal(derived.style.get("--my-accent-ink"), varsOf(deriveDark(light))["--my-accent-ink"]);

  const locked = run({}, "/theme-lab", "?theme=sunset&tone=dark");
  assert.equal(locked.attrs["data-theme-lock"], "1");
  assert.equal(locked.attrs["data-brand"], "sunset");
  assert.equal(locked.attrs["data-tone"], "dark");
});

test("editing a My Theme color is a real change and can be saved", () => {
  const saved = brandFrom({ theme: "mine", mine: THEMES[5].light });
  const edited = editMyThemeColor(saved, "light", "accent", "#0a5c96");
  assert.ok(edited);
  assert.equal(edited.theme, "mine");
  assert.equal(edited.mine?.accent, "#0a5c96");
  assert.equal(edited.mineDark, undefined);
  assert.equal(sameTheme(saved, edited), false);
  assert.equal(myThemeReadable(edited), true);

  const dark = editMyThemeColor(saved, "dark", "background", "#101820");
  assert.ok(dark?.mineDark);
  assert.equal(dark.mineDark.background, "#101820");
  assert.equal(sameTheme(saved, dark), false);
  assert.equal(dark.mine?.accent, saved.mine?.accent);
  assert.equal(editMyThemeColor(saved, "light", "accent", "nope"), null);
});

test("Themes is a Settings section on the Office tab, with no explainer subtitle", () => {
  const entry = settingsSearchCatalog.find((item) => item.key === "themes");
  assert.equal(entry?.title, "Themes");
  assert.equal(entry?.description, undefined);
  const office = SETTINGS_TABS.find((tab) => tab.id === "office");
  assert.ok(office?.keys.includes("themes"));
  const elsewhere = SETTINGS_TABS.filter((tab) => tab.id !== "office" && tab.id !== "all" && tab.keys.includes("themes"));
  assert.deepEqual(elsewhere, []);

  const page = readFileSync("src/app/(portal)/settings/page.tsx", "utf8");
  const at = page.indexOf('id="themes"');
  assert.ok(at > 0);
  const themesBlock = page.slice(Math.max(0, at - 250), at + 80);
  assert.equal(themesBlock.includes("description="), false);

  const section = readFileSync("src/components/themes-section.tsx", "utf8");
  assert.equal(section.includes("Your Mode"), false);
  assert.equal(section.includes("Save Theme"), false);
  assert.equal(section.includes("Previewing"), false);
  assert.ok(section.includes("savePersonTone"));
  assert.ok(section.includes("saveOfficeBrand"));
  assert.ok(section.includes("COLOR_SAVE_MS"));
  assert.ok(section.includes('aria-label="Light or Dark"'));

  const shell = readFileSync("src/components/app-shell.tsx", "utf8");
  assert.equal(shell.includes("ThemeModeSwitch"), false);
  assert.equal(readFileSync("src/lib/cloud/brand-save.ts", "utf8").includes("fetchKvValue(BRAND_STORAGE_KEY)"), true);
});

console.log(`\n${passed} passed`);
