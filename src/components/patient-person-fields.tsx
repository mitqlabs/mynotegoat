"use client";

import { AddressFieldGroup } from "@/components/address-field-group";
import { SmsSendMenu } from "@/components/sms-send-menu";
import { ageOn } from "@/lib/age";
import { maritalStatusOptions, type MaritalStatus } from "@/lib/marital-status";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { downloadVCard } from "@/lib/vcard";

export type PatientSexValue = "" | "Male" | "Female" | "Other";

/** Person fields the case page edits. Case-only fields are not included. */
export type PatientPersonDraft = {
  firstName: string;
  lastName: string;
  dob: string;
  phone: string;
  sex: PatientSexValue;
  maritalStatus: MaritalStatus | "";
  email: string;
  address: string;
  textRemindersOff: boolean;
};

export function formatUsDateInput(rawValue: string) {
  const digits = rawValue.replace(/\D/g, "").slice(0, 8);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function isoToUsDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-");
    return `${month}/${day}/${year}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(trimmed)) {
    const [month, day, year2] = trimmed.split("/");
    return `${month}/${day}/20${year2}`;
  }
  return formatUsDateInput(trimmed);
}

export function usDateToIso(value: string) {
  const formatted = isoToUsDate(value);
  const match = formatted.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type IdentityProps = {
  value: PatientPersonDraft;
  onChange: (next: PatientPersonDraft) => void;
  /** Case page saves the reminder flag immediately. Folder save sends it with the rest. */
  onTextRemindersOff?: (off: boolean) => void;
  /** Case page includes the case number on the contact card. */
  onAddToContacts?: () => void;
  emailClassName?: string;
};

/**
 * Last name, first name, DOB, phone (text + contacts icons and the reminder
 * checkbox), sex, marital status, and email. Rendered as a fragment so the
 * folder page can keep these cells in its own grid.
 */
export function PatientIdentityFields({
  value,
  onChange,
  onTextRemindersOff,
  onAddToContacts,
  emailClassName,
}: IdentityProps) {
  const set = (patch: Partial<PatientPersonDraft>) => onChange({ ...value, ...patch });
  const phoneDigits = value.phone.replace(/\D/g, "");
  return (
    <>
      <label className="grid gap-1">
        <span className="text-sm font-semibold text-[var(--text-muted)]">Patient Last Name</span>
        <input
          className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
          onChange={(event) => set({ lastName: event.target.value })}
          value={value.lastName}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-semibold text-[var(--text-muted)]">Patient First Name</span>
        <input
          className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
          onChange={(event) => set({ firstName: event.target.value })}
          value={value.firstName}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-semibold text-[var(--text-muted)]">Patient DOB</span>
        <input
          className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
          inputMode="numeric"
          maxLength={10}
          onChange={(event) => set({ dob: formatUsDateInput(event.target.value) })}
          placeholder="MM/DD/YYYY"
          value={value.dob}
        />
      </label>
      <div className="grid gap-1">
        <span className="text-sm font-semibold text-[var(--text-muted)]">Patient Phone</span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-[9.5rem] flex-1 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
            inputMode="numeric"
            maxLength={12}
            onChange={(event) => set({ phone: formatUsPhoneInput(event.target.value) })}
            value={value.phone}
          />
          <span className="inline-flex shrink-0 items-center gap-2">
            {phoneDigits.length > 0 && (
              <SmsSendMenu
                align="right"
                ariaLabel="Text this patient"
                className="flex h-[42px] w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--line-soft)] bg-white text-[var(--brand-primary)] hover:bg-[var(--bg-soft)]"
                context={{
                  patient: {
                    firstName: value.firstName,
                    lastName: value.lastName,
                    fullName: [value.firstName, value.lastName].filter(Boolean).join(" "),
                  },
                }}
                label={
                  <svg aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z" strokeLinejoin="round" />
                  </svg>
                }
                phone={value.phone}
              />
            )}
            <button
              aria-label="Add to Contacts"
              className="flex h-[42px] w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--line-soft)] bg-white text-[var(--brand-primary)] hover:bg-[var(--bg-soft)]"
              onClick={() => {
                if (onAddToContacts) {
                  onAddToContacts();
                  return;
                }
                downloadVCard({
                  firstName: value.firstName,
                  lastName: value.lastName,
                  phone: value.phone,
                  email: value.email,
                  dob: value.dob,
                  address: value.address,
                });
              }}
              title="Add to Contacts (downloads a .vcf — macOS opens it in Contacts with name, phone, birthday and address pre-filled)"
              type="button"
            >
              <svg aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <circle cx="10" cy="8" r="3.5" />
                <path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        </div>
        {phoneDigits.length > 0 && (
          <label
            className="inline-flex w-fit items-center gap-1.5 text-xs leading-4 font-semibold text-[var(--text-muted)]"
            title="Stops appointment reminder texts for this patient. Their number still works for texts you send by hand."
          >
            <input
              checked={value.textRemindersOff}
              onChange={(event) => {
                const off = event.target.checked;
                set({ textRemindersOff: off });
                onTextRemindersOff?.(off);
              }}
              type="checkbox"
            />
            No reminder texts
          </label>
        )}
      </div>
      <label className="grid gap-1">
        <span className="text-sm font-semibold text-[var(--text-muted)]">Sex</span>
        <select
          className="w-full min-w-0 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
          onChange={(event) => set({ sex: event.target.value as PatientSexValue })}
          value={value.sex}
        >
          <option value="">—</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
          {value.sex === "Other" && <option value="Other">Other</option>}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-semibold text-[var(--text-muted)]">Marital Status</span>
        <select
          className="w-full min-w-0 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
          onChange={(event) => set({ maritalStatus: event.target.value as MaritalStatus | "" })}
          value={value.maritalStatus}
        >
          <option value="">—</option>
          {maritalStatusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
          {value.maritalStatus === "Other" && <option value="Other">Other</option>}
        </select>
      </label>
      <label className={`grid gap-1 ${emailClassName ?? ""}`}>
        <span className="text-sm font-semibold text-[var(--text-muted)]">Patient Email</span>
        <input
          className="min-w-0 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
          onChange={(event) => set({ email: event.target.value })}
          type="email"
          value={value.email}
        />
      </label>
    </>
  );
}

export function PatientAddressFields({
  address,
  onChange,
  className,
}: {
  address: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="text-sm font-semibold text-[var(--text-muted)]">Patient Address</span>
      <div className="mt-1">
        <AddressFieldGroup onChange={onChange} value={address} />
      </div>
    </div>
  );
}

const caseLabel = "text-sm font-semibold leading-4 text-[var(--text-muted)]";
const caseInput =
  "min-w-0 w-full rounded-xl border border-[var(--line-soft)] bg-[var(--field-bg)] px-3 py-1.5 text-[var(--text-main)]";
const caseIconBtn =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--line-soft)] bg-[var(--bg-panel)] text-[var(--brand-primary)] hover:bg-[var(--bg-soft)]";

/**
 * Case file header: three tight rows.
 * 1. Last name, first name, DOB with age beside the date.
 * 2. Phone (icons + reminder checkbox), sex, marital status.
 * 3. Email and the address parts on one wrapping line.
 */
export function PatientCaseHeaderFields({
  value,
  onChange,
  onTextRemindersOff,
  onAddToContacts,
}: Omit<IdentityProps, "emailClassName">) {
  const set = (patch: Partial<PatientPersonDraft>) => onChange({ ...value, ...patch });
  const phoneDigits = value.phone.replace(/\D/g, "");
  const age = ageOn(value.dob);
  return (
    <div className="grid gap-y-2">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 sm:grid-cols-3">
        <label className="grid min-w-0 gap-0.5">
          <span className={caseLabel}>Last Name</span>
          <input className={caseInput} onChange={(event) => set({ lastName: event.target.value })} value={value.lastName} />
        </label>
        <label className="grid min-w-0 gap-0.5">
          <span className={caseLabel}>First Name</span>
          <input className={caseInput} onChange={(event) => set({ firstName: event.target.value })} value={value.firstName} />
        </label>
        <label className="col-span-2 grid min-w-0 gap-0.5 sm:col-span-1">
          <span className={caseLabel}>DOB</span>
          <span className="flex min-w-0 items-center gap-2">
            <input
              className={`${caseInput} flex-1`}
              inputMode="numeric"
              maxLength={10}
              onChange={(event) => set({ dob: formatUsDateInput(event.target.value) })}
              placeholder="MM/DD/YYYY"
              value={value.dob}
            />
            {age !== null && (
              <span className="shrink-0 text-base font-bold tabular-nums text-[var(--text-main)]" data-dob-age>
                Age {age}
              </span>
            )}
          </span>
        </label>
      </div>
      <div className="grid grid-cols-2 items-end gap-x-2 gap-y-1.5 min-[720px]:grid-cols-[minmax(0,1.55fr)_minmax(6.25rem,0.7fr)_minmax(8rem,0.85fr)]">
        <div className="col-span-2 grid min-w-0 gap-0.5 min-[720px]:col-span-1">
          <span className={caseLabel}>Phone</span>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <input
              className="min-w-[7.5rem] flex-1 rounded-xl border border-[var(--line-soft)] bg-[var(--field-bg)] px-3 py-1.5 text-[var(--text-main)]"
              inputMode="numeric"
              maxLength={12}
              onChange={(event) => set({ phone: formatUsPhoneInput(event.target.value) })}
              value={value.phone}
            />
            <span className="inline-flex shrink-0 items-center gap-1.5">
              {phoneDigits.length > 0 && (
                <SmsSendMenu
                  align="right"
                  ariaLabel="Text this patient"
                  className={caseIconBtn}
                  context={{
                    patient: {
                      firstName: value.firstName,
                      lastName: value.lastName,
                      fullName: [value.firstName, value.lastName].filter(Boolean).join(" "),
                    },
                  }}
                  label={
                    <svg aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z" strokeLinejoin="round" />
                    </svg>
                  }
                  phone={value.phone}
                />
              )}
              <button
                aria-label="Add to Contacts"
                className={caseIconBtn}
                onClick={() => {
                  if (onAddToContacts) {
                    onAddToContacts();
                    return;
                  }
                  downloadVCard({
                    firstName: value.firstName,
                    lastName: value.lastName,
                    phone: value.phone,
                    email: value.email,
                    dob: value.dob,
                    address: value.address,
                  });
                }}
                title="Add to Contacts (downloads a .vcf — macOS opens it in Contacts with name, phone, birthday and address pre-filled)"
                type="button"
              >
                <svg aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <circle cx="10" cy="8" r="3.5" />
                  <path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" strokeLinecap="round" />
                </svg>
              </button>
            </span>
            {phoneDigits.length > 0 && (
              <label
                className="inline-flex shrink-0 items-center gap-1.5 text-xs leading-4 font-semibold text-[var(--text-muted)]"
                title="Stops appointment reminder texts for this patient. Their number still works for texts you send by hand."
              >
                <input
                  checked={value.textRemindersOff}
                  onChange={(event) => {
                    const off = event.target.checked;
                    set({ textRemindersOff: off });
                    onTextRemindersOff?.(off);
                  }}
                  type="checkbox"
                />
                No reminder texts
              </label>
            )}
          </div>
        </div>
        <label className="grid min-w-0 gap-0.5">
          <span className={caseLabel}>Sex</span>
          <select
            className={caseInput}
            onChange={(event) => set({ sex: event.target.value as PatientSexValue })}
            value={value.sex}
          >
            <option value="">—</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            {value.sex === "Other" && <option value="Other">Other</option>}
          </select>
        </label>
        <label className="grid min-w-0 gap-0.5">
          <span className={caseLabel}>Marital Status</span>
          <select
            className={caseInput}
            onChange={(event) => set({ maritalStatus: event.target.value as MaritalStatus | "" })}
            value={value.maritalStatus}
          >
            <option value="">—</option>
            {maritalStatusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
            {value.maritalStatus === "Other" && <option value="Other">Other</option>}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-x-2 gap-y-1.5">
        <label className="grid min-w-[12rem] flex-[1_1_14rem] gap-0.5">
          <span className={caseLabel}>Email</span>
          <input
            className={caseInput}
            onChange={(event) => set({ email: event.target.value })}
            type="email"
            value={value.email}
          />
        </label>
        <AddressFieldGroup
          embedded
          onChange={(address) => set({ address })}
          tight
          value={value.address}
        />
      </div>
    </div>
  );
}

/** Folder Patient Info: the same person fields, with no case columns beside them. */
export function PatientPersonFields({
  value,
  onChange,
}: {
  value: PatientPersonDraft;
  onChange: (next: PatientPersonDraft) => void;
}) {
  return (
    <div className="grid items-start gap-3 sm:grid-cols-2">
      <PatientIdentityFields emailClassName="sm:col-span-2" onChange={onChange} value={value} />
      <PatientAddressFields
        address={value.address}
        className="sm:col-span-2"
        onChange={(address) => onChange({ ...value, address })}
      />
    </div>
  );
}
