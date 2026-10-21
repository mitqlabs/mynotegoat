"use client";

/**
 * The patient's questionnaire (public, no login). Mobile-first: one section
 * per step, big tap targets, progress bar, plain language, English/Spanish.
 * Every change saves to the server as you go — nothing is kept in the
 * browser, so the patient can close the page and finish later from the link.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  answeredCount,
  type FormSnapshot,
  type PatientAnswer,
  type PatientAnswers,
  type SnapshotQuestion,
} from "@/lib/patient-forms";
import { FORM_STRINGS, type FormLang } from "@/lib/patient-forms-i18n";

type Loaded =
  | { kind: "loading" }
  | { kind: "inactive"; message: string }
  | { kind: "error" }
  | { kind: "submitted"; officeName: string }
  | { kind: "open"; snapshot: FormSnapshot; officeName: string; formName: string };

type SaveState = "idle" | "saving" | "saved" | "failed";

function formatDateInput(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

const LOAD_TIMEOUT_MS = 10_000;

/** fetch that gives up after `ms` instead of hanging on a stalled connection. */
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = LOAD_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

export function PatientFormPage({ token }: { token: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [answers, setAnswers] = useState<PatientAnswers>({});
  const [step, setStep] = useState(0);
  const [lang, setLang] = useState<FormLang>("en");
  const [save, setSave] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const t = FORM_STRINGS[lang];

  const latest = useRef<{ answers: PatientAnswers; step: number }>({ answers: {}, step: 0 });
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryMs = useRef(2000);
  const endpoint = `/api/forms/public/${encodeURIComponent(token)}`;

  const load = useCallback(async () => {
    setLoaded({ kind: "loading" });
    try {
      let res: Response;
      try {
        res = await fetchWithTimeout(endpoint, { cache: "no-store" });
      } catch {
        // One automatic retry for a stalled/failed first attempt.
        res = await fetchWithTimeout(endpoint, { cache: "no-store" });
      }
      const json = await res.json().catch(() => ({}));
      if (json.status === "submitted") return setLoaded({ kind: "submitted", officeName: json.officeName ?? "" });
      if (!res.ok || !json.snapshot) {
        if (res.status === 404) return setLoaded({ kind: "inactive", message: json.message ?? "" });
        return setLoaded({ kind: "error" });
      }
      const a = (json.answers ?? {}) as PatientAnswers;
      latest.current = { answers: a, step: json.step ?? 0 };
      setAnswers(a);
      setStep(Math.min(json.step ?? 0, (json.snapshot as FormSnapshot).sections.length + 1));
      setLoaded({ kind: "open", snapshot: json.snapshot, officeName: json.officeName ?? "", formName: json.formName ?? "" });
      if (typeof navigator !== "undefined" && /^es\b/i.test(navigator.language) && (json.snapshot as FormSnapshot).introEs) setLang("es");
    } catch {
      setLoaded({ kind: "error" });
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (inFlight.current || !dirty.current) return !dirty.current;
    inFlight.current = true;
    dirty.current = false;
    setSave("saving");
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(latest.current),
      });
      if (res.status === 404) {
        setLoaded({ kind: "inactive", message: "" });
        return false;
      }
      if (!res.ok) throw new Error(String(res.status));
      setSave("saved");
      retryMs.current = 2000;
      return true;
    } catch {
      dirty.current = true;
      setSave("failed");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), retryMs.current);
      retryMs.current = Math.min(retryMs.current * 2, 30000);
      return false;
    } finally {
      inFlight.current = false;
      if (dirty.current && timer.current === null) timer.current = setTimeout(() => void flush(), 800);
    }
  }, [endpoint]);

  const queueSave = useCallback(
    (delay = 800) => {
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void flush();
      }, delay);
    },
    [flush],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const setAnswer = (key: string, next: PatientAnswer) => {
    setAnswers((cur) => {
      const merged = { ...cur, [key]: next };
      latest.current = { ...latest.current, answers: merged };
      return merged;
    });
    queueSave();
  };

  const goStep = (n: number) => {
    setStep(n);
    latest.current = { ...latest.current, step: n };
    queueSave(0);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    setSubmitting(true);
    if (timer.current) clearTimeout(timer.current);
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...latest.current, submit: true }),
      });
      if (res.ok) {
        dirty.current = false;
        setLoaded({ kind: "submitted", officeName: loaded.kind === "open" ? loaded.officeName : "" });
      } else if (res.status === 404) {
        setLoaded({ kind: "inactive", message: "" });
      } else {
        setSave("failed");
      }
    } catch {
      setSave("failed");
    } finally {
      setSubmitting(false);
    }
  };

  const shell = (children: React.ReactNode, office = "") => (
    <main className="min-h-screen bg-[#f5f7fb] px-4 py-6 text-[17px] text-slate-900">
      <div className="mx-auto max-w-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-500">{office}</p>
          <button
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-semibold"
            onClick={() => setLang(lang === "en" ? "es" : "en")}
            type="button"
          >
            {t.language}
          </button>
        </div>
        {children}
        <p className="mt-8 text-center text-xs text-slate-500">{t.privacy}</p>
      </div>
    </main>
  );

  const progress = useMemo(() => (loaded.kind === "open" ? answeredCount(loaded.snapshot, answers) : { answered: 0, total: 0 }), [loaded, answers]);

  if (loaded.kind === "loading") return shell(<p className="py-20 text-center text-slate-500">{t.loading}</p>);
  if (loaded.kind === "inactive")
    return shell(
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-2 text-xl font-bold">{t.inactiveTitle}</h1>
        <p>{FORM_STRINGS.en === t ? loaded.message || "Please contact the office for a new link." : "Por favor comuníquese con la oficina para recibir un enlace nuevo."}</p>
      </div>,
    );
  if (loaded.kind === "error")
    return shell(
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-bold">{t.errorTitle}</h1>
        <button className="w-full rounded-xl bg-[#1f4f8a] py-3 font-semibold text-white" onClick={() => void load()} type="button">
          {t.tryAgain}
        </button>
      </div>,
    );
  if (loaded.kind === "submitted")
    return shell(
      <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
        <div className="mb-2 text-4xl">✓</div>
        <h1 className="mb-2 text-2xl font-bold">{t.thanksTitle}</h1>
        <p>{t.thanksBody}</p>
      </div>,
      loaded.officeName,
    );

  const { snapshot } = loaded;
  const sections = snapshot.sections.filter((s) => s.questions.length > 0);
  const total = sections.length + 1; // sections + review
  const pick = <T extends string | undefined>(en: T, es?: string) => (lang === "es" && es ? es : en);

  const saveBadge =
    save === "saving" ? t.saving : save === "saved" ? `✓ ${t.saved}` : save === "failed" ? t.notSaved : "";

  const bar = (
    <div className="mb-4">
      <div className="mb-1 flex justify-between text-sm text-slate-600">
        <span>{step > 0 ? t.step(Math.min(step, total), total) : ""}</span>
        <span className={save === "failed" ? "text-red-700" : ""} aria-live="polite">{saveBadge}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full bg-[#1f4f8a] transition-all" style={{ width: `${progress.total ? Math.round((progress.answered / progress.total) * 100) : 0}%` }} />
      </div>
    </div>
  );

  const renderQuestion = (q: SnapshotQuestion) => {
    const a = answers[q.key] ?? {};
    const picks = a.picks ?? [];
    const label = pick(q.label, q.labelEs);
    const onlyNo = q.kind === "single" && q.options.length === 1 && /^no\b/i.test(q.options[0].label);
    if (q.kind === "text" && q.input === "long") {
      return (
        <label className="block" key={q.key}>
          <span className="mb-2 block font-semibold">{label}</span>
          <textarea
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
            onChange={(e) => setAnswer(q.key, { other: e.target.value })}
            placeholder={t.typeAnswer}
            rows={4}
            value={a.other ?? ""}
          />
        </label>
      );
    }
    if (q.kind === "text" && q.input === "number") {
      return (
        <label className="block" key={q.key}>
          <span className="mb-2 block font-semibold">{label}</span>
          <input
            className="w-40 rounded-xl border border-slate-300 bg-white px-4 py-3"
            inputMode="decimal"
            onChange={(e) => setAnswer(q.key, { other: e.target.value.replace(/[^\d.,-]/g, "").slice(0, 14) })}
            value={a.other ?? ""}
          />
        </label>
      );
    }
    if (q.kind === "text") {
      return (
        <label className="block" key={q.key}>
          <span className="mb-2 block font-semibold">{label}</span>
          <input
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
            inputMode={q.dateInput ? "numeric" : undefined}
            onChange={(e) => setAnswer(q.key, { other: q.dateInput ? formatDateInput(e.target.value) : e.target.value })}
            placeholder={q.dateInput ? "MM/DD/YYYY" : t.typeAnswer}
            value={a.other ?? ""}
          />
        </label>
      );
    }
    return (
      <fieldset className="block" key={q.key}>
        <legend className="mb-1 font-semibold">{label}</legend>
        <p className="mb-2 text-sm text-slate-500">{q.kind === "multi" ? t.pickAll : t.pickOne}</p>
        <div className="grid gap-2">
          {q.options.map((o) => {
            const on = picks.includes(o.value);
            return (
              <label
                className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 ${on ? "border-[#1f4f8a] bg-[#eaf1fb]" : "border-slate-300 bg-white"}`}
                key={o.value}
              >
                <input
                  checked={on}
                  className="h-5 w-5 shrink-0"
                  name={q.key}
                  onChange={() => {
                    if (q.kind === "single") setAnswer(q.key, on ? {} : { picks: [o.value] });
                    else setAnswer(q.key, { ...a, picks: on ? picks.filter((p) => p !== o.value) : [...picks, o.value] });
                  }}
                  type={q.kind === "single" ? "radio" : "checkbox"}
                />
                <span>{pick(o.label, o.labelEs)}</span>
              </label>
            );
          })}
          {q.allowOther && (
            <input
              aria-label={onlyNo ? t.explain : t.other}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
              onChange={(e) =>
                setAnswer(q.key, q.kind === "single" ? { other: e.target.value } : { ...a, other: e.target.value })
              }
              placeholder={onlyNo ? t.explain : t.other}
              value={a.other ?? ""}
            />
          )}
        </div>
      </fieldset>
    );
  };

  // Step 0: intro
  if (step === 0) {
    return shell(
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-3 text-2xl font-bold">{loaded.formName}</h1>
        <p className="mb-2">{pick(snapshot.intro, snapshot.introEs)}</p>
        <p className="mb-6 text-sm text-slate-500">{t.optional}</p>
        <button className="w-full rounded-xl bg-[#1f4f8a] py-4 text-lg font-semibold text-white" onClick={() => goStep(1)} type="button">
          {t.start}
        </button>
      </div>,
      loaded.officeName,
    );
  }

  // Review step
  if (step > sections.length) {
    return shell(
      <>
        {bar}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="mb-1 text-xl font-bold">{t.reviewTitle}</h1>
          <p className="mb-4 text-sm text-slate-500">{t.reviewHint}</p>
          {sections.map((s) => (
            <div className="mb-4" key={s.id}>
              <h2 className="mb-1 font-semibold text-[#1f4f8a]">{pick(s.title, s.titleEs)}</h2>
              <ul className="space-y-1 text-[15px]">
                {s.questions.map((q) => {
                  const a = answers[q.key];
                  const parts = [...(a?.picks ?? []).map((p) => {
                    const o = q.options.find((x) => x.value === p);
                    return o ? pick(o.label, o.labelEs) : p;
                  }), ...(a?.other?.trim() ? [a.other.trim()] : [])];
                  return (
                    <li key={q.key}>
                      <span className="text-slate-500">{pick(q.label, q.labelEs)}</span> — {parts.length ? parts.join(", ") : <em className="text-slate-400">{t.noAnswer}</em>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button className="rounded-xl border border-slate-300 bg-white py-3 font-semibold" onClick={() => goStep(sections.length)} type="button">
              {t.back}
            </button>
            <button className="rounded-xl bg-[#1f7a4d] py-3 font-semibold text-white disabled:opacity-60" disabled={submitting} onClick={() => void submit()} type="button">
              {submitting ? t.submitting : t.submit}
            </button>
          </div>
        </div>
      </>,
      loaded.officeName,
    );
  }

  const section = sections[step - 1];
  return shell(
    <>
      {bar}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-5 text-xl font-bold">{pick(section.title, section.titleEs)}</h1>
        <div className="space-y-7">{section.questions.map(renderQuestion)}</div>
        <div className="mt-8 grid grid-cols-2 gap-3">
          <button className="rounded-xl border border-slate-300 bg-white py-3 font-semibold" onClick={() => goStep(step - 1)} type="button">
            {t.back}
          </button>
          <button className="rounded-xl bg-[#1f4f8a] py-3 font-semibold text-white" onClick={() => goStep(step + 1)} type="button">
            {step === sections.length ? t.review : t.next}
          </button>
        </div>
      </div>
    </>,
    loaded.officeName,
  );
}
