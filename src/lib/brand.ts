/**
 * Typed front door for the office theme. The math lives in brand-math.js so
 * the no-flash script can run the same file before paint.
 */
import * as math from "./brand-math.js";

export const BRAND_KEY = math.BRAND_KEY as "casemate.brand.v1";
export const THEME_IDS = math.THEME_IDS as unknown as readonly ["blue", "sunset", "evergreen", "plum", "harbor", "mine"];
export type ThemeId = (typeof THEME_IDS)[number];
export const MODES = math.MODES as unknown as readonly ["light", "dark"];
export type Mode = (typeof MODES)[number];

/** The four colours an office picks for My Theme. Each is "#rrggbb". */
export interface MyTheme {
  accent: string;
  background: string;
  surface: string;
  text: string;
}

export interface BrandSettings {
  theme: ThemeId;
  /** My Theme's Light colours. Kept even while another theme is chosen. */
  mine?: MyTheme;
  /** My Theme's Dark colours; when missing they are worked out from the Light. */
  mineDark?: MyTheme;
  /** Each person's Light or Dark, by login id. Missing means Light. */
  modes?: Record<string, Mode>;
  savedAt?: number;
}

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  blurb: string;
  light: MyTheme;
  dark: MyTheme;
}

export interface ThemeLook {
  id: ThemeId;
  dark: boolean;
  vars: Record<string, string>;
}

export interface ThemeCheck {
  ok: boolean;
  problems: string[];
  notes: string[];
  textContrast: number;
  buttonContrast: number;
}

export const THEMES = math.THEMES as ThemeInfo[];
export const DEFAULT_BRAND = math.DEFAULT_BRAND as BrandSettings;
export const MY_THEME_START = math.MY_THEME_START as MyTheme;
export const MY_VARS = math.MY_VARS as readonly string[];

export const themeInfo = math.themeInfo as (id: ThemeId) => ThemeInfo;
export const normalizeHex = math.normalizeHex as (value: unknown) => string | null;
export const luminance = math.luminance as (hex: string) => number;
export const contrast = math.contrast as (a: string, b: string) => number;
export const mix = math.mix as (a: string, b: string, amount: number) => string;
export const inkOn = math.inkOn as (on: string) => string;
export const readableAccent = math.readableAccent as (accent: string, surface: string, text: string) => string;
export const isDark = math.isDark as (background: string) => boolean;
export const deriveDark = math.deriveDark as (light: MyTheme) => MyTheme;
export const brandFrom = math.brandFrom as (value: unknown) => BrandSettings;
export const sameBrand = math.sameBrand as (a: unknown, b: unknown) => boolean;
export const sameTheme = math.sameTheme as (a: unknown, b: unknown) => boolean;
export const modeOf = math.modeOf as (brand: BrandSettings | null | undefined, userId: string | null | undefined, fallback?: Mode) => Mode;
export const withMode = math.withMode as (brand: BrandSettings | null | undefined, userId: string, mode: Mode) => BrandSettings;
export const withTheme = math.withTheme as (remote: unknown, draft: unknown) => BrandSettings;
export const mineColors = math.mineColors as (b: BrandSettings, mode: Mode) => MyTheme;
export const varsOf = math.varsOf as (c: MyTheme) => Record<string, string>;
export const lookOf = math.lookOf as (brand: BrandSettings, mode?: Mode) => ThemeLook;
export const checkMyTheme = math.checkMyTheme as (c: MyTheme) => ThemeCheck;
