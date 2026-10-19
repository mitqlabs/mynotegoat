"use client";

import { useEffect, useRef, useState } from "react";
import { listFormRequests, type FormRequestRow } from "@/lib/patient-forms-client";

const REFRESH_EVENT = "notegoat:form-requests-changed";

/** Ask every mounted list to re-read (after send / revoke / insert / dismiss). */
export function refreshFormRequests() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REFRESH_EVENT));
}

type Filter = { patientId?: string; awaitingReview?: boolean; enabled: boolean };

/**
 * Questionnaire links from the cloud: re-read on mount, when the filter
 * changes, on window focus, on refreshFormRequests(), and every 2 minutes
 * while the tab is visible. `available` is false until the server table
 * exists (migration not run) — callers then show nothing.
 */
export function useFormRequests(filter: { patientId?: string; awaitingReview?: boolean }, enabled = true) {
  const [rows, setRows] = useState<FormRequestRow[]>([]);
  const [available, setAvailable] = useState(false);
  const filterRef = useRef<Filter>({ ...filter, enabled });
  const loadRef = useRef<() => void>(() => undefined);

  // One set of listeners per hook instance, installed once ([] deps).
  useEffect(() => {
    let alive = true;
    loadRef.current = () => {
      const f = filterRef.current;
      if (!f.enabled) return;
      void listFormRequests({ patientId: f.patientId, awaitingReview: f.awaitingReview }).then((data) => {
        if (!alive) return;
        setAvailable(data !== null);
        setRows(data ?? []);
      });
    };
    const onRefresh = () => loadRef.current();
    window.addEventListener("focus", onRefresh);
    window.addEventListener(REFRESH_EVENT, onRefresh);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") loadRef.current();
    }, 120_000);
    return () => {
      alive = false;
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(REFRESH_EVENT, onRefresh);
      window.clearInterval(id);
    };
  }, []);

  const { patientId, awaitingReview } = filter;
  useEffect(() => {
    filterRef.current = { patientId, awaitingReview, enabled };
    loadRef.current();
  }, [patientId, awaitingReview, enabled]);

  return { rows, available, reload: () => loadRef.current() };
}
