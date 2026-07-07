"use client";

/**
 * Cloud-first Key Dates hook — PILOT for the new architecture.
 *
 * Pattern this proves out:
 *
 *   - READ comes from cloud (Supabase workspace_kv row). Cached in
 *     memory by React Query for 30 seconds. No localStorage. No
 *     "bootstrap" that pulls everything down on app load and races
 *     with React state init.
 *   - WRITE goes to cloud first. The mutation does a read-modify-
 *     write on the kv row, then updates the local React Query cache
 *     on success. If the cloud write fails, the cache stays at the
 *     last successful state — no optimistic update getting silently
 *     overwritten later.
 *   - REALTIME subscription on the workspace_kv row means a change
 *     made on Device B propagates to Device A's open page within
 *     seconds. The subscription invalidates the cache, which
 *     triggers an automatic refetch. No localStorage drift across
 *     devices because there IS no localStorage.
 *
 * Once this is proven end-to-end on Key Dates (the pilot), the same
 * pattern goes on encounters, appointments, patients, and every
 * other entity that's been losing data.
 *
 * NOTE: workspace_kv stores key dates as a single JSON blob. There's
 * a small theoretical race when two devices write simultaneously
 * (last write wins). For key dates that's acceptable — they're
 * edited rarely. For encounters and appointments (which already have
 * per-record tables), the race doesn't exist because each record is
 * its own row.
 */

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { buildWorkspaceIdForUser } from "@/lib/cloud-state";
import {
  createKeyDateId,
  normalizeKeyDates,
  type KeyDateOfficeStatus,
  type KeyDateRecord,
} from "@/lib/key-dates";

const STORAGE_KEY = "casemate.key-dates.v1";
const QUERY_KEY = ["cloud-key-dates"] as const;

type KeyDateDraft = {
  startDate: string;
  endDate?: string;
  officeStatus: KeyDateOfficeStatus;
  reason: string;
};

type AddKeyDateResult =
  | { added: true; keyDate: KeyDateRecord }
  | { added: false; reason: string };

type UpdateKeyDateResult =
  | { updated: true; keyDate: KeyDateRecord }
  | { updated: false; reason: string };

function normalizeReason(value: string) {
  return value.trim();
}

async function getActiveWorkspaceId(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return null;
  // Must match the workspace_id the rest of the app uses:
  // `${userId}:${officeId}` (e.g. "…:main-office"). Returning the BARE
  // user id read/wrote a DIFFERENT workspace_kv row, so every key date
  // saved through the legacy (correct-id) path was invisible here.
  return buildWorkspaceIdForUser(userId);
}

async function fetchKeyDatesFromCloud(): Promise<KeyDateRecord[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) return [];

  const { data, error } = await supabase
    .from("workspace_kv")
    .select("value")
    .eq("workspace_id", workspaceId)
    .eq("key", STORAGE_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(`[cloud-key-dates] fetch failed: ${error.message}`);
  }

  return normalizeKeyDates(data?.value);
}

async function writeKeyDatesToCloud(records: KeyDateRecord[]): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase not configured");
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) throw new Error("No active workspace");

  const { error } = await supabase
    .from("workspace_kv")
    .upsert(
      { workspace_id: workspaceId, key: STORAGE_KEY, value: records },
      { onConflict: "workspace_id,key" },
    );

  if (error) {
    throw new Error(`[cloud-key-dates] write failed: ${error.message}`);
  }
}

export function useCloudKeyDates() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchKeyDatesFromCloud,
  });

  // Realtime subscription. When ANY device upserts the workspace_kv
  // row for this key, we invalidate our cache → React Query refetches
  // → the UI shows the latest state without a refresh. This is the
  // mechanism that makes cross-device sync feel automatic.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let workspaceId: string | null = null;
    let cancelled = false;
    const setupChannel = async () => {
      workspaceId = await getActiveWorkspaceId();
      if (!workspaceId || cancelled) return;
      const channel = supabase
        .channel(`cloud-key-dates:${workspaceId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "workspace_kv",
            filter: `key=eq.${STORAGE_KEY}`,
          },
          (payload) => {
            // payload includes the new/old row. We could optimistically
            // use payload.new.value here, but invalidating is safer —
            // it forces a fresh fetch with the canonical RLS-filtered
            // view of the data.
            void payload;
            queryClient.invalidateQueries({ queryKey: QUERY_KEY });
          },
        )
        .subscribe();
      return () => {
        void channel.unsubscribe();
      };
    };
    const cleanupPromise = setupChannel();
    return () => {
      cancelled = true;
      void cleanupPromise.then((cleanup) => cleanup?.());
    };
  }, [queryClient]);

  const addMutation = useMutation({
    mutationFn: async (draft: KeyDateDraft): Promise<AddKeyDateResult> => {
      const startDate = draft.startDate.trim();
      const endDate = (draft.endDate ?? draft.startDate).trim() || startDate;
      const reason = normalizeReason(draft.reason);
      if (!startDate) return { added: false, reason: "Start date is required." };
      if (!endDate) return { added: false, reason: "End date is required." };
      if (endDate < startDate) {
        return { added: false, reason: "End date cannot be before start date." };
      }
      // Read-modify-write. Read the current cloud list, append, write back.
      const current = await fetchKeyDatesFromCloud();
      const newRecord: KeyDateRecord = {
        id: createKeyDateId(),
        startDate,
        endDate,
        officeStatus: draft.officeStatus,
        reason,
      };
      const next = [...current, newRecord];
      await writeKeyDatesToCloud(next);
      return { added: true, keyDate: newRecord };
    },
    onSuccess: (result) => {
      if (result.added) {
        // Pre-populate the cache with what we know is now in cloud so
        // the UI doesn't flash to "empty" while waiting for the
        // realtime invalidation + refetch.
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (args: { id: string; draft: KeyDateDraft }): Promise<UpdateKeyDateResult> => {
      const { id, draft } = args;
      const startDate = draft.startDate.trim();
      const endDate = (draft.endDate ?? draft.startDate).trim() || startDate;
      const reason = normalizeReason(draft.reason);
      if (!startDate) return { updated: false, reason: "Start date is required." };
      if (!endDate) return { updated: false, reason: "End date is required." };
      if (endDate < startDate) {
        return { updated: false, reason: "End date cannot be before start date." };
      }
      const current = await fetchKeyDatesFromCloud();
      let updated: KeyDateRecord | null = null;
      const next = current.map((entry) => {
        if (entry.id !== id) return entry;
        updated = { ...entry, startDate, endDate, officeStatus: draft.officeStatus, reason };
        return updated;
      });
      if (!updated) return { updated: false, reason: "Key date not found." };
      await writeKeyDatesToCloud(next);
      return { updated: true, keyDate: updated };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const current = await fetchKeyDatesFromCloud();
      const next = current.filter((entry) => entry.id !== id);
      await writeKeyDatesToCloud(next);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return {
    keyDates: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    addKeyDate: (draft: KeyDateDraft): Promise<AddKeyDateResult> => addMutation.mutateAsync(draft),
    updateKeyDate: (id: string, draft: KeyDateDraft): Promise<UpdateKeyDateResult> =>
      updateMutation.mutateAsync({ id, draft }),
    removeKeyDate: (id: string): Promise<void> => removeMutation.mutateAsync(id),
    isSaving: addMutation.isPending || updateMutation.isPending || removeMutation.isPending,
  };
}
