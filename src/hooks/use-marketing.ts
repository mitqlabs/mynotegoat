"use client";

/**
 * React hook for marketing / BD outreach activities, keyed by attorney
 * contact id. Same sync shape as use-patient-packages: holds the map in
 * state, hydrates from localStorage, dual-writes on change, and stays in
 * sync with other hook instances + cross-device via onLocalChange.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createMarketingActivityId,
  loadMarketing,
  saveMarketing,
  STORAGE_KEY_MARKETING,
  type MarketingActivity,
  type MarketingActivityType,
  type MarketingByContact,
} from "@/lib/marketing";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

function nowIso() {
  return new Date().toISOString();
}

export function useMarketing() {
  const [activitiesByContact, setActivitiesByContact] = useState<MarketingByContact>(
    () => loadMarketing(),
  );
  const selfWriteCountRef = useRef(0);

  useEffect(() => {
    return onLocalChange(STORAGE_KEY_MARKETING, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setActivitiesByContact(loadMarketing());
    });
  }, []);

  const updateContactList = useCallback(
    (contactId: string, updater: (current: MarketingActivity[]) => MarketingActivity[]) => {
      const key = contactId.trim();
      if (!key) return;
      setActivitiesByContact((current) => {
        const existing = current[key] ?? [];
        const next = updater(existing);
        if (next === existing) return current;
        const map: MarketingByContact = { ...current };
        if (next.length === 0) {
          delete map[key];
        } else {
          map[key] = next;
        }
        saveMarketing(map);
        selfWriteCountRef.current++;
        notifyChange(STORAGE_KEY_MARKETING);
        return map;
      });
    },
    [],
  );

  const addActivity = useCallback(
    (
      contactId: string,
      input: { date: string; type: MarketingActivityType; repName?: string; notes?: string },
    ): MarketingActivity | null => {
      const key = contactId.trim();
      if (!key) return null;
      const ts = nowIso();
      const activity: MarketingActivity = {
        id: createMarketingActivityId(),
        contactId: key,
        date: (input.date ?? "").trim(),
        type: input.type,
        repName: input.repName?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        createdAt: ts,
        updatedAt: ts,
      };
      updateContactList(key, (current) => [activity, ...current]);
      return activity;
    },
    [updateContactList],
  );

  const updateActivity = useCallback(
    (
      contactId: string,
      activityId: string,
      patch: Partial<Omit<MarketingActivity, "id" | "contactId" | "createdAt">>,
    ) => {
      updateContactList(contactId, (current) =>
        current.map((entry) =>
          entry.id === activityId ? { ...entry, ...patch, updatedAt: nowIso() } : entry,
        ),
      );
    },
    [updateContactList],
  );

  const removeActivity = useCallback(
    (contactId: string, activityId: string) => {
      updateContactList(contactId, (current) => current.filter((e) => e.id !== activityId));
    },
    [updateContactList],
  );

  const getActivitiesForContact = useCallback(
    (contactId: string): MarketingActivity[] => activitiesByContact[contactId.trim()] ?? [],
    [activitiesByContact],
  );

  const totalActivities = useMemo(
    () => Object.values(activitiesByContact).reduce((sum, list) => sum + list.length, 0),
    [activitiesByContact],
  );

  return {
    activitiesByContact,
    getActivitiesForContact,
    addActivity,
    updateActivity,
    removeActivity,
    totalActivities,
  };
}
