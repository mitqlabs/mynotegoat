"use client";

/**
 * Did a look change really reach the database?
 *
 * "Saved" is shown only after the row is read back and matches. Anything else
 * is a reason and a Retry. Theme is the office row. Light or Dark is that
 * person's own cloud prefs, merged so the rest of their prefs stay put.
 */

import {
  BRAND_STORAGE_KEY,
  brandFrom,
  sameTheme,
  toneReadbackOk,
  TONE_STORAGE_KEY,
  type BrandSettings,
  type Mode,
} from "@/lib/brand";
import { dualWriteKvOrThrow, fetchKvValue } from "@/lib/kv-cloud";
import { markLocalWrite, notifyChange } from "@/lib/local-sync";
import { getSupabaseBrowserClient, getSessionUser } from "@/lib/supabase-browser";
import { mergePrefs, type PrefMap } from "@/lib/user-prefs-cloud";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";

export type SaveResult = { ok: true } | { ok: false; reason: string };

export function brandPayload(brand: BrandSettings): Record<string, unknown> {
  const b = brandFrom(brand);
  return {
    theme: b.theme,
    ...(b.mine ? { mine: b.mine } : {}),
    ...(b.mineDark ? { mineDark: b.mineDark } : {}),
    savedAt: Date.now(),
  };
}

/** True when the row we just read is the theme we asked to save. */
export function themeReadbackOk(stored: unknown, expected: BrandSettings): boolean {
  return sameTheme(brandFrom(stored), expected);
}

function reasonFrom(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return `The database said: ${error.message}`;
  return fallback;
}

export async function saveOfficeBrand(next: BrandSettings): Promise<SaveResult> {
  const payload = brandPayload(next);
  try {
    markLocalWrite(BRAND_STORAGE_KEY);
    window.localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify(payload));
    notifyChange(BRAND_STORAGE_KEY);
  } catch (error) {
    return { ok: false, reason: reasonFrom(error, "This browser could not store the theme.") };
  }

  try {
    await dualWriteKvOrThrow(BRAND_STORAGE_KEY, "tasks", payload);
  } catch (error) {
    return { ok: false, reason: reasonFrom(error, "The database did not confirm the save.") };
  }

  const back = await fetchKvValue(BRAND_STORAGE_KEY);
  if (!back) {
    return {
      ok: false,
      reason: "Saved, but it could not be read back. NoteGoat cannot reach the database right now, or no office is open.",
    };
  }
  return themeReadbackOk(back, next)
    ? { ok: true }
    : {
        ok: false,
        reason: "The database kept a different theme than the one chosen. Someone else may have changed it at the same time.",
      };
}

export async function savePersonTone(mode: Mode): Promise<SaveResult> {
  try {
    window.localStorage.setItem(TONE_STORAGE_KEY, mode);
    notifyChange(TONE_STORAGE_KEY);
  } catch (error) {
    return { ok: false, reason: reasonFrom(error, "This browser could not store Light or Dark.") };
  }

  const client = getSupabaseBrowserClient();
  const workspaceId = getActiveWorkspaceIdSync();
  if (!client || !workspaceId) {
    return { ok: false, reason: "NoteGoat cannot reach the database right now." };
  }
  const { data } = await getSessionUser(client);
  const userId = data.user?.id;
  if (!userId) return { ok: false, reason: "No one is signed in, so this choice has nowhere to be saved." };

  const key = `casemate.user-prefs.v1.u.${userId}`;
  const read = await client.from("workspace_kv").select("value").eq("workspace_id", workspaceId).eq("key", key).maybeSingle();
  if (read.error) return { ok: false, reason: `The database said: ${read.error.message}` };

  let mirror: PrefMap = {};
  try {
    mirror = mergePrefs(JSON.parse(window.localStorage.getItem("casemate.user-prefs-mirror.v1") ?? "{}") as PrefMap);
  } catch {
    mirror = {};
  }
  const merged = mergePrefs((read.data?.value ?? {}) as PrefMap, mirror);
  const prev = merged[TONE_STORAGE_KEY]?.at ?? 0;
  merged[TONE_STORAGE_KEY] = { v: mode, at: Math.max(Date.now(), prev + 1) };

  const wrote = await client.from("workspace_kv").upsert({ workspace_id: workspaceId, key, value: merged }, { onConflict: "workspace_id,key" });
  if (wrote.error) return { ok: false, reason: `The database said: ${wrote.error.message}` };

  const back = await client.from("workspace_kv").select("value").eq("workspace_id", workspaceId).eq("key", key).maybeSingle();
  if (back.error) return { ok: false, reason: `Saved, but it could not be read back: ${back.error.message}` };
  if (!back.data) return { ok: false, reason: "Saved, but it could not be read back." };
  return toneReadbackOk(back.data.value, mode)
    ? { ok: true }
    : { ok: false, reason: "The database did not keep that choice." };
}
