"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isFeatureEnabled as isEnabled,
  loadModuleVisibility,
  saveModuleVisibility,
  STORAGE_KEY_MODULE_VISIBILITY,
  type ModuleVisibility,
} from "@/lib/module-visibility";
import type { PortalFeature } from "@/lib/plan-access";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

export function useModuleVisibility() {
  const [visibility, setVisibility] = useState<ModuleVisibility>(() => loadModuleVisibility());
  const selfWriteCountRef = useRef(0);

  useEffect(() => {
    return onLocalChange(STORAGE_KEY_MODULE_VISIBILITY, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setVisibility(loadModuleVisibility());
    });
  }, []);

  const setFeatureEnabled = useCallback((feature: PortalFeature, enabled: boolean) => {
    setVisibility((current) => {
      const next = { ...current, [feature]: enabled };
      saveModuleVisibility(next);
      selfWriteCountRef.current++;
      notifyChange(STORAGE_KEY_MODULE_VISIBILITY);
      return next;
    });
  }, []);

  const isFeatureEnabled = useCallback(
    (feature: PortalFeature) => isEnabled(visibility, feature),
    [visibility],
  );

  return { visibility, isFeatureEnabled, setFeatureEnabled };
}
