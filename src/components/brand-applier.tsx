"use client";

import { useLayoutEffect } from "react";
import { BRAND_KEY, MY_VARS, brandFrom, lookOf, modeOf, type BrandSettings } from "@/lib/brand";
import { onLocalChange } from "@/lib/local-sync";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

/**
 * Puts the office theme and this person's Light or Dark on <html>.
 * Both come from the workspace settings cache (filled from the database).
 * The blocking script in the root layout paints the same thing before the
 * first frame; this keeps it in step after sign-in and after a save.
 */
export default function BrandApplier() {
  useLayoutEffect(() => {
    let alive = true;
    let userId: string | null = null;

    const apply = () => {
      let raw: unknown = null;
      try {
        raw = JSON.parse(window.localStorage.getItem(BRAND_KEY) || "null") as unknown;
      } catch {
        raw = null;
      }
      const settings = brandFrom(raw) as BrandSettings;
      const mode = modeOf(settings, userId, "light");
      const look = lookOf(settings, mode);
      const root = document.documentElement;
      root.setAttribute("data-brand", look.id);
      root.setAttribute("data-tone", look.dark ? "dark" : "light");
      for (const name of MY_VARS) root.style.removeProperty(name);
      for (const [name, value] of Object.entries(look.vars)) root.style.setProperty(name, value);
    };

    apply();
    const off = onLocalChange(BRAND_KEY, apply);
    const supabase = getSupabaseBrowserClient();
    void supabase?.auth.getSession().then(({ data }) => {
      if (!alive) return;
      userId = data.session?.user?.id ?? null;
      apply();
    });
    const sub = supabase?.auth.onAuthStateChange((_event, session) => {
      userId = session?.user?.id ?? null;
      apply();
    });
    return () => {
      alive = false;
      off();
      sub?.data.subscription.unsubscribe();
    };
  }, []);

  return null;
}
