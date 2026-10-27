"use client";

/**
 * Shared "current location" view for Schedule + Patients. Reads the office's
 * locations, resolves the viewer's default (their assigned main location) on
 * first load, and exposes the selected location + a setter. "" = All.
 */

import { useEffect, useState } from "react";
import { useOfficeSettings } from "@/hooks/use-office-settings";
import { getCurrentMembershipSync } from "@/lib/workspace-membership";
import {
  getAppliedMain,
  getSelectedLocationId,
  hasStoredLocationChoice,
  markMainApplied,
  resolveLoginLocation,
  LOCATION_VIEW_EVENT,
  setSelectedLocationId,
} from "@/lib/location-view";
import { NO_OFFICE_FILTER } from "@/lib/location-filter";

export function useLocationView() {
  const { officeSettings } = useOfficeSettings();
  // Locations are universal — there's always ≥1. The location PICKER only
  // matters when there are 2+ offices to switch between; a solo office needs
  // no selector or per-row filtering. `multiLocation` here therefore means
  // "has more than one location" (what all the UI gates should key on).
  const locations = officeSettings.locations ?? [];
  const multiLocation = locations.length > 1;

  const [selectedId, setSelectedId] = useState<string>(() => getSelectedLocationId());

  // At login, start on the member's main location (owners have none → All). They can switch
  // freely afterwards; a changed main location is applied once on their next load.
  useEffect(() => {
    if (!multiLocation) return;
    const membership = getCurrentMembershipSync();
    const main = membership?.permissions.mainLocationId ?? "";
    const userId = membership?.userId ?? "";
    const target = resolveLoginLocation({
      userId,
      main,
      locationIds: locations.map((l) => l.id),
      stored: hasStoredLocationChoice() ? getSelectedLocationId() : null,
      applied: getAppliedMain(),
    });
    if (target !== null) {
      setSelectedLocationId(target);
      setSelectedId(target);
    }
    if (main && userId) markMainApplied(userId, main);
  }, [multiLocation, locations]);

  // Keep in sync with other components / tabs.
  useEffect(() => {
    const onChange = () => setSelectedId(getSelectedLocationId());
    window.addEventListener(LOCATION_VIEW_EVENT, onChange);
    return () => window.removeEventListener(LOCATION_VIEW_EVENT, onChange);
  }, []);

  // A selected location that no longer exists falls back to All.
  // "No office set" (NO_OFFICE_FILTER) is kept as-is.
  const effectiveId =
    selectedId === NO_OFFICE_FILTER
      ? multiLocation
        ? NO_OFFICE_FILTER
        : ""
      : selectedId && locations.some((l) => l.id === selectedId)
        ? selectedId
        : "";

  const select = (id: string) => {
    setSelectedLocationId(id);
    setSelectedId(id);
  };

  return { multiLocation, locations, selectedLocationId: effectiveId, setLocation: select };
}
