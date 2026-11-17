"use client";

/**
 * A STOP reply the phone reported, when we could not tell which patient it was.
 * One tap marks that person "no reminder texts". Nothing is stored only on this computer.
 */

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { patients } from "@/lib/mock-data";
import { stopReplyChoices, UNMATCHED_PREFIX } from "@/lib/reminder-automation";

interface Notice {
  id: string;
  label: string;
}

export function UnmatchedStopAlert() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [note, setNote] = useState("");
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      const client = getSupabaseBrowserClient();
      const workspaceId = getActiveWorkspaceIdSync();
      if (!client || !workspaceId) return;
      const { data } = await client
        .from("reminder_opt_outs")
        .select("id, patient_id")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancel) return;
      const rows = (data ?? []) as { id: number | string; patient_id: string }[];
      const seen = new Set<string>();
      const next: Notice[] = [];
      for (const row of rows) {
        if (!row.patient_id.startsWith(UNMATCHED_PREFIX)) continue;
        const label = row.patient_id.slice(UNMATCHED_PREFIX.length);
        if (seen.has(label)) continue;
        seen.add(label);
        next.push({ id: String(row.id), label });
      }
      setNotices(next);
    };
    loadRef.current = () => void load();
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancel = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const act = async (noticeId: string, patientId: string | null) => {
    setNote("");
    const client = getSupabaseBrowserClient();
    const { data } = await client?.auth.getSession() ?? { data: { session: null } };
    const access = data.session?.access_token ?? "";
    const res = await fetch("/api/reminders/opt-out", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify(patientId ? { noticeId, patientId } : { noticeId, dismiss: true }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setNote(body.error || "Couldn't save that. Try again.");
      return;
    }
    loadRef.current();
  };

  if (!notices.length) return null;
  return (
    <div className="border-b border-red-300 bg-red-50 px-4 py-3 text-sm text-red-950 lg:px-7" data-testid="unmatched-stop-alert" role="alert">
      {notices.map((notice) => {
        const choices = stopReplyChoices(patients, notice.label);
        return (
          <div className="py-1" key={notice.id}>
            <p className="font-bold">Unmatched STOP reply: {notice.label}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {choices.map((person) => (
                <button
                  className="rounded-lg bg-red-800 px-3 py-1.5 text-sm font-semibold text-white"
                  key={person.id}
                  onClick={() => void act(notice.id, person.id)}
                  type="button"
                >
                  {person.fullName} — No reminder texts
                </button>
              ))}
              <button className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold" onClick={() => void act(notice.id, null)} type="button">
                Not a patient
              </button>
            </div>
          </div>
        );
      })}
      {note ? <p className="mt-1 font-semibold">{note}</p> : null}
    </div>
  );
}
