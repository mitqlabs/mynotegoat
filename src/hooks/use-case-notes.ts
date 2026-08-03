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
 *
 * On-screen text updates instantly on every keystroke; the persist (localStorage
 * + cloud + mirror notify) is DEBOUNCED so fast typing isn't stalled by a
 * per-keystroke cloud write (which dropped characters). The pending edit is
 * flushed on unmount / patient change so nothing is lost.
 */
export function useCaseNotes(patientId: string, seed = "") {
  const key = patientId.trim();
  const selfWriteCountRef = useRef(0);
  const seedRef = useRef(seed);
  seedRef.current = seed;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);

  const [notes, setNotesState] = useState<string>(() => {
    const stored = getCaseNote(key);
    return stored !== null ? stored : seed;
  });

  const flush = useCallback((flushKey: string) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (pendingRef.current !== null) {
      setCaseNote(flushKey, pendingRef.current);
      pendingRef.current = null;
      selfWriteCountRef.current++;
      notifyChange(STORAGE_KEY_CASE_NOTES);
    }
  }, []);

  // Re-read when the patient changes; flush the previous patient's pending edit.
  useEffect(() => {
    const stored = getCaseNote(key);
    setNotesState(stored !== null ? stored : seedRef.current);
    return () => flush(key);
  }, [key, flush]);

  // React to writes from other instances (the mirror).
  useEffect(() => {
    return onLocalChange(STORAGE_KEY_CASE_NOTES, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      // Don't clobber an in-progress local edit that hasn't been flushed yet.
      if (pendingRef.current !== null) return;
      const stored = getCaseNote(key);
      setNotesState(stored !== null ? stored : seedRef.current);
    });
  }, [key]);

  const setNotes = useCallback(
    (value: string) => {
      setNotesState(value); // instant on-screen update
      pendingRef.current = value;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        setCaseNote(key, pendingRef.current ?? value);
        pendingRef.current = null;
        saveTimerRef.current = null;
        selfWriteCountRef.current++;
        notifyChange(STORAGE_KEY_CASE_NOTES);
      }, 400);
    },
    [key],
  );

  return { notes, setNotes };
}
