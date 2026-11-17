/**
 * Approved sidebar icons (design/sidebar-icons, icons/sidebar-svgs @ 81ec8d9).
 * Strokes and brand fills use currentColor so they follow the active theme.
 * The soft duotone stays fill-opacity 0.18.
 * Other opacities from the source files are kept.
 */

import type { ReactElement } from "react";

type IconProps = { className?: string };

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

export function PatientListIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <rect x="3.55" y="3.35" width="16.9" height="17.3" rx="2.6" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <rect x="3.55" y="3.35" width="16.9" height="17.3" rx="2.6" />
      <circle cx="7.95" cy="7.55" r="1.55" />
      <path d="M5.85 10.95c.45-1.55 1.25-2.05 2.1-2.05s1.65.5 2.1 2.05" />
      <path d="M12.15 7.4h5.55" />
      <path d="M12.15 9.55h3.55" />
      <circle cx="7.95" cy="14.55" r="1.55" />
      <path d="M5.85 17.95c.45-1.55 1.25-2.05 2.1-2.05s1.65.5 2.1 2.05" />
      <path d="M12.15 14.4h5.55" />
      <path d="M12.15 16.55h3.55" />
    </svg>
  );
}

export function CaseListIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M8.35 3.5h3.35l1.35 1.55h6.45A1.55 1.55 0 0 1 21.05 6.6v4.3" />
      <path d="M6 6.4h3.5l1.4 1.6h7.15A1.7 1.7 0 0 1 19.75 9.7v3.6" />
      <path d="M5.15 9.35h4.25l1.55 1.85h8.2A1.95 1.95 0 0 1 21.1 13.15v5.75A2.15 2.15 0 0 1 18.95 21.05H5.2A2.15 2.15 0 0 1 3.05 18.9v-7.4A2 2 0 0 1 5.15 9.35Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <path d="M5.15 9.35h4.25l1.55 1.85h8.2A1.95 1.95 0 0 1 21.1 13.15v5.75A2.15 2.15 0 0 1 18.95 21.05H5.2A2.15 2.15 0 0 1 3.05 18.9v-7.4A2 2 0 0 1 5.15 9.35Z" />
    </svg>
  );
}

export function StatisticsIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M3.7 18.35H20.3V7.15L16.85 5.55L13.05 11.2C11.55 13.55 9.85 10.7 8.15 9.35L3.7 12.85Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <path d="M3.35 18.35h17.3" />
      <path d="M3.7 12.85L8.15 9.35C9.85 10.7 11.55 13.55 13.05 11.2L16.85 5.55L20.3 7.15" />
      <circle cx="20.3" cy="7.15" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ContactsIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M5.05 3.8H16.15A2.35 2.35 0 0 1 18.5 6.15V17.85A2.35 2.35 0 0 1 16.15 20.2H5.05A1.6 1.6 0 0 1 3.45 18.6V5.4A1.6 1.6 0 0 1 5.05 3.8Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <path d="M5.05 3.8H16.15A2.35 2.35 0 0 1 18.5 6.15V17.85A2.35 2.35 0 0 1 16.15 20.2H5.05A1.6 1.6 0 0 1 3.45 18.6V5.4A1.6 1.6 0 0 1 5.05 3.8Z" />
      <path d="M6.65 3.8v16.4" />
      <path d="M18.5 7.65h1.6a.95.95 0 0 1 .95.95v1.7a.95.95 0 0 1-.95.95H18.5" />
      <path d="M18.5 13.35h1.6a.95.95 0 0 1 .95.95v1.7a.95.95 0 0 1-.95.95H18.5" />
      <circle cx="12.65" cy="10.1" r="1.75" />
      <path d="M9.85 15.35a2.85 2.35 0 0 1 5.6 0" />
    </svg>
  );
}

export function ScheduleIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M5.9 5.75h12.2A2.4 2.4 0 0 1 20.5 8.15V9.4H3.5V8.15A2.4 2.4 0 0 1 5.9 5.75Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <rect x="3.5" y="5.75" width="17" height="14.7" rx="2.4" />
      <path d="M3.5 9.4h17" />
      <path d="M8.1 3.4v3.55" />
      <path d="M15.9 3.4v3.55" />
      <rect x="5.7" y="11.4" width="3.3" height="3.1" rx="0.7" fill="currentColor" fillOpacity="0.28" stroke="none" />
      <rect x="10.35" y="11.4" width="3.3" height="3.1" rx="0.7" fill="currentColor" fillOpacity="0.28" stroke="none" />
      <rect x="15" y="11.4" width="3.3" height="3.1" rx="0.7" fill="currentColor" fillOpacity="0.92" stroke="none" />
      <rect x="5.7" y="15.7" width="3.3" height="3.1" rx="0.7" fill="currentColor" fillOpacity="0.28" stroke="none" />
      <rect x="10.35" y="15.7" width="3.3" height="3.1" rx="0.7" fill="currentColor" fillOpacity="0.28" stroke="none" />
      <rect x="15" y="15.7" width="3.3" height="3.1" rx="0.7" fill="currentColor" fillOpacity="0.28" stroke="none" />
    </svg>
  );
}

export function EncountersIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <rect x="5.15" y="4.9" width="13.7" height="16.05" rx="2.35" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <rect x="5.15" y="4.9" width="13.7" height="16.05" rx="2.35" />
      <rect x="8.65" y="2.4" width="6.7" height="4.2" rx="1.35" />
      <path d="M8.4 11h7.2" />
      <path d="M8.4 14.05h7.2" />
      <path d="M8.4 17.2h1.95l1.15-2.5 1.65 3.75 1.2-2.15h2.25" />
    </svg>
  );
}

export function KeyDatesIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M7.6 4.5h8.8A3 3 0 0 1 19.4 7.5V8.8H4.6V7.5A3 3 0 0 1 7.6 4.5Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <rect x="4.6" y="4.5" width="14.8" height="15" rx="3" />
      <path d="M4.6 8.8h14.8" />
      <circle cx="8.95" cy="6.65" r="0.92" fill="currentColor" stroke="none" />
      <circle cx="15.05" cy="6.65" r="0.92" fill="currentColor" stroke="none" />
      <path d="M12 10.7v3.6" />
      <circle cx="12" cy="16.7" r="1.08" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MyFilesIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M11.75 10.4V4.25A1.15 1.15 0 0 1 12.9 3.1h5A1.15 1.15 0 0 1 19.05 4.25V10.4" />
      <path d="M9.9 10.4V5.75A1.2 1.2 0 0 1 11.1 4.55h5.1A1.2 1.2 0 0 1 17.4 5.75V10.4Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <path d="M9.9 10.4V5.75A1.2 1.2 0 0 1 11.1 4.55h5.1A1.2 1.2 0 0 1 17.4 5.75V10.4" />
      <path d="M5.5 8.5H8.7L10.25 10.4H19.7A2 2 0 0 1 21.7 12.4V18.85A2.15 2.15 0 0 1 19.55 21H5.3A2.15 2.15 0 0 1 3.15 18.85V10.5A2 2 0 0 1 5.5 8.5Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <path d="M5.5 8.5H8.7L10.25 10.4H19.7A2 2 0 0 1 21.7 12.4V18.85A2.15 2.15 0 0 1 19.55 21H5.3A2.15 2.15 0 0 1 3.15 18.85V10.5A2 2 0 0 1 5.5 8.5Z" />
    </svg>
  );
}

export function BillingIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M6.15 3.35h11.7a1.7 1.7 0 0 1 1.7 1.7v14.1l-1.75-1.1-1.7 1.15-1.7-1.15-1.65 1.15-1.7-1.15-1.7 1.15-1.7-1.15-1.7 1.1V5.05A1.7 1.7 0 0 1 6.15 3.35Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <path d="M6.15 3.35h11.7a1.7 1.7 0 0 1 1.7 1.7v14.1l-1.75-1.1-1.7 1.15-1.7-1.15-1.65 1.15-1.7-1.15-1.7 1.15-1.7-1.15-1.7 1.1V5.05A1.7 1.7 0 0 1 6.15 3.35Z" />
      <path d="M12 6.2v9.05" />
      <path d="M14.7 8.2c-.2-1.15-1.2-1.8-2.7-1.8-1.55 0-2.6.75-2.6 1.9 0 1.1.9 1.55 2.55 1.95 1.75.45 2.7 1.05 2.7 2.25 0 1.35-1.2 2.05-2.7 2.05-1.6 0-2.8-.8-2.85-2.1" />
    </svg>
  );
}

export function TimersIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <circle cx="12" cy="13.25" r="7.3" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <circle cx="12" cy="13.25" r="7.3" />
      <rect x="10.2" y="2.2" width="3.6" height="2.55" rx="0.85" />
      <path d="M12 4.75v1.05" />
      <rect x="17.15" y="5.15" width="2.55" height="1.85" rx="0.7" transform="rotate(40 18.42 6.08)" />
      <path d="M12 13.25l3.5-3.15" />
      <circle cx="12" cy="13.25" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MarketingIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M3.55 10.05h4.05L16.15 5.15a1.1 1.1 0 0 1 1.7.95v11.8a1.1 1.1 0 0 1-1.7.95L7.6 13.95H3.55A1.35 1.35 0 0 1 2.2 12.6v-1.2A1.35 1.35 0 0 1 3.55 10.05Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <path d="M3.55 10.05h4.05L16.15 5.15a1.1 1.1 0 0 1 1.7.95v11.8a1.1 1.1 0 0 1-1.7.95L7.6 13.95H3.55A1.35 1.35 0 0 1 2.2 12.6v-1.2A1.35 1.35 0 0 1 3.55 10.05Z" />
      <path d="M7.95 14.2v2.7a1.7 1.7 0 0 0 1.7 1.7h1.35" />
      <path d="M19.25 9.05a4.2 4.2 0 0 1 0 5.9" />
      <path d="M21.1 7.3a6.75 6.75 0 0 1 0 9.4" />
    </svg>
  );
}

export function MessagesIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M11.05 3.5h6.7A2.4 2.4 0 0 1 20.15 5.9v3.25A2.4 2.4 0 0 1 17.75 11.55h-6.7A2.4 2.4 0 0 1 8.65 9.15V5.9A2.4 2.4 0 0 1 11.05 3.5Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <path d="M11.05 3.5h6.7A2.4 2.4 0 0 1 20.15 5.9v3.25A2.4 2.4 0 0 1 17.75 11.55h-6.7A2.4 2.4 0 0 1 8.65 9.15V5.9A2.4 2.4 0 0 1 11.05 3.5Z" />
      <path d="M3.85 9h10.15A2.5 2.5 0 0 1 16.5 11.5v4.75a2.5 2.5 0 0 1-2.5 2.5H8.55L5.7 21.15v-2.4H3.85A1.9 1.9 0 0 1 1.95 16.85v-5.95A1.9 1.9 0 0 1 3.85 9Z" />
      <path d="M5.95 13h6.35" />
      <path d="M5.95 15.95h4.2" />
    </svg>
  );
}

export function HandbookIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M12 5.4C9.7 4.5 6.55 4.4 3.65 5.4V18.1C6.65 17.1 9.7 17.45 12 19.15Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <path d="M12 5.4C9.7 4.5 6.55 4.4 3.65 5.4V18.1C6.65 17.1 9.7 17.45 12 19.15Z" />
      <path d="M12 5.4C14.3 4.5 17.45 4.4 20.35 5.4V18.1C17.35 17.1 14.3 17.45 12 19.15Z" />
      <path d="M12 5.4v13.75" />
      <path d="M13.55 4.2h2.9v7.6l-1.45-1.3-1.45 1.3Z" fill="currentColor" />
    </svg>
  );
}

/** Envelope plus a G badge. The ring and the G are the sidebar color so they knock out in every theme. */
export function GoatMailIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <rect x="2.5" y="5" width="16" height="12" rx="2.2" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <rect x="2.5" y="5" width="16" height="12" rx="2.2" />
      <path d="M4.7 5L10.5 11L16.3 5" />
      <circle cx="18" cy="17" r="5.8" fill="var(--bg-sidebar)" stroke="none" />
      <circle cx="18" cy="17" r="4.6" fill="currentColor" stroke="none" />
      <path d="M18.133 20.5Q17.178 20.5 16.456 20.076Q15.734 19.651 15.33 18.868Q14.926 18.085 14.926 17.01Q14.926 15.903 15.346 15.118Q15.766 14.334 16.485 13.917Q17.204 13.5 18.103 13.5Q18.677 13.5 19.173 13.666Q19.67 13.833 20.057 14.14Q20.445 14.447 20.69 14.867Q20.935 15.286 21.007 15.79H19.586Q19.515 15.544 19.385 15.35Q19.254 15.156 19.068 15.019Q18.883 14.882 18.646 14.811Q18.41 14.74 18.125 14.74Q17.599 14.74 17.196 15.002Q16.793 15.264 16.568 15.768Q16.343 16.272 16.343 16.995Q16.343 17.718 16.565 18.224Q16.788 18.729 17.192 18.995Q17.595 19.26 18.143 19.26Q18.635 19.26 18.989 19.081Q19.343 18.901 19.531 18.572Q19.719 18.242 19.719 17.795L20.012 17.838H18.24V16.777H21.074V17.629Q21.074 18.522 20.695 19.165Q20.317 19.808 19.653 20.154Q18.989 20.5 18.133 20.5Z" fill="var(--bg-sidebar)" stroke="none" />
    </svg>
  );
}

export function SettingsIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M 10.129 5.880 L 9.759 3.335 A 8.950 8.950 0 0 1 14.241 3.335 L 13.871 5.880 A 6.400 6.400 0 0 1 16.365 7.319 L 18.384 5.727 A 8.950 8.950 0 0 1 20.624 9.608 L 18.236 10.560 A 6.400 6.400 0 0 1 18.236 13.440 L 20.624 14.392 A 8.950 8.950 0 0 1 18.384 18.273 L 16.365 16.681 A 6.400 6.400 0 0 1 13.871 18.120 L 14.241 20.665 A 8.950 8.950 0 0 1 9.759 20.665 L 10.129 18.120 A 6.400 6.400 0 0 1 7.635 16.681 L 5.616 18.273 A 8.950 8.950 0 0 1 3.376 14.392 L 5.764 13.440 A 6.400 6.400 0 0 1 5.764 10.560 L 3.376 9.608 A 8.950 8.950 0 0 1 5.616 5.727 L 7.635 7.319 A 6.400 6.400 0 0 1 10.129 5.880 Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
      <path d="M 10.129 5.880 L 9.759 3.335 A 8.950 8.950 0 0 1 14.241 3.335 L 13.871 5.880 A 6.400 6.400 0 0 1 16.365 7.319 L 18.384 5.727 A 8.950 8.950 0 0 1 20.624 9.608 L 18.236 10.560 A 6.400 6.400 0 0 1 18.236 13.440 L 20.624 14.392 A 8.950 8.950 0 0 1 18.384 18.273 L 16.365 16.681 A 6.400 6.400 0 0 1 13.871 18.120 L 14.241 20.665 A 8.950 8.950 0 0 1 9.759 20.665 L 10.129 18.120 A 6.400 6.400 0 0 1 7.635 16.681 L 5.616 18.273 A 8.950 8.950 0 0 1 3.376 14.392 L 5.764 13.440 A 6.400 6.400 0 0 1 5.764 10.560 L 3.376 9.608 A 8.950 8.950 0 0 1 5.616 5.727 L 7.635 7.319 A 6.400 6.400 0 0 1 10.129 5.880 Z" />
      <circle cx="12" cy="12" r="3.15" />
    </svg>
  );
}

export type SidebarIcon = (props: IconProps) => ReactElement;

/** Feature keys. caseList is ready for the folder preview; patients stays Patient List. */
export const sidebarIconsByFeature: Record<string, SidebarIcon> = {
  patients: PatientListIcon,
  caseList: CaseListIcon,
  statistics: StatisticsIcon,
  contacts: ContactsIcon,
  appointments: ScheduleIcon,
  encounters: EncountersIcon,
  keyDates: KeyDatesIcon,
  myFiles: MyFilesIcon,
  billing: BillingIcon,
  timers: TimersIcon,
  marketing: MarketingIcon,
  messages: MessagesIcon,
  settings: SettingsIcon,
  handbook: HandbookIcon,
  goatMail: GoatMailIcon,
};

/** Href wins over feature so /cases can use Case List while /patients stays Patient List. */
export const sidebarIconsByHref: Record<string, SidebarIcon> = {
  "/patients": PatientListIcon,
  "/cases": CaseListIcon,
  "/dashboard": StatisticsIcon,
  "/statistics": StatisticsIcon,
  "/contacts": ContactsIcon,
  "/appointments": ScheduleIcon,
  "/encounters": EncountersIcon,
  "/key-dates": KeyDatesIcon,
  "/my-files": MyFilesIcon,
  "/billing": BillingIcon,
  "/timers": TimersIcon,
  "/marketing": MarketingIcon,
  "/messages": MessagesIcon,
  "/handbook": HandbookIcon,
  "/goat-mail": GoatMailIcon,
  "/settings": SettingsIcon,
};

export function sidebarIconFor(page: { href: string; id: string; feature?: string }): SidebarIcon | null {
  return sidebarIconsByHref[page.href] ?? sidebarIconsByFeature[page.id] ?? (page.feature ? sidebarIconsByFeature[page.feature] : null) ?? null;
}

/** Render the icon for a sidebar page. Named components stay outside the caller so they are not created during render. */
export function SidebarIconView({
  page,
  className = "h-5 w-5",
}: {
  page: { href: string; id: string; feature?: string };
  className?: string;
}) {
  if (page.href === "/cases" || page.id === "caseList") return <CaseListIcon className={className} />;
  if (page.href === "/patients" || page.id === "patients" || page.feature === "patients") return <PatientListIcon className={className} />;
  if (page.href === "/dashboard" || page.href === "/statistics" || page.id === "statistics" || page.feature === "statistics") return <StatisticsIcon className={className} />;
  if (page.id === "contacts" || page.feature === "contacts") return <ContactsIcon className={className} />;
  if (page.id === "appointments" || page.feature === "appointments") return <ScheduleIcon className={className} />;
  if (page.id === "encounters" || page.feature === "encounters") return <EncountersIcon className={className} />;
  if (page.id === "keyDates" || page.feature === "keyDates") return <KeyDatesIcon className={className} />;
  if (page.id === "myFiles" || page.feature === "myFiles") return <MyFilesIcon className={className} />;
  if (page.id === "billing" || page.feature === "billing") return <BillingIcon className={className} />;
  if (page.id === "timers" || page.feature === "timers") return <TimersIcon className={className} />;
  if (page.id === "marketing" || page.feature === "marketing") return <MarketingIcon className={className} />;
  if (page.id === "messages" || page.feature === "messages") return <MessagesIcon className={className} />;
  if (page.id === "handbook") return <HandbookIcon className={className} />;
  if (page.id === "goatMail") return <GoatMailIcon className={className} />;
  if (page.id === "settings" || page.feature === "settings") return <SettingsIcon className={className} />;
  return null;
}
