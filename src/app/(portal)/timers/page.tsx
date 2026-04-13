"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScheduleRooms } from "@/hooks/use-schedule-rooms";

/* ─── Types ─── */

type ActiveTimer = {
  id: string;
  roomId: string;
  roomName: string;
  roomColor: string;
  label: string;
  totalSeconds: number;
  remaining: number;
  running: boolean;
  finished: boolean;
};

/* ─── Helpers ─── */

function formatTime(totalSecs: number): string {
  const mins = Math.floor(Math.abs(totalSecs) / 60);
  const secs = Math.abs(totalSecs) % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function createTimerId() {
  return `tmr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Play a pleasant chime using the Web Audio API.
 * Falls back silently if AudioContext is unavailable.
 */
function playChime() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
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

    // Cleanup after playback
    setTimeout(() => ctx.close(), 2000);
  } catch {
    // AudioContext not supported — fail silently
  }
}

/* ─── Component ─── */

export default function TimersPage() {
  const { scheduleRooms } = useScheduleRooms();
  const activeRooms = useMemo(
    () => scheduleRooms.rooms.filter((r) => r.active),
    [scheduleRooms.rooms],
  );

  const [timers, setTimers] = useState<ActiveTimer[]>([]);
  const [finishedBanner, setFinishedBanner] = useState<ActiveTimer | null>(null);
  const [customMinutes, setCustomMinutes] = useState<Record<string, string>>({});

  const intervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const finishedIdsRef = useRef<Set<string>>(new Set());

  // ── Tick logic ──
  const tick = useCallback((timerId: string) => {
    setTimers((prev) =>
      prev.map((t) => {
        if (t.id !== timerId || !t.running || t.finished) return t;
        const next = t.remaining - 1;
        if (next <= 0) {
          return { ...t, remaining: 0, running: false, finished: true };
        }
        return { ...t, remaining: next };
      }),
    );
  }, []);

  // ── Detect finished timers and show banner + play sound ──
  useEffect(() => {
    const justFinished = timers.find(
      (t) => t.finished && !finishedIdsRef.current.has(t.id),
    );
    if (justFinished) {
      finishedIdsRef.current.add(justFinished.id);
      setFinishedBanner(justFinished);
      playChime();
      // Clear the interval
      const interval = intervalsRef.current.get(justFinished.id);
      if (interval) {
        clearInterval(interval);
        intervalsRef.current.delete(justFinished.id);
      }
    }
  }, [timers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      intervalsRef.current.forEach((interval) => clearInterval(interval));
    };
  }, []);

  const startTimer = useCallback(
    (roomId: string, roomName: string, roomColor: string, seconds: number, label: string) => {
      const id = createTimerId();
      const timer: ActiveTimer = {
        id,
        roomId,
        roomName,
        roomColor,
        label,
        totalSeconds: seconds,
        remaining: seconds,
        running: true,
        finished: false,
      };
      setTimers((prev) => [...prev, timer]);
      const interval = setInterval(() => tick(id), 1000);
      intervalsRef.current.set(id, interval);
    },
    [tick],
  );

  const pauseTimer = useCallback((timerId: string) => {
    setTimers((prev) =>
      prev.map((t) => (t.id === timerId ? { ...t, running: false } : t)),
    );
    const interval = intervalsRef.current.get(timerId);
    if (interval) {
      clearInterval(interval);
      intervalsRef.current.delete(timerId);
    }
  }, []);

  const resumeTimer = useCallback(
    (timerId: string) => {
      setTimers((prev) =>
        prev.map((t) => (t.id === timerId ? { ...t, running: true } : t)),
      );
      const interval = setInterval(() => tick(timerId), 1000);
      intervalsRef.current.set(timerId, interval);
    },
    [tick],
  );

  const resetTimer = useCallback((timerId: string) => {
    const interval = intervalsRef.current.get(timerId);
    if (interval) {
      clearInterval(interval);
      intervalsRef.current.delete(timerId);
    }
    setTimers((prev) =>
      prev.map((t) =>
        t.id === timerId
          ? { ...t, remaining: t.totalSeconds, running: false, finished: false }
          : t,
      ),
    );
    finishedIdsRef.current.delete(timerId);
  }, []);

  const removeTimer = useCallback((timerId: string) => {
    const interval = intervalsRef.current.get(timerId);
    if (interval) {
      clearInterval(interval);
      intervalsRef.current.delete(timerId);
    }
    setTimers((prev) => prev.filter((t) => t.id !== timerId));
    finishedIdsRef.current.delete(timerId);
  }, []);

  const handleCustomStart = useCallback(
    (roomId: string, roomName: string, roomColor: string) => {
      const raw = customMinutes[roomId] ?? "";
      const mins = parseFloat(raw);
      if (!mins || mins <= 0 || mins > 999) return;
      const secs = Math.round(mins * 60);
      startTimer(roomId, roomName, roomColor, secs, `${raw} min`);
      setCustomMinutes((prev) => ({ ...prev, [roomId]: "" }));
    },
    [customMinutes, startTimer],
  );

  // Group active timers by room
  const timersByRoom = useMemo(() => {
    const map = new Map<string, ActiveTimer[]>();
    for (const t of timers) {
      const arr = map.get(t.roomId) ?? [];
      arr.push(t);
      map.set(t.roomId, arr);
    }
    return map;
  }, [timers]);

  // Progress percentage
  const getProgress = (t: ActiveTimer) =>
    t.totalSeconds > 0 ? ((t.totalSeconds - t.remaining) / t.totalSeconds) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* ── Finished Banner ── */}
      {finishedBanner && (
        <div
          className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-3 px-4 py-4 text-white shadow-xl animate-pulse"
          style={{ backgroundColor: finishedBanner.roomColor || "#0d79bf" }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-6 w-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
          </svg>
          <span className="text-lg font-bold">
            {finishedBanner.roomName} — {finishedBanner.label} timer is done!
          </span>
          <button
            className="ml-4 rounded-lg bg-white/20 px-3 py-1 text-sm font-semibold backdrop-blur hover:bg-white/30 active:scale-95"
            onClick={() => setFinishedBanner(null)}
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Header ── */}
      <section className="panel-card p-4">
        <h2 className="text-2xl font-semibold">Room Timers</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Set countdown timers for each treatment room. A chime will sound when time is up.
        </p>
      </section>

      {/* ── No Rooms ── */}
      {activeRooms.length === 0 && (
        <section className="panel-card p-6 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            No rooms configured. Go to{" "}
            <a href="/settings" className="font-semibold text-[var(--brand-primary)] underline">
              Settings
            </a>{" "}
            to set up your rooms first.
          </p>
        </section>
      )}

      {/* ── Room Cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {activeRooms.map((room) => {
          const roomTimers = timersByRoom.get(room.id) ?? [];
          return (
            <section
              key={room.id}
              className="panel-card overflow-hidden"
            >
              {/* Room header */}
              <div
                className="flex items-center gap-2 px-4 py-3 text-white"
                style={{ backgroundColor: room.color || "#0d79bf" }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                <h3 className="text-lg font-bold">{room.name}</h3>
                {roomTimers.filter((t) => t.running).length > 0 && (
                  <span className="ml-auto rounded-full bg-white/25 px-2 py-0.5 text-xs font-semibold">
                    {roomTimers.filter((t) => t.running).length} active
                  </span>
                )}
              </div>

              <div className="space-y-3 p-4">
                {/* Custom timer */}
                <div className="flex gap-1.5">
                  <input
                    className="w-24 rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                    inputMode="decimal"
                    onChange={(e) =>
                      setCustomMinutes((prev) => ({ ...prev, [room.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCustomStart(room.id, room.name, room.color);
                    }}
                    placeholder="Minutes"
                    value={customMinutes[room.id] ?? ""}
                  />
                  <button
                    className="rounded-lg border border-[var(--brand-primary)] bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-semibold text-white transition-all hover:brightness-110 active:scale-95"
                    onClick={() => handleCustomStart(room.id, room.name, room.color)}
                    type="button"
                  >
                    Start
                  </button>
                </div>

                {/* Active timers */}
                {roomTimers.length > 0 && (
                  <div className="space-y-2 border-t border-[var(--line-soft)] pt-3">
                    {roomTimers.map((timer) => (
                      <div
                        key={timer.id}
                        className={`rounded-xl border p-3 ${
                          timer.finished
                            ? "border-green-300 bg-green-50"
                            : "border-[var(--line-soft)] bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-[var(--text-muted)]">
                            {timer.label}
                          </span>
                          <span
                            className={`font-mono text-2xl font-bold tabular-nums ${
                              timer.finished
                                ? "text-green-600"
                                : timer.remaining <= 60
                                  ? "text-red-500"
                                  : "text-[var(--text-main)]"
                            }`}
                          >
                            {formatTime(timer.remaining)}
                          </span>
                        </div>

                        {/* Progress bar */}
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
                          <div
                            className="h-full rounded-full transition-all duration-1000"
                            style={{
                              width: `${getProgress(timer)}%`,
                              backgroundColor: timer.finished
                                ? "#16a34a"
                                : timer.remaining <= 60
                                  ? "#ef4444"
                                  : room.color || "#0d79bf",
                            }}
                          />
                        </div>

                        {/* Controls */}
                        <div className="mt-2 flex gap-1.5">
                          {!timer.finished && timer.running && (
                            <button
                              className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 active:scale-95"
                              onClick={() => pauseTimer(timer.id)}
                              type="button"
                            >
                              Pause
                            </button>
                          )}
                          {!timer.finished && !timer.running && (
                            <button
                              className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 active:scale-95"
                              onClick={() => resumeTimer(timer.id)}
                              type="button"
                            >
                              Resume
                            </button>
                          )}
                          <button
                            className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold active:scale-95"
                            onClick={() => resetTimer(timer.id)}
                            type="button"
                          >
                            Reset
                          </button>
                          <button
                            className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 active:scale-95"
                            onClick={() => removeTimer(timer.id)}
                            type="button"
                          >
                            Remove
                          </button>
                          {timer.finished && (
                            <span className="ml-auto flex items-center gap-1 text-xs font-bold text-green-600">
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                              </svg>
                              Done
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
