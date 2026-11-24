"use client";

import { useEffect, useRef, useState } from "react";
import { ThemePageSamples } from "@/components/theme-page-samples";
import {
  BRAND_STORAGE_KEY,
  brandFrom,
  checkMyTheme,
  editMyThemeColor,
  lookOf,
  mineColors,
  myThemeReadable,
  resolvedTheme,
  sameTheme,
  swatchHardToRead,
  THEMES,
  type BrandSettings,
  type ExtraColorKey,
  type Mode,
  type MyTheme,
  type ThemeId,
} from "@/lib/brand";
import { publishBrandLocal, saveOfficeBrand, savePersonTone, type SaveResult } from "@/lib/cloud/brand-save";
import { onLocalChange } from "@/lib/local-sync";
import { usePersonTone } from "@/lib/theme";

/**
 * Settings → Themes.
 *
 * Light or Dark is the signed-in person's own, on the same cloud key as
 * before. The office theme is everyone else's look, and only someone who can
 * edit Settings changes it. A choice paints immediately, then says Saved
 * only after the database has been read back and matches.
 */

type Status = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "failed"; reason: string };

const COLOR_LABELS: { key: keyof MyTheme; label: string }[] = [
  { key: "accent", label: "Accent" },
  { key: "background", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "text", label: "Text" },
];

const MORE_COLORS: { key: ExtraColorKey; label: string }[] = [
  { key: "link", label: "Link" },
  { key: "muted", label: "Muted text" },
  { key: "heading", label: "Headings" },
  { key: "button", label: "Button" },
  { key: "buttonText", label: "Button text" },
  { key: "line", label: "Borders" },
  { key: "badge", label: "Badges" },
  { key: "danger", label: "Danger" },
];

/** Colour drags fire continuously. The cloud write waits until they pause. */
const COLOR_SAVE_MS = 500;

function loadBrand(): BrandSettings {
  if (typeof window === "undefined") return { theme: "blue" };
  try {
    const raw = window.localStorage.getItem(BRAND_STORAGE_KEY);
    return raw ? brandFrom(JSON.parse(raw)) : { theme: "blue" };
  } catch {
    return { theme: "blue" };
  }
}

function SaveNote({ status, onRetry }: { status: Status; onRetry: () => void }) {
  if (status.state === "idle") return null;
  return (
    <span role="status" className="flex flex-wrap items-center gap-2 text-sm">
      {status.state === "saving" && <span className="text-[var(--text-muted)]">Saving…</span>}
      {status.state === "saved" && <span className="font-semibold text-[var(--status-active,#186843)]">Saved</span>}
      {status.state === "failed" && (
        <>
          <span className="text-[var(--status-alert,#8f251f)]">Not saved. {status.reason}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            Retry
          </button>
        </>
      )}
    </span>
  );
}

/** A small office screen, drawn with the real theme rules. */
export function ThemePreview({ brand, mode, compact = false }: { brand: BrandSettings; mode: Mode; compact?: boolean }) {
  const look = lookOf(brand, mode);
  return (
    <div
      data-brand={look.id}
      data-tone={look.dark ? "dark" : "light"}
      style={{ ...look.vars, background: "var(--shell-bg)", color: "var(--text-main)" }}
      aria-hidden="true"
      className={`flex overflow-hidden rounded-xl border border-[var(--line-soft)] ${compact ? "h-24" : "h-52"}`}
    >
      <div
        className="flex w-1/4 flex-col gap-1.5 border-r p-2"
        style={{ background: "var(--bg-sidebar)", color: "var(--sidebar-text)", borderColor: "transparent" }}
      >
        <span className="text-[11px] font-semibold leading-none">NoteGoat</span>
        <span className="h-4 rounded-md" style={{ background: "var(--sidebar-active)" }} />
        <span className="h-1.5 w-3/4 rounded-full" style={{ background: "var(--sidebar-muted)" }} />
        <span className="h-1.5 w-2/3 rounded-full" style={{ background: "var(--sidebar-link)" }} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <span className="text-[15px] font-semibold leading-none">Sample, Alex</span>
        <div className="flex flex-1 gap-2">
          <div className="flex flex-1 flex-col justify-between rounded-lg border p-2" style={{ background: "var(--bg-panel)", borderColor: "var(--line-soft)" }}>
            <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>Visit</span>
            <span className="text-[13px] font-semibold" style={{ color: "var(--brand-ink)" }}>Tuesday</span>
          </div>
          {!compact && (
            <div className="flex flex-1 flex-col justify-between rounded-lg border p-2" style={{ background: "var(--bg-panel)", borderColor: "var(--line-soft)" }}>
              <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>Note</span>
              <span className="text-[13px] font-semibold">SOAP</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full px-3 py-1 text-[10px] font-semibold" style={{ background: "var(--btn-bg, var(--brand-primary))", color: "var(--on-brand)" }}>
            Save
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Maybe Later</span>
        </div>
      </div>
    </div>
  );
}

function Swatches({ colors }: { colors: MyTheme }) {
  const items: { label: string; value: string }[] = [
    { label: "Accent", value: colors.accent },
    { label: "Background", value: colors.background },
    { label: "Surface", value: colors.surface },
    { label: "Text", value: colors.text },
  ];
  return (
    <span className="mt-2 flex gap-1.5">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
          <span className="inline-block h-3.5 w-3.5 rounded-full border border-black/10" style={{ background: item.value }} title={`${item.label} ${item.value}`} />
        </span>
      ))}
    </span>
  );
}

export function ThemesSection({ canEditOffice }: { canEditOffice: boolean }) {
  const tone = usePersonTone();
  const [saved, setSaved] = useState<BrandSettings>(() => loadBrand());
  useEffect(() => onLocalChange(BRAND_STORAGE_KEY, () => setSaved(loadBrand())), []);

  return <OfficeThemeCard saved={saved} tone={tone} canEdit={canEditOffice} />;
}

function OfficeThemeCard({ saved, tone, canEdit }: { saved: BrandSettings; tone: Mode; canEdit: boolean }) {
  const [override, setOverride] = useState<BrandSettings | null>(null);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [modeStatus, setModeStatus] = useState<Status>({ state: "idle" });
  const [lastBrand, setLastBrand] = useState<BrandSettings | null>(null);
  const [lastMode, setLastMode] = useState<Mode | null>(null);
  const latest = useRef<BrandSettings | null>(null);
  const timer = useRef<number | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  // Drop the draft once the painted copy matches it, so a later cloud
  // update can show through without an effect.
  if (override && sameTheme(override, saved)) setOverride(null);

  const theme = override?.theme ?? saved.theme;
  const mine = override ? override.mine : saved.mine;
  const mineDark = override ? override.mineDark : saved.mineDark;
  const shown: BrandSettings = brandFrom({
    theme: theme === "mine" && !mine ? "blue" : theme,
    mine,
    mineDark,
  });
  const lightColors = mineColors({ ...shown, theme: "mine", mine: mine ?? mineColors(saved, "light") }, "light");
  const darkColors = mineColors({ theme: "mine", mine: mine ?? lightColors, mineDark }, "dark");
  const lightCheck = checkMyTheme(lightColors);
  const darkCheck = checkMyTheme(darkColors);
  const editing = tone === "light" ? lightColors : darkColors;
  const check = tone === "light" ? lightCheck : darkCheck;

  const enqueue = (next: BrandSettings) => {
    queue.current = queue.current
      .then(async () => {
        if (!latest.current || !sameTheme(latest.current, next)) return;
        if (mounted.current) setStatus({ state: "saving" });
        const result = await saveOfficeBrand(next, { writeLocal: false });
        if (!mounted.current || !latest.current || !sameTheme(latest.current, next)) return;
        setLastBrand(next);
        setStatus(result.ok ? { state: "saved" } : { state: "failed", reason: result.reason });
      })
      .catch(() => {
        if (!mounted.current) return;
        setStatus({ state: "failed", reason: "The database did not confirm the save." });
      });
  };

  const stage = (next: BrandSettings, delay: number, force = false) => {
    if (!canEdit) return;
    latest.current = next;
    try {
      publishBrandLocal(next);
    } catch (error) {
      setLastBrand(next);
      setStatus({
        state: "failed",
        reason: error instanceof Error && error.message ? error.message : "This browser could not store the theme.",
      });
      return;
    }
    // The paint already matches this choice. Leave a pending cloud write
    // alone — clearing it would keep the theme only in this browser.
    if (!force && sameTheme(next, saved)) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (delay <= 0) {
      enqueue(next);
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      enqueue(next);
    }, delay);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!timer.current) return;
      window.clearTimeout(timer.current);
      timer.current = null;
      const pending = latest.current;
      if (!pending) return;
      queue.current = queue.current.then(() => saveOfficeBrand(pending, { writeLocal: false }).then(() => undefined));
    };
  }, []);

  const chooseMode = async (mode: Mode) => {
    if (mode === tone && modeStatus.state !== "failed") return;
    setLastMode(mode);
    setModeStatus({ state: "saving" });
    const result: SaveResult = await savePersonTone(mode);
    setModeStatus(result.ok ? { state: "saved" } : { state: "failed", reason: result.reason });
  };

  const pick = (id: ThemeId) => {
    if (!canEdit) return;
    const next = brandFrom({
      theme: id,
      mine: id === "mine" && !mine ? mineColors(saved, "light") : mine,
      mineDark,
    });
    if (id === "mine" && !myThemeReadable(next)) {
      setOverride(next);
      return;
    }
    if (sameTheme(next, saved) && !override) return;
    setOverride(next);
    stage(next, 0);
  };

  const setColor = (key: keyof MyTheme, value: string) => {
    if (!canEdit) return;
    const next = editMyThemeColor(brandFrom({ theme: "mine", mine: mine ?? lightColors, mineDark }), tone, key, value);
    if (!next) return;
    setOverride(next);
    if (!myThemeReadable(next)) return;
    stage(next, COLOR_SAVE_MS);
  };

  const resetMine = () => {
    const next = brandFrom({ theme: "mine", mine: mineColors({ theme: "mine" }, "light") });
    setOverride(next);
    stage(next, 0);
  };

  const resetDark = () => {
    const next = brandFrom({ theme: "mine", mine: mine ?? lightColors });
    setOverride(next);
    stage(next, 0);
  };

  return (
    <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--bg-panel)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Office Theme</h3>
        <div className="flex flex-wrap items-center gap-3">
          <div role="radiogroup" aria-label="Light or Dark" className="inline-flex rounded-full border border-[var(--line-soft)] bg-[var(--bg-panel)] p-0.5">
            {(["light", "dark"] as Mode[]).map((mode) => {
              const on = tone === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => void chooseMode(mode)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    on ? "bg-[var(--brand-primary)] text-[var(--on-brand)]" : "text-[var(--text-muted)]"
                  }`}
                >
                  {mode === "light" ? "Light" : "Dark"}
                </button>
              );
            })}
          </div>
          <SaveNote status={modeStatus} onRetry={() => lastMode && void chooseMode(lastMode)} />
          <SaveNote status={status} onRetry={() => lastBrand && stage(lastBrand, 0, true)} />
        </div>
      </div>
      {!canEdit && (
        <p className="mb-3 text-sm text-[var(--text-muted)]">Your role can look at the themes but not change the office&apos;s.</p>
      )}

      <fieldset disabled={!canEdit} className="m-0 min-w-0 border-0 p-0 disabled:opacity-80">
        <div role="radiogroup" aria-label="Office Theme" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {THEMES.map((t) => {
            const chosenNow = saved.theme === t.id;
            const unset = t.id === "mine" && !mine;
            const previewBrand: BrandSettings =
              t.id !== "mine"
                ? { theme: t.id }
                : unset
                  ? { theme: "mine", mine: mineColors(saved, "light") }
                  : { theme: "mine", mine: lightColors, mineDark };
            const swatch = t.id === "mine" ? (tone === "light" ? lightColors : darkColors) : tone === "light" ? t.light : t.dark;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={theme === t.id}
                onClick={() => pick(t.id)}
                className={`rounded-2xl border p-3 text-left ${theme === t.id ? "border-[var(--brand-primary)] bg-[var(--bg-soft)]" : "border-[var(--line-soft)]"}`}
              >
                <span className="mb-2 flex items-center justify-between gap-2">
                  <span>
                    <span className="block text-sm font-semibold">{t.name}</span>
                    <span className="block text-xs text-[var(--text-muted)]">{t.blurb}</span>
                  </span>
                  {chosenNow && <span className="rounded-full bg-[var(--brand-primary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--on-brand)]">In Use</span>}
                </span>
                <ThemePreview compact mode={tone} brand={previewBrand} />
                <Swatches colors={swatch} />
              </button>
            );
          })}
        </div>

        {theme === "mine" && (
          <div className="mt-5 grid gap-4 border-t border-[var(--line-soft)] pt-5">
            <div>
              <h3 className="mb-3 text-sm font-semibold">My Theme — {tone === "light" ? "Light" : "Dark"} Colors</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {COLOR_LABELS.map(({ key, label }) => (
                  <ColorRow
                    key={`${tone}-${key}`}
                    label={label}
                    note={key === "text" || key === "accent" ? (swatchHardToRead(key, editing) ? "hard to read" : "") : ""}
                    value={editing[key] ?? ""}
                    onChange={(v) => setColor(key, v)}
                  />
                ))}
              </div>
              <details open className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold">More colors</summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {MORE_COLORS.map(({ key, label }) => (
                    <ColorRow
                      key={`${tone}-${key}`}
                      label={label}
                      note={swatchHardToRead(key, editing) ? "hard to read" : ""}
                      value={resolvedTheme(editing)[key]}
                      onChange={(v) => setColor(key, v)}
                    />
                  ))}
                </div>
              </details>
              {tone === "dark" && mineDark && (
                <button type="button" className="mt-3 text-xs font-semibold text-[var(--brand-ink)] underline" onClick={resetDark}>
                  Start Dark Over From My Light Colors
                </button>
              )}
              {tone === "light" && (
                <button type="button" className="mt-3 text-xs font-semibold text-[var(--brand-ink)] underline" onClick={resetMine}>
                  Reset My Theme
                </button>
              )}
              {check.problems.map((p) => (
                <p key={p} className="mt-3 text-sm text-[var(--status-alert,#8f251f)]">
                  {tone === "light" ? "Light: " : "Dark: "}
                  {p}
                </p>
              ))}
              {tone === "light" && !darkCheck.ok && (
                <p className="mt-3 text-sm text-[var(--status-alert,#8f251f)]">Dark has a problem too. Switch to Dark to fix it.</p>
              )}
              {tone === "dark" && !lightCheck.ok && (
                <p className="mt-3 text-sm text-[var(--status-alert,#8f251f)]">Light has a problem too. Switch to Light to fix it.</p>
              )}
              {check.notes.map((n) => (
                <p key={n} className="mt-2 text-xs text-[var(--text-muted)]">
                  {n}
                </p>
              ))}
            </div>
            <ThemePageSamples brand={{ theme: "mine", mine: lightColors, mineDark }} mode={tone} />
          </div>
        )}
      </fieldset>
    </div>
  );
}

export function ThemeColorRowsPreview() {
  const [colors, setColors] = useState<MyTheme>({
    accent: "#0d79bf",
    background: "#eef6fb",
    surface: "#fdfefe",
    text: "#172a3a",
  });
  return (
    <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="theme-color-rows">
      {COLOR_LABELS.map(({ key, label }) => (
        <ColorRow key={key} label={label} value={colors[key] ?? "#000000"} onChange={(value) => setColors((current) => ({ ...current, [key]: value }))} />
      ))}
    </div>
  );
}

function ColorRow({ label, value, note, onChange }: { label: string; value: string; note?: string; onChange: (hex: string) => void }) {
  return (
    <div className="flex w-fit items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} Color`}
        className="h-9 w-12 max-w-12 shrink-0 cursor-pointer rounded-md border border-[var(--line-soft)] bg-transparent p-0.5"
      />
      <span className="text-sm font-medium">{label}</span>
      {note ? <span className="text-xs text-[var(--text-muted)]">{note}</span> : null}
    </div>
  );
}
