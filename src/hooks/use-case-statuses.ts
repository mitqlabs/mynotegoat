"use client";

import { useCallback, useState } from "react";
import {
  getDefaultCaseStatusSettings,
  getDefaultLienOptions,
  getDefaultReviewOptions,
  loadCaseStatusSettings,
  saveCaseStatusSettings,
  type CaseStatusConfig,
  type LienLabel,
} from "@/lib/case-statuses";

export function useCaseStatuses() {
  const [settings, setSettings] = useState(() => loadCaseStatusSettings());

  const updateSettings = useCallback(
    (updater: (current: ReturnType<typeof loadCaseStatusSettings>) => ReturnType<typeof loadCaseStatusSettings>) => {
      setSettings((current) => {
        const next = updater(current);
        saveCaseStatusSettings(next);
        return next;
      });
    },
    [],
  );

  const updateStatuses = useCallback(
    (updater: (current: CaseStatusConfig[]) => CaseStatusConfig[]) => {
      updateSettings((current) => {
        const nextStatuses = updater(current.statuses);
        return {
          ...current,
          statuses: nextStatuses,
        };
      });
    },
    [updateSettings],
  );

  const addStatus = useCallback(
    (name: string, showOnDashboard: boolean, color: string, isCaseClosed = false) => {
      const normalizedName = name.trim();
      if (!normalizedName) {
        return;
      }

      updateStatuses((current) => {
        const exists = current.some(
          (status) => status.name.toLowerCase() === normalizedName.toLowerCase(),
        );
        if (exists) {
          return current;
        }

        return [...current, { name: normalizedName, showOnDashboard, color, isCaseClosed, autoFolder: false }];
      });
    },
    [updateStatuses],
  );

  const removeStatus = useCallback(
    (name: string) => {
      updateStatuses((current) =>
        current.filter((status) => status.name.toLowerCase() !== name.toLowerCase()),
      );
    },
    [updateStatuses],
  );

  const toggleDashboardVisibility = useCallback(
    (name: string) => {
      updateStatuses((current) =>
        current.map((status) =>
          status.name.toLowerCase() === name.toLowerCase()
            ? { ...status, showOnDashboard: !status.showOnDashboard }
            : status,
        ),
      );
    },
    [updateStatuses],
  );

  const setStatusColor = useCallback(
    (name: string, color: string) => {
      updateStatuses((current) =>
        current.map((status) =>
          status.name.toLowerCase() === name.toLowerCase() ? { ...status, color } : status,
        ),
      );
    },
    [updateStatuses],
  );

  const setStatusClosed = useCallback(
    (name: string, isCaseClosed: boolean) => {
      updateStatuses((current) =>
        current.map((status) =>
          status.name.toLowerCase() === name.toLowerCase() ? { ...status, isCaseClosed } : status,
        ),
      );
    },
    [updateStatuses],
  );

  const setStatusAutoFolder = useCallback(
    (name: string, autoFolder: boolean) => {
      updateStatuses((current) =>
        current.map((status) =>
          status.name.toLowerCase() === name.toLowerCase() ? { ...status, autoFolder } : status,
        ),
      );
    },
    [updateStatuses],
  );

  const setLienLabel = useCallback(
    (nextLabel: LienLabel) => {
      updateSettings((current) => ({
        ...current,
        lienLabel: nextLabel,
      }));
    },
    [updateSettings],
  );

  const addLienOption = useCallback(
    (name: string) => {
      const normalizedName = name.trim();
      if (!normalizedName) {
        return;
      }
      updateSettings((current) => {
        const exists = current.lienOptions.some(
          (option) => option.toLowerCase() === normalizedName.toLowerCase(),
        );
        if (exists) {
          return current;
        }
        return {
          ...current,
          lienOptions: [...current.lienOptions, normalizedName],
        };
      });
    },
    [updateSettings],
  );

  const updateLienOption = useCallback(
    (index: number, name: string) => {
      const normalizedName = name.trim();
      if (!normalizedName) {
        return;
      }
      updateSettings((current) => {
        if (index < 0 || index >= current.lienOptions.length) {
          return current;
        }
        const isDuplicate = current.lienOptions.some((option, optionIndex) => {
          if (optionIndex === index) {
            return false;
          }
          return option.toLowerCase() === normalizedName.toLowerCase();
        });
        if (isDuplicate) {
          return current;
        }
        const nextLienOptions = [...current.lienOptions];
        nextLienOptions[index] = normalizedName;
        return {
          ...current,
          lienOptions: nextLienOptions,
        };
      });
    },
    [updateSettings],
  );

  const removeLienOption = useCallback(
    (index: number) => {
      updateSettings((current) => {
        if (current.lienOptions.length <= 1 || index < 0 || index >= current.lienOptions.length) {
          return current;
        }
        return {
          ...current,
          lienOptions: current.lienOptions.filter((_, optionIndex) => optionIndex !== index),
        };
      });
    },
    [updateSettings],
  );

  const moveLienOption = useCallback(
    (index: number, direction: "up" | "down") => {
      updateSettings((current) => {
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (
          index < 0 ||
          index >= current.lienOptions.length ||
          targetIndex < 0 ||
          targetIndex >= current.lienOptions.length
        ) {
          return current;
        }
        const nextLienOptions = [...current.lienOptions];
        const [moved] = nextLienOptions.splice(index, 1);
        nextLienOptions.splice(targetIndex, 0, moved);
        return {
          ...current,
          lienOptions: nextLienOptions,
        };
      });
    },
    [updateSettings],
  );

  const resetLienOptionsToDefaults = useCallback(() => {
    updateSettings((current) => ({
      ...current,
      lienLabel: "Lien",
      lienOptions: getDefaultLienOptions(),
    }));
  }, [updateSettings]);

  const addReviewOption = useCallback(
    (name: string) => {
      const normalizedName = name.trim();
      if (!normalizedName) return;
      updateSettings((current) => {
        const exists = current.reviewOptions.some(
          (option) => option.toLowerCase() === normalizedName.toLowerCase(),
        );
        if (exists) return current;
        return { ...current, reviewOptions: [...current.reviewOptions, normalizedName] };
      });
    },
    [updateSettings],
  );

  const updateReviewOption = useCallback(
    (index: number, name: string) => {
      const normalizedName = name.trim();
      if (!normalizedName) return;
      updateSettings((current) => {
        if (index < 0 || index >= current.reviewOptions.length) return current;
        const isDuplicate = current.reviewOptions.some((option, i) => {
          if (i === index) return false;
          return option.toLowerCase() === normalizedName.toLowerCase();
        });
        if (isDuplicate) return current;
        const next = [...current.reviewOptions];
        next[index] = normalizedName;
        return { ...current, reviewOptions: next };
      });
    },
    [updateSettings],
  );

  const removeReviewOption = useCallback(
    (index: number) => {
      updateSettings((current) => {
        if (
          current.reviewOptions.length <= 1 ||
          index < 0 ||
          index >= current.reviewOptions.length
        ) {
          return current;
        }
        return {
          ...current,
          reviewOptions: current.reviewOptions.filter((_, i) => i !== index),
        };
      });
    },
    [updateSettings],
  );

  const moveReviewOption = useCallback(
    (index: number, direction: "up" | "down") => {
      updateSettings((current) => {
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (
          index < 0 ||
          index >= current.reviewOptions.length ||
          targetIndex < 0 ||
          targetIndex >= current.reviewOptions.length
        ) {
          return current;
        }
        const next = [...current.reviewOptions];
        const [moved] = next.splice(index, 1);
        next.splice(targetIndex, 0, moved);
        return { ...current, reviewOptions: next };
      });
    },
    [updateSettings],
  );

  const resetReviewOptionsToDefaults = useCallback(() => {
    updateSettings((current) => ({
      ...current,
      reviewOptions: getDefaultReviewOptions(),
    }));
  }, [updateSettings]);

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultCaseStatusSettings();
    setSettings(defaults);
    saveCaseStatusSettings(defaults);
  }, []);

  return {
    caseStatuses: settings.statuses,
    lienLabel: settings.lienLabel,
    lienOptions: settings.lienOptions,
    reviewOptions: settings.reviewOptions,
    addStatus,
    removeStatus,
    toggleDashboardVisibility,
    setStatusColor,
    setStatusClosed,
    setStatusAutoFolder,
    setLienLabel,
    addLienOption,
    updateLienOption,
    moveLienOption,
    removeLienOption,
    resetLienOptionsToDefaults,
    addReviewOption,
    updateReviewOption,
    moveReviewOption,
    removeReviewOption,
    resetReviewOptionsToDefaults,
    resetToDefaults,
  };
}
