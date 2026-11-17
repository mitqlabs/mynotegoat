"use client";

import { useEffect, useState } from "react";
import {
  BRAND_STORAGE_KEY,
  brandFrom,
  checkMyTheme,
  lookOf,
  mineColors,
  normalizeHex,
  sameTheme,
  THEMES,
  type BrandSettings,
  type Mode,
  type MyTheme,
  type ThemeId,
} from "@/lib/brand";
import { saveOfficeBrand, savePersonTone, type SaveResult } from "@/lib/cloud/brand-save";
import { onLocalChange } from "@/lib/local-sync";
import { usePersonTone } from "@/lib/theme";

/**
 * Settings → Themes.
 *
 * Light or Dark is the signed-in person's own. Which theme the office wears
 * follows the Settings permission (owner and admin). Both say Saved only
 * after the database has been read back and matches.
 */

type Status = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "failed"; reason: string };

const COLOR_LABELS: { key: keyof MyTheme; label: string; help: string }[] = [
  { key: "accent", label: "Accent", help: "Buttons and highlights" },
  { key: "background", label: "Background", help: "The page behind the cards" },
  { key: "surface", label: "Surface", help: "Cards and panels" },
  { key: "text", label: "Text", help: "Words and numbers" },
];

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

  return (
    <div className="space-y-4">
      <ModeCard tone={tone} saved={saved} />
      <OfficeThemeCard saved={saved} tone={tone} canEdit={canEditOffice} />
    </div>
  );
}

function ModeCard({ tone, saved }: { tone: Mode; saved: BrandSettings }) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [last, setLast] = useState<Mode | null>(null);

  const run = async (mode: Mode) => {
    setStatus({ state: "saving" });
    const result: SaveResult = await savePersonTone(mode);
    setStatus(result.ok ? { state: "saved" } : { state: "failed", reason: result.reason });
  };

  return (
    <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--bg-panel)] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Your Mode</h3>
        <SaveNote status={status} onRetry={() => last && void run(last)} />
      </div>
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Light or Dark, for you alone. It is saved to your login, so it follows you to any computer, and nobody else&apos;s screen changes.
      </p>
      <div role="radiogroup" aria-label="Your Mode" className="grid gap-3 sm:grid-cols-2">
        {(["light", "dark"] as Mode[]).map((mode) => {
          const active = tone === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                setLast(mode);
                void run(mode);
              }}
              className={`rounded-2xl border p-3 text-left ${active ? "border-[var(--brand-primary)] bg-[var(--bg-soft)]" : "border-[var(--line-soft)]"}`}
            >
              <span className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{mode === "light" ? "Light" : "Dark"}</span>
                {active && <span className="rounded-full bg-[var(--brand-primary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--on-brand)]">In Use</span>}
              </span>
              <ThemePreview brand={saved} mode={mode} compact />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OfficeThemeCard({ saved, tone, canEdit }: { saved: BrandSettings; tone: Mode; canEdit: boolean }) {
  const [override, setOverride] = useState<BrandSettings | null>(null);
  const [view, setView] = useState<Mode>(tone);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [last, setLast] = useState<BrandSettings | null>(null);
  // Drop the draft once the database copy matches it, so a later cloud
  // update can show through without an effect.
  if (override && sameTheme(override, saved)) setOverride(null);

  const theme = override?.theme ?? saved.theme;
  const mine = override ? override.mine : saved.mine;
  const mineDark = override ? override.mineDark : saved.mineDark;
  const draft: BrandSettings = brandFrom({
    theme: theme === "mine" && !mine ? "blue" : theme,
    mine,
    mineDark,
  });
  const dirty = !sameTheme(draft, saved);
  const lightColors = mineColors({ ...draft, theme: "mine", mine: mine ?? mineColors(saved, "light") }, "light");
  const darkColors = mineColors({ theme: "mine", mine: mine ?? lightColors, mineDark }, "dark");
  const lightCheck = checkMyTheme(lightColors);
  const darkCheck = checkMyTheme(darkColors);
  const editing = view === "light" ? lightColors : darkColors;
  const check = view === "light" ? lightCheck : darkCheck;
  const blocked = theme === "mine" && !(lightCheck.ok && darkCheck.ok);

  const remember = (next: BrandSettings) => {
    setOverride(next);
    setStatus({ state: "idle" });
  };

  const pick = (id: ThemeId) => {
    remember(brandFrom({
      theme: id,
      mine: id === "mine" && !mine ? mineColors(saved, "light") : mine,
      mineDark,
    }));
  };

  const setColor = (key: keyof MyTheme, value: string) => {
    const hex = normalizeHex(value);
    if (!hex) return;
    remember(brandFrom({
      theme,
      mine: view === "light" ? { ...lightColors, [key]: hex } : mine ?? lightColors,
      mineDark: view === "dark" ? { ...darkColors, [key]: hex } : mineDark,
    }));
  };

  const run = async (next: BrandSettings) => {
    setStatus({ state: "saving" });
    const result = await saveOfficeBrand(next);
    setStatus(result.ok ? { state: "saved" } : { state: "failed", reason: result.reason });
  };

  const save = () => {
    if (blocked || !canEdit) return;
    const next = brandFrom({
      theme,
      mine: theme === "mine" ? lightColors : mine,
      mineDark,
    });
    setLast(next);
    void run(next);
  };

  return (
    <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--bg-panel)] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Office Theme</h3>
        <div className="flex flex-wrap items-center gap-3">
          <SaveNote status={status} onRetry={() => last && void run(last)} />
          {canEdit && (
            <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || blocked || status.state === "saving"}>
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
            type="button"
            onClick={() => setView(m)}
            aria-pressed={view === m}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              view === m ? "border-[var(--brand-primary)] bg-[var(--bg-soft)]" : "border-[var(--line-soft)] text-[var(--text-muted)]"
            }`}
          >
            {m === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>

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
            const swatch = t.id === "mine" ? (view === "light" ? lightColors : darkColors) : view === "light" ? t.light : t.dark;
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
                <ThemePreview compact mode={view} brand={previewBrand} />
                <Swatches colors={swatch} />
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
                  <ColorRow key={`${view}-${key}`} label={label} help={help} value={editing[key]} onChange={(v) => setColor(key, v)} />
                ))}
              </div>
              {view === "dark" && mineDark && (
                <button
                  type="button"
                  className="mt-3 text-xs font-semibold text-[var(--brand-ink)] underline"
                  onClick={() => remember(brandFrom({ theme: "mine", mine: mine ?? lightColors }))}
                >
                  Start Dark Over From My Light Colors
                </button>
              )}
              {view === "light" && (
                <button
                  type="button"
                  className="mt-3 text-xs font-semibold text-[var(--brand-ink)] underline"
                  onClick={() => remember(brandFrom({ theme: "mine", mine: mineColors({ theme: "mine" }, "light") }))}
                >
                  Reset My Theme
                </button>
              )}
              {check.problems.map((p) => (
                <p key={p} className="mt-3 text-sm text-[var(--status-alert,#8f251f)]">
                  {view === "light" ? "Light: " : "Dark: "}
                  {p}
                </p>
              ))}
              {view === "light" && !darkCheck.ok && (
                <p className="mt-3 text-sm text-[var(--status-alert,#8f251f)]">Dark has a problem too. Switch Previewing to Dark to fix it.</p>
              )}
              {view === "dark" && !lightCheck.ok && (
                <p className="mt-3 text-sm text-[var(--status-alert,#8f251f)]">Light has a problem too. Switch Previewing to Light to fix it.</p>
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

function ColorRow({ label, help, value, onChange }: { label: string; help: string; value: string; onChange: (hex: string) => void }) {
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
