"use client";

import { useId } from "react";
import type { CameraOption } from "@/lib/scan-pdf";
import type { CamState } from "@/hooks/use-office-camera";

/** Plain sentence. No panel, no subtitle block. */
export function cameraProblemText(state: CamState): string | null {
  if (state === "denied") {
    return "Camera is blocked. In Chrome, click the lock icon in the address bar and set Camera to Allow. In Safari, choose Safari → Settings for This Website → Camera → Allow. Then click Refresh.";
  }
  if (state === "none") {
    return "No camera found. Plug one in, or lock your Device and set it near the Mac, then click Refresh.";
  }
  if (state === "error") {
    return "The camera didn't start. Another app may be using it. Close that app or pick another camera, then click Refresh.";
  }
  if (state === "starting") return "Starting the camera…";
  return null;
}

export function CameraPicker({
  cameras,
  cameraId,
  onChange,
  onRefresh,
  refreshing,
  continuityListed,
}: {
  cameras: CameraOption[];
  cameraId: string | null;
  onChange: (id: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  continuityListed: boolean;
}) {
  const selectId = useId();
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="camera-picker">
      <label className="text-sm font-semibold" htmlFor={selectId}>
        Camera
      </label>
      <select
        className="min-w-[220px] rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
        disabled={cameras.length === 0}
        id={selectId}
        onChange={(e) => onChange(e.target.value)}
        value={cameraId ?? ""}
      >
        {cameras.length === 0 && <option value="">No camera yet</option>}
        {cameras.map((c) => (
          <option key={c.deviceId} value={c.deviceId}>
            {c.label}
          </option>
        ))}
      </select>
      <button className="btn btn-secondary btn-sm" disabled={refreshing} onClick={onRefresh} title="Look for cameras again" type="button">
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
      {cameras.length > 0 && !continuityListed && (
        <span className="text-xs text-[var(--text-muted)]">Don&apos;t see your Device? Lock it, set it near the Mac, then click Refresh.</span>
      )}
    </div>
  );
}
