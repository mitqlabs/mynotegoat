/**
 * Every casemate.* / notegoat.* localStorage key must be listed here with
 * how it is backed by the cloud. scripts/sanity-check.mjs fails the build
 * when code uses a key that isn't registered. NOTHING is browser-only.
 *
 *  - "workspace": its own workspace_kv row (shared by the office)
 *  - "table":     a dedicated Supabase table (patients, schedule, notes…)
 *  - "user":      mirrored into the signed-in user's own workspace_kv row
 *                 (casemate.user-prefs.v1.u.<userId>), merged per key,
 *                 newest change wins — see user-prefs-cloud.ts
 *  - "system":    sync bookkeeping / caches of cloud data, not user data
 */
export type CloudBacking = "workspace" | "table" | "user" | "system";

/** Exact keys, or prefixes ending in "." / ":" / "-" that match many keys. */
export const CLOUD_KEY_REGISTRY: Record<string, CloudBacking> = {
  // workspace_kv rows
  "casemate.office-settings.v1": "workspace",
  "casemate.key-dates.v1": "workspace",
  "casemate.schedule-settings.v1": "workspace",
  "casemate.sms-templates.v1": "workspace",
  "casemate.patient-forms.v1": "workspace",
  "casemate.sms-reminders.v1": "workspace",
  "casemate.contact-directory.v1": "workspace",
  "casemate.contact-categories.v1": "workspace",
  "casemate.contact-subcategories.v1": "workspace",
  "casemate.schedule-appointment-types.v1": "workspace",
  "casemate.schedule-rooms.v1": "workspace",
  "casemate.room-timer-presets.v1": "workspace",
  "casemate.report-templates.v1": "workspace",
  "casemate.document-templates.v1": "workspace",
  "casemate.tasks.v1": "workspace",
  "casemate.encounter-merge-backups.v1": "workspace",
  "casemate.patient-follow-up-overrides.v1": "workspace",
  "casemate.files.v1": "workspace",
  "casemate.billing-macros.v1": "workspace",
  "casemate.soap-macros.v1": "workspace",
  "casemate.macro-library.v1": "workspace",
  "casemate.quick-stats-settings.v1": "workspace",
  "casemate.patient-page-prefs.v1": "workspace",
  "casemate.patient-diagnoses.v1": "workspace",
  "casemate.patient-billing.v1": "workspace",
  "casemate.email-settings.v1": "workspace",
  "casemate.dashboard-workspace-settings.v1": "workspace",
  "casemate.dashboard-priority-rules.v1": "workspace",
  "casemate.case-statuses.v1": "workspace",
  "casemate.case-notes.v1": "workspace",
  "casemate.treatment-plans.v1": "workspace",
  "casemate.treatment-plan-settings.v1": "workspace",
  "casemate.module-visibility.v1": "workspace",
  "casemate.marketing.v1": "workspace",
  "casemate.marketing-settings.v1": "workspace",
  "casemate.holiday-keydate-prompts.v1": "workspace",
  "casemate.goat-settings.v1": "workspace",
  "casemate.goat-answer-prefs.v1": "workspace",
  "casemate.cash-payments.v1": "workspace",
  "casemate.patient-packages.v1": "workspace",
  "casemate.key-date-dismissals.v1": "workspace",
  "casemate.cleared-tasks.v1": "workspace",
  "casemate.duplicate-dismissals.v1": "workspace",
  "casemate.attorney-not-same.v1": "workspace",
  "casemate.team-settings.v1": "workspace",
  "casemate.team-member-order.v1": "workspace",
  "casemate.onboarding.v1": "workspace",
  "casemate.admin-access.v1": "workspace",
  "casemate.activity-log-settings.v1": "workspace",
  // dedicated tables
  "casemate.patients.v2": "table",
  "casemate.schedule-appointments.v1": "table",
  "casemate.encounter-notes.v1": "table",
  // per-user ticks with their own merge (use-referral-ticks.ts)
  "casemate.referral-checked.v1": "user",
  "casemate.referral-checked.v2": "user",
  // per-user mirrored prefs (user-prefs-cloud.ts)
  "casemate.contacts-sort.v1": "user",
  "casemate.scanner-camera.v1": "user",
  "casemate.referral-drill-sort.v1": "user",
  "casemate.sidebar-collapsed": "user",
  // G.O.A.T. home-screen install tip dismissed (stays dismissed on every device).
  "casemate.goat-install-tip.v1": "user",
  "casemate.soap-split-height.v1": "user",
  "casemate.quick-glance.open.v1": "user",
  "casemate.files-view-mode": "user",
  "casemate.dashboard.sections-open.v1": "user",
  "casemate.timer-sound-repeat.v1": "user",
  "casemate.patient-sort-column.v1": "user",
  "casemate.patient-sort-asc.v1": "user",
  "casemate.patient-column-order.v1": "user",
  "casemate.cf-sort-levels.v1": "user",
  "casemate.cf-sort-column.v1": "user",
  "casemate.cf-sort-asc.v1": "user",
  "casemate.cf-secondary-sort-column.v1": "user",
  "casemate.cf-secondary-sort-asc.v1": "user",
  "casemate.cf-hidden-categories.v1": "user",
  "casemate.cf-column-order.v1": "user",
  "casemate.attorney-perf-sort-levels.v1": "user",
  "casemate.attorney-perf-sort-column.v1": "user",
  "casemate.attorney-perf-sort-asc.v1": "user",
  "casemate.macro-question-clipboard": "user",
  "casemate.messages.last-seen.v1": "user",
  "casemate.location-view.v1": "user",
  "notegoat.note-signers.v1": "user",
  "notegoat.note-signer-last.v1": "user",
  "notegoat.goat-smart-mode.v1": "user",
  "notegoat.goat-smart-model.v1": "user",
  "notegoat.patients.print-extras.v1": "user",
  "notegoat.sort.": "user",
  "notegoat-ui.patient-list-sort.v1": "user",
  "notegoat.goat-chat.v1:": "user",
  "notegoat.goat-plus-intro.v1": "user",
  "notegoat.goat-plus-removed.v1": "user",
  // system: sync bookkeeping, crash-recovery drafts, caches of cloud data
  "casemate.active-workspace-id.v1": "system",
  "casemate.__safety-backup__.v1": "system",
  "casemate.cloud-sync-at": "system",
  "casemate.cloud-sync-at.": "system",
  "casemate.draft.v1.": "system",
  // G.O.A.T. → form handoffs (sessionStorage, read once, 10-min expiry). The data lands in the
  // cloud only when the user saves the form (patients / appointments are cloud-backed).
  "casemate.new-patient-prefill.v1": "system",
  "casemate.new-appointment-prefill.v1": "system",
  "casemate.cache.v1.": "system",
  "casemate.feature-flag.": "system",
  "casemate.user-prefs-mirror.v1": "system",
  "notegoat.unsynced-notes.v1": "system",
  // the cloud rows themselves (realtime may echo them into localStorage)
  "casemate.user-prefs.v1.u.": "system",
  "casemate.referral-checked.v2.u.": "system",
};

const PREFIX_END = /[.:-]$/;

export function cloudBackingFor(key: string): CloudBacking | null {
  if (CLOUD_KEY_REGISTRY[key]) return CLOUD_KEY_REGISTRY[key];
  for (const [k, v] of Object.entries(CLOUD_KEY_REGISTRY)) {
    if (PREFIX_END.test(k) && key.startsWith(k)) return v;
  }
  return null;
}

/** Keys mirrored to the user's own cloud row by user-prefs-cloud.ts. */
export function isMirroredUserKey(key: string): boolean {
  return cloudBackingFor(key) === "user" && !key.startsWith("casemate.referral-checked.");
}
