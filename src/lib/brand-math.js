/**
 * Office look: ready-made themes plus My Theme.
 *
 * Plain JavaScript with no imports so the no-flash script can run this file
 * before the page paints, and so tests can load it directly.
 *
 * What is chosen is an office setting (workspace_kv "casemate.brand.v1").
 * Light or Dark is each person's own, stored on that same row under modes,
 * keyed by their login id, so it follows them to any computer. Nothing here
 * is kept only in the browser — localStorage is the cache the rest of the
 * app already keeps for workspace settings.
 */

export const BRAND_KEY = "casemate.brand.v1";

export const THEME_IDS = ["blue", "sunset", "evergreen", "plum", "harbor", "mine"];

export const MODES = ["light", "dark"];

export const THEMES = [
  {
    id: "blue",
    name: "NoteGoat Blue",
    blurb: "Clinic Blue, Soft Sky",
    light: { accent: "#0d79bf", background: "#ffffff", surface: "#fdfefe", text: "#172a3a" },
    dark: { accent: "#5eb4ea", background: "#0e1c28", surface: "#162838", text: "#e7f3fb" },
  },
  {
    id: "sunset",
    name: "Sunset",
    blurb: "Coral, Peach, And Pink Sky",
    light: { accent: "#f26b3a", background: "#fff1ea", surface: "#fff8f5", text: "#3a2118" },
    dark: { accent: "#ff8b64", background: "#1c1210", surface: "#2a1c18", text: "#fde8e2" },
  },
  {
    id: "evergreen",
    name: "Evergreen",
    blurb: "Calm Green, Fresh Paper",
    light: { accent: "#1c7a46", background: "#eef6f1", surface: "#f7fdf9", text: "#13281c" },
    dark: { accent: "#3fbe78", background: "#0c1812", surface: "#14261c", text: "#e6f6ec" },
  },
  {
    id: "plum",
    name: "Plum",
    blurb: "Soft Plum, Warm Light",
    light: { accent: "#8a3d86", background: "#f7f1f8", surface: "#fdf9fd", text: "#2a1830" },
    dark: { accent: "#e7a6e4", background: "#160f18", surface: "#241828", text: "#f8eef8" },
  },
  {
    id: "harbor",
    name: "Harbor",
    blurb: "Sea Glass, Quiet Teal",
    light: { accent: "#0e7674", background: "#e8f4f3", surface: "#f7fcfb", text: "#102e2c" },
    dark: { accent: "#4ecfc6", background: "#0c1918", surface: "#132624", text: "#e6f6f4" },
  },
  {
    id: "mine",
    name: "My Theme",
    blurb: "Pick Your Own Colors",
    light: { accent: "#0d79bf", background: "#eef6fb", surface: "#ffffff", text: "#172a3a" },
    dark: { accent: "#5eb4ea", background: "#0e1c28", surface: "#162838", text: "#e7f3fb" },
  },
];

export const DEFAULT_BRAND = { theme: "blue" };

/** Where My Theme starts before the office has touched it. */
export const MY_THEME_START = THEMES[5].light;

export function themeInfo(id) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** "#rrggbb" in lower case, or null when it is not a colour. */
export function normalizeHex(value) {
  if (typeof value !== "string") return null;
  const m = HEX.exec(value.trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h}`;
}

export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex) {
  const lin = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `amount` (0–1) of `b` mixed into `a`. */
export function mix(a, b, amount) {
  const x = rgb(a);
  const y = rgb(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * amount));
}

export function rgba(hex, alpha) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Black or white, whichever reads better on `on`. */
export function inkOn(on) {
  return contrast(on, "#ffffff") >= contrast(on, "#000000") ? "#ffffff" : "#000000";
}

/**
 * The accent, nudged toward the text colour until it can be read as text on
 * the surface. A bright coral that makes a lovely button makes an unreadable link.
 */
export function readableAccent(accent, surface, text) {
  let out = accent;
  for (let i = 0; i < 24 && contrast(out, surface) < 4.5; i++) out = mix(out, text, 0.08);
  return out;
}

export function isDark(background) {
  return luminance(background) < 0.2;
}

function nudge(fg, bg, toward) {
  let out = fg;
  for (let i = 0; i < 24 && contrast(out, bg) < 4.5; i++) out = mix(out, toward, 0.1);
  return out;
}

/**
 * A Dark version worked out from a Light one, for an office that has set
 * My Theme's Light colours and not yet its Dark: the same hues, turned down,
 * then nudged until the words clear 4.5.
 */
export function deriveDark(light) {
  const dark = {
    background: mix(light.background, "#000000", 0.92),
    surface: mix(light.background, "#000000", 0.86),
    text: mix("#ffffff", light.surface, 0.08),
    accent: mix(light.accent, "#ffffff", 0.35),
  };
  let guard = 0;
  while (!isDark(dark.background) && guard++ < 8) dark.background = mix(dark.background, "#000000", 0.45);
  if (luminance(dark.surface) <= luminance(dark.background)) {
    dark.surface = mix(dark.background, "#ffffff", 0.08);
  }
  guard = 0;
  while (guard++ < 24 && Math.min(contrast(dark.text, dark.background), contrast(dark.text, dark.surface)) < 4.5) {
    dark.text = mix(dark.text, "#ffffff", 0.12);
  }
  return dark;
}

function myThemeFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const accent = normalizeHex(value.accent);
  const background = normalizeHex(value.background);
  const surface = normalizeHex(value.surface);
  const text = normalizeHex(value.text);
  return accent && background && surface && text ? { accent, background, surface, text } : undefined;
}

function modesFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out = {};
  for (const [id, mode] of Object.entries(value)) {
    if ((mode === "light" || mode === "dark") && id) out[id] = mode;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Whatever the database holds, as a usable setting. Anything unreadable falls
 * back to NoteGoat Blue; an office that never chose has the key missing.
 */
export function brandFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { theme: "blue" };
  let theme = THEME_IDS.includes(value.theme) ? value.theme : "blue";
  const mine = myThemeFrom(value.mine);
  const mineDark = myThemeFrom(value.mineDark);
  const modes = modesFrom(value.modes);
  if (theme === "mine" && !mine) theme = "blue";
  const out = { theme };
  if (mine) out.mine = mine;
  if (mineDark) out.mineDark = mineDark;
  if (modes) out.modes = modes;
  if (typeof value.savedAt === "number" && Number.isFinite(value.savedAt)) out.savedAt = value.savedAt;
  return out;
}

function sorted(b) {
  return {
    theme: b.theme,
    mine: b.mine ?? null,
    mineDark: b.mineDark ?? null,
    modes: Object.entries(b.modes ?? {}).sort(([x], [y]) => x.localeCompare(y)),
  };
}

/** Two settings that would look the same, for the same people. */
export function sameBrand(a, b) {
  return JSON.stringify(sorted(brandFrom(a))) === JSON.stringify(sorted(brandFrom(b)));
}

/** Whether two settings choose the same theme and the same My Theme colours (modes aside). */
export function sameTheme(a, b) {
  const x = brandFrom(a);
  const y = brandFrom(b);
  return JSON.stringify([x.theme, x.mine ?? null, x.mineDark ?? null]) === JSON.stringify([y.theme, y.mine ?? null, y.mineDark ?? null]);
}

/** One person's Light or Dark; `fallback` is used until they have chosen. */
export function modeOf(brand, userId, fallback = "light") {
  const chosen = userId && brand && brand.modes ? brand.modes[userId] : undefined;
  return chosen === "light" || chosen === "dark" ? chosen : fallback;
}

/** The setting with one person's mode changed and everything else as it was. */
export function withMode(brand, userId, mode) {
  const b = brandFrom(brand);
  return { ...b, modes: { ...(b.modes ?? {}), [userId]: mode } };
}

/** Theme and My Theme colours from `draft`, with everyone else's modes kept from `remote`. */
export function withTheme(remote, draft) {
  const now = brandFrom(remote);
  const next = brandFrom(draft);
  const out = { theme: next.theme };
  if (next.mine) out.mine = next.mine;
  if (next.mineDark) out.mineDark = next.mineDark;
  if (now.modes) out.modes = now.modes;
  return out;
}

/** My Theme's colours for a mode, as the office set them or worked out. */
export function mineColors(b, mode) {
  const light = b.mine ?? MY_THEME_START;
  if (mode === "light") return light;
  if (b.mineDark) return b.mineDark;
  if (b.mine) return deriveDark(light);
  return THEMES[5].dark;
}

/**
 * Every shade My Theme needs, worked out from the four colours. Inline on
 * <html> as --my-* ; globals.css maps those onto the chrome variables.
 */
export function varsOf(c) {
  let accent = c.accent;
  let btnInk = inkOn(accent);
  for (let i = 0; i < 16 && contrast(btnInk, accent) < 4.5; i++) {
    accent = mix(accent, btnInk === "#ffffff" ? "#000000" : "#ffffff", 0.08);
    btnInk = inkOn(accent);
  }
  let link = readableAccent(accent, c.surface, c.text);
  link = nudge(link, c.background, c.text);
  let muted = nudge(mix(c.text, c.background, 0.34), c.background, c.text);
  muted = nudge(muted, c.surface, c.text);
  let faint = nudge(mix(c.text, c.background, 0.48), c.background, c.text);
  faint = nudge(faint, c.surface, c.text);

  let sidebar = mix(accent, "#000000", 0.84);
  let sidebarText = "#f7fbff";
  let guard = 0;
  while (contrast(sidebarText, sidebar) < 4.5 && guard++ < 12) sidebar = mix(sidebar, "#000000", 0.18);
  let sidebarMuted = mix(sidebarText, sidebar, 0.32);
  guard = 0;
  while (contrast(sidebarMuted, sidebar) < 4.5 && guard++ < 12) sidebarMuted = mix(sidebarMuted, sidebarText, 0.16);

  let navFrom = accent;
  let navInk = inkOn(navFrom);
  guard = 0;
  while (contrast(navInk, navFrom) < 4.5 && guard++ < 16) {
    navFrom = mix(navFrom, navInk === "#ffffff" ? "#000000" : "#ffffff", 0.1);
    navInk = inkOn(navFrom);
  }
  let navTo = mix(navFrom, navInk === "#ffffff" ? "#ffffff" : "#000000", 0.22);
  guard = 0;
  while (contrast(navInk, navTo) < 4.5 && guard++ < 16) navTo = mix(navTo, navFrom, 0.3);

  const secondary = mix(accent, "#1aa0a2", 0.4);
  const warm = mix(accent, "#ff6f91", 0.35);
  let box = mix(accent, c.surface, 0.86);
  let boxText = contrast(c.text, box) >= 4.5 ? c.text : inkOn(box);
  guard = 0;
  while (contrast(boxText, box) < 4.5 && guard++ < 12) {
    box = mix(box, luminance(boxText) > 0.5 ? "#000000" : "#ffffff", 0.12);
  }

  let goatText = contrast(c.text, c.surface) >= 4.5 ? c.text : inkOn(c.surface);
  const lightenStops = luminance(goatText) < 0.5;
  let goatFrom = mix(accent, c.surface, 0.58);
  let goatVia = mix(warm, c.surface, 0.5);
  let goatTo = mix(secondary, c.background, 0.42);
  const fixStop = (stop) => {
    let s = stop;
    const toward = lightenStops ? "#ffffff" : "#000000";
    for (let i = 0; i < 20 && contrast(goatText, s) < 4.5; i++) s = mix(s, toward, 0.12);
    return s;
  };
  goatFrom = fixStop(goatFrom);
  goatVia = fixStop(goatVia);
  goatTo = fixStop(goatTo);

  const soft = mix(c.surface, c.background, 0.42);
  const line = mix(c.text, c.surface, 0.84);

  return {
    "--my-bg": c.background,
    "--my-surface": c.surface,
    "--my-text": c.text,
    "--my-accent": accent,
    "--my-btn-ink": btnInk,
    "--my-link": link,
    "--my-muted": muted,
    "--my-faint": faint,
    "--my-soft": soft,
    "--my-line": line,
    "--my-sidebar": sidebar,
    "--my-sidebar-text": sidebarText,
    "--my-sidebar-muted": sidebarMuted,
    "--my-nav-from": navFrom,
    "--my-nav-to": navTo,
    "--my-nav-ink": navInk,
    "--my-secondary": secondary,
    "--my-warm": warm,
    "--my-box": box,
    "--my-box-text": boxText,
    "--my-goat-from": goatFrom,
    "--my-goat-via": goatVia,
    "--my-goat-to": goatTo,
    "--my-goat-text": goatText,
    "--my-glow-a": rgba(accent, 0.18),
    "--my-glow-b": rgba(warm, 0.16),
  };
}

export const MY_VARS = [
  "--my-bg",
  "--my-surface",
  "--my-text",
  "--my-accent",
  "--my-btn-ink",
  "--my-link",
  "--my-muted",
  "--my-faint",
  "--my-soft",
  "--my-line",
  "--my-sidebar",
  "--my-sidebar-text",
  "--my-sidebar-muted",
  "--my-nav-from",
  "--my-nav-to",
  "--my-nav-ink",
  "--my-secondary",
  "--my-warm",
  "--my-box",
  "--my-box-text",
  "--my-goat-from",
  "--my-goat-via",
  "--my-goat-to",
  "--my-goat-text",
  "--my-glow-a",
  "--my-glow-b",
];

export function lookOf(brand, mode = "light") {
  const b = brandFrom(brand);
  const tone = mode === "dark" ? "dark" : "light";
  if (b.theme !== "mine") return { id: b.theme, dark: tone === "dark", vars: {} };
  return { id: "mine", dark: tone === "dark", vars: varsOf(mineColors(b, tone)) };
}

/** Can people read it? Text must clear 4.5:1 on both the page and the cards. */
export function checkMyTheme(c) {
  const textContrast = Math.min(contrast(c.text, c.background), contrast(c.text, c.surface));
  const buttonContrast = contrast(c.accent, inkOn(c.accent));
  const problems = [];
  const notes = [];
  if (textContrast < 4.5) {
    problems.push("The text is too close to the background to read comfortably. Pick a darker text or a lighter background (or the other way round).");
  }
  if (contrast(c.surface, c.background) < 1.04) {
    notes.push("Cards and the page are almost the same color, so cards will not stand out.");
  }
  if (contrast(c.accent, c.surface) < 3) {
    notes.push("The accent is pale on cards, so NoteGoat will darken it where it is used as text.");
  }
  return { ok: problems.length === 0, problems, notes, textContrast, buttonContrast };
}
