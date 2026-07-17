export type PlanTier = "tracking" | "track_schedule" | "complete";

export type PortalFeature =
  | "patients"
  | "statistics"
  | "contacts"
  | "appointments"
  | "encounters"
  | "keyDates"
  | "myFiles"
  | "billing"
  | "timers"
  | "marketing"
  | "settings";

export type PortalNavItem = {
  href: string;
  label: string;
  feature: PortalFeature;
};

export const portalNavItems: PortalNavItem[] = [
  { href: "/patients", label: "Patients", feature: "patients" },
  { href: "/statistics", label: "Statistics", feature: "statistics" },
  { href: "/contacts", label: "Contacts", feature: "contacts" },
  { href: "/appointments", label: "Schedule", feature: "appointments" },
  { href: "/encounters", label: "Encounters", feature: "encounters" },
  { href: "/key-dates", label: "Key Dates", feature: "keyDates" },
  { href: "/my-files", label: "My Files", feature: "myFiles" },
  { href: "/billing", label: "Billing", feature: "billing" },
  { href: "/timers", label: "Timers", feature: "timers" },
  { href: "/marketing", label: "Marketing", feature: "marketing" },
  { href: "/settings", label: "Settings", feature: "settings" },
];

const planFeatureMap: Record<PlanTier, PortalFeature[]> = {
  tracking: [
    "patients",
    "statistics",
    "contacts",
    "keyDates",
    "myFiles",
    "timers",
    "marketing",
    "settings",
  ],
  track_schedule: [
    "patients",
    "statistics",
    "contacts",
    "appointments",
    "keyDates",
    "myFiles",
    "timers",
    "marketing",
    "settings",
  ],
  complete: [
    "patients",
    "statistics",
    "contacts",
    "appointments",
    "encounters",
    "keyDates",
    "myFiles",
    "billing",
    "timers",
    "marketing",
    "settings",
  ],
};

const fallbackPlan: PlanTier = "complete";

function normalizePlanToken(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function normalizePlanTier(value: unknown): PlanTier {
  const normalized = normalizePlanToken(value);
  if (normalized === "tracking" || normalized === "track_only") {
    return "tracking";
  }
  if (
    normalized === "track_schedule" ||
    normalized === "track_and_schedule" ||
    normalized === "tracking_schedule"
  ) {
    return "track_schedule";
  }
  if (normalized === "complete" || normalized === "full") {
    return "complete";
  }
  return fallbackPlan;
}

// NoteGoat is now a single all-access plan — every subscriber gets every
// feature. The planTier plumbing is kept intact (Stripe, plan-context) so
// billing is unaffected, but it no longer restricts which portal sections
// are available. Per-USER access (front desk, office manager, etc.) is
// handled separately by the team-permissions system, not by plan tier.
export function hasPortalFeature(_planTier: PlanTier, _feature: PortalFeature) {
  return true;
}

export function getVisiblePortalNavItems(_planTier: PlanTier) {
  return portalNavItems;
}

export function getDefaultPortalPath(planTier: PlanTier) {
  const firstAllowed = getVisiblePortalNavItems(planTier)[0];
  return firstAllowed?.href ?? "/patients";
}

export function resolvePortalFeatureFromPath(pathname: string): PortalFeature | null {
  if (pathname.startsWith("/patients")) {
    return "patients";
  }
  if (pathname.startsWith("/statistics")) {
    return "statistics";
  }
  if (pathname.startsWith("/contacts")) {
    return "contacts";
  }
  if (pathname.startsWith("/appointments")) {
    return "appointments";
  }
  if (pathname.startsWith("/encounters")) {
    return "encounters";
  }
  if (pathname.startsWith("/key-dates")) {
    return "keyDates";
  }
  if (pathname.startsWith("/my-files")) {
    return "myFiles";
  }
  if (pathname.startsWith("/billing")) {
    return "billing";
  }
  if (pathname.startsWith("/timers")) {
    return "timers";
  }
  if (pathname.startsWith("/marketing")) {
    return "marketing";
  }
  if (pathname.startsWith("/settings")) {
    return "settings";
  }
  return null;
}

export function isPortalPathAllowed(planTier: PlanTier, pathname: string) {
  const feature = resolvePortalFeatureFromPath(pathname);
  if (!feature) {
    return true;
  }
  return hasPortalFeature(planTier, feature);
}
