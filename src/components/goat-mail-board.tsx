"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { onLocalChange } from "@/lib/local-sync";
import { createPatientRecord } from "@/lib/mock-data";
import {
  GOAT_MAIL_CONNECT_LINE,
  GOAT_MAIL_KEY,
  GOAT_MAIL_SECRET_EXPIRED,
  GOAT_MAIL_SETUP_LINE,
  answerMail,
  loadMailDecisions,
  mailSecretAlertText,
  mailSecretDue,
  rememberMailPatient,
  resolveMail,
  saveMailDecisions,
  triageGoatMail,
  type ClaimDocument,
  type GoatMailCategory,
  type GoatMailDecision,
  type GoatMailMessage,
  type GoatMailRow,
  type MailFolderChoice,
} from "@/lib/goat-mail";

type Status = {
  configured: boolean;
  connected: boolean;
  account?: string;
  needsMigration?: boolean;
  error?: string;
  messages: GoatMailMessage[];
  folders?: MailFolderChoice[];
  selectedFolderIds?: string[];
  secretExpiresOn?: string;
  secretExpired?: boolean;
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
  const [folderNotice, setFolderNotice] = useState("");
  const [reload, setReload] = useState(0);

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
  }, [notice, reload]);

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
    folderNotice,
    connect: async () => {
      const headers = await authHeaders();
      if (!headers) {
        setNotice("Could not connect the mailbox. Try again.");
        return;
      }
      const res = await fetch("/api/goat-mail/connect", { headers }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as { url?: string } | null;
      if (json?.url) {
        window.location.assign(json.url);
        return;
      }
      setNotice("Could not connect the mailbox. Try again.");
    },
    saveFolders: async (folderIds: string[]) => {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch("/api/goat-mail/folders", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ folderIds }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setFolderNotice(json?.error || "Could not save the folders.");
        return;
      }
      setFolderNotice("Saved.");
      setReload((value) => value + 1);
    },
    saveSecret: async (expiresOn: string) => {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch("/api/goat-mail/secret", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresOn }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string; expiresOn?: string } | null;
      if (!res.ok) {
        setNotice(json?.error || "Could not save the date.");
        return;
      }
      setNotice("");
      setStatus((current) => (current ? { ...current, secretExpiresOn: json?.expiresOn ?? "" } : current));
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

function SecretDateField({ value, onSave }: { value: string; onSave: (iso: string) => void }) {
  const [date, setDate] = useState(value);
  return (
    <div className="mt-4">
      <label className="block text-sm font-semibold" htmlFor="goat-mail-secret-date">
        Microsoft secret expires on
      </label>
      <p className="mt-1 text-xs text-[var(--text-muted)]">Optional. Saved for this office.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input className="rounded-lg border border-[var(--line-soft)] px-2 py-1 text-sm" id="goat-mail-secret-date" onChange={(event) => setDate(event.target.value)} type="date" value={date} />
        <button className="rounded-xl border border-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--brand-primary)]" onClick={() => onSave(date)} type="button">
          Save date
        </button>
        {value ? (
          <button className="text-sm font-semibold text-[var(--text-muted)] underline" onClick={() => { setDate(""); onSave(""); }} type="button">
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function GoatMailSecretNotice({
  expiresOn,
  secretExpired = false,
  today = new Date(),
}: {
  expiresOn?: string | null;
  secretExpired?: boolean;
  today?: Date;
}) {
  const due = Boolean(expiresOn && mailSecretDue(expiresOn, today));
  if (!due && !secretExpired) return null;
  return (
    <div className="mb-3 space-y-2">
      {secretExpired ? <p className="rounded-xl bg-[#fde8e8] px-3 py-2 text-sm text-[#9b1c1c]" role="alert">{GOAT_MAIL_SECRET_EXPIRED}</p> : null}
      {due && expiresOn ? <p className="rounded-xl bg-[#fff4d6] px-3 py-2 text-sm text-[#7a4b00]" role="alert">{mailSecretAlertText(expiresOn)}</p> : null}
    </div>
  );
}

function MailPageLink({ connected }: { connected: boolean }) {
  return (
    <Link className="mt-2 inline-block text-sm font-semibold text-[var(--brand-primary)] underline" href="/goat-mail">
      {connected ? "Open GOAT Mail" : "Connect"}
    </Link>
  );
}

function FolderPicker({
  folders,
  selected,
  notice,
  onSave,
}: {
  folders: MailFolderChoice[];
  selected: string[];
  notice: string;
  onSave: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(selected);
  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-semibold">Folders GOAT reads</legend>
      <p className="mt-1 text-xs text-[var(--text-muted)]">Inbox is the default. GOAT only reads the folders you leave checked.</p>
      <ul className="mt-2 max-h-64 space-y-1 overflow-auto">
        {folders.map((folder) => (
          <li key={folder.id}>
            <label className="flex items-center gap-2 text-sm">
              <input checked={picked.includes(folder.id)} onChange={() => toggle(folder.id)} type="checkbox" />
              <span>{folder.path}</span>
            </label>
          </li>
        ))}
      </ul>
      <button className="mt-3 rounded-xl border border-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--brand-primary)]" disabled={picked.length === 0} onClick={() => onSave(picked)} type="button">
        Save folders
      </button>
      {notice && <p className="mt-2 text-xs text-[var(--text-muted)]">{notice}</p>}
    </fieldset>
  );
}

export function GoatMailBoard({
  variant,
  status,
  rows,
  notice,
  folderNotice = "",
  onConnect,
  onDisconnect,
  onAnswer,
  onResolve,
  onSaveFolders,
  onSaveSecret,
}: {
  variant: "page" | "triage" | "questions";
  status: Status | null;
  rows: GoatMailRow[];
  notice: string;
  folderNotice?: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onAnswer: (id: string, category: GoatMailCategory) => void;
  onResolve: (id: string) => void;
  onSaveFolders?: (ids: string[]) => void;
  onSaveSecret?: (iso: string) => void;
}) {
  const questions = rows.filter((row) => row.needsAnswer);
  if (!status) return <p className="mt-2 text-sm text-[var(--text-muted)]">Opening GOAT Mail…</p>;
  const ready = Boolean(status.configured && !status.needsMigration);
  const connectButton = (
    <a
      className="mt-5 inline-flex items-center justify-center rounded-2xl bg-[var(--brand-primary)] px-6 py-3 text-base font-semibold text-white"
      href="/api/goat-mail/connect"
      onClick={(event) => {
        event.preventDefault();
        onConnect();
      }}
    >
      Connect Outlook
    </a>
  );
  if (variant === "questions") {
    if (!ready || !status.connected) return <p className="mt-2 text-sm text-[var(--text-muted)]">Nothing to decide right now.</p>;
    return <RowList onAnswer={onAnswer} onResolve={onResolve} rows={questions} />;
  }
  if (variant === "triage") {
    return (
      <div className="mt-2">
        <MailPageLink connected={Boolean(ready && status.connected)} />
        {ready && status.connected ? <RowList onAnswer={onAnswer} onResolve={onResolve} rows={rows} /> : null}
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="mx-auto max-w-3xl">
        <section className="panel-card p-5">
          <h1 className="text-xl font-semibold">GOAT Mail</h1>
          <GoatMailSecretNotice expiresOn={status.secretExpiresOn} secretExpired={status.secretExpired} />
          <p className="mt-2 text-sm">{GOAT_MAIL_SETUP_LINE}</p>
          {onSaveSecret ? <SecretDateField key={status.secretExpiresOn ?? ""} onSave={onSaveSecret} value={status.secretExpiresOn ?? ""} /> : null}
        </section>
      </div>
    );
  }
  if (!status.connected) {
    return (
      <div className="mx-auto max-w-3xl">
        <section className="panel-card p-5">
          <h1 className="text-xl font-semibold">GOAT Mail</h1>
          <GoatMailSecretNotice expiresOn={status.secretExpiresOn} secretExpired={status.secretExpired} />
          <p className="mt-2 text-sm">{GOAT_MAIL_CONNECT_LINE}</p>
          {connectButton}
          {notice && notice !== "disconnected" && <p className="mt-3 text-sm text-[var(--text-muted)]">Could not connect the mailbox. Try again.</p>}
          {onSaveSecret ? <SecretDateField key={status.secretExpiresOn ?? ""} onSave={onSaveSecret} value={status.secretExpiresOn ?? ""} /> : null}
        </section>
      </div>
    );
  }
  const folders = status.folders ?? [];
  const selected = status.selectedFolderIds ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="panel-card p-5">
        <h1 className="text-xl font-semibold">GOAT Mail</h1>
        <GoatMailSecretNotice expiresOn={status.secretExpiresOn} secretExpired={status.secretExpired} />
        <p className="mt-1 text-sm text-[var(--text-muted)]">Read-only. GOAT never sends, moves, deletes, or changes email.</p>
        {status.account && <p className="mt-2 text-sm">Connected as {status.account}</p>}
        {status.error && !status.secretExpired && <p className="mt-2 text-sm text-[var(--text-muted)]">Could not read the mailbox. Try again in a moment.</p>}
        {onSaveSecret ? <SecretDateField key={status.secretExpiresOn ?? ""} onSave={onSaveSecret} value={status.secretExpiresOn ?? ""} /> : null}
        {folders.length > 0 && onSaveFolders && <FolderPicker key={selected.join("|")} folders={folders} notice={folderNotice} onSave={onSaveFolders} selected={selected} />}
        <button className="mt-3 block text-sm font-semibold text-[var(--text-muted)] underline" onClick={onDisconnect} type="button">
          Disconnect
        </button>
      </section>
      <section className="panel-card p-5">
        <h2 className="text-sm font-semibold">Triage</h2>
        <RowList onAnswer={onAnswer} onResolve={onResolve} rows={rows} />
      </section>
    </div>
  );
}
