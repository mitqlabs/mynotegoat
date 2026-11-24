"use client";

import { useLayoutEffect, useState, useEffect } from "react";
import {
  BRAND_STORAGE_KEY,
  brandFrom,
  lookOf,
  MY_VARS,
  type BrandSettings,
  type Mode,
} from "@/lib/brand";
import { onLocalChange } from "@/lib/local-sync";
import { usePersonTone } from "@/lib/theme";

function readBrand(): BrandSettings {
  if (typeof window === "undefined") return { theme: "blue" };
  try {
    const raw = window.localStorage.getItem(BRAND_STORAGE_KEY);
    if (!raw) return { theme: "blue" };
    return brandFrom(JSON.parse(raw));
  } catch {
    return { theme: "blue" };
  }
}

/**
 * Paints the office theme and this person's Light or Dark onto <html>.
 * The no-flash script has already done this once; this keeps it in step
 * when settings change or the cloud copy arrives.
 */
export function BrandApplier() {
  const tone = usePersonTone();
  const [brand, setBrand] = useState<BrandSettings>(() => readBrand());

  useEffect(() => {
    return onLocalChange(BRAND_STORAGE_KEY, () => setBrand(readBrand()));
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute("data-theme-lock") === "1") return;
    applyLook(root, brand, tone);
  }, [brand, tone]);

  return null;
}

export function applyLook(root: HTMLElement, brand: BrandSettings, tone: Mode) {
  const look = lookOf(brand, tone);
  root.setAttribute("data-brand", look.id);
  root.setAttribute("data-tone", look.dark ? "dark" : "light");
  for (const name of MY_VARS) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(look.vars)) root.style.setProperty(name, value);
}
