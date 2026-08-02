"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCaseNote, setCaseNote, STORAGE_KEY_CASE_NOTES } from "@/lib/case-notes";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

/**
 * Shared per-patient Case Notes. Every instance (patient page, encounter
 * workspace) reads/writes the same store and stays in sync via local-sync, so
 * the two note boxes mirror each other — edit or clear on one, it shows on the
 * other. `seed` is the legacy patient.matrix.notes fallback used only until the
 * note has been touched through this store.
 */
export function useCaseNotes(patientId: string, seed = "") {
  const key = patientId.trim();
  const selfWriteCountRef = useRef(0);
  const seedRef = useRef(seed);
  seedRef.current = seed;

  const [notes, setNotesState] = useState<string>(() => {
    const stored = getCaseNote(key);
    return stored !== null ? stored : seed;
  });

  // Re-read when the patient changes.
  useEffect(() => {
    const stored = getCaseNote(key);
    setNotesState(stored !== null ? stored : seedRef.current);
  }, [key]);

  // React to writes from other instances (the mirror).
  useEffect(() => {
    return onLocalChange(STORAGE_KEY_CASE_NOTES, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      const stored = getCaseNote(key);
      setNotesState(stored !== null ? stored : seedRef.current);
    });
  }, [key]);

  const setNotes = useCallback(
    (value: string) => {
      setNotesState(value);
      setCaseNote(key, value);
      selfWriteCountRef.current++;
      notifyChange(STORAGE_KEY_CASE_NOTES);
    },
    [key],
  );

  return { notes, setNotes };
}
