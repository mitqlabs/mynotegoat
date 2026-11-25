"use client";

import { useId, useState, type ReactNode } from "react";
import { NumberInput } from "@/components/number-input";
import type { DashboardWorkspaceSettings, MriAppearMode, SpecialistAppearWhen } from "@/lib/dashboard-workspace-settings";
import type { PriorityCaseRules } from "@/lib/priority-cases";
import {
  MRI_CLEAR_CHOICES,
  SPECIALIST_CLEAR_CHOICES,
  XRAY_CLEAR_CHOICES,
  lienRowSummary,
  mriRowSummary,
  specialistRowSummary,
  xrayRowSummary,
} from "@/lib/reminder-settings-summary";

/**
 * Reminders settings layout. Every control calls the same setters the
 * page used before, and those setters still write the cloud copy.
 */
type FollowUp = DashboardWorkspaceSettings["patientFollowUp"];

type Choice = readonly [string, string];

export type ReminderSettingsPanelProps = {
  openOnly: boolean;
  onOpenOnlyChange: (enabled: boolean) => void;
  caseFlowEnabled: boolean;
  onCaseFlowEnabledChange: (enabled: boolean) => void;
  followUp: FollowUp;
  lienLabel: string;
  caseStatusNames: string[];
  lienClearOptions: string[];
  priorityRules: PriorityCaseRules;
  onIncludeXray: (enabled: boolean) => void;
  onIncludeMri: (enabled: boolean) => void;
  onIncludeSpecialist: (enabled: boolean) => void;
  onIncludeLien: (enabled: boolean) => void;
  onXrayAppearAuto: (enabled: boolean) => void;
  onMriAppearMode: (mode: MriAppearMode) => void;
  onMriAppearDays: (days: number) => void;
  onMriNoScheduleWarningDays: (days: number) => void;
  onSpecialistAppearWhen: (value: SpecialistAppearWhen) => void;
  onSpecialistNoScheduleWarningDays: (days: number) => void;
  onToggleXrayClearedBy: (condition: "patientRefused" | "completedPriorCare" | "noXray", enabled: boolean) => void;
  onToggleMriClearedBy: (condition: "patientRefused" | "completedPriorCare" | "noMri", enabled: boolean) => void;
  onToggleSpecialistClearedBy: (condition: "patientRefused" | "completedPriorCare" | "report" | "noPm", enabled: boolean) => void;
  onXrayClearStatuses: (names: string[]) => void;
  onMriClearStatuses: (names: string[]) => void;
  onSpecialistClearStatuses: (names: string[]) => void;
  onLienClearStatuses: (names: string[]) => void;
  onStaleDays: (days: number) => void;
  onMaxCaseFlowRows: (count: number) => void;
  onIncludeNoUpdate: (enabled: boolean) => void;
  onNoUpdateDays: (days: number) => void;
  onIncludePaymentStatus: (enabled: boolean) => void;
  onPaymentStatusDays: (days: number) => void;
  onMaxAlertItems: (count: number) => void;
};

type OpenKey = "xray" | "mri" | "specialist" | "lien";

const SPECIALIST_APPEAR: { value: SpecialistAppearWhen; label: string }[] = [
  { value: "auto", label: "Auto (on case creation)" },
  { value: "mri_sent", label: "After MRI Sent" },
  { value: "mri_completed", label: "After MRI Completed" },
  { value: "mri_reviewed", label: "Once MRI Reviewed" },
];

const fieldClass = "w-20 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-base";

function EnableSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
        checked ? "border-[var(--text-main)] bg-[var(--text-main)]" : "border-[var(--line-soft)] bg-[var(--bg-panel)]"
      }`}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={`inline-block h-5 w-5 rounded-full shadow transition-transform ${
          checked ? "translate-x-5 bg-[var(--bg-panel)]" : "translate-x-0.5 bg-[var(--text-muted)]"
        }`}
      />
    </button>
  );
}

function ClearChips({
  choices,
  selectedConditions,
  statusNames,
  selectedStatuses,
  onToggleCondition,
  onToggleStatus,
}: {
  choices: readonly Choice[];
  selectedConditions: readonly string[];
  statusNames: readonly string[];
  selectedStatuses: readonly string[];
  onToggleCondition: (value: string, enabled: boolean) => void;
  onToggleStatus: (name: string, enabled: boolean) => void;
}) {
  const chips: { key: string; label: string; selected: boolean; onToggle: (enabled: boolean) => void }[] = [
    ...choices.map(([value, label]) => ({
      key: `c-${value}`,
      label,
      selected: selectedConditions.includes(value),
      onToggle: (enabled: boolean) => onToggleCondition(value, enabled),
    })),
    ...statusNames.map((name) => ({
      key: `s-${name}`,
      label: name,
      selected: selectedStatuses.includes(name),
      onToggle: (enabled: boolean) => onToggleStatus(name, enabled),
    })),
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <button
          aria-pressed={chip.selected}
          className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
            chip.selected
              ? "border-[var(--text-main)] text-[var(--text-main)]"
              : "border-[var(--line-soft)] text-[var(--text-main)]"
          }`}
          key={chip.key}
          onClick={() => chip.onToggle(!chip.selected)}
          type="button"
        >
          {chip.selected ? "✓ " : ""}
          {chip.label}
        </button>
      ))}
    </div>
  );
}

function toggleStatusList(current: readonly string[], name: string, enabled: boolean) {
  return enabled ? [...current, name] : current.filter((entry) => entry !== name);
}

export function ReminderSettingsPanel(props: ReminderSettingsPanelProps) {
  const {
    followUp,
    caseStatusNames,
    priorityRules,
    lienLabel,
  } = props;
  const [openKey, setOpenKey] = useState<OpenKey | null>(null);
  const baseId = useId();
  const toggleOpen = (key: OpenKey) => setOpenKey((current) => (current === key ? null : key));

  return (
    <div className="w-full min-w-0 max-w-full space-y-4">
      <div className="divide-y divide-[var(--line-soft)] overflow-hidden rounded-xl border border-[var(--line-soft)]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <span className="text-base font-semibold">To Do</span>
          <label className="inline-flex items-center gap-2 text-base font-medium">
            <input
              checked={props.openOnly}
              className="h-4 w-4"
              onChange={(event) => props.onOpenOnlyChange(event.target.checked)}
              type="checkbox"
            />
            Default to Open tasks only
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <span className="text-base font-semibold">Case Flow</span>
          <span className="inline-flex items-center gap-2 text-base font-medium">
            <EnableSwitch
              checked={props.caseFlowEnabled}
              label="Enable Case Flow"
              onChange={props.onCaseFlowEnabledChange}
            />
            Enable Case Flow
          </span>
        </div>

        <CategoryRow
          enabled={followUp.includeXray}
          name="X-Ray"
          onEnabled={props.onIncludeXray}
          onToggle={() => toggleOpen("xray")}
          open={openKey === "xray"}
          panelId={`${baseId}-xray`}
          summary={xrayRowSummary(followUp, caseStatusNames)}
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Appear</legend>
            <label className="inline-flex items-center gap-2 text-base font-medium">
              <input
                checked={followUp.xrayAppearAuto}
                onChange={(event) => props.onXrayAppearAuto(event.target.checked)}
                type="checkbox"
              />
              Auto (on case creation)
            </label>
          </fieldset>
          <ClearWhen
            choices={XRAY_CLEAR_CHOICES}
            onToggleCondition={(value, enabled) =>
              props.onToggleXrayClearedBy(value as "patientRefused" | "completedPriorCare" | "noXray", enabled)
            }
            onToggleStatus={(name, enabled) =>
              props.onXrayClearStatuses(toggleStatusList(followUp.xrayClearStatuses, name, enabled))
            }
            selectedConditions={followUp.xrayClearedBy}
            selectedStatuses={followUp.xrayClearStatuses}
            statusNames={caseStatusNames}
          />
        </CategoryRow>

        <CategoryRow
          enabled={followUp.includeMriCt}
          name="MRI / CT"
          onEnabled={props.onIncludeMri}
          onToggle={() => toggleOpen("mri")}
          open={openKey === "mri"}
          panelId={`${baseId}-mri`}
          summary={mriRowSummary(followUp, caseStatusNames)}
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Appear</legend>
            <label className="inline-flex items-center gap-2 text-base font-medium">
              <input
                checked={followUp.mriAppearMode === "auto"}
                name={`${baseId}-mri-appear`}
                onChange={() => props.onMriAppearMode("auto")}
                type="radio"
              />
              Auto (on case creation)
            </label>
            <div className="flex flex-wrap items-center gap-2 text-base">
              <label className="inline-flex items-center gap-2 font-medium">
                <input
                  checked={followUp.mriAppearMode === "days_from_initial"}
                  name={`${baseId}-mri-appear`}
                  onChange={() => props.onMriAppearMode("days_from_initial")}
                  type="radio"
                />
                After
              </label>
              <NumberInput
                className={fieldClass}
                disabled={followUp.mriAppearMode !== "days_from_initial"}
                fallback={1}
                min={1}
                onChange={props.onMriAppearDays}
                value={followUp.mriAppearDays}
              />
              <span>days from initial</span>
            </div>
          </fieldset>
          <GracePeriod days={followUp.mriNoScheduleWarningDays} onChange={props.onMriNoScheduleWarningDays} />
          <ClearWhen
            choices={MRI_CLEAR_CHOICES}
            onToggleCondition={(value, enabled) =>
              props.onToggleMriClearedBy(value as "patientRefused" | "completedPriorCare" | "noMri", enabled)
            }
            onToggleStatus={(name, enabled) =>
              props.onMriClearStatuses(toggleStatusList(followUp.mriCtClearStatuses, name, enabled))
            }
            selectedConditions={followUp.mriCtClearedBy}
            selectedStatuses={followUp.mriCtClearStatuses}
            statusNames={caseStatusNames}
          />
        </CategoryRow>

        <CategoryRow
          enabled={followUp.includeSpecialist}
          name="Specialist"
          onEnabled={props.onIncludeSpecialist}
          onToggle={() => toggleOpen("specialist")}
          open={openKey === "specialist"}
          panelId={`${baseId}-specialist`}
          summary={specialistRowSummary(followUp, caseStatusNames)}
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Appear</legend>
            {SPECIALIST_APPEAR.map((option) => (
              <label className="flex items-center gap-2 text-base font-medium" key={option.value}>
                <input
                  checked={followUp.specialistAppearWhen === option.value}
                  name={`${baseId}-specialist-appear`}
                  onChange={() => props.onSpecialistAppearWhen(option.value)}
                  type="radio"
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <GracePeriod
            days={followUp.specialistNoScheduleWarningDays}
            onChange={props.onSpecialistNoScheduleWarningDays}
          />
          <ClearWhen
            choices={SPECIALIST_CLEAR_CHOICES}
            onToggleCondition={(value, enabled) =>
              props.onToggleSpecialistClearedBy(
                value as "patientRefused" | "completedPriorCare" | "report" | "noPm",
                enabled,
              )
            }
            onToggleStatus={(name, enabled) =>
              props.onSpecialistClearStatuses(toggleStatusList(followUp.specialistClearStatuses, name, enabled))
            }
            selectedConditions={followUp.specialistClearedBy}
            selectedStatuses={followUp.specialistClearStatuses}
            statusNames={caseStatusNames}
          />
        </CategoryRow>

        <CategoryRow
          enabled={followUp.includeLienLop}
          name={lienLabel}
          onEnabled={props.onIncludeLien}
          onToggle={() => toggleOpen("lien")}
          open={openKey === "lien"}
          panelId={`${baseId}-lien`}
          summary={lienRowSummary(followUp)}
        >
          <label className="grid max-w-xs gap-1.5">
            <span className="text-sm font-semibold">Cleared when status is</span>
            <select
              className="w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-base"
              onChange={(event) => {
                const selected = event.target.value;
                if (selected) props.onLienClearStatuses([selected]);
              }}
              value={followUp.lienLopClearStatuses[0] ?? ""}
            >
              {props.lienClearOptions.map((statusName) => (
                <option key={statusName} value={statusName}>
                  {statusName}
                </option>
              ))}
            </select>
          </label>
        </CategoryRow>
      </div>

      <div className="rounded-xl border border-[var(--line-soft)] px-4 py-4">
        <h4 className="text-base font-semibold">General</h4>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold">Stale after (days)</span>
            <NumberInput
              className={fieldClass}
              fallback={1}
              min={1}
              onChange={props.onStaleDays}
              value={followUp.staleDaysThreshold}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold">Max Case Flow rows</span>
            <NumberInput
              className={fieldClass}
              fallback={1}
              min={1}
              onChange={props.onMaxCaseFlowRows}
              value={followUp.maxItems}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold">Max alert items</span>
            <NumberInput
              className={fieldClass}
              fallback={1}
              min={1}
              onChange={props.onMaxAlertItems}
              value={priorityRules.maxItems}
            />
          </label>
        </div>
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-base">
            <label className="inline-flex items-center gap-2 font-medium">
              <input
                checked={priorityRules.includeNoUpdate}
                onChange={(event) => props.onIncludeNoUpdate(event.target.checked)}
                type="checkbox"
              />
              No Update alert after
            </label>
            <NumberInput
              className={fieldClass}
              disabled={!priorityRules.includeNoUpdate}
              fallback={1}
              min={1}
              onChange={props.onNoUpdateDays}
              value={priorityRules.noUpdateDaysThreshold}
            />
            <span>days</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-base">
            <label className="inline-flex items-center gap-2 font-medium">
              <input
                checked={priorityRules.includeRbStatusCheck}
                onChange={(event) => props.onIncludePaymentStatus(event.target.checked)}
                type="checkbox"
              />
              Payment Status after
            </label>
            <NumberInput
              className={fieldClass}
              disabled={!priorityRules.includeRbStatusCheck}
              fallback={1}
              min={1}
              onChange={props.onPaymentStatusDays}
              value={priorityRules.rbStatusCheckDaysThreshold}
            />
            <span>days from report submitted</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ClearWhen({
  choices,
  selectedConditions,
  statusNames,
  selectedStatuses,
  onToggleCondition,
  onToggleStatus,
}: {
  choices: readonly Choice[];
  selectedConditions: readonly string[];
  statusNames: readonly string[];
  selectedStatuses: readonly string[];
  onToggleCondition: (value: string, enabled: boolean) => void;
  onToggleStatus: (name: string, enabled: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Cleared from Case Flow when</p>
      <ClearChips
        choices={choices}
        onToggleCondition={onToggleCondition}
        onToggleStatus={onToggleStatus}
        selectedConditions={selectedConditions}
        selectedStatuses={selectedStatuses}
        statusNames={statusNames}
      />
    </div>
  );
}

function GracePeriod({ days, onChange }: { days: number; onChange: (days: number) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Appt not scheduled grace period</p>
      <div className="flex flex-wrap items-center gap-2 text-base">
        <span>Warn after</span>
        <NumberInput className={fieldClass} fallback={0} min={0} onChange={onChange} value={days} />
        <span>days from sent date</span>
      </div>
    </div>
  );
}

function CategoryRow({
  name,
  summary,
  enabled,
  onEnabled,
  open,
  onToggle,
  panelId,
  children,
}: {
  name: string;
  summary: string;
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  open: boolean;
  onToggle: () => void;
  panelId: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="pt-0.5">
          <EnableSwitch checked={enabled} label={`Enable ${name}`} onChange={onEnabled} />
        </span>
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={onToggle}
          type="button"
        >
          <span className="shrink-0 text-base font-semibold">{name}</span>
          <span className="min-w-0 flex-1 text-base text-[var(--text-muted)]">{summary}</span>
          <span
            aria-hidden
            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center text-sm transition-transform ${
              open ? "rotate-180" : ""
            }`}
          >
            ⌄
          </span>
        </button>
      </div>
      {open ? (
        <div className="space-y-4 border-t border-[var(--line-soft)] px-4 py-4 pl-14" id={panelId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
