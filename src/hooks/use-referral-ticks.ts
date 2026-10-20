"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { markLocalWrite, onLocalChange } from "@/lib/local-sync";
import {
  mergeTicks,
  parseTicks,
  REFERRAL_TICKS_LEGACY_KEY,
  REFERRAL_TICKS_LOCAL_KEY,
  referralTicksCloudKey,
  sameTicks,
  setTick,
  tickedKeys,
  ticksFromSafetyBackup,
  type TickMap,
} from "@/lib/referral-ticks";
import { getSupabaseBrowserClient, getSessionUser } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";

function readLocal(key: string): TickMap {
  if (typeof window === "undefined") return {};
  try {
    return parseTicks(JSON.parse(window.localStorage.getItem(key) ?? "null"));
  } catch {
    return {};
  }
}

function writeLocal(map: TickMap) {
  try {
    markLocalWrite(REFERRAL_TICKS_LOCAL_KEY);
    window.localStorage.setItem(REFERRAL_TICKS_LOCAL_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn("[referral-ticks] could not save locally:", err);
  }
}

/**
 * Personal referral ticks: kept in this browser AND in the cloud (one row
 * per user), merged per tick so nothing set later is ever dropped.
 */
export function useReferralTicks() {
  const [ticks, setTicks] = useState<TickMap>(() =>
    mergeTicks(
      typeof window === "undefined" ? {} : ticksFromSafetyBackup(window.localStorage.getItem("casemate.__safety-backup__.v1")),
      readLocal(REFERRAL_TICKS_LEGACY_KEY),
      readLocal(REFERRAL_TICKS_LOCAL_KEY),
    ),
  );
  const ticksRef = useRef(ticks);
  const cloudKeyRef = useRef<string | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback((next: TickMap) => {
    if (sameTicks(next, ticksRef.current)) return;
    ticksRef.current = next;
    writeLocal(next);
    setTicks(next);
  }, []);

  // Read the cloud copy, merge, and write back the merged result.
  const syncCloud = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    const workspaceId = getActiveWorkspaceIdSync();
    if (!client || !workspaceId) return;
    if (!cloudKeyRef.current) {
      const { data } = await getSessionUser(client);
      if (!data.user?.id) return;
      cloudKeyRef.current = referralTicksCloudKey(data.user.id);
    }
    const key = cloudKeyRef.current;
    const { data: row, error } = await client
      .from("workspace_kv")
      .select("value")
      .eq("workspace_id", workspaceId)
      .eq("key", key)
      .maybeSingle();
    if (error) {
      console.warn("[referral-ticks] cloud read failed:", error.message);
      return;
    }
    const remote = parseTicks(row?.value ?? null);
    const merged = mergeTicks(remote, ticksRef.current);
    apply(merged);
    if (!sameTicks(merged, remote)) {
      markLocalWrite(key);
      const { error: upErr } = await client
        .from("workspace_kv")
        .upsert({ workspace_id: workspaceId, key, value: merged }, { onConflict: "workspace_id,key" });
      if (upErr) console.warn("[referral-ticks] cloud save failed:", upErr.message);
    }
  }, [apply]);

  useEffect(() => {
    void syncCloud();
  }, [syncCloud]);

  // A realtime echo of our cloud row lands in localStorage under the cloud
  // key; merge it in (never replace).
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    const t = setInterval(() => {
      const key = cloudKeyRef.current;
      if (!key || cancelled) return;
      clearInterval(t);
      unsub = onLocalChange(key, () => apply(mergeTicks(ticksRef.current, readLocal(key))));
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(t);
      unsub?.();
    };
  }, [apply]);

  useEffect(
    () => () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    },
    [],
  );

  const toggle = useCallback(
    (key: string) => {
      const on = !tickedKeys(ticksRef.current).has(key);
      apply(setTick(ticksRef.current, key, on));
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => void syncCloud(), 800);
    },
    [apply, syncCloud],
  );

  return { checked: tickedKeys(ticks), toggle };
}
