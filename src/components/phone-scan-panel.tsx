"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { scanFileName } from "@/lib/scan-pdf";

/**
 * Desktop half of "Scan with my phone": makes a one-time link, shows it as a
 * QR code (drawn here in the browser, no outside service), and waits for the
 * phone's PDF. When it arrives it's handed to onReceived, which files it like
 * any other scan, then the server deletes its temporary copy.
 */
interface Props {
  patientId: string;
  folderId: string;
  label: string;
  /** What's in the File name box ("" = default name). */
  name: string;
  onReceived: (file: File) => void;
}

type State =
  | { kind: "making" }
  | { kind: "error"; text: string }
  | { kind: "waiting"; id: string; qr: string; url: string; expiresAt: number }
  | { kind: "receiving"; id: string }
  | { kind: "done"; pages: number }
  | { kind: "expired" };

async function headers(): Promise<Record<string, string> | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : null;
}

export function PhoneScanPanel({ patientId, folderId, label, name, onReceived }: Props) {
  const [state, setState] = useState<State>({ kind: "making" });
  const [now, setNow] = useState(() => Date.now());
  const idRef = useRef<string | null>(null);
  const nameRef = useRef(name);
  const onReceivedRef = useRef(onReceived);
  useEffect(() => {
    nameRef.current = name;
    onReceivedRef.current = onReceived;
  });

  const make = useCallback(async () => {
    setState({ kind: "making" });
    const h = await headers();
    if (!h) return setState({ kind: "error", text: "You're signed out. Sign in again, then reopen Scan." });
    try {
      const res = await fetch("/api/phone-scan", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ workspaceId: getActiveWorkspaceIdSync(), patientId, folderId, label }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setState({ kind: "error", text: json.error || "Couldn't make the phone link." });
      const qr = await QRCode.toDataURL(json.url, { margin: 1, width: 260, errorCorrectionLevel: "M" });
      idRef.current = json.id;
      setState({ kind: "waiting", id: json.id, qr, url: json.url, expiresAt: Date.parse(json.expiresAt) });
    } catch {
      setState({ kind: "error", text: "No connection. Try again." });
    }
  }, [patientId, folderId, label]);

  useEffect(() => {
    const t = window.setTimeout(() => void make(), 0);
    return () => window.clearTimeout(t);
  }, [make]);

  // Cancel an unused link when the panel closes (Close, switch tab, leave page).
  useEffect(
    () => () => {
      const id = idRef.current;
      if (!id) return;
      void headers().then((h) => {
        if (h) void fetch(`/api/phone-scan/${id}?workspaceId=${encodeURIComponent(getActiveWorkspaceIdSync())}`, { method: "DELETE", headers: h, keepalive: true });
      });
    },
    [],
  );

  // Poll every 2 s while waiting.
  useEffect(() => {
    if (state.kind !== "waiting") return;
    const id = state.id;
    let stop = false;
    const tick = async () => {
      setNow(Date.now());
      const h = await headers();
      if (!h || stop) return;
      const ws = encodeURIComponent(getActiveWorkspaceIdSync());
      const res = await fetch(`/api/phone-scan/${id}?workspaceId=${ws}`, { headers: h, cache: "no-store" }).catch(() => null);
      const json = res?.ok ? await res.json().catch(() => null) : null;
      if (stop || !json) return;
      if (json.status === "expired" || json.status === "revoked") {
        idRef.current = null;
        setState({ kind: "expired" });
      } else if (json.status === "uploaded" && json.fileUrl) {
        stop = true;
        setState({ kind: "receiving", id });
        try {
          const blob = await (await fetch(json.fileUrl, { cache: "no-store" })).blob();
          onReceivedRef.current(new File([blob], scanFileName(nameRef.current), { type: "application/pdf" }));
          await fetch(`/api/phone-scan/${id}`, { method: "POST", headers: h, body: JSON.stringify({ workspaceId: getActiveWorkspaceIdSync(), action: "saved" }) });
          idRef.current = null;
          setState({ kind: "done", pages: Number(json.pages) || 1 });
        } catch {
          setState({ kind: "error", text: "The scan arrived but couldn't be downloaded. Try again." });
        }
      }
    };
    const t = window.setInterval(() => void tick(), 2000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [state]);

  const box = "mt-3 flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--line-soft)] bg-[#f6f9fc] px-6 py-6 text-center";
  const again = (
    <button className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white" onClick={() => void make()} type="button">
      Scan more with my phone
    </button>
  );

  if (state.kind === "making") return <div className={box}><p className="font-semibold">Making your phone link…</p></div>;
  if (state.kind === "error")
    return (
      <div className={box}>
        <p className="font-semibold text-red-600">{state.text}</p>
        <button className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold" onClick={() => void make()} type="button">Try again</button>
      </div>
    );
  if (state.kind === "expired")
    return (
      <div className={box}>
        <p className="font-semibold">That QR code timed out.</p>
        <button className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white" onClick={() => void make()} type="button">Show a new code</button>
      </div>
    );
  if (state.kind === "receiving") return <div className={box}><p className="font-semibold">Receiving from phone…</p></div>;
  if (state.kind === "done")
    return (
      <div className={box} data-testid="phone-scan-done">
        <p className="text-lg font-semibold text-green-700">✓ Received from phone</p>
        <p className="text-sm text-[var(--text-muted)]">
          {state.pages} page{state.pages === 1 ? "" : "s"} saved as a PDF in Patient Files.
        </p>
        {again}
      </div>
    );

  const left = Math.max(0, state.expiresAt - now);
  const mm = Math.floor(left / 60000);
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  return (
    <div className={box} data-testid="phone-scan-qr">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="QR code for your phone" className="h-[220px] w-[220px] rounded-lg bg-white p-2" src={state.qr} />
      <ol className="max-w-sm space-y-1 text-left text-sm">
        <li>1. Open the Camera app on your iPhone and point it at this code.</li>
        <li>2. Tap the link, then take a picture of each page.</li>
        <li>3. Tap <strong>Send to NoteGoat</strong>. It will show up here and in Patient Files.</li>
      </ol>
      <p className="text-xs text-[var(--text-muted)]">
        Waiting for your phone… This code works once and expires in {mm}:{ss}. No login or app needed.
      </p>
    </div>
  );
}
