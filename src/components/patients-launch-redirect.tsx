"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePlanTier } from "@/lib/plan-context";
import { patientsLaunchRedirect } from "@/lib/sidebar-launch";
import { readSidebarOrderFromStorage, sidebarLandingHref } from "@/lib/sidebar-order";
import { hasSyncedUserPrefs, syncUserPrefs } from "@/lib/user-prefs-cloud";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";

/**
 * Shown only for a fresh tab that opened exactly on /patients, behind the
 * check-in screen. Waits for the cloud prefs (joining the layout's sync),
 * then replaces Patient List with the first sidebar page. In-app clicks and
 * later loads of this tab never mount this.
 */
export function PatientsLaunchRedirect({ onStay }: { onStay: () => void }) {
  const router = useRouter();
  const planTier = usePlanTier();
  const { canView } = useWorkspaceAccess();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Join the layout's sync when the 10s check-in timeout won the race.
        // When that sync already finished, the key is restored — don't start
        // a second cloud read before choosing the page.
        if (!hasSyncedUserPrefs()) await syncUserPrefs();
      } catch (err) {
        console.warn("[patients-launch] could not load the sidebar order:", err);
      }
      if (cancelled) return;
      const landing = sidebarLandingHref(planTier, canView, readSidebarOrderFromStorage());
      const href = patientsLaunchRedirect({
        fresh: true,
        pathname: "/patients",
        search: "",
        landingHref: landing,
      });
      if (href) router.replace(href);
      else onStay();
    })();
    return () => {
      cancelled = true;
    };
  }, [router, planTier, canView, onStay]);

  return null;
}
