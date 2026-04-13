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

export function hasPortalFeature(planTier: PlanTier, feature: PortalFeature) {
  return planFeatureMap[planTier].includes(feature);
}

export function getVisiblePortalNavItems(planTier: PlanTier) {
  return portalNavItems.filter((item) => hasPortalFeature(planTier, item.feature));
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
