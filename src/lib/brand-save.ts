"use client";

/**
 * Did a look change really reach the database?
 *
 * The theme and each person's Light / Dark live in the existing workspace
 * settings row (notegoat.theme.v1). Save must not say "Saved" because a
 * request went out: it writes, reads the row back, and checks it matches.
 * There is no new table and no migration.
 */
import {
  BRAND_KEY,
  brandFrom,
  modeOf,
  sameTheme,
  withMode,
  withTheme,
  type BrandSettings,
  type Mode,
} from "@/lib/brand";
import { markLocalWrite, notifyChange } from "@/lib/local-sync";
import { upsertKvValue } from "@/lib/kv-cloud";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";

export type SaveResult = { ok: true } | { ok: false; reason: string };

export type Expected =
  | { kind: "theme"; brand: BrandSettings }
  | { kind: "mode"; userId: string; mode: Mode };

function cacheLocal(value: BrandSettings) {
  try {
    window.localStorage.setItem(BRAND_KEY, JSON.stringify(value));
    markLocalWrite(BRAND_KEY);
    notifyChange(BRAND_KEY);
  } catch {
    // The database copy is the one that counts. The cache is only for paint.
  }
}

async function readRow(): Promise<unknown> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("NoteGoat cannot reach the database right now.");
  const workspaceId = getActiveWorkspaceIdSync();
  if (!workspaceId) throw new Error("No office is open to check against.");
  const { data, error } = await supabase
    .from("workspace_kv")
    .select("value")
    .eq("workspace_id", workspaceId)
    .eq("key", BRAND_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? data.value : null;
}

async function writeRow(value: BrandSettings) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("NoteGoat cannot reach the database right now.");
  if (!getActiveWorkspaceIdSync()) throw new Error("No office is open to save to.");
  await upsertKvValue(BRAND_KEY, value);
}

/**
 * Save the office theme, keeping each person's mode as the database has it
 * now, then read the row back.
 */
export async function saveOfficeTheme(draft: BrandSettings): Promise<SaveResult> {
  try {
    const remote = await readRow();
    const next: BrandSettings = { ...withTheme(remote, draft), savedAt: Date.now() };
    await writeRow(next);
    const back = brandFrom(await readRow());
    if (!sameTheme(back, next)) {
      return {
        ok: false,
        reason: "The database kept a different theme than the one chosen. Someone else may have changed it at the same time.",
      };
    }
    cacheLocal(back);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The database did not confirm the save.";
    return { ok: false, reason: message };
  }
}

/** Save one person's Light or Dark, leaving the office theme untouched, then read the row back. */
export async function savePersonalMode(userId: string, mode: Mode): Promise<SaveResult> {
  if (!userId) return { ok: false, reason: "Sign in before choosing Light or Dark." };
  try {
    const remote = await readRow();
    const next: BrandSettings = { ...withMode(brandFrom(remote), userId, mode), savedAt: Date.now() };
    await writeRow(next);
    const back = brandFrom(await readRow());
    if (modeOf(back, userId, "light") !== mode || back.modes?.[userId] !== mode) {
      return { ok: false, reason: "The database did not keep that choice." };
    }
    if (!sameTheme(back, next)) {
      return {
        ok: false,
        reason: "The database kept a different theme than the one on file. Someone else may have changed it at the same time.",
      };
    }
    cacheLocal(back);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The database did not confirm the save.";
    return { ok: false, reason: message };
  }
}
