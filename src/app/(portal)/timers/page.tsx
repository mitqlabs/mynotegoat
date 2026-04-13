"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScheduleRooms } from "@/hooks/use-schedule-rooms";
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

type RoomPreset = { id: string; minutes: number };

type SoundRepeat = "1" | "3" | "5" | "until-off";

/* ─── Constants ─── */

const TABLE = "room_timers";
const ROOM_PRESETS_KEY = "casemate.room-timer-presets.v1";
const SOUND_REPEAT_KEY = "casemate.timer-sound-repeat.v1";
const POLL_MS = 2000;

/* ─── Helpers ─── */

function formatTime(totalSecs: number): string {
  const s = Math.max(0, Math.round(totalSecs));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function createId(prefix = "tmr") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

/* ── Per-room presets ── */

type RoomPresetsMap = Record<string, RoomPreset[]>;

function loadRoomPresets(): RoomPresetsMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ROOM_PRESETS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as RoomPresetsMap;
  } catch {
    return {};
  }
}

function saveRoomPresets(map: RoomPresetsMap) {
  try {
    window.localStorage.setItem(ROOM_PRESETS_KEY, JSON.stringify(map));
  } catch {}
}

/* ─── Audio ─── */

function playChimeOnce(): number {
  const DUR = 800;
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return DUR;
    const ctx = new AudioCtx();
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
    setTimeout(() => ctx.close(), 2000);
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

/* ─── Component ─── */

export default function TimersPage() {
  const { scheduleRooms } = useScheduleRooms();
  const activeRooms = useMemo(
    () => scheduleRooms.rooms.filter((r) => r.active),
    [scheduleRooms.rooms],
  );

  const [timers, setTimers] = useState<CloudTimer[]>([]);
  const [finishedBanner, setFinishedBanner] = useState<CloudTimer | null>(null);
  const [customMinutes, setCustomMinutes] = useState<Record<string, string>>({});
  const [soundRepeat, setSoundRepeat] = useState<SoundRepeat>(loadSoundRepeat);
  const [roomPresets, setRoomPresets] = useState<RoomPresetsMap>(loadRoomPresets);
  const [addingPresetRoom, setAddingPresetRoom] = useState<string | null>(null);
  const [newPresetMinutes, setNewPresetMinutes] = useState("");

  const finishedIdsRef = useRef<Set<string>>(new Set());
  const stopChimeRef = useRef<(() => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Poll cloud for timer state ──
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

  // ── Detect newly finished timers ──
  useEffect(() => {
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
  }, [timers, soundRepeat]);

  useEffect(() => {
    return () => {
      stopChimeRef.current?.();
    };
  }, []);

  // ── Timer actions ──
  const startTimer = useCallback(
    async (roomId: string, roomName: string, roomColor: string, seconds: number, label: string) => {
      const timer: CloudTimer = {
        id: createId(),
        room_id: roomId,
        room_name: roomName,
        room_color: roomColor,
        label,
        total_seconds: seconds,
        ends_at: new Date(Date.now() + seconds * 1000).toISOString(),
        paused_remaining: 0,
        finished: false,
        dismissed: false,
      };
      setTimers((prev) => [...prev, timer]);
      await upsertTimer(timer);
    },
    [],
  );

  const pauseTimer = useCallback(async (timer: CloudTimer) => {
    const rem = Math.max(0, Math.round(remainingSeconds(timer)));
    const updated = { ...timer, paused_remaining: rem };
    setTimers((prev) => prev.map((t) => (t.id === timer.id ? updated : t)));
    await upsertTimer(updated);
  }, []);

  const resumeTimer = useCallback(async (timer: CloudTimer) => {
    const updated = {
      ...timer,
      ends_at: new Date(Date.now() + timer.paused_remaining * 1000).toISOString(),
      paused_remaining: 0,
    };
    setTimers((prev) => prev.map((t) => (t.id === timer.id ? updated : t)));
    await upsertTimer(updated);
  }, []);

  const resetTimerAction = useCallback(async (timer: CloudTimer) => {
    const updated = {
      ...timer,
      ends_at: new Date(Date.now() + timer.total_seconds * 1000).toISOString(),
      paused_remaining: 0,
      finished: false,
    };
    finishedIdsRef.current.delete(timer.id);
    setTimers((prev) => prev.map((t) => (t.id === timer.id ? updated : t)));
    await upsertTimer(updated);
  }, []);

  const dismissTimer = useCallback(async (timerId: string) => {
    finishedIdsRef.current.delete(timerId);
    setTimers((prev) => prev.filter((t) => t.id !== timerId));
    await deleteTimer(timerId);
  }, []);

  const dismissBanner = useCallback(() => {
    if (finishedBanner) {
      void dismissTimer(finishedBanner.id);
    }
    setFinishedBanner(null);
    stopChimeRef.current?.();
    stopChimeRef.current = null;
  }, [finishedBanner, dismissTimer]);

  const handleCustomStart = useCallback(
    (roomId: string, roomName: string, roomColor: string) => {
      const raw = customMinutes[roomId] ?? "";
      const mins = parseFloat(raw);
      if (!mins || mins <= 0 || mins > 999) return;
      const secs = Math.round(mins * 60);
      void startTimer(roomId, roomName, roomColor, secs, `${raw} min`);
      setCustomMinutes((prev) => ({ ...prev, [roomId]: "" }));
    },
    [customMinutes, startTimer],
  );

  // ── Per-room preset management ──
  const addPresetToRoom = useCallback(
    (roomId: string) => {
      const mins = parseFloat(newPresetMinutes);
      if (!mins || mins <= 0) return;
      const current = roomPresets[roomId] ?? [];
      // Don't add duplicate minutes
      if (current.some((p) => p.minutes === mins)) {
        setNewPresetMinutes("");
        setAddingPresetRoom(null);
        return;
      }
      const next: RoomPresetsMap = {
        ...roomPresets,
        [roomId]: [...current, { id: createId("rp"), minutes: mins }],
      };
      setRoomPresets(next);
      saveRoomPresets(next);
      setNewPresetMinutes("");
      setAddingPresetRoom(null);
    },
    [newPresetMinutes, roomPresets],
  );

  const removePresetFromRoom = useCallback(
    (roomId: string, presetId: string) => {
      const current = roomPresets[roomId] ?? [];
      const filtered = current.filter((p) => p.id !== presetId);
      const next: RoomPresetsMap = { ...roomPresets };
      if (filtered.length === 0) delete next[roomId];
      else next[roomId] = filtered;
      setRoomPresets(next);
      saveRoomPresets(next);
    },
    [roomPresets],
  );

  // Group timers by room
  const timersByRoom = useMemo(() => {
    const map = new Map<string, CloudTimer[]>();
    for (const t of timers) {
      const arr = map.get(t.room_id) ?? [];
      arr.push(t);
      map.set(t.room_id, arr);
    }
    return map;
  }, [timers]);

  // Force re-render every second for countdown display
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const getProgress = (t: CloudTimer) => {
    const rem = remainingSeconds(t);
    return t.total_seconds > 0 ? ((t.total_seconds - rem) / t.total_seconds) * 100 : 0;
  };

  return (
    <div className="space-y-4">
      {/* ── Finished Banner ── */}
      {finishedBanner && (
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
      )}

      {/* ── Header ── */}
      <section className="panel-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Room Timers</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Timers sync across all your devices. Set on desktop, dismiss on tablet.
            </p>
          </div>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-[var(--text-muted)]">Sound Repeat</span>
            <select
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
              value={soundRepeat}
              onChange={(e) => {
                const v = e.target.value as SoundRepeat;
                setSoundRepeat(v);
                try { window.localStorage.setItem(SOUND_REPEAT_KEY, v); } catch {}
              }}
            >
              <option value="1">1 time</option>
              <option value="3">3 times</option>
              <option value="5">5 times</option>
              <option value="until-off">Until dismissed</option>
            </select>
          </label>
        </div>
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
          const myPresets = roomPresets[room.id] ?? [];
          const isAddingPreset = addingPresetRoom === room.id;

          return (
            <section key={room.id} className="panel-card overflow-hidden">
              {/* Room header */}
              <div
                className="flex items-center gap-2 px-4 py-3 text-white"
                style={{ backgroundColor: room.color || "#0d79bf" }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                <h3 className="text-lg font-bold">{room.name}</h3>
                {roomTimers.filter((t) => !t.finished && t.paused_remaining === 0).length > 0 && (
                  <span className="ml-auto rounded-full bg-white/25 px-2 py-0.5 text-xs font-semibold">
                    {roomTimers.filter((t) => !t.finished && t.paused_remaining === 0).length} active
                  </span>
                )}
              </div>

              <div className="space-y-3 p-4">
                {/* Room presets + add button */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {myPresets.map((preset) => (
                    <span key={preset.id} className="group relative inline-flex">
                      <button
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-xs font-semibold transition-all hover:bg-[var(--bg-soft)] active:scale-95"
                        onClick={() =>
                          void startTimer(
                            room.id,
                            room.name,
                            room.color,
                            Math.round(preset.minutes * 60),
                            `${preset.minutes} min`,
                          )
                        }
                        type="button"
                      >
                        {preset.minutes} min
                      </button>
                      <button
                        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-400 text-[10px] leading-none text-white opacity-0 shadow transition-opacity group-hover:opacity-100"
                        onClick={() => removePresetFromRoom(room.id, preset.id)}
                        title="Remove preset"
                        type="button"
                      >
                        ×
                      </button>
                    </span>
                  ))}

                  {/* Add preset inline */}
                  {isAddingPreset ? (
                    <span className="inline-flex items-center gap-1">
                      <input
                        autoFocus
                        className="w-16 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-xs"
                        inputMode="decimal"
                        onChange={(e) => setNewPresetMinutes(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addPresetToRoom(room.id);
                          if (e.key === "Escape") {
                            setAddingPresetRoom(null);
                            setNewPresetMinutes("");
                          }
                        }}
                        placeholder="Min"
                        value={newPresetMinutes}
                      />
                      <button
                        className="rounded-lg bg-[var(--brand-primary)] px-2 py-1.5 text-xs font-semibold text-white active:scale-95"
                        onClick={() => addPresetToRoom(room.id)}
                        type="button"
                      >
                        Add
                      </button>
                      <button
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-xs font-semibold text-[var(--text-muted)] active:scale-95"
                        onClick={() => {
                          setAddingPresetRoom(null);
                          setNewPresetMinutes("");
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      className="rounded-lg border border-dashed border-[var(--line-soft)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--text-muted)] transition-all hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] active:scale-95"
                      onClick={() => {
                        setAddingPresetRoom(room.id);
                        setNewPresetMinutes("");
                      }}
                      type="button"
                    >
                      + Preset
                    </button>
                  )}
                </div>

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
                    {roomTimers.map((timer) => {
                      const rem = remainingSeconds(timer);
                      const isPaused = timer.paused_remaining > 0;
                      const isRunning = !timer.finished && !isPaused;
                      const isDone = timer.finished || (rem <= 0 && !isPaused);
                      return (
                        <div
                          key={timer.id}
                          className={`rounded-xl border p-3 ${
                            isDone
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
                                isDone
                                  ? "text-green-600"
                                  : rem <= 60
                                    ? "text-red-500"
                                    : "text-[var(--text-main)]"
                              }`}
                            >
                              {formatTime(rem)}
                            </span>
                          </div>

                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
                            <div
                              className="h-full rounded-full transition-all duration-1000"
                              style={{
                                width: `${getProgress(timer)}%`,
                                backgroundColor: isDone
                                  ? "#16a34a"
                                  : rem <= 60
                                    ? "#ef4444"
                                    : room.color || "#0d79bf",
                              }}
                            />
                          </div>

                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {isRunning && !isDone && (
                              <button
                                className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 active:scale-95"
                                onClick={() => void pauseTimer(timer)}
                                type="button"
                              >
                                Pause
                              </button>
                            )}
                            {isPaused && !isDone && (
                              <button
                                className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 active:scale-95"
                                onClick={() => void resumeTimer(timer)}
                                type="button"
                              >
                                Resume
                              </button>
                            )}
                            <button
                              className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold active:scale-95"
                              onClick={() => void resetTimerAction(timer)}
                              type="button"
                            >
                              Reset
                            </button>
                            <button
                              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 active:scale-95"
                              onClick={() => void dismissTimer(timer.id)}
                              type="button"
                            >
                              Remove
                            </button>
                            {isDone && (
                              <span className="ml-auto flex items-center gap-1 text-xs font-bold text-green-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                </svg>
                                Done
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
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
