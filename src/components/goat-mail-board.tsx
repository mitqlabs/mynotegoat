"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { appConfirm } from "@/components/app-dialog";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { onLocalChange } from "@/lib/local-sync";
import { createPatientRecord, patients as livePatients, updatePatientRecordById } from "@/lib/mock-data";
import {
  GOAT_MAIL_CONNECT_LINE,
  GOAT_MAIL_KEY,
  GOAT_MAIL_SECRET_EXPIRED,
  GOAT_MAIL_SETUP_LINE,
  answerMail,
  loadMailDecisions,
  mailSecretAlertText,
  mailSecretDue,
  planMailIntake,
  reloadMailDecisions,
  rememberMailPatient,
  rememberMailReferral,
  resolveMail,
  resolveMailBuckets,
  saveMailDecisions,
  triageGoatMail,
  type ClaimDocument,
  type GoatMailCategory,
  type GoatMailDecision,
  type GoatMailMessage,
  type GoatMailRow,
  type MailBucket,
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
  buckets?: MailBucket[] | null;
};

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
        buckets: status?.buckets,
      }),
    [status?.messages, input.patients, input.appointments, input.claimDocument, input.listVersion, decisions, todayIso],
  );

  const mailboxRows = rows.filter((row) => row.needsAnswer || row.category !== "new-patient");
  const openReferral = (id: string) => !decisions.some((item) => item.id === id && (item.patientId || item.resolved));
  const liveReferrals = rows.filter((row) => row.category === "new-patient" && row.referral && !row.needsAnswer && openReferral(row.id));
  const storedReferrals: GoatMailRow[] = decisions
    .filter((item) => item.referral && !item.patientId && !item.resolved && !liveReferrals.some((row) => row.id === item.id))
    .map((item) => ({
      id: item.id,
      category: "new-patient",
      label: "New Patient referral",
      subject: "",
      from: item.referral?.from ?? "",
      receivedAt: item.updatedAt,
      flags: [],
      missing: item.referral?.missing ?? [],
      needsAnswer: false,
      question: "",
      choices: [],
      create: Boolean(item.referral?.firstName && item.referral?.lastName),
      referral: {
        firstName: item.referral?.firstName ?? "",
        lastName: item.referral?.lastName ?? "",
        phone: item.referral?.phone,
        dateOfLoss: item.referral?.dateOfLoss ?? "",
        attorney: item.referral?.attorney,
        from: item.referral?.from ?? "",
      },
    }));
  const referrals = [...liveReferrals, ...storedReferrals];

  useEffect(() => {
    const pending = liveReferrals.filter((row) => row.referral);
    if (!pending.length) return;
    let next = loadMailDecisions();
    let changed = false;
    const now = new Date().toISOString();
    for (const row of pending) {
      if (!row.referral) continue;
      const prior = next.find((item) => item.id === row.id);
      const snapshot = {
        firstName: row.referral.firstName,
        lastName: row.referral.lastName,
        ...(row.referral.phone ? { phone: row.referral.phone } : {}),
        ...(row.referral.dateOfLoss ? { dateOfLoss: row.referral.dateOfLoss } : {}),
        ...(row.referral.attorney ? { attorney: row.referral.attorney } : {}),
        ...(row.referral.from ? { from: row.referral.from } : {}),
        ...(row.missing.length ? { missing: row.missing } : {}),
      };
      if (prior?.referral && JSON.stringify(prior.referral) === JSON.stringify(snapshot)) continue;
      const saved = rememberMailReferral(next, row.id, snapshot, now);
      if (saved !== next) {
        next = saved;
        changed = true;
      }
    }
    if (changed) void saveMailDecisions(next);
  }, [liveReferrals]);

  const save = (next: GoatMailDecision[]) => {
    setDecisions(next);
    void saveMailDecisions(next);
  };

  return {
    status,
    rows: mailboxRows,
    referrals,
    addReferral: async (id: string) => {
      const row = referrals.find((item) => item.id === id) ?? rows.find((item) => item.id === id);
      const draft = row?.draft ?? row?.referral;
      if (!draft?.firstName || !draft.lastName) {
        setNotice("That referral is missing a name, so no chart was added.");
        return;
      }
      const decisions = await reloadMailDecisions();
      const plan = planMailIntake({
        messageId: id,
        draft,
        decisions,
        patients: livePatients.map((patient) => ({
          id: patient.id,
          fullName: patient.fullName,
          dateOfLoss: patient.dateOfLoss,
          deleted: patient.deleted,
          phone: patient.phone,
          dob: patient.dob,
          goatMailMessageId: patient.matrix?.goatMailMessageId,
        })),
      });
      const now = new Date().toISOString();
      if (plan.action === "skip") {
        setNotice("That email was already added.");
        return;
      }
      if (plan.action === "link") {
        const open = await appConfirm("This person is already in the office. Open that chart instead?");
        if (!open) return;
        save(rememberMailPatient(decisions, id, plan.patientId, now));
        window.location.assign(`/patients/${plan.patientId}`);
        return;
      }
      const created = createPatientRecord({
        firstName: draft.firstName,
        lastName: draft.lastName,
        phone: draft.phone,
        dob: draft.dob,
        dateOfLoss: draft.dateOfLoss,
        attorney: draft.attorney,
        address: draft.address,
        initialExam: draft.initialExam,
        notes: row?.missing.length ? `Added from G.O.A.T. Mail. Missing: ${row.missing.join(", ")}.` : "Added from G.O.A.T. Mail.",
      });
      if (!created) return;
      updatePatientRecordById(created.id, { matrix: { goatMailMessageId: id } });
      save(rememberMailPatient(decisions, id, created.id, now));
    },
    dismissReferral: (id: string) => {
      void (async () => {
        const current = await reloadMailDecisions();
        save(resolveMail(current, id, new Date().toISOString()));
      })();
    },
    actionCount: mailboxRows.length,
    questionCount: mailboxRows.filter((row) => row.needsAnswer).length,
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

function MailCard({ row, onAnswer, onResolve }: { row: GoatMailRow; onAnswer: (id: string, category: GoatMailCategory) => void; onResolve: (id: string) => void }) {
  return (
    <li className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-3">
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
        <Link className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-primary)] underline" href={`/patients/${row.patientId}`}>
          Open chart
        </Link>
      )}
      {row.needsAnswer && <p className="mt-1 text-xs font-semibold">{row.question}</p>}
      {row.choices.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {row.choices.map((choice) => (
            <button className="min-h-11 rounded-full border border-[var(--brand-primary)] px-3 text-sm font-semibold text-[var(--brand-primary)]" key={choice.id} onClick={() => onAnswer(row.id, choice.id)} type="button">
              {choice.label}
            </button>
          ))}
        </div>
      )}
      {row.needsAnswer && (
        <button className="mt-1 min-h-11 text-sm font-semibold text-[var(--text-muted)] underline" onClick={() => onResolve(row.id)} type="button">
          I&apos;ll handle it
        </button>
      )}
    </li>
  );
}

function RowList({ rows, onAnswer, onResolve }: { rows: GoatMailRow[]; onAnswer: (id: string, category: GoatMailCategory) => void; onResolve: (id: string) => void }) {
  if (!rows.length) return <p className="mt-2 text-sm text-[var(--text-muted)]">Nothing in the mailbox needs a decision.</p>;
  return (
    <ul className="mt-3 space-y-3">
      {rows.map((row) => (
        <MailCard key={row.id} onAnswer={onAnswer} onResolve={onResolve} row={row} />
      ))}
    </ul>
  );
}

export function SecretDateField({ value, onSave }: { value: string; onSave: (iso: string) => void }) {
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

function BucketColumns({
  rows,
  buckets,
  onAnswer,
  onResolve,
}: {
  rows: GoatMailRow[];
  buckets: MailBucket[];
  onAnswer: (id: string, category: GoatMailCategory) => void;
  onResolve: (id: string) => void;
}) {
  const needs = rows.filter((row) => row.needsAnswer);
  const groups = [
    { id: "needs-answer", name: "Needs your answer", items: needs },
    ...buckets.map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      items: rows.filter((row) => !row.needsAnswer && row.category === bucket.id),
    })),
  ];
  const known = new Set(buckets.map((bucket) => bucket.id));
  const leftover = rows.filter((row) => !row.needsAnswer && !known.has(row.category));
  if (leftover.length) {
    const other = groups.find((group) => group.id === "other");
    if (other) other.items = [...other.items, ...leftover];
    else groups.push({ id: "other", name: "Other", items: leftover });
  }
  if (!rows.length) return <p className="text-sm text-[var(--text-muted)]">Nothing in the mailbox needs a decision.</p>;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-goat-mail-buckets>
      {groups.map((group) => {
        const heading = (
          <span className="flex min-h-11 items-center justify-between gap-2 px-3 py-2 text-sm font-semibold">
            <span>{group.name}</span>
            <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-xs">{group.items.length}</span>
          </span>
        );
        if (!group.items.length) {
          return (
            <details className="rounded-2xl border border-[var(--line-soft)] bg-white/70" key={group.id}>
              <summary className="cursor-pointer list-none">{heading}</summary>
            </details>
          );
        }
        return (
          <section className="rounded-2xl border border-[var(--line-soft)] bg-[#f8fbfc] p-2" key={group.id}>
            {heading}
            <ul className="space-y-2">
              {group.items.map((row) => (
                <MailCard key={row.id} onAnswer={onAnswer} onResolve={onResolve} row={row} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function MailHeader({
  status,
  notice,
  onConnect,
  onDisconnect,
}: {
  status: Status;
  notice: string;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const ready = Boolean(status.configured && !status.needsMigration);
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line-soft)] bg-white px-4 py-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">G.O.A.T. Mail</h1>
        {!ready ? <p className="text-sm text-[var(--text-muted)]">{GOAT_MAIL_SETUP_LINE}</p> : null}
        {ready && !status.connected ? <p className="text-sm text-[var(--text-muted)]">{GOAT_MAIL_CONNECT_LINE}</p> : null}
        {status.connected ? <p className="truncate text-sm text-[var(--text-muted)]">Connected as {status.account || "the office mailbox"} · read only</p> : null}
        {notice && notice !== "disconnected" ? <p className="text-sm text-[var(--text-muted)]">Could not connect the mailbox. Try again.</p> : null}
        {status.error ? <p className="text-sm text-[var(--text-muted)]">Could not read the mailbox. Try again in a moment.</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ready && !status.connected ? (
          <a
            className="inline-flex min-h-11 items-center rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white"
            href="/api/goat-mail/connect"
            onClick={(event) => {
              event.preventDefault();
              onConnect();
            }}
          >
            Connect Outlook
          </a>
        ) : null}
        {status.connected ? (
          <button className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--text-muted)] underline" onClick={onDisconnect} type="button">
            Disconnect
          </button>
        ) : null}
        <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-primary)] underline" href="/settings/goat#goat-mail">
          G.O.A.T. Settings
        </Link>
      </div>
    </header>
  );
}

function MailPageLink({ connected }: { connected: boolean }) {
  return (
    <Link className="mt-2 inline-block text-sm font-semibold text-[var(--brand-primary)] underline" href="/goat-mail">
      {connected ? "Open G.O.A.T. Mail" : "Connect"}
    </Link>
  );
}

export function FolderPicker({
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
      <legend className="text-sm font-semibold">Folders G.O.A.T. reads</legend>
      <p className="mt-1 text-xs text-[var(--text-muted)]">Inbox is the default. G.O.A.T. only reads the folders you leave checked.</p>
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
  if (!status) return <p className="mt-2 text-sm text-[var(--text-muted)]">Opening G.O.A.T. Mail…</p>;
  const ready = Boolean(status.configured && !status.needsMigration);
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
  const buckets = resolveMailBuckets(status.buckets);
  return (
    <div className="w-full space-y-4" data-goat-mail-page>
      <MailHeader notice={notice} onConnect={onConnect} onDisconnect={onDisconnect} status={status} />
      {ready && status.connected ? <BucketColumns buckets={buckets} onAnswer={onAnswer} onResolve={onResolve} rows={rows} /> : null}
    </div>
  );
}
