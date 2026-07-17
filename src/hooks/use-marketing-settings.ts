"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadMarketingSettings,
  saveMarketingSettings,
  STORAGE_KEY_MARKETING_SETTINGS,
  type MarketingCaseBucket,
  type MarketingSettings,
} from "@/lib/marketing-settings";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

export function useMarketingSettings() {
  const [settings, setSettings] = useState<MarketingSettings>(() => loadMarketingSettings());
  const selfWriteCountRef = useRef(0);

  useEffect(() => {
    return onLocalChange(STORAGE_KEY_MARKETING_SETTINGS, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setSettings(loadMarketingSettings());
    });
  }, []);

  const persist = useCallback((next: MarketingSettings) => {
    saveMarketingSettings(next);
    selfWriteCountRef.current++;
    notifyChange(STORAGE_KEY_MARKETING_SETTINGS);
    return next;
  }, []);

  const setVisitTypes = useCallback(
    (visitTypes: string[]) => {
      setSettings((current) => persist({ ...current, visitTypes }));
    },
    [persist],
  );

  const setCaseBucket = useCallback(
    (statusName: string, bucket: MarketingCaseBucket) => {
      const key = statusName.trim().toLowerCase();
      if (!key) return;
      setSettings((current) =>
        persist({
          ...current,
          caseBucketByStatus: { ...current.caseBucketByStatus, [key]: bucket },
        }),
      );
    },
    [persist],
  );

  return { settings, setVisitTypes, setCaseBucket };
}
