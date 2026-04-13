"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

/* ─── Types ─── */

type CloudTimer = {
  id: string;
  room_id: string;
  room_name: string;
  room_color: string;
  label: string;
  total_seconds: number;
  ends_at: string;
  paused_remaining: number;
  finished: boolean;
  dismissed: boolean;
};

type SoundRepeat = "1" | "3" | "5" | "until-off";

/* ─── Constants ─── */

const TABLE = "room_timers";
const SOUND_REPEAT_KEY = "casemate.timer-sound-repeat.v1";
const POLL_MS = 2000;

/* ─── Audio ─── */

let sharedAudioCtx: AudioContext | null = null;

function getOrCreateAudioCtx(): AudioContext | null {
  if (sharedAudioCtx && sharedAudioCtx.state !== "closed") {
    if (sharedAudioCtx.state === "suspended") {
      void sharedAudioCtx.resume();
    }
    return sharedAudioCtx;
  }
  try {
    const AudioCtxClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxClass) return null;
    sharedAudioCtx = new AudioCtxClass();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

function warmUpAudio() {
  const ctx = getOrCreateAudioCtx();
  if (ctx && ctx.state === "suspended") {
    void ctx.resume();
  }
  window.removeEventListener("click", warmUpAudio);
  window.removeEventListener("touchstart", warmUpAudio);
}

if (typeof window !== "undefined") {
  window.addEventListener("click", warmUpAudio, { once: true });
  window.addEventListener("touchstart", warmUpAudio, { once: true });
}

function playChimeOnce(): number {
  const DUR = 800;
  try {
    const ctx = getOrCreateAudioCtx();
    if (!ctx) return DUR;
    if (ctx.state === "suspended") void ctx.resume();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.15);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.15 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.6);
    });
  } catch {}
  return DUR;
}

function playChimeRepeated(count: number | "forever"): () => void {
  let stopped = false;
  let played = 0;
  const gap = 1200;
  const next = () => {
    if (stopped) return;
    if (count !== "forever" && played >= count) return;
    played++;
    const dur = playChimeOnce();
    setTimeout(next, dur + gap);
  };
  next();
  return () => {
    stopped = true;
  };
}

/* ─── Supabase helpers ─── */

async function getWorkspaceId(): Promise<string | null> {
  try {
    const sb = getSupabaseBrowserClient();
    if (!sb) return null;
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return null;
    const officeId =
      (typeof process !== "undefined" &&
        (process.env.NEXT_PUBLIC_CASEMATE_OFFICE_ID?.trim() ||
          process.env.NEXT_PUBLIC_CASEMATE_WORKSPACE_ID?.trim())) ||
      "main-office";
    return `${user.id}:${officeId}`;
  } catch {
    return null;
  }
}

async function fetchTimers(): Promise<CloudTimer[]> {
  const wsId = await getWorkspaceId();
  if (!wsId) return [];
  const sb = getSupabaseBrowserClient();
  if (!sb) return [];
  const { data } = await sb
    .from(TABLE)
    .select("*")
    .eq("workspace_id", wsId)
    .eq("dismissed", false)
    .order("created_at", { ascending: true });
  return (data as CloudTimer[] | null) ?? [];
}

async function upsertTimer(timer: CloudTimer): Promise<void> {
  const wsId = await getWorkspaceId();
  if (!wsId) return;
  const sb = getSupabaseBrowserClient();
  if (!sb) return;
  await sb.from(TABLE).upsert({ ...timer, workspace_id: wsId }, { onConflict: "id" });
}

async function deleteTimer(id: string): Promise<void> {
  const wsId = await getWorkspaceId();
  if (!wsId) return;
  const sb = getSupabaseBrowserClient();
  if (!sb) return;
  await sb.from(TABLE).delete().eq("workspace_id", wsId).eq("id", id);
}

function remainingSeconds(t: CloudTimer): number {
  if (t.finished) return 0;
  if (t.paused_remaining > 0) return t.paused_remaining;
  const diff = (new Date(t.ends_at).getTime() - Date.now()) / 1000;
  return Math.max(0, diff);
}

function loadSoundRepeat(): SoundRepeat {
  if (typeof window === "undefined") return "3";
  const v = window.localStorage.getItem(SOUND_REPEAT_KEY);
  if (v === "1" || v === "3" || v === "5" || v === "until-off") return v;
  return "3";
}

/* ─── Component ─── */

export function GlobalTimerAlerts() {
  const [timers, setTimers] = useState<CloudTimer[]>([]);
  const [finishedBanner, setFinishedBanner] = useState<CloudTimer | null>(null);
  const finishedIdsRef = useRef<Set<string>>(new Set());
  const stopChimeRef = useRef<(() => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for timers
  const refreshTimers = useCallback(async () => {
    try {
      const cloud = await fetchTimers();
      setTimers(cloud);
    } catch {}
  }, []);

  useEffect(() => {
    void refreshTimers();
    pollRef.current = setInterval(refreshTimers, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshTimers]);

  // Detect finished timers → show banner + play sound
  useEffect(() => {
    const soundRepeat = loadSoundRepeat();
    for (const t of timers) {
      const rem = remainingSeconds(t);
      if (rem <= 0 && !t.finished && t.paused_remaining === 0) {
        void upsertTimer({ ...t, finished: true });
      }
      if ((t.finished || rem <= 0) && !finishedIdsRef.current.has(t.id)) {
        finishedIdsRef.current.add(t.id);
        setFinishedBanner(t);
        stopChimeRef.current?.();
        const count = soundRepeat === "until-off" ? "forever" : Number(soundRepeat);
        stopChimeRef.current = playChimeRepeated(count);
      }
    }
  }, [timers]);

  // Cleanup
  useEffect(() => {
    return () => {
      stopChimeRef.current?.();
    };
  }, []);

  const dismissBanner = useCallback(() => {
    if (finishedBanner) {
      finishedIdsRef.current.delete(finishedBanner.id);
      void deleteTimer(finishedBanner.id);
    }
    setFinishedBanner(null);
    stopChimeRef.current?.();
    stopChimeRef.current = null;
  }, [finishedBanner]);

  if (!finishedBanner) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-3 px-4 py-4 text-white shadow-xl animate-pulse"
      style={{ backgroundColor: finishedBanner.room_color || "#0d79bf" }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
      </svg>
      <span className="text-lg font-bold">
        {finishedBanner.room_name} — {finishedBanner.label} timer is done!
      </span>
      <button
        className="ml-4 rounded-lg bg-white/20 px-3 py-1 text-sm font-semibold backdrop-blur hover:bg-white/30 active:scale-95"
        onClick={dismissBanner}
        type="button"
      >
        Dismiss
      </button>
    </div>
  );
}
