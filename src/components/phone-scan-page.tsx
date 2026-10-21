"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { buildScanPdf, moveItem } from "@/lib/scan-pdf";
import { PHONE_SCAN_BUCKET, PHONE_SCAN_MAX_PAGES } from "@/lib/phone-scan";
import { loadImage, makeEnhanced, makeThumb, scaleDown, toJpeg } from "@/lib/scan-canvas";

/**
 * The phone side of "Scan with my phone" (/s/<token>). No login and nothing
 * saved on the phone: pages live in memory until Send, then go straight to
 * the office's own Supabase storage through a one-time upload slot.
 */
interface Page {
  id: string;
  original: HTMLCanvasElement;
  enhanced: HTMLCanvasElement;
  thumb: string;
}

type View = "loading" | "ready" | "sending" | "sent" | "inactive";

export function PhoneScanPage({ token }: { token: string }) {
  const [view, setView] = useState<View>("loading");
  const [label, setLabel] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [enhance, setEnhance] = useState(false);
  const [retake, setRetake] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const api = `/api/phone-scan/public/${encodeURIComponent(token)}`;

  useEffect(() => {
    fetch(api, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.status === "ready") {
          setLabel(j.label || "");
          setView("ready");
        } else setView(r.ok && j.status === "sent" ? "sent" : "inactive");
      })
      .catch(() => setView("inactive"));
  }, [api]);

  useEffect(() => {
    setPages((cur) => cur.map((p) => ({ ...p, thumb: makeThumb(enhance ? p.enhanced : p.original) })));
  }, [enhance]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setMessage("");
    const added: Page[] = [];
    for (const f of Array.from(files)) {
      try {
        const original = scaleDown(await loadImage(f));
        const enhanced = makeEnhanced(original);
        added.push({ id: `${Date.now()}-${Math.random()}`, original, enhanced, thumb: makeThumb(enhance ? enhanced : original) });
      } catch {
        setMessage("Couldn't read that picture. Try again.");
      }
    }
    setPages((cur) => {
      if (retake !== null && added[0] && retake < cur.length) {
        const next = cur.slice();
        next[retake] = added[0];
        return next;
      }
      return [...cur, ...added].slice(0, PHONE_SCAN_MAX_PAGES);
    });
    setRetake(null);
  };

  const send = async () => {
    if (!pages.length) return;
    setView("sending");
    setMessage("");
    try {
      const out = [];
      for (const p of pages) {
        const c = enhance ? p.enhanced : p.original;
        out.push({ jpeg: await toJpeg(c), width: c.width, height: c.height });
      }
      const pdf = new Blob([buildScanPdf(out) as BlobPart], { type: "application/pdf" });
      const post = (body: unknown) =>
        fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const start = await post({ step: "start" });
      const slot = await start.json().catch(() => ({}));
      if (start.status === 404) return setView("inactive");
      if (!start.ok) throw new Error(slot.error);
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
      if (!url || !key) throw new Error("Not configured");
      const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const up = await sb.storage.from(PHONE_SCAN_BUCKET).uploadToSignedUrl(slot.path, slot.uploadToken, pdf, { contentType: "application/pdf" });
      if (up.error) throw up.error;
      const done = await post({ step: "done", pages: pages.length });
      if (done.status === 404) return setView("inactive");
      if (!done.ok) throw new Error("done");
      setPages([]);
      setView("sent");
    } catch {
      setMessage("Sending didn't work. Check your connection and tap Send again.");
      setView("ready");
    }
  };

  const shell = (child: React.ReactNode) => (
    <main className="mx-auto min-h-screen max-w-md bg-white px-4 py-6 text-[#0e293e]">{child}</main>
  );
  if (view === "loading") return shell(<p className="text-center font-semibold">Loading…</p>);
  if (view === "inactive")
    return shell(
      <div className="mt-16 text-center">
        <p className="text-lg font-semibold">This scan link is no longer active.</p>
        <p className="mt-2 text-sm opacity-75">Links work once, for 10 minutes. On the computer, click Scan → Scan with my phone for a new code.</p>
      </div>,
    );
  if (view === "sent")
    return shell(
      <div className="mt-16 text-center">
        <p className="text-2xl font-semibold text-green-700">✓ Sent to NoteGoat</p>
        <p className="mt-2 text-sm opacity-75">It&apos;s now in the patient&apos;s files on the computer. You can close this page.</p>
      </div>,
    );

  const small = "rounded-lg border border-[#d5dee8] bg-white px-2 py-1 text-xs font-semibold disabled:opacity-40";
  return shell(
    <>
      <h1 className="text-xl font-semibold">Scan to NoteGoat</h1>
      {label && <p className="mt-1 text-sm opacity-75">{label}</p>}
      <button
        className="mt-4 w-full rounded-2xl bg-[#1d6fa5] px-4 py-4 text-lg font-semibold text-white active:scale-[0.98]"
        disabled={view === "sending"}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {retake !== null ? `📷 Retake page ${retake + 1}` : pages.length ? "📷 Take next page" : "📷 Take a picture"}
      </button>
      {retake !== null && (
        <button className="mt-2 w-full text-sm font-semibold underline opacity-75" onClick={() => setRetake(null)} type="button">Cancel retake</button>
      )}
      <input
        accept="image/*"
        capture="environment"
        className="hidden"
        multiple={retake === null}
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = "";
        }}
        ref={inputRef}
        type="file"
      />
      <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
        <input checked={enhance} onChange={(e) => setEnhance(e.target.checked)} type="checkbox" />
        Black &amp; white document look
      </label>
      {pages.length > 0 && (
        <ol className="mt-4 grid grid-cols-2 gap-3">
          {pages.map((p, i) => (
            <li className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 ${retake === i ? "border-amber-400" : "border-[#d5dee8]"}`} key={p.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={`Page ${i + 1}`} className="h-32 w-auto rounded" src={p.thumb} />
              <span className="text-xs font-semibold">Page {i + 1}</span>
              <div className="flex flex-wrap justify-center gap-1">
                <button aria-label="Move earlier" className={small} disabled={i === 0} onClick={() => setPages((c) => moveItem(c, i, i - 1))} type="button">←</button>
                <button aria-label="Move later" className={small} disabled={i === pages.length - 1} onClick={() => setPages((c) => moveItem(c, i, i + 1))} type="button">→</button>
                <button className={small} onClick={() => { setRetake(i); inputRef.current?.click(); }} type="button">Retake</button>
                <button className={`${small} text-red-600`} onClick={() => { setPages((c) => c.filter((_, j) => j !== i)); setRetake(null); }} type="button">Delete</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {message && <p className="mt-3 text-sm font-semibold text-red-600">{message}</p>}
      <button
        className="mt-5 w-full rounded-2xl bg-green-700 px-4 py-4 text-lg font-semibold text-white active:scale-[0.98] disabled:opacity-40"
        disabled={!pages.length || view === "sending"}
        onClick={() => void send()}
        type="button"
      >
        {view === "sending" ? "Sending…" : pages.length > 1 ? `Send ${pages.length} pages to NoteGoat` : "Send to NoteGoat"}
      </button>
    </>,
  );
}
