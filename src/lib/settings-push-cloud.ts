"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { upsertKvValue } from "@/lib/kv-cloud";
import { flushSaveQueue, getSaveQueueState } from "@/lib/save-queue";
import { getDirtyKeys, markKeyClean } from "@/lib/dirty-keys";
import { pushPendingSettings, type SettingsPushDeps, type SettingsPushResult } from "@/lib/settings-push";

/** The real bindings for the Settings "Save to Cloud" button. */
export const cloudSettingsPushDeps: SettingsPushDeps = {
  notReady() {
    if (!getSupabaseBrowserClient()) return "Cloud isn't configured on this device.";
    if (!getActiveWorkspaceIdSync()) return "You're not signed in to a workspace — sign in again, then retry.";
    return null;
  },
  dirtyKeys: getDirtyKeys,
  localRaw: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async fetchCloud(keys) {
    const out = new Map<string, { value: unknown; updatedAt: string | null }>();
    if (keys.length === 0) return out;
    const supabase = getSupabaseBrowserClient();
    const workspaceId = getActiveWorkspaceIdSync();
    if (!supabase || !workspaceId) throw new Error("Cloud isn't available.");
    const { data, error } = await supabase
      .from("workspace_kv")
      .select("key, value, updated_at")
      .eq("workspace_id", workspaceId)
      .in("key", keys);
    if (error) throw new Error(`Couldn't read the cloud: ${error.message}`);
    for (const row of data ?? []) {
      out.set(row.key, { value: row.value, updatedAt: typeof row.updated_at === "string" ? row.updated_at : null });
    }
    return out;
  },
  upsert: upsertKvValue,
  async flushHeldWrites() {
    await flushSaveQueue();
    return getSaveQueueState().waiting;
  },
  markClean: (key) => markKeyClean(key),
};

export function pushSettingsToCloud(): Promise<SettingsPushResult> {
  return pushPendingSettings(cloudSettingsPushDeps);
}
