/**
 * The office's look. Five ready-made themes and a sixth the office builds.
 *
 * The theme is an office setting (workspace_kv, casemate.brand.v1) so everyone
 * in the office sees the same NoteGoat. Light or Dark belongs to each person
 * (casemate.theme-tone.v1, mirrored to that person's cloud row). Nothing is
 * kept only in the browser: an old per-device value is read as a fallback
 * until that person picks.
 *
 * Ready-made themes are written out in globals.css. Only My Theme's own
 * colours live here; globals.css turns them into the other shades.
 *
 * This file is plain code with no imports so the tests can run it.
 */

export const PRESET_IDS = ["blue", "sunset", "harbor", "grove", "cedar"] as const;
export const THEME_IDS = [...PRESET_IDS, "mine"] as const;
export type PresetId = (typeof PRESET_IDS)[number];
export type ThemeId = (typeof THEME_IDS)[number];

export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];

export const BRAND_STORAGE_KEY = "casemate.brand.v1";
export const TONE_STORAGE_KEY = "casemate.theme-tone.v1";
/** Old per-device values. Read only, never written. */
export const LEGACY_TONE_KEYS = ["casemate.theme", "notegoat.theme"] as const;

/** Extra My Theme picks. Missing keys stay derived from the four base colours. */
export const EXTRA_COLOR_KEYS = ["link", "muted", "heading", "button", "buttonText", "line", "badge", "danger"] as const;
export type ExtraColorKey = (typeof EXTRA_COLOR_KEYS)[number];

/** The four base colours, plus optional picks that override the derived shades. */
export interface MyTheme {
  accent: string;
  background: string;
  surface: string;
  text: string;
  link?: string;
  muted?: string;
  heading?: string;
  button?: string;
  buttonText?: string;
  line?: string;
  badge?: string;
  danger?: string;
}

/** Every shade a ready-made theme paints. `accent` is the button color. */
export interface ThemeTokens extends MyTheme {
  /** Link and highlight text. Light themes use the same color as `accent`. */
  ink: string;
  muted: string;
  soft: string;
  line: string;
  sidebar: string;
  sidebarText: string;
  sidebarMuted: string;
  sidebarLink: string;
  onBrand: string;
  active1: string;
  active2: string;
  secondary: string;
  header: string;
  /** Solid stand-in for the page wash, used when checking contrast. */
  shell: string;
  /** Extra colors inside a gradient wash. Each one is checked for contrast. */
  wash: string[];
}

export interface BrandSettings {
  theme: ThemeId;
  /** My Theme's Light colours. Kept even while another theme is chosen. */
  mine?: MyTheme;
  /** My Theme's Dark colours. When missing they are worked out from the Light. */
  mineDark?: MyTheme;
}

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  blurb: string;
  light: MyTheme;
  dark: MyTheme;
}

const BLUE_LIGHT: ThemeTokens = {
  accent: "#0d79bf",
  ink: "#0d79bf",
  background: "#eef6fb",
  surface: "#fdfefe",
  text: "#172a3a",
  muted: "#57758b",
  soft: "#e4f0f7",
  line: "#d7e6f1",
  sidebar: "#0f2e46",
  sidebarText: "#e4f4ff",
  sidebarMuted: "#aad0e4",
  sidebarLink: "#d5ebf8",
  onBrand: "#ffffff",
  active1: "#157bbf",
  active2: "#1a9ba9",
  secondary: "#1aa0a2",
  header: "#ffffff",
  shell: "#ffffff",
  wash: [],
};

const SUNSET_LIGHT: ThemeTokens = {
  accent: "#b03a12",
  ink: "#b03a12",
  background: "#fff1ea",
  surface: "#fff8f4",
  text: "#3b1c16",
  muted: "#7a4638",
  soft: "#ffe0d4",
  line: "#f0c2b4",
  sidebar: "#4a2030",
  sidebarText: "#ffe8e2",
  sidebarMuted: "#f0c2b6",
  sidebarLink: "#ffd8cc",
  onBrand: "#ffffff",
  active1: "#b03a12",
  active2: "#9a3058",
  secondary: "#9a3058",
  header: "#fff0e8",
  shell: "#ffe4d8",
  wash: ["#ffe8dc", "#ffd6c8", "#ffd7e1", "#ffe9d6"],
};

const HARBOR_LIGHT: ThemeTokens = {
  accent: "#0c5e5b",
  ink: "#0c5e5b",
  background: "#e7f4f2",
  surface: "#f7fcfb",
  text: "#102624",
  muted: "#3c5f5c",
  soft: "#d5ebe8",
  line: "#b7d4cf",
  sidebar: "#0c2e2c",
  sidebarText: "#e6f7f5",
  sidebarMuted: "#b5d9d4",
  sidebarLink: "#d4eeea",
  onBrand: "#ffffff",
  active1: "#0c5e5b",
  active2: "#0e4e68",
  secondary: "#0e4e68",
  header: "#f3faf9",
  shell: "#e7f4f2",
  wash: ["#e7f4f2", "#d5ebe8", "#e5f2f6"],
};

const GROVE_LIGHT: ThemeTokens = {
  accent: "#215c32",
  ink: "#215c32",
  background: "#eef4ea",
  surface: "#f8fbf6",
  text: "#1a291c",
  muted: "#3e5942",
  soft: "#dce8d8",
  line: "#c5d7c0",
  sidebar: "#16301c",
  sidebarText: "#e8f5ea",
  sidebarMuted: "#b7d4bc",
  sidebarLink: "#d5ead9",
  onBrand: "#ffffff",
  active1: "#215c32",
  active2: "#2f5a3a",
  secondary: "#2f5a3a",
  header: "#f3f7ef",
  shell: "#eef4ea",
  wash: ["#eef4ea", "#e0ecd8", "#e7f0e4"],
};

const CEDAR_LIGHT: ThemeTokens = {
  accent: "#8a4520",
  ink: "#8a4520",
  background: "#f6efe6",
  surface: "#fbf7f2",
  text: "#2b2118",
  muted: "#6a5140",
  soft: "#f0e2d2",
  line: "#e2cbb6",
  sidebar: "#3a291c",
  sidebarText: "#f8efe6",
  sidebarMuted: "#e2c8b2",
  sidebarLink: "#f0dcc8",
  onBrand: "#ffffff",
  active1: "#8a4520",
  active2: "#6e3a28",
  secondary: "#6e3a28",
  header: "#f8f1e8",
  shell: "#f6efe6",
  wash: ["#f6efe6", "#f3e6d6", "#f8efe4"],
};

const BLUE_DARK: ThemeTokens = {
  accent: "#157bbf",
  ink: "#9ed4f5",
  background: "#0c1924",
  surface: "#15283a",
  text: "#e7f3fb",
  muted: "#b5cfe0",
  soft: "#1c3348",
  line: "#2c4a63",
  sidebar: "#08141c",
  sidebarText: "#e7f4fc",
  sidebarMuted: "#b7d0e0",
  sidebarLink: "#d7ebf6",
  onBrand: "#ffffff",
  active1: "#157bbf",
  active2: "#14689f",
  secondary: "#3aa0a8",
  header: "#122433",
  shell: "#0c1924",
  wash: ["#0c1924", "#143047"],
};

const SUNSET_DARK: ThemeTokens = {
  accent: "#b5552b",
  ink: "#ffc2a8",
  background: "#1a0e12",
  surface: "#2c1820",
  text: "#ffe8e1",
  muted: "#efc2b6",
  soft: "#3a2228",
  line: "#5a3842",
  sidebar: "#12080c",
  sidebarText: "#ffe8e1",
  sidebarMuted: "#efc2b6",
  sidebarLink: "#ffd5c8",
  onBrand: "#ffffff",
  active1: "#b5552b",
  active2: "#9a3d4e",
  secondary: "#9a3d4e",
  header: "#24141a",
  shell: "#1a0e12",
  wash: ["#1a0e12", "#3a1822"],
};

const HARBOR_DARK: ThemeTokens = {
  accent: "#107e77",
  ink: "#9ee6dc",
  background: "#0b1c1b",
  surface: "#14302e",
  text: "#e5f6f4",
  muted: "#b7d9d4",
  soft: "#1c3d3a",
  line: "#2d5652",
  sidebar: "#071413",
  sidebarText: "#e5f6f4",
  sidebarMuted: "#b7d9d4",
  sidebarLink: "#d4eeea",
  onBrand: "#ffffff",
  active1: "#107e77",
  active2: "#0e6878",
  secondary: "#0e6878",
  header: "#122826",
  shell: "#0b1c1b",
  wash: ["#0b1c1b", "#12302e"],
};

const GROVE_DARK: ThemeTokens = {
  accent: "#208239",
  ink: "#b6e7c2",
  background: "#101a12",
  surface: "#1b2e20",
  text: "#e8f6ea",
  muted: "#c0ddc6",
  soft: "#243c28",
  line: "#3b5a40",
  sidebar: "#0b140d",
  sidebarText: "#e8f6ea",
  sidebarMuted: "#c0ddc6",
  sidebarLink: "#d7ecd9",
  onBrand: "#ffffff",
  active1: "#208239",
  active2: "#1d6e34",
  secondary: "#1d6e34",
  header: "#17261b",
  shell: "#101a12",
  wash: ["#101a12", "#1a2e1e"],
};

const CEDAR_DARK: ThemeTokens = {
  accent: "#a26131",
  ink: "#f3c7a4",
  background: "#1a130e",
  surface: "#2c2118",
  text: "#f8efe6",
  muted: "#e4cbb6",
  soft: "#3a2c22",
  line: "#5c4636",
  sidebar: "#120d0a",
  sidebarText: "#f8efe6",
  sidebarMuted: "#e4cbb6",
  sidebarLink: "#f3ddc8",
  onBrand: "#ffffff",
  active1: "#a26131",
  active2: "#8a4e28",
  secondary: "#8a4e28",
  header: "#241b14",
  shell: "#1a130e",
  wash: ["#1a130e", "#2c1c14"],
};

export const PRESET_TOKENS: Record<PresetId, { light: ThemeTokens; dark: ThemeTokens }> = {
  blue: { light: BLUE_LIGHT, dark: BLUE_DARK },
  sunset: { light: SUNSET_LIGHT, dark: SUNSET_DARK },
  harbor: { light: HARBOR_LIGHT, dark: HARBOR_DARK },
  grove: { light: GROVE_LIGHT, dark: GROVE_DARK },
  cedar: { light: CEDAR_LIGHT, dark: CEDAR_DARK },
};

function card(tokens: ThemeTokens): MyTheme {
  return {
    accent: tokens.accent,
    background: tokens.background,
    surface: tokens.surface,
    text: tokens.text,
  };
}

export const THEMES: ThemeInfo[] = [
  { id: "blue", name: "NoteGoat Blue", blurb: "The Blue You Have Now", light: card(BLUE_LIGHT), dark: card(BLUE_DARK) },
  { id: "sunset", name: "Sunset", blurb: "Peach, Coral, And Pink", light: card(SUNSET_LIGHT), dark: card(SUNSET_DARK) },
  { id: "harbor", name: "Harbor", blurb: "Quiet Teal Water", light: card(HARBOR_LIGHT), dark: card(HARBOR_DARK) },
  { id: "grove", name: "Grove", blurb: "Soft Sage Green", light: card(GROVE_LIGHT), dark: card(GROVE_DARK) },
  { id: "cedar", name: "Cedar", blurb: "Warm Wood And Cream", light: card(CEDAR_LIGHT), dark: card(CEDAR_DARK) },
  {
    id: "mine",
    name: "My Theme",
    blurb: "Pick Your Own Colors",
    light: { accent: "#0d79bf", background: "#eef6fb", surface: "#fdfefe", text: "#172a3a" },
    dark: { accent: "#5eb0e0", background: "#13202b", surface: "#1c2d3b", text: "#fdfefe" },
  },
];

export const DEFAULT_BRAND: BrandSettings = { theme: "blue" };
export const MY_THEME_START: MyTheme = THEMES[5].light;

export function themeInfo(id: ThemeId): ThemeInfo {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** "#rrggbb", or null when it is not a colour. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = HEX.exec(value.trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h}`;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const lin = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `amount` (0–1) of `b` mixed into `a`. Matches CSS color-mix in srgb. */
export function mix(a: string, b: string, amount: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * amount) as [number, number, number]);
}

/** Black or white, whichever reads better on `on`. */
export function inkOn(on: string): string {
  return contrast(on, "#ffffff") >= contrast(on, "#000000") ? "#ffffff" : "#000000";
}

/**
 * The accent, nudged toward the text colour until it can be read as text on
 * the surface. A pale gold that makes a lovely button makes an unreadable link.
 */
export function readableAccent(accent: string, surface: string, text: string): string {
  let out = accent;
  for (let i = 0; i < 24 && contrast(out, surface) < 4.5; i++) out = mix(out, text, 0.12);
  return out;
}

export function isDark(background: string): boolean {
  return luminance(background) < 0.2;
}

/** A Dark version worked out from a Light one, when Dark was never set. */
export function deriveDark(light: MyTheme): MyTheme {
  return {
    background: mix(light.background, "#000000", 0.92),
    surface: mix(light.background, "#000000", 0.86),
    text: mix(light.surface, "#ffffff", 0.1),
    accent: mix(light.accent, "#ffffff", 0.3),
  };
}

function myThemeFrom(value: unknown): MyTheme | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const accent = normalizeHex(v.accent);
  const background = normalizeHex(v.background);
  const surface = normalizeHex(v.surface);
  const text = normalizeHex(v.text);
  if (!accent || !background || !surface || !text) return undefined;
  const theme: MyTheme = { accent, background, surface, text };
  for (const key of EXTRA_COLOR_KEYS) {
    const hex = normalizeHex(v[key]);
    if (hex) theme[key] = hex;
  }
  return theme;
}

/** Secondary text: stepped toward the surface, never below 4.5:1. */
export function mutedInk(text: string, surface: string): string {
  let color = text;
  for (let i = 0; i < 16; i++) {
    const next = mix(color, surface, 0.12);
    if (contrast(next, surface) < 4.5) break;
    color = next;
  }
  return color;
}

/** Accent used as a link, nudged until it reads on the surface. */
export function linkInk(accent: string, surface: string, text: string): string {
  return readableAccent(accent, surface, text);
}

/** A readable danger red on the surface. */
export function dangerInk(surface: string, text: string): string {
  return readableAccent("#c9423a", surface, text);
}

/** Words on a badge fill: the theme text when it clears 4.5:1, otherwise black or white. */
export function badgeInk(badge: string, text: string): string {
  return contrast(text, badge) >= 4.5 ? text : inkOn(badge);
}

/** Base colours plus every extra, using a stored pick when there is one. */
export function resolvedTheme(c: MyTheme): MyTheme & Record<ExtraColorKey, string> {
  const button = c.button ?? c.accent;
  return {
    ...c,
    link: c.link ?? linkInk(c.accent, c.surface, c.text),
    muted: c.muted ?? mutedInk(c.text, c.surface),
    heading: c.heading ?? c.accent,
    button,
    buttonText: c.buttonText ?? inkOn(button),
    line: c.line ?? mix(c.text, c.surface, 0.82),
    badge: c.badge ?? mix(c.accent, c.surface, 0.84),
    danger: c.danger ?? dangerInk(c.surface, c.text),
  };
}

/** True when this pick is too close to the colour behind it. */
export function swatchHardToRead(key: ExtraColorKey | "text" | "accent", c: MyTheme): boolean {
  const r = resolvedTheme(c);
  if (key === "text") return Math.min(contrast(r.text, r.surface), contrast(r.text, r.background)) < 4.5;
  if (key === "accent" || key === "button" || key === "buttonText") return contrast(r.buttonText, r.button) < 4.5;
  if (key === "link") return contrast(r.link, r.surface) < 4.5;
  if (key === "muted") return contrast(r.muted, r.surface) < 4.5;
  if (key === "heading") return contrast(inkOn(r.heading), r.heading) < 4.5;
  if (key === "badge") return contrast(badgeInk(r.badge, r.text), r.badge) < 4.5;
  if (key === "danger") return contrast(r.danger, r.surface) < 4.5;
  return contrast(r.line, r.surface) < 1.08;
}

/**
 * Whatever the database holds, as a usable setting. Anything unreadable falls
 * back to NoteGoat Blue. A missing row means the office never chose.
 */
export function brandFrom(value: unknown): BrandSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { theme: "blue" };
  const v = value as Record<string, unknown>;
  let theme: ThemeId = THEME_IDS.find((t) => t === v.theme) ?? "blue";
  const mine = myThemeFrom(v.mine);
  const mineDark = myThemeFrom(v.mineDark);
  if (theme === "mine" && !mine) theme = "blue";
  return { theme, ...(mine ? { mine } : {}), ...(mineDark ? { mineDark } : {}) };
}

/** The theme and My Theme colours, ignoring anything else stored beside them. */
export function sameTheme(a: BrandSettings, b: BrandSettings): boolean {
  const x = brandFrom(a);
  const y = brandFrom(b);
  return JSON.stringify([x.theme, x.mine ?? null, x.mineDark ?? null]) === JSON.stringify([y.theme, y.mine ?? null, y.mineDark ?? null]);
}

/** My Theme's colours for a mode, as the office set them or as we worked them out. */
export function mineColors(b: BrandSettings, mode: Mode): MyTheme {
  const light = b.mine ?? MY_THEME_START;
  if (mode === "light") return light;
  return b.mineDark ?? (b.mine ? deriveDark(light) : THEMES[5].dark);
}

/**
 * My Theme with one colour changed. Light edits keep a Dark the office
 * already set. Dark edits store their own four, so a later Light change
 * does not move them. Null when the value is not a colour.
 */
export function editMyThemeColor(brand: BrandSettings, mode: Mode, key: keyof MyTheme, value: string): BrandSettings | null {
  const hex = normalizeHex(value);
  if (!hex) return null;
  const light = mineColors(brand, "light");
  const dark = mineColors(brand, "dark");
  return brandFrom({
    theme: "mine",
    mine: mode === "light" ? { ...light, [key]: hex } : light,
    mineDark: mode === "dark" ? { ...dark, [key]: hex } : brand.mineDark,
  });
}

/** Both Light and Dark of My Theme can be read. */
export function myThemeReadable(brand: BrandSettings): boolean {
  return checkMyTheme(mineColors(brand, "light")).ok && checkMyTheme(mineColors(brand, "dark")).ok;
}

export interface ThemeLook {
  id: ThemeId;
  dark: boolean;
  /** Inline custom properties. Only My Theme has any. */
  vars: Record<string, string>;
}

/** The custom properties My Theme's rules read. */
export function varsOf(c: MyTheme): Record<string, string> {
  const r = resolvedTheme(c);
  const ink = readableAccent(c.accent, c.surface, c.text);
  return {
    "--my-bg": c.background,
    "--my-surface": c.surface,
    "--my-text": c.text,
    "--my-accent": c.accent,
    "--my-accent-ink": ink,
    "--my-btn-ink": r.buttonText,
    "--my-link": r.link,
    "--my-muted": r.muted,
    "--my-heading": r.heading,
    "--my-heading-ink": inkOn(r.heading),
    "--my-button": r.button,
    "--my-button-text": r.buttonText,
    "--my-line": r.line,
    "--my-badge": r.badge,
    "--my-badge-ink": badgeInk(r.badge, c.text),
    "--my-danger": r.danger,
  };
}

export const MY_VARS = [
  "--my-bg",
  "--my-surface",
  "--my-text",
  "--my-accent",
  "--my-accent-ink",
  "--my-btn-ink",
  "--my-link",
  "--my-muted",
  "--my-heading",
  "--my-heading-ink",
  "--my-button",
  "--my-button-text",
  "--my-line",
  "--my-badge",
  "--my-badge-ink",
  "--my-danger",
];

export function lookOf(brand: BrandSettings, mode: Mode = "light"): ThemeLook {
  const b = brandFrom(brand);
  if (b.theme !== "mine") return { id: b.theme, dark: mode === "dark", vars: {} };
  return { id: "mine", dark: mode === "dark", vars: varsOf(mineColors(b, mode)) };
}

export interface ThemeCheck {
  ok: boolean;
  problems: string[];
  notes: string[];
  textContrast: number;
  buttonContrast: number;
}

/** Can people read it? Text must clear 4.5:1 on both the page and the cards. */
export function checkMyTheme(c: MyTheme): ThemeCheck {
  const textContrast = Math.min(contrast(c.text, c.background), contrast(c.text, c.surface));
  const buttonContrast = contrast(c.accent, inkOn(c.accent));
  const problems: string[] = [];
  const notes: string[] = [];
  if (textContrast < 4.5) {
    problems.push("The text is too close to the background to read comfortably. Pick a darker text or a lighter background (or the other way round).");
  }
  if (buttonContrast < 4.5) {
    problems.push("The accent is too light for the words on a button. Pick a stronger accent.");
  }
  if (contrast(c.surface, c.background) < 1.04) {
    notes.push("Cards and the page are almost the same color, so cards will not stand out.");
  }
  if (contrast(readableAccent(c.accent, c.surface, c.text), c.surface) < 4.5) {
    notes.push("The accent is pale on cards, so NoteGoat will darken it where it is used as text.");
  }
  return { ok: problems.length === 0, problems, notes, textContrast, buttonContrast };
}

/** True when a person's prefs row still has the value that was saved. */
export function toneReadbackOk(stored: unknown, value: string, key = TONE_STORAGE_KEY): boolean {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return false;
  const entry = (stored as Record<string, { v?: unknown }>)[key];
  return entry?.v === value;
}

/** A stored tone, or null when this person has not picked yet. */
export function storedTone(value: unknown): Mode | null {
  return value === "light" || value === "dark" ? value : null;
}

/** Person's mode. The old browser value is used only when nothing is saved. */
export function toneFrom(stored: unknown, legacy: unknown): Mode {
  return storedTone(stored) ?? (legacy === "dark" ? "dark" : "light");
}

/**
 * Pairs that must stay readable on the main screens. NoteGoat Blue Light is
 * today's look, including two pairs that were already a hair under 4.5
 * (muted text on the canvas, and the teal end of the sidebar highlight).
 * Every other theme and tone has to clear 4.5 on all of them.
 */
export function screenPairs(tokens: ThemeTokens): Array<{ screen: string; name: string; a: string; b: string }> {
  const body = [
    ["text on page", tokens.text, tokens.background],
    ["text on card", tokens.text, tokens.surface],
    ["text on header", tokens.text, tokens.header],
    ["text on wash", tokens.text, tokens.shell],
    ["muted on page", tokens.muted, tokens.background],
    ["muted on card", tokens.muted, tokens.surface],
    ["muted on header", tokens.muted, tokens.header],
    ["accent text on card", tokens.ink, tokens.surface],
    ["accent text on page", tokens.ink, tokens.background],
    ["accent text on header", tokens.ink, tokens.header],
    ["button label", tokens.onBrand, tokens.accent],
  ] as const;
  const screens = ["Dashboard", "G.O.A.T. Page", "Patient Page", "SOAP", "Schedule"];
  const rows: Array<{ screen: string; name: string; a: string; b: string }> = [];
  for (const screen of screens) {
    for (const [name, a, b] of body) rows.push({ screen, name, a, b });
    for (const stop of tokens.wash) rows.push({ screen, name: "text on sky", a: tokens.text, b: stop });
    for (const stop of tokens.wash) rows.push({ screen, name: "muted on sky", a: tokens.muted, b: stop });
  }
  rows.push({ screen: "Sidebar", name: "sidebar text", a: tokens.sidebarText, b: tokens.sidebar });
  rows.push({ screen: "Sidebar", name: "sidebar muted", a: tokens.sidebarMuted, b: tokens.sidebar });
  rows.push({ screen: "Sidebar", name: "sidebar link", a: tokens.sidebarLink, b: tokens.sidebar });
  rows.push({ screen: "Sidebar", name: "active start", a: tokens.onBrand, b: tokens.active1 });
  rows.push({ screen: "Sidebar", name: "active end", a: tokens.onBrand, b: tokens.active2 });
  return rows;
}

/** CSS custom properties for one ready-made theme. Blue Light matches :root. */
export function cssVarsFor(tokens: ThemeTokens, shell: string): Record<string, string> {
  return {
    "--brand-primary": tokens.accent,
    "--brand-ink": tokens.ink,
    "--brand-secondary": tokens.secondary,
    "--bg-canvas": tokens.background,
    "--bg-panel": tokens.surface,
    "--bg-soft": tokens.soft,
    "--surface-muted": tokens.soft,
    "--line-soft": tokens.line,
    "--text-main": tokens.text,
    "--text-primary": tokens.text,
    "--text-muted": tokens.muted,
    "--bg-sidebar": tokens.sidebar,
    "--sidebar-text": tokens.sidebarText,
    "--sidebar-muted": tokens.sidebarMuted,
    "--sidebar-link": tokens.sidebarLink,
    "--sidebar-active": `linear-gradient(90deg, ${tokens.active1}, ${tokens.active2})`,
    "--on-brand": tokens.onBrand,
    "--header-bg": tokens.header,
    "--shell-bg": shell,
    "--field-border": tokens.line,
    "--placeholder": tokens.muted,
    "--btn-secondary-bg": tokens.surface,
    "--field-bg": tokens.surface,
  };
}
