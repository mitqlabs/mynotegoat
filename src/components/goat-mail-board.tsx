"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { onLocalChange } from "@/lib/local-sync";
import { createPatientRecord } from "@/lib/mock-data";
import {
  GOAT_MAIL_CONNECT_LINE,
  GOAT_MAIL_COMING_SOON,
  GOAT_MAIL_KEY,
  answerMail,
  loadMailDecisions,
  rememberMailPatient,
  resolveMail,
  saveMailDecisions,
  triageGoatMail,
  type ClaimDocument,
  type GoatMailCategory,
  type GoatMailDecision,
  type GoatMailMessage,
  type GoatMailRow,
} from "@/lib/goat-mail";

type Status = {
  configured: boolean;
  connected: boolean;
  account?: string;
  needsMigration?: boolean;
  error?: string;
  messages: GoatMailMessage[];
};

const creating = new Set<string>();

const FLAG_LABEL: Record<GoatMailRow["flags"][number], string> = {
  unbooked: "Unbooked referral",
  "multi-passenger": "Multi-passenger crash",
  "second-crash": "Second crash for an existing patient",
};

async function authHeaders(): Promise<Record<string, string> | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

export function useGoatMail(input: {
  patients: Array<{ id: string; fullName: string; dateOfLoss?: string; deleted?: boolean }>;
  appointments: Array<{ patientId: string; date: string; status: string }>;
  claimDocument: ClaimDocument;
  listVersion: number;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [decisions, setDecisions] = useState<GoatMailDecision[]>(() => loadMailDecisions());
  const [notice, setNotice] = useState("");

  useEffect(() => onLocalChange(GOAT_MAIL_KEY, () => setDecisions(loadMailDecisions())), []);

  useEffect(() => {
    let stop = false;
    void (async () => {
      const headers = await authHeaders();
      if (!headers) {
        if (!stop) setStatus({ configured: false, connected: false, messages: [] });
        return;
      }
      const res = await fetch("/api/goat-mail/inbox", { headers }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as Status | null;
      if (!stop) setStatus(json ?? { configured: false, connected: false, messages: [] });
    })();
    return () => {
      stop = true;
    };
  }, [notice]);

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const rows = useMemo(
    () =>
      triageGoatMail({
        messages: status?.messages ?? [],
        patients: input.patients,
        appointments: input.appointments,
        todayIso,
        claimDocument: input.claimDocument,
        decisions,
      }),
    [status?.messages, input.patients, input.appointments, input.claimDocument, input.listVersion, decisions, todayIso],
  );

  useEffect(() => {
    const pending = rows.filter((row) => row.create && row.draft);
    if (!pending.length) return;
    let next = loadMailDecisions();
    let changed = false;
    for (const row of pending) {
      if (!row.draft || next.some((item) => item.id === row.id && item.patientId) || creating.has(row.id)) continue;
      creating.add(row.id);
      const created = createPatientRecord({
        firstName: row.draft.firstName,
        lastName: row.draft.lastName,
        phone: row.draft.phone,
        dob: row.draft.dob,
        dateOfLoss: row.draft.dateOfLoss,
        attorney: row.draft.attorney,
        address: row.draft.address,
        initialExam: row.draft.initialExam,
        notes: row.missing.length ? `Added from GOAT Mail. Missing: ${row.missing.join(", ")}.` : "Added from GOAT Mail.",
      });
      creating.delete(row.id);
      if (!created) continue;
      next = rememberMailPatient(next, row.id, created.id, new Date().toISOString());
      changed = true;
    }
    if (!changed) return;
    void saveMailDecisions(next);
  }, [rows]);

  const save = (next: GoatMailDecision[]) => {
    setDecisions(next);
    void saveMailDecisions(next);
  };

  return {
    status,
    rows,
    actionCount: rows.length,
    questionCount: rows.filter((row) => row.needsAnswer).length,
    notice,
    connect: async () => {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch("/api/goat-mail/connect", { method: "POST", headers });
      const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (json?.url) window.location.assign(json.url);
      else setNotice("Could not connect the mailbox. Try again.");
    },
    disconnect: async () => {
      const headers = await authHeaders();
      if (!headers) return;
      await fetch("/api/goat-mail/inbox", { method: "DELETE", headers });
      setNotice("disconnected");
      setStatus((current) => (current ? { ...current, connected: false, messages: [] } : current));
    },
    answer: (id: string, category: GoatMailCategory) => save(answerMail(decisions, id, category, new Date().toISOString())),
    resolve: (id: string) => save(resolveMail(decisions, id, new Date().toISOString())),
  };
}

function RowList({ rows, onAnswer, onResolve }: { rows: GoatMailRow[]; onAnswer: (id: string, category: GoatMailCategory) => void; onResolve: (id: string) => void }) {
  if (!rows.length) return <p className="mt-2 text-sm text-[var(--text-muted)]">Nothing in the mailbox needs a decision.</p>;
  return (
    <ul className="mt-3 space-y-3">
      {rows.map((row) => (
        <li className="rounded-xl border border-[var(--line-soft)] px-3 py-2" key={row.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">{row.label}</span>
            <span className="text-[11px] text-[var(--text-muted)]">{row.from}</span>
          </div>
          <p className="text-sm">{row.subject}</p>
          {row.flags.length > 0 && (
            <p className="mt-1 text-xs font-semibold text-amber-800">{row.flags.map((flag) => FLAG_LABEL[flag]).join(" · ")}</p>
          )}
          {row.missing.length > 0 && <p className="mt-1 text-xs text-[var(--text-muted)]">Missing: {row.missing.join(", ")}</p>}
          {row.patientId && (
            <Link className="mt-1 inline-block text-xs font-semibold text-[var(--brand-primary)] hover:underline" href={`/patients/${row.patientId}`}>
              Open chart
            </Link>
          )}
          {row.needsAnswer && <p className="mt-1 text-xs font-semibold">{row.question}</p>}
          {row.choices.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {row.choices.map((choice) => (
                <button className="rounded-full border border-[var(--brand-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-primary)]" key={choice.id} onClick={() => onAnswer(row.id, choice.id)} type="button">
                  {choice.label}
                </button>
              ))}
            </div>
          )}
          {row.needsAnswer && (
            <button className="mt-2 text-xs font-semibold text-[var(--text-muted)] underline" onClick={() => onResolve(row.id)} type="button">
              I&apos;ll handle it
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function GoatMailBoard({
  variant,
  status,
  rows,
  notice,
  onConnect,
  onDisconnect,
  onAnswer,
  onResolve,
}: {
  variant: "page" | "triage" | "questions";
  status: Status | null;
  rows: GoatMailRow[];
  notice: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onAnswer: (id: string, category: GoatMailCategory) => void;
  onResolve: (id: string) => void;
}) {
  const questions = rows.filter((row) => row.needsAnswer);
  if (!status) return <p className="mt-2 text-sm text-[var(--text-muted)]">Opening GOAT Mail…</p>;
  const ready = Boolean(status.configured && !status.needsMigration);
  const connectButton = (
    <button className="mt-4 rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white" onClick={onConnect} type="button">
      Connect mailbox
    </button>
  );
  if (variant === "questions") {
    if (!ready || !status.connected) return <p className="mt-2 text-sm text-[var(--text-muted)]">Nothing to decide right now.</p>;
    return <RowList onAnswer={onAnswer} onResolve={onResolve} rows={questions} />;
  }
  if (variant === "triage") {
    if (!ready) return <p className="mt-2 text-sm text-[var(--text-muted)]">{GOAT_MAIL_COMING_SOON}</p>;
    if (!status.connected) {
      return (
        <div className="mt-2">
          <p className="text-sm">{GOAT_MAIL_CONNECT_LINE}</p>
          {connectButton}
        </div>
      );
    }
    return <RowList onAnswer={onAnswer} onResolve={onResolve} rows={rows} />;
  }
  if (!ready) {
    return (
      <div className="mx-auto max-w-3xl">
        <section className="panel-card p-5">
          <h1 className="text-xl font-semibold">{GOAT_MAIL_COMING_SOON}</h1>
        </section>
      </div>
    );
  }
  if (!status.connected) {
    return (
      <div className="mx-auto max-w-3xl">
        <section className="panel-card p-5">
          <h1 className="text-xl font-semibold">GOAT Mail</h1>
          <p className="mt-2 text-sm">{GOAT_MAIL_CONNECT_LINE}</p>
          {connectButton}
          {notice && notice !== "disconnected" && <p className="mt-3 text-sm text-[var(--text-muted)]">Could not connect the mailbox. Try again.</p>}
        </section>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="panel-card p-5">
        <h1 className="text-xl font-semibold">GOAT Mail</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Read-only. GOAT never sends, deletes, or changes email.</p>
        {status.account && <p className="mt-2 text-sm">Connected as {status.account}</p>}
        {status.error && <p className="mt-2 text-sm text-[var(--text-muted)]">Could not read the mailbox. Try again in a moment.</p>}
        <button className="mt-3 text-sm font-semibold text-[var(--text-muted)] underline" onClick={onDisconnect} type="button">
          Disconnect mailbox
        </button>
      </section>
      <section className="panel-card p-5">
        <h2 className="text-sm font-semibold">Triage</h2>
        <RowList onAnswer={onAnswer} onResolve={onResolve} rows={rows} />
      </section>
    </div>
  );
}
