"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useBillingMacros } from "@/hooks/use-billing-macros";
import { useMacroTemplates } from "@/hooks/use-macro-templates";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { useOnboarding } from "@/hooks/use-onboarding";
import { useScheduleAppointmentTypes } from "@/hooks/use-schedule-appointment-types";
import { hasMacroInEverySection, starterMacroPack } from "@/lib/onboarding";
import { AddressFieldGroup } from "@/components/address-field-group";
import { formatUsPhoneInput } from "@/lib/phone-format";
import type { AppointmentTypePatientTypes } from "@/lib/schedule-appointment-types";
import { ScrollLock } from "@/components/scroll-lock";

type StepId = 1 | 2 | 3 | 4 | 5 | 6;

const stepTitles: Record<Exclude<StepId, 6>, string> = {
  1: "Welcome",
  2: "Office Identity",
  3: "Appointment Types",
  4: "SOAP Macros & Charges",
  5: "Templates & Contacts",
};

export function OnboardingModal() {
  const { onboardingState, markComplete } = useOnboarding();
  const { officeSettings, updateOfficeSettings } = useOfficeSettings();
  const { appointmentTypes, addAppointmentType } = useScheduleAppointmentTypes();
  const { macroLibrary, addMacro, updateMacro } = useMacroTemplates();
  const { billingMacros, addTreatment } = useBillingMacros();

  const [step, setStep] = useState<StepId>(1);
  const [dismissed, setDismissed] = useState(false);

  const shouldShow = useMemo(() => {
    if (onboardingState.completedAt) return false;
    // Derived check: if the user already has office + types + macros + CPT,
    // treat onboarding as already done implicitly.
    const hasOfficeName = officeSettings.officeName.trim().length > 0;
    const hasTypes = appointmentTypes.length > 0;
    const hasMacros = hasMacroInEverySection(macroLibrary.templates);
    const hasCpt = billingMacros.treatments.length > 0;
    if (hasOfficeName && hasTypes && hasMacros && hasCpt) return false;
    return true;
  }, [
    onboardingState.completedAt,
    officeSettings.officeName,
    appointmentTypes.length,
    macroLibrary.templates,
    billingMacros.treatments.length,
  ]);

  if (!shouldShow || dismissed) return null;

  const finish = () => {
    markComplete();
    setDismissed(true);
  };

  const content = () => {
    switch (step) {
      case 1:
        return <Welcome onContinue={() => setStep(2)} />;
      case 2:
        return (
          <OfficeIdentity
            office={officeSettings}
            onContinue={(next) => {
              updateOfficeSettings(next);
              setStep(3);
            }}
          />
        );
      case 3:
        return (
          <AppointmentTypesStep
            existingCount={appointmentTypes.length}
            onAdd={(name, durationMin, color, patientTypes) =>
              addAppointmentType(name, color, durationMin, false, patientTypes)
            }
            onContinue={() => setStep(4)}
          />
        );
      case 4:
        return (
          <MacrosAndChargesStep
            hasEveryMacroSection={hasMacroInEverySection(macroLibrary.templates)}
            macroCount={macroLibrary.templates.length}
            chargeCount={billingMacros.treatments.length}
            onImportStarterPack={() => {
              for (const entry of starterMacroPack) {
                const id = addMacro(entry.section, undefined);
                updateMacro(id, (current) => ({
                  ...current,
                  buttonName: entry.buttonName,
                  body: entry.body,
                }));
              }
            }}
            onAddCharge={(code, name, unitPrice) => {
              addTreatment({
                procedureCode: code,
                name,
                unitPrice,
                modifier: "",
                defaultUnits: 1,
              });
            }}
            onContinue={() => setStep(5)}
          />
        );
      case 5:
        return <TemplatesStep onContinue={() => setStep(6)} />;
      case 6:
        return <Done onFinish={finish} />;
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-8">
      <ScrollLock />
      <div className="panel-card w-full max-w-3xl p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)]">
              Setup · Step {step <= 5 ? step : 5} of 5
            </p>
            <h2 className="text-2xl font-semibold">
              {step <= 5 ? stepTitles[step as Exclude<StepId, 6>] : "You're ready"}
            </h2>
          </div>
          {step > 1 && step <= 5 && (
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold"
              onClick={() => setStep((step - 1) as StepId)}
              type="button"
            >
              Back
            </button>
          )}
        </div>
        <div className="mb-4 flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              className={`h-1.5 flex-1 rounded-full ${
                step > n ? "bg-[var(--brand-primary)]" : step === n ? "bg-[var(--brand-primary)]/60" : "bg-[var(--line-soft)]"
              }`}
              key={`onboarding-step-${n}`}
            />
          ))}
        </div>
        {content()}
      </div>
    </div>
  );
}

function Welcome({ onContinue }: { onContinue: () => void }) {
  return (
    <div>
      <p className="text-base">
        Welcome to Note Goat. This is a chiropractic practice management tool
        that tracks your patients, case workflow, SOAP encounters, billing,
        and document templates — all cloud-synced, all yours.
      </p>
      <p className="mt-3 text-sm text-[var(--text-muted)]">
        The next few screens will set you up with office info, appointment
        types, and SOAP macros so the app is ready to use on your first
        patient. Takes about three minutes.
      </p>
      <div className="mt-6 flex justify-end">
        <button
          className="rounded-xl bg-[var(--brand-primary)] px-5 py-2.5 font-semibold text-white"
          onClick={onContinue}
          type="button"
        >
          Let&apos;s go →
        </button>
      </div>
    </div>
  );
}

function OfficeIdentity({
  office,
  onContinue,
}: {
  office: ReturnType<typeof useOfficeSettings>["officeSettings"];
  onContinue: (patch: Partial<ReturnType<typeof useOfficeSettings>["officeSettings"]>) => void;
}) {
  const [form, setForm] = useState({
    officeName: office.officeName,
    doctorName: office.doctorName,
    phone: office.phone,
    email: office.email,
    address: office.address,
  });
  const canContinue = form.officeName.trim().length > 0;

  return (
    <div>
      <p className="text-sm text-[var(--text-muted)]">
        Your office details appear on printed reports, letters, and SOAP notes.
        You can refine these later in Settings → Office Settings.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm font-semibold">Office name *</span>
          <input
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            onChange={(e) => setForm({ ...form, officeName: e.target.value })}
            value={form.officeName}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-semibold">Doctor name</span>
          <input
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            onChange={(e) => setForm({ ...form, doctorName: e.target.value })}
            value={form.doctorName}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-semibold">Phone</span>
          <input
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            onChange={(e) => setForm({ ...form, phone: formatUsPhoneInput(e.target.value) })}
            value={form.phone}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-semibold">Email</span>
          <input
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            value={form.email}
          />
        </label>
        <div className="grid gap-1 md:col-span-2">
          <span className="text-sm font-semibold">Address</span>
          <AddressFieldGroup
            onChange={(nextAddress) => setForm({ ...form, address: nextAddress })}
            value={form.address}
          />
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <button
          className="rounded-xl bg-[var(--brand-primary)] px-5 py-2.5 font-semibold text-white disabled:opacity-50"
          disabled={!canContinue}
          onClick={() => onContinue(form)}
          type="button"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

function AppointmentTypesStep({
  existingCount,
  onAdd,
  onContinue,
}: {
  existingCount: number;
  onAdd: (
    name: string,
    durationMin: number,
    color: string,
    patientTypes: AppointmentTypePatientTypes,
  ) => boolean;
  onContinue: () => void;
}) {
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(30);
  const [color, setColor] = useState("#73b4e4");
  const [pi, setPi] = useState(true);
  const [cash, setCash] = useState(true);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const added = onAdd(trimmed, duration, color, { pi, cash });
    if (added) {
      setName("");
    }
  };

  return (
    <div>
      <p className="text-sm text-[var(--text-muted)]">
        Common examples: Personal Injury Office Visit, Personal Injury New
        Patient, Cash Office Visit, Re-Exam, Discharge, Spinal Decompression.
        Add at least one to continue — you can add more any time in Settings.
      </p>
      <div className="mt-4 grid gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3 md:grid-cols-[1fr_120px_100px_auto]">
        <input
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Personal Injury Office Visit)"
          value={name}
        />
        <input
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
          onChange={(e) => setDuration(Number(e.target.value) || 30)}
          placeholder="Minutes"
          type="number"
          value={duration}
        />
        <input
          className="h-9 w-full rounded-lg border border-[var(--line-soft)] bg-white p-1"
          onChange={(e) => setColor(e.target.value)}
          type="color"
          value={color}
        />
        <button
          className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-white"
          onClick={submit}
          type="button"
        >
          Add
        </button>
        <div className="col-span-full flex flex-wrap items-center gap-3 text-xs">
          <span className="font-semibold text-[var(--text-muted)]">Applies to:</span>
          <label className="inline-flex items-center gap-1.5">
            <input
              checked={pi}
              onChange={(e) => setPi(e.target.checked)}
              type="checkbox"
            />
            PI
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              checked={cash}
              onChange={(e) => setCash(e.target.checked)}
              type="checkbox"
            />
            Cash
          </label>
        </div>
      </div>
      <p className="mt-3 text-sm">
        {existingCount === 0
          ? "No appointment types yet — add at least one to continue."
          : `${existingCount} appointment type${existingCount === 1 ? "" : "s"} added.`}
      </p>
      <div className="mt-5 flex justify-end">
        <button
          className="rounded-xl bg-[var(--brand-primary)] px-5 py-2.5 font-semibold text-white disabled:opacity-50"
          disabled={existingCount === 0}
          onClick={onContinue}
          type="button"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

function MacrosAndChargesStep({
  hasEveryMacroSection,
  macroCount,
  chargeCount,
  onImportStarterPack,
  onAddCharge,
  onContinue,
}: {
  hasEveryMacroSection: boolean;
  macroCount: number;
  chargeCount: number;
  onImportStarterPack: () => void;
  onAddCharge: (code: string, name: string, unitPrice: number) => void;
  onContinue: () => void;
}) {
  const [cptCode, setCptCode] = useState("");
  const [cptName, setCptName] = useState("");
  const [cptPrice, setCptPrice] = useState<number>(0);
  const canContinue = hasEveryMacroSection && chargeCount > 0;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold">What&apos;s a macro?</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Macros are pre-written SOAP text. You click one, it types itself.
          You customize the answers. We recommend at least one per SOAP
          section (S / O / A / P) so your encounter notes always have a
          starting point.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-4">
        <p className="text-sm font-semibold">Starter pack (7 generic macros)</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          One click imports Pain Intake, Cervical Pain, Vitals, Cervical Exam,
          Progress, Standard Visit, and Referral. All editable afterward.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            className="rounded-xl bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-white"
            onClick={onImportStarterPack}
            type="button"
          >
            Import Starter Pack
          </button>
          <Link
            className="text-sm font-semibold text-[var(--brand-primary)] underline"
            href="/settings?section=soapMacros"
          >
            Or start from scratch in Settings →
          </Link>
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {macroCount === 0
            ? "No macros yet."
            : `${macroCount} macro${macroCount === 1 ? "" : "s"} in your library.`}
          {hasEveryMacroSection
            ? " · All 4 sections covered ✓"
            : " · Need at least one macro per S/O/A/P section."}
        </p>
      </div>

      <div>
        <h3 className="text-lg font-semibold">Billing charges (CPT codes)</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Add at least one CPT code so encounter charges can be tracked.
        </p>
        <div className="mt-2 grid gap-2 rounded-xl border border-[var(--line-soft)] bg-white p-3 md:grid-cols-[120px_1fr_120px_auto]">
          <input
            className="rounded-lg border border-[var(--line-soft)] px-2 py-1.5 text-sm"
            onChange={(e) => setCptCode(e.target.value.toUpperCase())}
            placeholder="Code (97110)"
            value={cptCode}
          />
          <input
            className="rounded-lg border border-[var(--line-soft)] px-2 py-1.5 text-sm"
            onChange={(e) => setCptName(e.target.value)}
            placeholder="Description (Therapeutic Exercise)"
            value={cptName}
          />
          <input
            className="rounded-lg border border-[var(--line-soft)] px-2 py-1.5 text-sm"
            inputMode="decimal"
            onChange={(e) => setCptPrice(Number(e.target.value) || 0)}
            placeholder="Unit $"
            type="number"
            value={cptPrice || ""}
          />
          <button
            className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-white"
            onClick={() => {
              if (!cptCode.trim() || !cptName.trim() || cptPrice <= 0) return;
              onAddCharge(cptCode.trim(), cptName.trim(), cptPrice);
              setCptCode("");
              setCptName("");
              setCptPrice(0);
            }}
            type="button"
          >
            Add
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {chargeCount} charge{chargeCount === 1 ? "" : "s"} added.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--text-muted)]">
          {canContinue
            ? "All set — click Continue."
            : "Need at least one macro per S/O/A/P section and one CPT charge."}
        </p>
        <button
          className="rounded-xl bg-[var(--brand-primary)] px-5 py-2.5 font-semibold text-white disabled:opacity-50"
          disabled={!canContinue}
          onClick={onContinue}
          type="button"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

function TemplatesStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-muted)]">
        These are optional — set them up now or skip and come back later via
        Settings.
      </p>
      <ul className="space-y-2">
        {[
          {
            title: "Report templates",
            desc: "Custom long-form narrative reports with merge fields.",
            href: "/settings?section=reports",
          },
          {
            title: "Letter templates",
            desc: "Work notes, school notes, specialist referrals, imaging requests.",
            href: "/settings?section=documents",
          },
          {
            title: "SMS / Text templates",
            desc: "Birthday, reminder, follow-up texts sent via Messages.app.",
            href: "/settings?section=smsTemplates",
          },
          {
            title: "Contacts",
            desc: "Attorneys, imaging centers, specialists, orthopedic surgeons.",
            href: "/settings?section=contactCategories",
          },
          {
            title: "Case statuses",
            desc: "Customize the pipeline names/colors for your workflow.",
            href: "/settings?section=caseStatuses",
          },
        ].map((item) => (
          <li
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2.5"
            key={item.title}
          >
            <div className="min-w-0">
              <p className="font-semibold">{item.title}</p>
              <p className="text-xs text-[var(--text-muted)]">{item.desc}</p>
            </div>
            <Link
              className="rounded-lg border border-[var(--line-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-primary)]"
              href={item.href}
            >
              Set up now
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3">
        <button
          className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold"
          onClick={onContinue}
          type="button"
        >
          Skip for now →
        </button>
        <button
          className="rounded-xl bg-[var(--brand-primary)] px-5 py-2.5 font-semibold text-white"
          onClick={onContinue}
          type="button"
        >
          I&apos;ve done what I need →
        </button>
      </div>
    </div>
  );
}

function Done({ onFinish }: { onFinish: () => void }) {
  return (
    <div>
      <p className="text-base">
        You&apos;re ready. Note Goat is configured — everything else is
        refinable from Settings at your own pace.
      </p>
      <div className="mt-5 grid gap-2 md:grid-cols-3">
        <Link
          className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-3 text-center font-semibold"
          href="/patients"
          onClick={onFinish}
        >
          Create your first patient
        </Link>
        <Link
          className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-3 text-center font-semibold"
          href="/appointments"
          onClick={onFinish}
        >
          Go to Schedule
        </Link>
        <Link
          className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-3 text-center font-semibold"
          href="/settings"
          onClick={onFinish}
        >
          Explore more settings
        </Link>
      </div>
    </div>
  );
}
