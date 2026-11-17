"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { LEGACY_TONE_KEYS, storedTone, TONE_STORAGE_KEY, type Mode } from "@/lib/brand";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

export type Theme = Mode;
export const THEME_KEY = LEGACY_TONE_KEYS[0];
export const DEFAULT_THEME: Theme = "light";

/**
 * What this browser used to remember as its Light / Dark choice. The choice
 * now belongs to the person and is saved with their login, so this is read
 * only as a starting point for someone who has not picked yet, and is never
 * written any more.
 */

let current: Theme | null = null;
const listeners = new Set<() => void>();

function readLegacy(): Theme {
  try {
    for (const key of LEGACY_TONE_KEYS) {
      if (window.localStorage.getItem(key) === "dark") return "dark";
    }
  } catch {
    // private mode
  }
  return DEFAULT_THEME;
}

function getSnapshot(): Theme {
  if (current === null) current = readLegacy();
  return current;
}

function getServerSnapshot(): Theme {
  return DEFAULT_THEME;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

interface ThemeValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setTheme = useCallback((t: Theme) => {
    current = t;
    for (const listener of listeners) listener();
  }, []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

function readStoredTone(): Mode | null {
  try {
    return storedTone(window.localStorage.getItem(TONE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function subscribeTone(onChange: () => void): () => void {
  return onLocalChange(TONE_STORAGE_KEY, onChange);
}

/** This person's Light or Dark. Falls back to the old browser value until they pick. */
export function usePersonTone(): Mode {
  const { theme: legacy } = useTheme();
  const stored = useSyncExternalStore(subscribeTone, readStoredTone, () => null);
  return stored ?? legacy;
}

/** Apply a person's mode on this computer immediately. The cloud save is separate. */
export function writePersonToneLocal(mode: Mode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TONE_STORAGE_KEY, mode);
  notifyChange(TONE_STORAGE_KEY);
}
