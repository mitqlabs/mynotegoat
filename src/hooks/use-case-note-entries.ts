"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCaseNotes } from "@/hooks/use-case-notes";
import {
  CASE_NOTE_ENTRIES_KEY,
  addEntry,
  authorDisplayName,
  caseNotesPlainText,
  canEditEntryDate,
  canEditEntryText,
  deleteEntry,
  entriesForPatient,
  loadCaseNoteEntries,
  makeEntry,
  mergeEntries,
  normalizeEntries,
  saveCaseNoteEntries,
  updateEntry,
  type CaseNoteEntry,
} from "@/lib/case-note-entries";
import { notifyChange, onLocalChange } from "@/lib/local-sync";
import { useWorkspaceKvRealtime } from "@/lib/cloud-realtime";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { getCurrentMembershipSync } from "@/lib/workspace-membership";
import { loadOfficeSettings } from "@/lib/office-settings";
import { logActivity } from "@/lib/activity-log";

/** Name stamped on a note by the person signed in right now. */
export function currentAuthor(): { author: string; userId: string } {
  const m = getCurrentMembershipSync();
  const office = loadOfficeSettings();
  const author = authorDisplayName({
    userId: m?.userId ?? null,
    isMember: Boolean(m?.isMember),
    memberLabel: m?.label ?? "",
    memberFirstName: m?.permissions?.firstName,
    memberLastName: m?.permissions?.lastName,
    ownerName: (office.doctorName ?? "").trim(),
    doctors: office.doctors ?? [],
  });
  return { author, userId: m?.userId ?? "" };
}

/**
 * One patient's Notes log. Every instance (patient page, encounter workspace)
 * reads the same cloud-backed list, so they mirror each other and update for
 * other team members (realtime + refetch on open).
 */
export function useCaseNoteEntries(patientId: string, patientName = "") {
  const pid = patientId.trim();
  const { roleTier } = useWorkspaceAccess();
  const [all, setAll] = useState<CaseNoteEntry[]>(() => loadCaseNoteEntries());
  const [cloudOk, setCloudOk] = useState(true);

  // Other instances on this page.
  useEffect(() => onLocalChange(CASE_NOTE_ENTRIES_KEY, () => setAll(loadCaseNoteEntries())), []);

  const applyRemote = useCallback((remote: unknown) => {
    if (remote === null || remote === undefined) return;
    const merged = mergeEntries(loadCaseNoteEntries(), remote);
    try {
      window.localStorage.setItem(CASE_NOTE_ENTRIES_KEY, JSON.stringify(merged));
    } catch {
      /* cache only */
    }
    setAll(merged);
  }, []);

  // Another device / team member added or changed a note.
  useWorkspaceKvRealtime(CASE_NOTE_ENTRIES_KEY, (value) => applyRemote(normalizeEntries(value)));

  // Pull the latest from the cloud when a patient's notes open.
  useEffect(() => {
    let off = false;
    void import("@/lib/kv-cloud")
      .then((kv) => kv.fetchKvValue<unknown>(CASE_NOTE_ENTRIES_KEY))
      .then((remote) => {
        if (!off) applyRemote(remote);
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [pid, applyRemote]);

  const entries = useMemo(() => entriesForPatient(all, pid), [all, pid]);

  const commit = useCallback((next: CaseNoteEntry[]) => {
    setAll(next);
    void saveCaseNoteEntries(next).then((res) => {
      setAll(res.records);
      setCloudOk(res.cloudOk);
      notifyChange(CASE_NOTE_ENTRIES_KEY);
    });
  }, []);

  /** Returns true when a note was added (false for an empty box). */
  const add = useCallback(
    (text: string): boolean => {
      const { author, userId } = currentAuthor();
      const entry = makeEntry({ patientId: pid, text, author, authorUserId: userId });
      if (!entry) return false;
      commit(addEntry(loadCaseNoteEntries(), entry));
      logActivity({ category: "notes", action: "case_note.added", summary: "Added a note to Notes", patientId: pid, patientName, details: { text: entry.text } });
      return true;
    },
    [pid, patientName, commit],
  );

  const edit = useCallback(
    (id: string, patch: { text?: string; date?: string }) => {
      const { author } = currentAuthor();
      commit(updateEntry(loadCaseNoteEntries(), id, patch, author));
      logActivity({ category: "notes", action: "case_note.edited", summary: "Edited a note in Notes", patientId: pid, patientName, details: { id, ...patch } });
    },
    [pid, patientName, commit],
  );

  const remove = useCallback(
    (id: string) => {
      const { author } = currentAuthor();
      const old = loadCaseNoteEntries().find((e) => e.id === id);
      commit(deleteEntry(loadCaseNoteEntries(), id, author));
      logActivity({ category: "notes", action: "case_note.deleted", summary: "Deleted a note from Notes", patientId: pid, patientName, details: { id, text: old?.text ?? "" } });
    },
    [pid, patientName, commit],
  );

  const userId = getCurrentMembershipSync()?.userId ?? null;
  return {
    entries,
    add,
    edit,
    remove,
    cloudOk,
    canEditDate: canEditEntryDate(roleTier),
    canEditText: (entry: CaseNoteEntry) => canEditEntryText(entry, userId, roleTier),
  };
}

/**
 * Read-only plain text of a patient's Notes (the quick-note log, newest first,
 * then the old free-form text) for G.O.A.T. and letter templates. Reads the
 * local cache and follows local changes; the Notes box itself does the cloud sync.
 */
export function useCaseNotesText(patientId: string, seed = ""): string {
  const pid = patientId.trim();
  const { notes: legacy } = useCaseNotes(pid, seed);
  const [all, setAll] = useState<CaseNoteEntry[]>(() => loadCaseNoteEntries());
  useEffect(() => {
    return onLocalChange(CASE_NOTE_ENTRIES_KEY, () => setAll(loadCaseNoteEntries()));
  }, []);
  return useMemo(() => caseNotesPlainText(entriesForPatient(all, pid), legacy), [all, pid, legacy]);
}
