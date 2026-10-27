import { settingsSearchCatalog, type SettingsSectionKey } from "@/lib/settings-catalog";

/**
 * Settings page search. Sections that aren't CollapsibleSection catalog entries (Team Members, Features,
 * Marketing, Treatment Plan Settings) are indexed here so they match by title, description and aliases
 * exactly like catalog sections, and each lives on ONE tab (plus Everything).
 */
export type ExtraSectionId = "team" | "modules" | "marketing" | "treatmentPlan";

export interface ExtraSection {
  id: ExtraSectionId;
  title: string;
  description: string;
  aliases: string[];
  /** The single tab this section belongs to (it also shows on "Everything"). */
  tab: "office" | "notes" | "account";
}

export const EXTRA_SECTIONS: ExtraSection[] = [
  {
    id: "team",
    title: "Team Members",
    description: "Invite staff, set each member's role, access, main location and which sections they see.",
    aliases: ["team", "staff", "member", "members", "user", "users", "invite", "login", "logins", "role", "roles", "access", "permissions", "main location", "default location", "deactivate", "disable", "doctor", "front desk", "manager", "admin"],
    tab: "office",
  },
  {
    id: "modules",
    title: "Features",
    description: "Turn off features your office doesn't use — they disappear from the menu and everywhere they appear.",
    aliases: ["features", "feature", "module", "modules", "module visibility", "hide", "show", "menu", "turn off", "turn on"],
    tab: "account",
  },
  {
    id: "marketing",
    title: "Marketing",
    description: "Customize the \"Type of Contact\" options used when logging marketing activity, and which case statuses count toward a firm's Active and Total cases.",
    aliases: ["marketing", "type of contact", "types of contact", "visit type", "visit types", "contact type", "case count", "firm", "firms", "attorney marketing", "outreach"],
    tab: "office",
  },
  {
    id: "treatmentPlan",
    title: "Treatment Plan Settings",
    description: "Treatment plan macros and folders used when building a patient's plan.",
    aliases: ["treatment plan", "plan", "plan macros", "treatment"],
    tab: "notes",
  },
];

export interface SettingsSearchResult {
  /** Catalog sections that match (parents included so children are reachable). */
  keys: Set<SettingsSectionKey>;
  /** Non-catalog sections that match. */
  extras: Set<ExtraSectionId>;
  /** True when anything at all will be visible — the "no match" banner must key off this. */
  hasVisible: boolean;
}

function termHits(haystack: string, term: string): boolean {
  if (haystack.includes(term)) return true;
  // members → member, fields → field
  return term.length > 3 && term.endsWith("s") && haystack.includes(term.slice(0, -1));
}

/** Returns null when search is inactive (show everything normally). */
export function computeSettingsSearch(
  query: string,
  memberText: string[] = [],
): SettingsSearchResult | null {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;
  const keys = new Set<SettingsSectionKey>();
  for (const entry of settingsSearchCatalog) {
    const haystack = [entry.title, entry.description ?? "", ...(entry.aliases ?? [])].join(" ").toLowerCase();
    if (!terms.every((t) => termHits(haystack, t))) continue;
    keys.add(entry.key);
    if (entry.parent) keys.add(entry.parent);
  }
  const extras = new Set<ExtraSectionId>();
  for (const section of EXTRA_SECTIONS) {
    const base = [section.title, section.description, ...section.aliases];
    // Member names / emails make the Team Members section findable ("hannah").
    const haystack = (section.id === "team" ? [...base, ...memberText] : base).join(" ").toLowerCase();
    if (terms.every((t) => termHits(haystack, t))) extras.add(section.id);
  }
  return { keys, extras, hasVisible: keys.size > 0 || extras.size > 0 };
}

/** Whether an extra section shows given the active tab ("all" = Everything) and search. */
export function showExtraSection(
  id: ExtraSectionId,
  activeTab: string,
  search: SettingsSearchResult | null,
): boolean {
  if (search) return search.extras.has(id);
  if (activeTab === "all") return true;
  return EXTRA_SECTIONS.find((s) => s.id === id)?.tab === activeTab;
}

/** Settings tabs: each section key lists the tab(s) it shows on; wrappers appear on several so their children are reachable. */
export type SettingsTabId = "office" | "schedule" | "notes" | "goat" | "reminders" | "forms" | "billing" | "account" | "all";
export const SETTINGS_TABS: { id: SettingsTabId; label: string; keys: SettingsSectionKey[] }[] = [
  { id: "office", label: "Office", keys: ["officeSettings", "office", "caseStatuses", "patientPage", "templates", "contactCategories"] },
  { id: "schedule", label: "Schedule", keys: ["officeSettings", "schedule"] },
  { id: "notes", label: "Notes & Macros", keys: ["macros", "soapMacros", "templates", "documents"] },
  { id: "goat", label: "G.O.A.T.", keys: ["goat"] },
  { id: "reminders", label: "Reminders", keys: ["officeSettings", "dashboard", "templates", "smsTemplates", "textReminders", "emailSettings"] },
  { id: "forms", label: "Forms", keys: ["templates", "forms"] },
  { id: "billing", label: "Billing", keys: ["macros", "billingMacros", "packageBuilder", "admin", "subscription"] },
  { id: "account", label: "Account", keys: ["adminAccess", "admin", "diagnostics", "backup", "recovery", "security"] },
  { id: "all", label: "Everything", keys: [] },
];
export const SETTINGS_TAB_WRAPPERS = new Set<SettingsSectionKey>(["officeSettings", "macros", "templates", "admin"]);
