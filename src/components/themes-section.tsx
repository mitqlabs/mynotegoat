"use client";

import { useEffect, useState } from "react";
import {
  THEMES,
  brandFrom,
  checkMyTheme,
  lookOf,
  mineColors,
  modeOf,
  normalizeHex,
  sameTheme,
  withMode,
  BRAND_KEY,
  type BrandSettings,
  type Mode,
  type MyTheme,
  type ThemeId,
} from "@/lib/brand";
import { saveOfficeTheme, savePersonalMode, type SaveResult } from "@/lib/brand-save";
import { notifyChange, onLocalChange } from "@/lib/local-sync";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { isAdminTier } from "@/lib/admin-access";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

/**
 * Settings → Themes.
 *
 * Light or Dark belongs to the signed-in person and follows their login.
 * Which theme the office wears belongs to the office. Only an owner or
 * admin can change it (the same role check as other office-wide settings).
 * "Saved" appears only after the workspace settings row is read back.
 */

type Status =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "failed"; reason: string };

const COLOR_LABELS: { key: keyof MyTheme; label: string; help: string }[] = [
  { key: "accent", label: "Accent", help: "Buttons and highlights" },
  { key: "background", label: "Background", help: "The page behind the cards" },
  { key: "surface", label: "Surface", help: "Cards and panels" },
  { key: "text", label: "Text", help: "Words and numbers" },
];

function readCachedBrand(): BrandSettings {
  if (typeof window === "undefined") return brandFrom(null);
  try {
    return brandFrom(JSON.parse(window.localStorage.getItem(BRAND_KEY) || "null"));
  } catch {
    return brandFrom(null);
  }
}

function SaveNote({ status, onRetry }: { status: Status; onRetry: () => void }) {
  if (status.state === "idle") return null;
  return (
    <span role="status" className="flex flex-wrap items-center gap-2 text-sm">
      {status.state === "saving" && <span className="text-[var(--text-muted)]">Saving…</span>}
      {status.state === "saved" && <span className="font-semibold text-emerald-700">Saved</span>}
      {status.state === "failed" && (
        <>
          <span className="text-red-700">Not Saved. {status.reason}</span>
          <button className="btn btn-secondary btn-sm" onClick={onRetry} type="button">
            Retry
          </button>
        </>
      )}
    </span>
  );
}

/** A small NoteGoat, drawn by the real theme rules. */
export function ThemePreview({
  brand,
  mode,
  compact = false,
}: {
  brand: BrandSettings;
  mode: Mode;
  compact?: boolean;
}) {
  const look = lookOf(brand, mode);
  return (
    <div
      data-brand={look.id}
      data-tone={look.dark ? "dark" : "light"}
      style={look.vars as React.CSSProperties}
      aria-hidden="true"
      className={`overflow-hidden rounded-xl border border-[var(--line-soft)] bg-[var(--shell-bg)] text-[var(--text-main)] ${compact ? "h-24" : "h-52"}`}
    >
      <div className={`grid h-full ${compact ? "grid-cols-[64px_1fr]" : "grid-cols-[88px_1fr]"}`}>
        <div className="flex flex-col gap-1.5 bg-[var(--bg-sidebar)] p-2 text-[var(--sidebar-text)]">
          <span className="text-[10px] font-semibold leading-none">NoteGoat</span>
          <span className="nav-active h-4 rounded-md" />
          <span className="h-1.5 w-3/4 rounded-full bg-[var(--sidebar-muted)]" />
          <span className="h-1.5 w-2/3 rounded-full bg-[var(--sidebar-muted)]" />
        </div>
        <div className="flex min-w-0 flex-col gap-2 p-2.5">
          <span className="text-[13px] font-semibold leading-none">Patients</span>
          <div
            className="rounded-lg px-2 py-1.5 text-[10px] font-semibold"
            style={{
              backgroundImage: "linear-gradient(to bottom right, var(--goat-from), var(--goat-via), var(--goat-to))",
              color: "var(--goat-text)",
            }}
          >
            G.O.A.T. Page
          </div>
          {!compact && (
            <div className="rounded-lg border border-[var(--line-soft)] bg-[var(--bg-panel)] px-2 py-1.5">
              <div
                className="mb-1 rounded px-1.5 py-0.5 text-[9px] font-semibold"
                style={{ background: "var(--box-header-bg)", color: "var(--box-header-text)" }}
              >
                Follow Up
              </div>
              <span className="text-[12px] font-semibold text-[var(--brand-link)]">12 Open</span>
            </div>
          )}
          <span className="btn btn-primary btn-sm self-start px-3 py-1 text-[10px]">Save</span>
        </div>
      </div>
    </div>
  );
}

export default function ThemesSection() {
  const { roleTier, roleKnown } = useWorkspaceAccess();
  const canEdit = roleKnown && isAdminTier(roleTier);
  const [userId, setUserId] = useState<string | null>(null);
  const [saved, setSaved] = useState<BrandSettings>(() => readCachedBrand());

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    void supabase?.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
    });
    return onLocalChange(BRAND_KEY, () => setSaved(readCachedBrand()));
  }, []);

  const myMode = modeOf(saved, userId, "light");

  return (
    <section className="panel-card p-4" id="themes">
      <h3 className="text-xl font-semibold">Themes</h3>
      <p className="text-sm text-[var(--text-muted)]">
        The office look, and your own Light or Dark. The theme is shared. Light or Dark follows your login.
      </p>
      <div className="mt-4 space-y-4">
        <ModeCard saved={saved} userId={userId} myMode={myMode} />
        <OfficeThemeCard saved={saved} myMode={myMode} canEdit={canEdit} />
      </div>
    </section>
  );
}

function ModeCard({
  saved,
  userId,
  myMode,
}: {
  saved: BrandSettings;
  userId: string | null;
  myMode: Mode;
}) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [last, setLast] = useState<Mode | null>(null);

  const paint = (value: BrandSettings) => {
    try {
      window.localStorage.setItem(BRAND_KEY, JSON.stringify(value));
      notifyChange(BRAND_KEY);
    } catch {
      // The cache is only for paint. The database copy is confirmed below.
    }
  };

  const run = async (mode: Mode, previous: BrandSettings) => {
    if (!userId) {
      setStatus({ state: "failed", reason: "Sign in before choosing Light or Dark." });
      return;
    }
    setStatus({ state: "saving" });
    const result: SaveResult = await savePersonalMode(userId, mode);
    if (!result.ok) {
      paint(previous);
      setStatus({ state: "failed", reason: result.reason });
      return;
    }
    setStatus({ state: "saved" });
  };

  const choose = (mode: Mode) => {
    if (!userId || mode === myMode) return;
    setLast(mode);
    const previous = readCachedBrand();
    paint(withMode(previous, userId, mode));
    void run(mode, previous);
  };

  const retry = () => {
    if (!last || !userId) return;
    const previous = readCachedBrand();
    paint(withMode(previous, userId, last));
    void run(last, previous);
  };

  return (
    <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--bg-panel)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-base font-semibold">Your Mode</h4>
        <SaveNote status={status} onRetry={retry} />
      </div>
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Light or Dark, for you alone. It is saved to your login, so it follows you to any computer, and nobody else&apos;s screen changes.
      </p>
      <div role="radiogroup" aria-label="Your Mode" className="grid gap-3 sm:grid-cols-2">
        {(["light", "dark"] as Mode[]).map((mode) => {
          const active = myMode === mode;
          return (
            <button
              key={mode}
              role="radio"
              aria-checked={active}
              disabled={!userId}
              onClick={() => choose(mode)}
              type="button"
              className={`rounded-2xl border p-3 text-left transition-colors disabled:opacity-60 ${
                active ? "border-[var(--brand-primary)] bg-[var(--bg-soft)]" : "border-[var(--line-soft)] hover:border-[var(--brand-link)]"
              }`}
            >
              <span className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{mode === "light" ? "Light" : "Dark"}</span>
                {active && (
                  <span className="rounded-full bg-[var(--brand-primary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--btn-ink)]">
                    In Use
                  </span>
                )}
              </span>
              <ThemePreview brand={saved} mode={mode} compact />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OfficeThemeCard({
  saved,
  myMode,
  canEdit,
}: {
  saved: BrandSettings;
  myMode: Mode;
  canEdit: boolean;
}) {
  // Unsaved office-theme edits. Ignored once they match what the database cache holds,
  // so a Light/Dark save (same row, same theme) does not wipe an in-progress edit.
  const [edit, setEdit] = useState<BrandSettings | null>(null);
  const [view, setView] = useState<Mode>(myMode);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [last, setLast] = useState<BrandSettings | null>(null);
  const pending = edit && !sameTheme(edit, saved) ? edit : null;
  const theme = pending?.theme ?? saved.theme;
  const mine = pending ? pending.mine : saved.mine;
  const mineDark = pending ? pending.mineDark : saved.mineDark;

  const draft: BrandSettings = brandFrom({
    theme: theme === "mine" && !mine ? "blue" : theme,
    mine,
    mineDark,
    modes: saved.modes,
  });
  const dirty = !sameTheme(draft, saved);
  const remember = (next: BrandSettings) => {
    setEdit(next);
    setStatus({ state: "idle" });
  };
  const lightColors = mineColors(draft, "light");
  const darkColors = mineColors(draft, "dark");
  const lightCheck = checkMyTheme(lightColors);
  const darkCheck = checkMyTheme(darkColors);
  const editing = view === "light" ? lightColors : darkColors;
  const check = view === "light" ? lightCheck : darkCheck;
  const blocked = theme === "mine" && !(lightCheck.ok && darkCheck.ok);

  const pick = (id: ThemeId) => {
    remember({
      theme: id,
      mine: id === "mine" ? (mine ?? mineColors(saved, "light")) : mine,
      mineDark,
      modes: saved.modes,
    });
  };

  const setColor = (key: keyof MyTheme, value: string) => {
    const hex = normalizeHex(value);
    if (!hex) return;
    if (view === "light") remember({ theme, mine: { ...lightColors, [key]: hex }, mineDark, modes: saved.modes });
    else remember({ theme, mine, mineDark: { ...darkColors, [key]: hex }, modes: saved.modes });
  };

  const run = async (next: BrandSettings) => {
    setStatus({ state: "saving" });
    const result = await saveOfficeTheme(next);
    setStatus(result.ok ? { state: "saved" } : { state: "failed", reason: result.reason });
  };

  const save = () => {
    if (blocked || !canEdit) return;
    setLast(draft);
    void run(draft);
  };

  const retry = () => {
    if (last) void run(last);
  };

  return (
    <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--bg-panel)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-base font-semibold">Office Theme</h4>
        <div className="flex flex-wrap items-center gap-3">
          <SaveNote status={status} onRetry={retry} />
          {canEdit && (
            <button className="btn btn-primary btn-sm disabled:opacity-50" disabled={!dirty || blocked || status.state === "saving"} onClick={save} type="button">
              {status.state === "saving" ? "Saving…" : "Save Theme"}
            </button>
          )}
        </div>
      </div>
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        The look everyone in the office sees. Every theme has a Light and a Dark version. Each person picks their own above.
        {!canEdit && " Your role can look at the themes but not change the office's."}
      </p>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-[var(--text-muted)]">Previewing</span>
        {(["light", "dark"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setView(m)}
            aria-pressed={view === m}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              view === m
                ? "border-[var(--brand-primary)] bg-[var(--bg-soft)] text-[var(--text-main)]"
                : "border-[var(--line-soft)] text-[var(--text-muted)]"
            }`}
          >
            {m === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>

      <fieldset disabled={!canEdit} className="m-0 min-w-0 border-0 p-0 disabled:opacity-90">
        <div role="radiogroup" aria-label="Office Theme" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {THEMES.map((t) => {
            const chosenNow = saved.theme === t.id;
            const unset = t.id === "mine" && !mine;
            const previewBrand: BrandSettings =
              unset
                ? { theme: "mine", mine: mineColors(saved, "light") }
                : t.id === "mine"
                  ? { theme: "mine", mine: lightColors, mineDark }
                  : { theme: t.id };
            return (
              <button
                key={t.id}
                role="radio"
                aria-checked={theme === t.id}
                onClick={() => pick(t.id)}
                type="button"
                className={`rounded-2xl border p-3 text-left transition-colors ${
                  theme === t.id ? "border-[var(--brand-primary)] bg-[var(--bg-soft)]" : "border-[var(--line-soft)] hover:border-[var(--brand-link)]"
                }`}
              >
                <span className="mb-2 flex items-center justify-between gap-2">
                  <span>
                    <span className="block text-sm font-semibold">{t.name}</span>
                    <span className="block text-xs text-[var(--text-muted)]">{t.blurb}</span>
                  </span>
                  {chosenNow && (
                    <span className="rounded-full bg-[var(--brand-primary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--btn-ink)]">
                      In Use
                    </span>
                  )}
                </span>
                <ThemePreview compact mode={view} brand={previewBrand} />
              </button>
            );
          })}
        </div>

        {theme === "mine" && (
          <div className="mt-5 grid gap-5 border-t border-[var(--line-soft)] pt-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-semibold">My Theme — {view === "light" ? "Light" : "Dark"} Colors</h3>
              <p className="mb-3 text-xs text-[var(--text-muted)]">
                Pick four colors. NoteGoat works out every other shade. Light and Dark each have their own four.
                {view === "dark" && !mineDark && " Dark starts from your Light colors until you change it."}
              </p>
              <div className="space-y-2.5">
                {COLOR_LABELS.map(({ key, label, help }) => (
                  <ColorRow
                    key={`${view}-${key}`}
                    label={label}
                    help={help}
                    value={editing[key]}
                    onChange={(v) => setColor(key, v)}
                  />
                ))}
              </div>
              {view === "dark" && mineDark && (
                <button className="mt-3 text-xs font-semibold text-[var(--brand-link)] hover:underline" onClick={() => remember({ theme, mine, modes: saved.modes })} type="button">
                  Start Dark Over From My Light Colors
                </button>
              )}
              {view === "light" && (
                <button
                  className="mt-3 text-xs font-semibold text-[var(--brand-link)] hover:underline"
                  onClick={() => remember({ theme: "mine", mine: { ...mineColors({ theme: "mine" }, "light") }, modes: saved.modes })}
                  type="button"
                >
                  Reset My Theme
                </button>
              )}
              {check.problems.map((p) => (
                <p key={p} className="mt-3 text-sm text-red-700">
                  {view === "light" ? "Light: " : "Dark: "}
                  {p}
                </p>
              ))}
              {view === "light" && !darkCheck.ok && (
                <p className="mt-3 text-sm text-red-700">Dark has a problem too. Switch Previewing to Dark to fix it.</p>
              )}
              {view === "dark" && !lightCheck.ok && (
                <p className="mt-3 text-sm text-red-700">Light has a problem too. Switch Previewing to Light to fix it.</p>
              )}
              {check.notes.map((n) => (
                <p key={n} className="mt-2 text-xs text-[var(--text-muted)]">
                  {n}
                </p>
              ))}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Live Preview</h3>
              <ThemePreview brand={{ theme: "mine", mine: lightColors, mineDark }} mode={view} />
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Text contrast {check.textContrast.toFixed(1)}:1 (needs 4.5). Nothing is saved until you press Save Theme.
              </p>
            </div>
          </div>
        )}
      </fieldset>
    </div>
  );
}

function ColorRow({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }
  return (
    <label className="flex items-center gap-3">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} Color`}
        className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-[var(--line-soft)] bg-transparent p-0.5"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-[var(--text-muted)]">{help}</span>
      </span>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (normalizeHex(e.target.value)) onChange(e.target.value);
        }}
        onBlur={() => setText(value)}
        aria-label={`${label} Hex`}
        spellCheck={false}
        className="h-9 w-24 rounded-md border border-[var(--line-soft)] bg-[var(--bg-panel)] px-2 font-mono text-xs"
      />
    </label>
  );
}
