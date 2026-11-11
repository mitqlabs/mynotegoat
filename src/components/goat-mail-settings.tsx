"use client";

import { useEffect, useState } from "react";
import { appConfirm } from "@/components/app-dialog";
import { FolderPicker, SecretDateField } from "@/components/goat-mail-board";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  GOAT_MAIL_CONNECT_LINE,
  GOAT_MAIL_SECRET_EXPIRED,
  GOAT_MAIL_SETUP_LINE,
  defaultMailBuckets,
  resolveMailBuckets,
  type MailBucket,
  type MailFolderChoice,
} from "@/lib/goat-mail";

type MailStatus = {
  configured?: boolean;
  connected?: boolean;
  account?: string;
  needsMigration?: boolean;
  error?: string;
  secretExpired?: boolean;
  secretExpiresOn?: string;
  folders?: MailFolderChoice[];
  selectedFolderIds?: string[];
  buckets?: MailBucket[] | null;
};

async function authHeaders(): Promise<Record<string, string> | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

function newBucketId(): string {
  return `b${Math.random().toString(36).slice(2, 8)}`;
}

export function GoatMailSettingsPanel({
  preview,
}: {
  /** Sample office data for a screenshot. The live page leaves this empty. */
  preview?: MailStatus;
}) {
  const [status, setStatus] = useState<MailStatus | null>(preview ?? null);
  const [buckets, setBuckets] = useState<MailBucket[]>(() => resolveMailBuckets(preview?.buckets));
  const [notice, setNotice] = useState("");
  const [folderNotice, setFolderNotice] = useState("");

  useEffect(() => {
    if (preview) return;
    let stop = false;
    void (async () => {
      const headers = await authHeaders();
      if (!headers) {
        if (!stop) setStatus({ configured: false, connected: false });
        return;
      }
      const res = await fetch("/api/goat-mail/inbox", { headers }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as MailStatus | null;
      if (stop) return;
      const next = json ?? { configured: false, connected: false };
      setStatus(next);
      setBuckets(resolveMailBuckets(next.buckets));
    })();
    return () => {
      stop = true;
    };
  }, [preview]);

  const saveFolders = async (folderIds: string[]) => {
    const headers = await authHeaders();
    if (!headers) return;
    const res = await fetch("/api/goat-mail/folders", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ folderIds }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string; selectedFolderIds?: string[] } | null;
    if (!res.ok) {
      setFolderNotice(json?.error || "Could not save the folders.");
      return;
    }
    setFolderNotice("Saved.");
    setStatus((current) => (current ? { ...current, selectedFolderIds: json?.selectedFolderIds ?? folderIds } : current));
  };

  const saveSecret = async (expiresOn: string) => {
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
  };

  const saveBuckets = async (next: MailBucket[] | null) => {
    if (preview) {
      setBuckets(resolveMailBuckets(next));
      setNotice(next ? "Saved." : "Reset to the built-in buckets.");
      return;
    }
    const headers = await authHeaders();
    if (!headers) return;
    const res = await fetch("/api/goat-mail/buckets", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(next ? { buckets: next } : { reset: true }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string; buckets?: MailBucket[] | null } | null;
    if (!res.ok) {
      setNotice(json?.error || "Could not save the buckets.");
      return;
    }
    setBuckets(resolveMailBuckets(json?.buckets));
    setNotice(next ? "Saved." : "Reset to the built-in buckets.");
  };

  const disconnect = async () => {
    const headers = await authHeaders();
    if (!headers) return;
    await fetch("/api/goat-mail/inbox", { method: "DELETE", headers });
    setStatus((current) => (current ? { ...current, connected: false, account: "" } : current));
  };

  const ready = Boolean(status?.configured && !status?.needsMigration);
  const updateBucket = (id: string, patch: Partial<MailBucket>) => {
    setBuckets((current) => current.map((bucket) => (bucket.id === id ? { ...bucket, ...patch } : bucket)));
  };

  return (
    <div className="space-y-4" data-goat-mail-settings>
      <div>
        <h4 className="text-base font-semibold">Mailbox</h4>
        {!status ? <p className="mt-1 text-sm text-[var(--text-muted)]">Opening GOAT Mail…</p> : null}
        {status && !ready ? <p className="mt-1 text-sm">{GOAT_MAIL_SETUP_LINE}</p> : null}
        {status && ready && !status.connected ? (
          <div className="mt-1">
            <p className="text-sm">{GOAT_MAIL_CONNECT_LINE}</p>
            <a
              className="mt-3 inline-flex rounded-2xl bg-[var(--brand-primary)] px-5 py-2.5 text-sm font-semibold text-white"
              href="/api/goat-mail/connect"
              onClick={(event) => {
                event.preventDefault();
                void (async () => {
                  const headers = await authHeaders();
                  if (!headers) return;
                  const res = await fetch("/api/goat-mail/connect", { headers }).catch(() => null);
                  const json = (await res?.json().catch(() => null)) as { url?: string } | null;
                  if (json?.url) window.location.assign(json.url);
                  else setNotice("Could not connect the mailbox. Try again.");
                })();
              }}
            >
              Connect Outlook
            </a>
          </div>
        ) : null}
        {status?.connected ? (
          <div className="mt-1 text-sm">
            <p>Connected as {status.account || "the office mailbox"}.</p>
            <button className="mt-2 font-semibold text-[var(--text-muted)] underline" onClick={() => void disconnect()} type="button">
              Disconnect
            </button>
          </div>
        ) : null}
        {status?.secretExpired ? <p className="mt-2 rounded-xl bg-[#fde8e8] px-3 py-2 text-sm text-[#9b1c1c]">{GOAT_MAIL_SECRET_EXPIRED}</p> : null}
      </div>
      {status?.connected && (status.folders?.length ?? 0) > 0 ? (
        <FolderPicker folders={status.folders ?? []} notice={folderNotice} onSave={(ids) => void saveFolders(ids)} selected={status.selectedFolderIds ?? []} />
      ) : null}
      <SecretDateField onSave={(iso) => void saveSecret(iso)} value={status?.secretExpiresOn ?? ""} />
      <div>
        <h4 className="text-base font-semibold">Mail buckets</h4>
        <p className="mt-1 text-xs text-[var(--text-muted)]">GOAT sorts each message into the first buckets whose keywords it finds. Other is the fallback.</p>
        <ul className="mt-3 space-y-3">
          {buckets.map((bucket) => (
            <li className="rounded-xl border border-[var(--line-soft)] p-3" key={bucket.id}>
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label="Bucket name" className="min-w-0 flex-1 rounded-lg border border-[var(--line-soft)] px-2 py-1 text-sm font-semibold" onChange={(event) => updateBucket(bucket.id, { name: event.target.value })} value={bucket.name} />
                <button className="text-xs font-semibold text-[var(--text-muted)] underline" onClick={() => setBuckets((current) => current.filter((item) => item.id !== bucket.id))} type="button">
                  Remove
                </button>
              </div>
              <label className="mt-2 block text-xs text-[var(--text-muted)]">
                Keywords, one per line
                <textarea
                  className="mt-1 w-full rounded-lg border border-[var(--line-soft)] px-2 py-1 text-sm text-[var(--text-main)]"
                  onChange={(event) => updateBucket(bucket.id, { keywords: event.target.value.split("\n") })}
                  rows={Math.min(8, Math.max(3, bucket.keywords.length + 1))}
                  value={bucket.keywords.join("\n")}
                />
              </label>
              {bucket.requireAction ? <p className="mt-1 text-xs text-[var(--text-muted)]">Also needs a request word such as please, send, need, sign, or attach.</p> : null}
              {bucket.requireReport ? <p className="mt-1 text-xs text-[var(--text-muted)]">Also needs a report word such as report, results, findings, impression, or attached.</p> : null}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="rounded-xl border border-[var(--line-soft)] px-3 py-1.5 text-sm font-semibold" onClick={() => setBuckets((current) => [...current, { id: newBucketId(), name: "New bucket", keywords: [] }])} type="button">
            Add bucket
          </button>
          <button className="rounded-xl bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-white" onClick={() => void saveBuckets(buckets)} type="button">
            Save buckets
          </button>
          <button
            className="rounded-xl border border-[var(--line-soft)] px-3 py-1.5 text-sm font-semibold"
            onClick={() => {
              void (async () => {
                if (!(await appConfirm("Reset mail buckets to the built-in list?"))) return;
                setBuckets(defaultMailBuckets());
                await saveBuckets(null);
              })();
            }}
            type="button"
          >
            Reset to defaults
          </button>
        </div>
        {notice ? <p className="mt-2 text-xs text-[var(--text-muted)]">{notice}</p> : null}
      </div>
    </div>
  );
}
