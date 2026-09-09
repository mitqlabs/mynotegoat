"use client";

/**
 * Theme preference: Light / Dark / System. The blue palette is the LIGHT
 * theme; dark mode overrides the CSS variables under
 * `:root[data-theme="dark"]` (see globals.css). Stored per-viewer in
 * localStorage; applied by setting data-theme on <html>. A tiny inline
 * script in the root layout applies it before first paint (no flash).
 */

export type ThemePref = "light" | "dark" | "system";

const KEY = "casemate.theme.v1";
export const THEME_CHANGE_EVENT = "casemate:theme-changed";

export function loadThemePref(): ThemePref {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
  } catch {
    return "system";
  }
}

export function prefersDark(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function resolveEffective(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (prefersDark() ? "dark" : "light") : pref;
}

export function applyTheme(pref: ThemePref) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolveEffective(pref));
}

export function saveThemePref(pref: ThemePref) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, pref);
  } catch {
    // ignore
  }
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
}
