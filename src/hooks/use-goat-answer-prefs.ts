"use client";

import { useCallback, useEffect, useState } from "react";
import { markLocalWrite, notifyChange, onLocalChange } from "@/lib/local-sync";
import { GOAT_ANSWER_PREFS_KEY, loadGoatAnswerPrefs, saveGoatAnswerPrefs, type GoatAnswerPrefs } from "@/lib/goat-answer-prefs";

/** G.O.A.T. answer settings for this office (Settings → G.O.A.T.): Show costs / fees, Region order. */
export function useGoatAnswerPrefs() {
  const [prefs, setPrefs] = useState<GoatAnswerPrefs>(() => loadGoatAnswerPrefs());
  useEffect(() => onLocalChange(GOAT_ANSWER_PREFS_KEY, () => setPrefs(loadGoatAnswerPrefs())), []);
  const update = useCallback((patch: Partial<GoatAnswerPrefs>) => {
    const next = { ...loadGoatAnswerPrefs(), ...patch };
    markLocalWrite(GOAT_ANSWER_PREFS_KEY);
    saveGoatAnswerPrefs(next);
    setPrefs(loadGoatAnswerPrefs());
    notifyChange(GOAT_ANSWER_PREFS_KEY);
  }, []);
  return { prefs, update };
}
