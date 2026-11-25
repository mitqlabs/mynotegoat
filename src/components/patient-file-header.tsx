"use client";

import Link from "next/link";
import { ageOn } from "@/lib/age";
import { PatientCaseHeaderFields, type PatientPersonDraft } from "@/components/patient-person-fields";

type Crumb = { id: string; name: string };

/**
 * Patient file header: photo, name with age, alert under the name,
 * then the person fields in three tight rows.
 */
export function PatientFileHeader({
  folderCrumb,
  name,
  photoSrc,
  person,
  onPersonChange,
  onTextRemindersOff,
  onAddToContacts,
  alerts,
  onRemoveAlert,
  alertDraft,
  onAlertDraftChange,
  onAddAlert,
}: {
  folderCrumb: Crumb | null;
  name: string;
  photoSrc?: string;
  person: PatientPersonDraft;
  onPersonChange: (next: PatientPersonDraft) => void;
  onTextRemindersOff?: (off: boolean) => void;
  onAddToContacts?: () => void;
  alerts: string[];
  onRemoveAlert: (index: number) => void;
  alertDraft: string;
  onAlertDraftChange: (value: string) => void;
  onAddAlert: (text: string) => void;
}) {
  const age = ageOn(person.dob);
  const commitAlert = () => {
    const text = alertDraft.trim().toUpperCase();
    if (!text) return;
    onAddAlert(text);
    onAlertDraftChange("");
  };

  return (
    <div className="case-header">
      {photoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="case-header-photo rounded-xl object-cover" src={photoSrc} />
      ) : null}
      <div className="case-header-name min-w-0">
        <p className="text-sm text-[var(--text-muted)]">
          {folderCrumb ? (
            <>
              <Link href="/patients" className="underline">
                Patients
              </Link>
              {" / "}
              <Link href={`/patients/${folderCrumb.id}`} className="underline">
                {folderCrumb.name}
              </Link>
              {" / Case"}
            </>
          ) : (
            <>
              <Link href="/patients" className="underline">
                Patients
              </Link>{" "}
              / Patient File
            </>
          )}
        </p>
        <h2 className="text-2xl font-semibold text-[var(--text-main)]">
          {name}
          {age !== null && (
            <span className="whitespace-nowrap tabular-nums" data-patient-age>
              {" · "}
              {age}
            </span>
          )}
        </h2>
      </div>
      <div className="case-header-alerts min-w-0">
        {alerts.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {alerts.map((alert, index) => (
              <span
                className="tone-warn inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-bold"
                key={`alert-${index}`}
              >
                ⚠ {alert}
                <button
                  className="ml-0.5 rounded-full text-[var(--text-muted)] transition hover:text-[var(--status-alert)]"
                  onClick={() => onRemoveAlert(index)}
                  title="Remove alert"
                  type="button"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg border border-[var(--line-soft)] bg-[var(--field-bg)] px-3 py-1.5 text-sm text-[var(--text-main)]"
            onChange={(event) => onAlertDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitAlert();
              }
            }}
            placeholder="Add Patient Alert (Ex: Hx of Cancer, Broken Rib, etc.)"
            value={alertDraft}
          />
          <button className="btn btn-secondary btn-sm shrink-0" onClick={commitAlert} type="button">
            + Alert
          </button>
        </div>
      </div>
      <div className="case-header-info min-w-0" data-patient-demographics>
        <PatientCaseHeaderFields
          onAddToContacts={onAddToContacts}
          onChange={onPersonChange}
          onTextRemindersOff={onTextRemindersOff}
          value={person}
        />
      </div>
    </div>
  );
}
