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
  getSelectedLocationId,
  hasStoredLocationChoice,
  LOCATION_VIEW_EVENT,
  setSelectedLocationId,
} from "@/lib/location-view";

export function useLocationView() {
  const { officeSettings } = useOfficeSettings();
  const multiLocation = officeSettings.multiLocation;
  const locations = multiLocation ? officeSettings.locations ?? [] : [];

  const [selectedId, setSelectedId] = useState<string>(() => getSelectedLocationId());

  // On first load with no explicit choice, default to the member's main
  // location (owners have none → All).
  useEffect(() => {
    if (!multiLocation) return;
    if (hasStoredLocationChoice()) return;
    const main = getCurrentMembershipSync()?.permissions.mainLocationId ?? "";
    if (main && locations.some((l) => l.id === main)) {
      setSelectedLocationId(main);
      setSelectedId(main);
    }
  }, [multiLocation, locations]);

  // Keep in sync with other components / tabs.
  useEffect(() => {
    const onChange = () => setSelectedId(getSelectedLocationId());
    window.addEventListener(LOCATION_VIEW_EVENT, onChange);
    return () => window.removeEventListener(LOCATION_VIEW_EVENT, onChange);
  }, []);

  // A selected location that no longer exists falls back to All.
  const effectiveId = selectedId && locations.some((l) => l.id === selectedId) ? selectedId : "";

  const select = (id: string) => {
    setSelectedLocationId(id);
    setSelectedId(id);
  };

  return { multiLocation, locations, selectedLocationId: effectiveId, setLocation: select };
}
