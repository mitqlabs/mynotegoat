"use client";

/**
 * Setup guide (the welcome popup).
 *
 * - Pops up by itself only for a brand-new practice, and only until it is
 *   finished or closed (× / "Not now"). Closing is remembered in the cloud.
 * - Reopens from Settings ("Setup guide") or the Dashboard setup card.
 * - "Open in Settings" links shrink the guide to a small pill in the corner,
 *   so the real settings are never hidden under it. The pill brings it back.
 * - Progress ("Setup 3/6") comes from the real settings, not just the name.
 */

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AddressFieldGroup } from "@/components/address-field-group";
import { ScrollLock } from "@/components/scroll-lock";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useOnboarding } from "@/hooks/use-onboarding";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { useWorkspacePeople } from "@/hooks/use-workspace-people";
import { onLocalChange } from "@/lib/local-sync";
import { patients, PATIENTS_STORAGE_KEY } from "@/lib/mock-data";
import {
  computeSetupProgress,
  OPEN_SETTINGS_SECTION_EVENT,
  OPEN_SETUP_GUIDE_EVENT,
  openSetupGuide,
  SETUP_STEPS,
  shouldAutoOpenSetupGuide,
  type SetupProgress,
  type SetupStepId,
} from "@/lib/onboarding";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { formatDurationMinutes } from "@/lib/schedule-appointment-types";
import { weekdayLabels } from "@/lib/schedule-settings";
import { to12hLabel } from "@/lib/time-12h";
import { getCurrentMembershipSync } from "@/lib/workspace-membership";
import { isBlankStarterWorkspace } from "@/lib/workspace-starter";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

const btnPrimary =
  "rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const btnSecondary =
  "rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-semibold";
const input = "rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2";

function livePatientCount() {
  return patients.filter((p) => p.deleted !== true).length;
}

/** Live setup progress for the signed-in practice. */
export function useSetupProgress(): SetupProgress {
  const { officeSettings } = useOfficeSettings();
  const { appointmentTypes } = useScheduleAppointmentTypes();
  const { onboardingState } = useOnboarding();
  const people = useWorkspacePeople();
  const [patientCount, setPatientCount] = useState(() => livePatientCount());
  useEffect(() => onLocalChange(PATIENTS_STORAGE_KEY, () => setPatientCount(livePatientCount())), []);
  const ownerId = getCurrentMembershipSync()?.ownerId ?? "";
  const teamMemberCount = people.filter((p) => p.userId !== ownerId && p.email !== "Owner").length;
  return useMemo(
    () =>
      computeSetupProgress({
        office: officeSettings,
        appointmentTypeCount: appointmentTypes.length,
        teamMemberCount,
        patientCount,
        confirmedSteps: onboardingState.confirmedSteps,
      }),
    [officeSettings, appointmentTypes.length, teamMemberCount, patientCount, onboardingState.confirmedSteps],
  );
}

/** "Setup guide · 3/6" button (Settings page). */
export function SetupGuideButton() {
  const { isOwner } = useWorkspaceAccess();
  if (!isOwner) return null;
  return <SetupGuideButtonInner />;
}

function SetupGuideButtonInner() {
  const progress = useSetupProgress();
  return (
    <button className={btnSecondary} onClick={() => openSetupGuide()} type="button">
      Setup guide · {progress.doneCount}/{progress.total}
    </button>
  );
}

/** Dashboard card for a new practice that hasn't finished setup. */
export function SetupProgressCard() {
  const { isOwner } = useWorkspaceAccess();
  const { onboardingState } = useOnboarding();
  const isBlank = useIsBlankStarter();
  if (!isOwner || !isBlank || onboardingState.completedAt) return null;
  return <SetupProgressCardInner />;
}

function SetupProgressCardInner() {
  const progress = useSetupProgress();
  if (progress.complete) return null;
  return (
    <section className="panel-card flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <h3 className="text-lg font-semibold">
          Setup {progress.doneCount}/{progress.total}
        </h3>
        <p className="text-sm text-[var(--text-muted)]">
          Next: {SETUP_STEPS.find((s) => s.id === progress.nextStepId)?.title}
        </p>
      </div>
      <button className={btnPrimary} onClick={() => openSetupGuide(progress.nextStepId)} type="button">
        Continue setup
      </button>
    </section>
  );
}

type GuideMode = "closed" | "open" | "minimized";

export function OnboardingModal() {
  const { onboardingState } = useOnboarding();
  const isBlank = useIsBlankStarter();
  const [mode, setModeRaw] = useState<GuideMode>("closed");
  // null = start on the first step that isn't done yet.
  const [requestedStep, setRequestedStep] = useState<SetupStepId | null>(null);
  const [openCount, setOpenCount] = useState(0);
  // Once the user has opened/closed/minimized it, stop auto-opening.
  const [touched, setTouched] = useState(false);
  const setMode = useCallback((next: GuideMode) => {
    setTouched(true);
    setModeRaw(next);
  }, []);

  // Pops up by itself only for a new practice's owner (see lib).
  const autoOpen =
    !touched &&
    shouldAutoOpenSetupGuide({
      isBlankStarter: isBlank,
      isMember: Boolean(getCurrentMembershipSync()?.isMember),
      state: onboardingState,
    });
  const effectiveMode: GuideMode = autoOpen ? "open" : mode;

  // Open from anywhere (Settings button, Dashboard card).
  useEffect(() => {
    const handleOpen = (event: Event) => {
      setRequestedStep((event as CustomEvent<SetupStepId | null>).detail ?? null);
      setOpenCount((n) => n + 1);
      setTouched(true);
      setModeRaw("open");
    };
    window.addEventListener(OPEN_SETUP_GUIDE_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_SETUP_GUIDE_EVENT, handleOpen);
  }, []);

  if (effectiveMode === "closed") return null;
  return <SetupGuide key={openCount} initialStep={requestedStep} mode={effectiveMode} setMode={setMode} />;
}

const noopSubscribe = () => () => {};
/** Client-only read of the workspace starter (false while server-rendering). */
function useIsBlankStarter(): boolean {
  return useSyncExternalStore(noopSubscribe, isBlankStarterWorkspace, () => false);
}

function SetupGuide({
  initialStep,
  mode,
  setMode,
}: {
  initialStep: SetupStepId | null;
  mode: GuideMode;
  setMode: (mode: GuideMode) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { onboardingState, markComplete, dismiss, confirmStep } = useOnboarding();
  const progress = useSetupProgress();
  const [step, setStep] = useState<SetupStepId | "done">(() => initialStep ?? progress.nextStepId);

  const close = useCallback(() => {
    setMode("closed");
    dismiss();
  }, [dismiss, setMode]);

  /** Go to a real Settings section and shrink the guide out of the way. */
  const openSettings = useCallback(
    (section: string) => {
      setMode("minimized");
      const href = `/settings?section=${section}`;
      if (pathname === "/settings") {
        window.history.replaceState(null, "", href);
        window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_SECTION_EVENT, { detail: section }));
      } else {
        router.push(href);
      }
    },
    [pathname, router, setMode],
  );

  if (mode === "minimized") {
    return (
      <div className="fixed bottom-4 left-4 z-[55] flex items-center gap-2 rounded-full border border-[var(--line-soft)] bg-white py-1.5 pl-4 pr-1.5 shadow-lg">
        <span className="text-sm font-semibold">
          Setup {progress.doneCount}/{progress.total}
        </span>
        <button className={`${btnPrimary} rounded-full py-1.5`} onClick={() => setMode("open")} type="button">
          Back to setup
        </button>
        <button
          aria-label="Close setup guide"
          className="h-8 w-8 rounded-full text-lg text-[var(--text-muted)] hover:bg-[var(--bg-soft)]"
          onClick={close}
          type="button"
        >
          ×
        </button>
      </div>
    );
  }

  const stepIndex = step === "done" ? SETUP_STEPS.length : SETUP_STEPS.findIndex((s) => s.id === step);
  const goNext = () => {
    const next = SETUP_STEPS[stepIndex + 1];
    setStep(next ? next.id : "done");
  };
  const goBack = () => {
    const prev = SETUP_STEPS[stepIndex - 1];
    if (prev) setStep(prev.id);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-8"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <ScrollLock />
      <div aria-label="Setup guide" aria-modal="true" className="panel-card w-full max-w-3xl p-5" role="dialog">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)]">
              Setup {progress.doneCount}/{progress.total}
            </p>
            <h2 className="text-2xl font-semibold">
              {step === "done" ? "You're ready" : SETUP_STEPS[stepIndex]?.title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button className={btnSecondary} onClick={close} type="button">
              Not now
            </button>
            <button
              aria-label="Close setup guide"
              className="h-9 w-9 rounded-full text-xl text-[var(--text-muted)] hover:bg-[var(--bg-soft)]"
              onClick={close}
              type="button"
            >
              ×
            </button>
          </div>
        </div>

        {/* Step list: shows what's done and lets you jump to any step. */}
        <ol className="mb-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-6">
          {progress.steps.map((s) => (
            <li key={s.id}>
              <button
                className={`w-full rounded-lg border px-2 py-1.5 text-left text-xs font-semibold ${
                  s.id === step
                    ? "border-[var(--brand-primary)] bg-[#ecf4fa]"
                    : "border-[var(--line-soft)] bg-white"
                }`}
                onClick={() => setStep(s.id)}
                type="button"
              >
                <span className={s.done ? "text-emerald-600" : "text-[var(--text-muted)]"}>{s.done ? "✓" : "○"}</span>{" "}
                {s.title}
              </button>
            </li>
          ))}
        </ol>

        {step === "practice" && <PracticeStep onSaved={goNext} />}
        {step === "offices" && (
          <OfficesStep
            confirmed={onboardingState.confirmedSteps.includes("offices")}
            onConfirm={() => {
              confirmStep("offices");
              goNext();
            }}
            openSettings={openSettings}
          />
        )}
        {step === "doctors" && <DoctorsStep openSettings={openSettings} />}
        {step === "appointmentTypes" && <AppointmentTypesStep openSettings={openSettings} />}
        {step === "team" && (
          <TeamStep
            confirmed={onboardingState.confirmedSteps.includes("team")}
            onSolo={() => {
              confirmStep("team");
              goNext();
            }}
            openSettings={openSettings}
          />
        )}
        {step === "firstPatient" && (
          <FirstPatientStep
            onAddPatient={() => {
              setMode("closed");
              router.push("/patients?new=1");
            }}
          />
        )}
        {step === "done" && (
          <DoneStep
            progress={progress}
            onFinish={() => {
              markComplete();
              setMode("closed");
              router.push("/patients");
            }}
            onJump={(id) => setStep(id)}
          />
        )}

        {step !== "done" && (
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--line-soft)] pt-4">
            <button className={btnSecondary} disabled={stepIndex <= 0} onClick={goBack} type="button">
              Back
            </button>
            <button className={btnSecondary} onClick={goNext} type="button">
              {stepIndex === SETUP_STEPS.length - 1 ? "Finish" : "Skip for now"} →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PracticeStep({ onSaved }: { onSaved: () => void }) {
  const { officeSettings, updateOfficeSettings } = useOfficeSettings();
  const [form, setForm] = useState({
    officeName: officeSettings.officeName,
    phone: officeSettings.phone,
    email: officeSettings.email,
    address: officeSettings.address,
  });
  const canSave = form.officeName.trim().length > 0;
  return (
    <div>
      <p className="text-sm text-[var(--text-muted)]">
        Your practice name, phone and address go on letters, reports and notes. Text messages sign off with
        your practice name ({"{{OFFICE_NAME}}"}).
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm font-semibold">Practice name *</span>
          <input
            className={input}
            onChange={(e) => setForm({ ...form, officeName: e.target.value })}
            placeholder="Your practice name"
            value={form.officeName}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-semibold">Phone</span>
          <input
            className={input}
            inputMode="numeric"
            onChange={(e) => setForm({ ...form, phone: formatUsPhoneInput(e.target.value) })}
            placeholder="(555) 555-5555"
            value={form.phone}
          />
        </label>
        <label className="grid gap-1 md:col-span-2">
          <span className="text-sm font-semibold">Email</span>
          <input
            className={input}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="office@example.com"
            type="email"
            value={form.email}
          />
        </label>
        <div className="grid gap-1 md:col-span-2">
          <span className="text-sm font-semibold">Address</span>
          <AddressFieldGroup onChange={(address) => setForm({ ...form, address })} value={form.address} />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          className={btnPrimary}
          disabled={!canSave}
          onClick={() => {
            updateOfficeSettings({
              officeName: form.officeName.trim(),
              phone: form.phone,
              email: form.email.trim(),
              address: form.address,
            });
            onSaved();
          }}
          type="button"
        >
          Save and continue →
        </button>
      </div>
    </div>
  );
}

function OfficesStep({
  confirmed,
  onConfirm,
  openSettings,
}: {
  confirmed: boolean;
  onConfirm: () => void;
  openSettings: (section: string) => void;
}) {
  const { officeSettings } = useOfficeSettings();
  const { scheduleSettings } = useScheduleSettings();
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-muted)]">
        Check your office hours. If you have more than one office, add each one (each can have its own
        address, phone and hours).
      </p>
      <div className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
        <p className="mb-2 text-sm font-semibold">Office hours</p>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {scheduleSettings.officeHours.map((d) => (
            <li className="flex justify-between gap-3" key={`hours-${d.dayOfWeek}`}>
              <span>{weekdayLabels[d.dayOfWeek]}</span>
              <span className="text-[var(--text-muted)]">
                {d.enabled ? `${to12hLabel(d.start)} – ${to12hLabel(d.end)}` : "Closed"}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-sm">
        {officeSettings.multiLocation && officeSettings.locations.length
          ? `${officeSettings.locations.length} office${officeSettings.locations.length === 1 ? "" : "s"} set up.`
          : "One office (you can add more any time)."}
      </p>
      <div className="flex flex-wrap gap-2">
        <button className={btnSecondary} onClick={() => openSettings("schedule")} type="button">
          Change hours in Settings
        </button>
        <button className={btnSecondary} onClick={() => openSettings("office")} type="button">
          Add offices in Settings
        </button>
        <button className={btnPrimary} onClick={onConfirm} type="button">
          {confirmed ? "✓ Hours are right" : "Hours look right →"}
        </button>
      </div>
    </div>
  );
}

function DoctorsStep({ openSettings }: { openSettings: (section: string) => void }) {
  const { officeSettings, updateOfficeSettings } = useOfficeSettings();
  const [name, setName] = useState("");
  const doctors = officeSettings.doctors ?? [];
  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `doc-${crypto.randomUUID()}`
        : `doc-${Date.now()}`;
    updateOfficeSettings((cur) => ({
      doctors: [...(cur.doctors ?? []), { id, name: trimmed }],
      // The first doctor becomes the main doctor unless one is set.
      ...(cur.doctorName.trim() ? {} : { doctorName: trimmed }),
    }));
    setName("");
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-muted)]">
        Add the doctors you schedule. The main doctor is the default provider and appears on notes and
        letters.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          className={`${input} min-w-[220px] flex-1`}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="Dr. First Last"
          value={name}
        />
        <button className={btnPrimary} onClick={add} type="button">
          Add doctor
        </button>
      </div>
      {doctors.length > 0 && (
        <label className="grid max-w-md gap-1">
          <span className="text-sm font-semibold">Main doctor (default provider)</span>
          <select
            className={input}
            onChange={(e) => updateOfficeSettings({ doctorName: e.target.value })}
            value={officeSettings.doctorName}
          >
            {!doctors.some((d) => d.name === officeSettings.doctorName) && (
              <option value={officeSettings.doctorName}>{officeSettings.doctorName || "Choose…"}</option>
            )}
            {doctors.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-sm">
        {doctors.length ? `${doctors.length} doctor${doctors.length === 1 ? "" : "s"}: ${doctors.map((d) => d.name).join(", ")}` : "No doctors yet."}
      </p>
      {officeSettings.multiLocation && (
        <button className={btnSecondary} onClick={() => openSettings("office")} type="button">
          Choose which office each doctor works at
        </button>
      )}
    </div>
  );
}

function AppointmentTypesStep({ openSettings }: { openSettings: (section: string) => void }) {
  const { appointmentTypes, addAppointmentType } = useScheduleAppointmentTypes();
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(30);
  const [color, setColor] = useState("#73b4e4");
  const [error, setError] = useState("");
  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const ok = addAppointmentType(trimmed, color, duration, appointmentTypes.length === 0);
    if (!ok) {
      setError(`"${trimmed}" is already on your list.`);
      return;
    }
    setError("");
    setName("");
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-muted)]">
        Add the kinds of visits you book, with how long each one takes. You can add more and pick colors in
        Settings any time.
      </p>
      <div className="grid gap-2 rounded-xl border border-[var(--line-soft)] bg-white p-3 sm:grid-cols-[1fr_120px_56px_auto]">
        <input
          className={input}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="Visit name (e.g. New Patient Exam)"
          value={name}
        />
        <select className={input} onChange={(e) => setDuration(Number(e.target.value))} value={duration}>
          {[15, 20, 30, 45, 60, 90].map((m) => (
            <option key={m} value={m}>
              {formatDurationMinutes(m)}
            </option>
          ))}
        </select>
        <input
          aria-label="Color"
          className="h-10 w-full rounded-lg border border-[var(--line-soft)]"
          onChange={(e) => setColor(e.target.value)}
          type="color"
          value={color}
        />
        <button className={btnPrimary} onClick={add} type="button">
          Add
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {appointmentTypes.length ? (
        <ul className="flex flex-wrap gap-2">
          {appointmentTypes.map((t) => (
            <li
              className="inline-flex items-center gap-2 rounded-full border border-[var(--line-soft)] bg-white px-3 py-1 text-sm"
              key={t.id}
            >
              <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name} · {formatDurationMinutes(t.durationMin)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">No appointment types yet.</p>
      )}
      <button className={btnSecondary} onClick={() => openSettings("schedule")} type="button">
        Open appointment types in Settings
      </button>
    </div>
  );
}

function TeamStep({
  confirmed,
  onSolo,
  openSettings,
}: {
  confirmed: boolean;
  onSolo: () => void;
  openSettings: (section: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-muted)]">
        Give your front desk and other doctors their own login. You choose what each person can see.
      </p>
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} onClick={() => openSettings("team")} type="button">
          Add team members in Settings
        </button>
        <button className={btnSecondary} onClick={onSolo} type="button">
          {confirmed ? "✓ Just me for now" : "It's just me for now →"}
        </button>
      </div>
    </div>
  );
}

function FirstPatientStep({ onAddPatient }: { onAddPatient: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-muted)]">
        Add your first patient. You can book their first visit from the same form.
      </p>
      <button className={btnPrimary} onClick={onAddPatient} type="button">
        Add your first patient
      </button>
    </div>
  );
}

function DoneStep({
  progress,
  onFinish,
  onJump,
}: {
  progress: SetupProgress;
  onFinish: () => void;
  onJump: (id: SetupStepId) => void;
}) {
  const left = progress.steps.filter((s) => !s.done);
  return (
    <div className="space-y-4">
      {left.length ? (
        <div>
          <p className="text-sm">Still to do (you can come back from Settings → Setup guide):</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {left.map((s) => (
              <li key={s.id}>
                <button className={btnSecondary} onClick={() => onJump(s.id)} type="button">
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-base">Everything is set up.</p>
      )}
      <p className="text-sm text-[var(--text-muted)]">
        Macros, charges, letter and report templates and texts start empty. Add your own in Settings
        whenever you&apos;re ready.
      </p>
      <div className="flex justify-end">
        <button className={btnPrimary} onClick={onFinish} type="button">
          Done → add first patient
        </button>
      </div>
    </div>
  );
}
