"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadMarketingSettings,
  saveMarketingSettings,
  STORAGE_KEY_MARKETING_SETTINGS,
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

  const setVisitTypes = useCallback((visitTypes: string[]) => {
    setSettings(() => {
      const next: MarketingSettings = { visitTypes };
      saveMarketingSettings(next);
      selfWriteCountRef.current++;
      notifyChange(STORAGE_KEY_MARKETING_SETTINGS);
      return next;
    });
  }, []);

  return { settings, setVisitTypes };
}
