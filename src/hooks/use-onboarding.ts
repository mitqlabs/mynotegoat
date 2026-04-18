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

  const update = useCallback((patch: Partial<OnboardingState>) => {
    setState((current) => {
      const next: OnboardingState = { ...current, ...patch };
      saveOnboardingState(next);
      selfWriteCountRef.current++;
      notifyChange(onboardingStorageKey);
      return next;
    });
  }, []);

  const markComplete = useCallback(() => {
    update({ completedAt: new Date().toISOString() });
  }, [update]);

  const addSkipped = useCallback(
    (stepId: string) => {
      setState((current) => {
        if (current.skippedSteps.includes(stepId)) return current;
        const next: OnboardingState = {
          ...current,
          skippedSteps: [...current.skippedSteps, stepId],
        };
        saveOnboardingState(next);
        selfWriteCountRef.current++;
        notifyChange(onboardingStorageKey);
        return next;
      });
    },
    [],
  );

  return { onboardingState: state, markComplete, addSkipped };
}
