"use client";

import { useMemo, useState, type Ref } from "react";
import {
  ATTORNEY_CUSTOM_LABEL,
  ATTORNEY_CUSTOM_VALUE,
  ATTORNEY_PLACEHOLDER,
  SELF_ATTORNEY_LABEL,
  SELF_ATTORNEY_VALUE,
  attorneyFirmOptions,
  attorneySelectValue,
  isCustomAttorneyEntry,
  isSelfRepresentedAttorney,
  resolveAttorneyPick,
  type AttorneyPick,
} from "@/lib/attorney-picker";

const fieldClass = "w-full min-w-0 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2";

/**
 * Office attorney dropdown. Placeholder first, SELF under it, firms A–Z
 * (a leading "The " is ignored), and "Type a new attorney…" last.
 * Picking SELF reports the SELF value and an empty phone — it does not
 * describe a contact.
 */
export function AttorneyFirmSelect({
  attorneys,
  attorney,
  onSelect,
  onCustomName,
  onCustomBlur,
  selectTestId = "attorney-firm-select",
  nameTestId = "attorney-firm-name",
  nameInputRef,
}: {
  attorneys: Array<{ id: string; name: string; phone?: string }>;
  attorney: string;
  onSelect: (choice: AttorneyPick) => void;
  onCustomName: (name: string) => void;
  onCustomBlur?: (name: string) => void;
  selectTestId?: string;
  nameTestId?: string;
  nameInputRef?: Ref<HTMLInputElement>;
}) {
  const firms = useMemo(() => attorneyFirmOptions(attorneys), [attorneys]);
  // True after "Type a new attorney…" so the name box stays up before any
  // text is entered. A name that already isn't in the list opens that way.
  const [forcedCustom, setForcedCustom] = useState(false);
  const typingNew = forcedCustom || isCustomAttorneyEntry(attorney, firms);
  const selected = attorneySelectValue(attorney, firms, typingNew);

  return (
    <div className="grid gap-1">
      <select
        className={fieldClass}
        data-testid={selectTestId}
        onChange={(event) => {
          const choice = resolveAttorneyPick(event.target.value, firms);
          setForcedCustom(choice.type === "custom");
          onSelect(choice);
        }}
        value={selected}
      >
        <option value="">{ATTORNEY_PLACEHOLDER}</option>
        <option value={SELF_ATTORNEY_VALUE}>{SELF_ATTORNEY_LABEL}</option>
        {firms.map((firm) => (
          <option key={firm.id} value={firm.name}>
            {firm.name}
          </option>
        ))}
        <option value={ATTORNEY_CUSTOM_VALUE}>{ATTORNEY_CUSTOM_LABEL}</option>
      </select>
      {typingNew && (
        <>
          <span className="text-sm font-semibold text-[var(--text-muted)]">Attorney name</span>
          <input
            aria-label="Attorney name"
            className={fieldClass}
            data-testid={nameTestId}
            onBlur={(event) => onCustomBlur?.(event.target.value)}
            onChange={(event) => {
              const next = event.target.value;
              if (isSelfRepresentedAttorney(next)) {
                setForcedCustom(false);
                onSelect({ type: "self" });
                return;
              }
              onCustomName(next);
            }}
            placeholder="Law firm"
            ref={nameInputRef}
            value={attorney}
          />
        </>
      )}
    </div>
  );
}
