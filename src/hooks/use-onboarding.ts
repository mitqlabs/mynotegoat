"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadOnboardingState,
  onboardingStorageKey,
  saveOnboardingState,
  type OnboardingState,
} from "@/lib/onboarding";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(() => loadOnboardingState());
  const selfWriteCountRef = useRef(0);

  useEffect(() => {
    return onLocalChange(onboardingStorageKey, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setState(loadOnboardingState());
    });
  }, []);

  const update = useCallback((fn: (current: OnboardingState) => OnboardingState) => {
    setState((current) => {
      const next = fn(current);
      saveOnboardingState(next);
      selfWriteCountRef.current++;
      notifyChange(onboardingStorageKey);
      return next;
    });
  }, []);

  const markComplete = useCallback(() => {
    update((c) => ({ ...c, completedAt: new Date().toISOString() }));
  }, [update]);

  const dismiss = useCallback(() => {
    update((c) => (c.dismissedAt ? c : { ...c, dismissedAt: new Date().toISOString() }));
  }, [update]);

  const confirmStep = useCallback(
    (stepId: string, on = true) => {
      update((c) => {
        const has = c.confirmedSteps.includes(stepId);
        if (on === has) return c;
        return {
          ...c,
          confirmedSteps: on ? [...c.confirmedSteps, stepId] : c.confirmedSteps.filter((s) => s !== stepId),
        };
      });
    },
    [update],
  );

  return { onboardingState: state, markComplete, dismiss, confirmStep };
}
