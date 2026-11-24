"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { pickCamera, reconcileCamera, sameCameras, isIphoneCamera, type CameraOption } from "@/lib/scan-pdf";

/**
 * The camera picked last time. A "user" key: localStorage.setItem is mirrored
 * to the signed-in user's cloud row (user-prefs-cloud.ts). Same key the
 * document scanner already uses, so the office keeps one camera.
 */
export const OFFICE_CAMERA_KEY = "casemate.scanner-camera.v1";

export type CamState = "starting" | "live" | "denied" | "none" | "error";

function readLastCamera(): string | null {
  try {
    return window.localStorage.getItem(OFFICE_CAMERA_KEY);
  } catch {
    return null;
  }
}

function rememberCamera(id: string) {
  try {
    window.localStorage.setItem(OFFICE_CAMERA_KEY, id);
  } catch {
    /* storage full or blocked: the choice still works this session */
  }
}

function videoInputs(devices: MediaDeviceInfo[]): CameraOption[] {
  return devices
    .filter((d) => d.kind === "videoinput" && d.deviceId)
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

/**
 * Permission first, then list cameras while that capture is still open.
 * Safari and Chrome on macOS often omit a Continuity Camera until a stream
 * is running, and drop it again if the stream is stopped first. A facing
 * mode is not set: that prefers a built-in camera and can hide the iPhone.
 */
async function camerasAfterPermission(): Promise<CameraOption[]> {
  const probe = await navigator.mediaDevices.getUserMedia({ audio: false, video: {} });
  try {
    let list = videoInputs(await navigator.mediaDevices.enumerateDevices());
    if (!list.some((c) => isIphoneCamera(c.label))) {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      const again = videoInputs(await navigator.mediaDevices.enumerateDevices());
      if (again.length > 0) list = again;
    }
    return list;
  } finally {
    probe.getTracks().forEach((t) => t.stop());
  }
}

async function openChosenCamera(deviceId: string): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    { audio: false, video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
    { audio: false, video: { deviceId: { exact: deviceId } } },
    { audio: false, video: { deviceId: { ideal: deviceId } } },
  ];
  let last: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      last = err;
      const name = (err as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") throw err;
    }
  }
  throw last instanceof Error ? last : new Error("camera");
}

function camErrorName(err: unknown): CamState {
  const n = (err as DOMException)?.name;
  if (n === "NotAllowedError" || n === "SecurityError") return "denied";
  if (n === "NotFoundError" || n === "DevicesNotFoundError" || n === "OverconstrainedError") return "none";
  return "error";
}

/**
 * Camera on the computer the office is already logged into.
 * Asks for permission, then lists devices. Re-lists on devicechange and when
 * Refresh is clicked, so a Continuity Camera that wakes up late still appears.
 * Prefers the last choice, then a Continuity / iPhone camera, then the first.
 */
export function useOfficeCamera(
  active: boolean,
  videoRef: RefObject<HTMLVideoElement | null>,
  streamRef: RefObject<MediaStream | null>,
) {
  const camerasRef = useRef<CameraOption[]>([]);
  const cameraIdRef = useRef<string | null>(null);
  const userPickedRef = useRef(false);
  const permittedRef = useRef(false);
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [camState, setCamState] = useState<CamState>("starting");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);
  useEffect(() => {
    cameraIdRef.current = cameraId;
  }, [cameraId]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const publishList = useCallback((list: CameraOption[], mode: "initial" | "refresh") => {
    if (list.length === 0) {
      if (mode === "refresh") return;
      camerasRef.current = [];
      setCameras([]);
      setCameraId(null);
      setCamState("none");
      return;
    }
    const prev = camerasRef.current;
    const nextId =
      mode === "refresh"
        ? reconcileCamera(prev, list, cameraIdRef.current, userPickedRef.current, readLastCamera())
        : pickCamera(list, readLastCamera());
    if (!sameCameras(prev, list)) {
      camerasRef.current = list;
      setCameras(list);
    }
    if (nextId !== cameraIdRef.current) setCameraId(nextId);
  }, []);

  const refreshCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
      setCamState("none");
      return;
    }
    try {
      if (!permittedRef.current) {
        const list = await camerasAfterPermission();
        permittedRef.current = true;
        publishList(list, "refresh");
        return;
      }
      const list = videoInputs(await navigator.mediaDevices.enumerateDevices());
      publishList(list, "refresh");
    } catch (err) {
      if (!permittedRef.current) setCamState(camErrorName(err));
      else console.warn("[camera] refresh failed", err);
    }
  }, [publishList]);

  const refreshRef = useRef(refreshCameras);
  useEffect(() => {
    refreshRef.current = refreshCameras;
  }, [refreshCameras]);

  // One listener for the life of the component. No-op until permission is granted.
  useEffect(() => {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.addEventListener) return;
    const onChange = () => {
      if (!permittedRef.current) return;
      void refreshRef.current();
    };
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, []);

  useEffect(() => {
    if (!active) {
      stopStream();
      setCameras([]);
      camerasRef.current = [];
      setCameraId(null);
      userPickedRef.current = false;
      permittedRef.current = false;
      setCamState("starting");
      return;
    }
    let cancelled = false;
    (async () => {
      setCamState("starting");
      if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
        setCamState("none");
        return;
      }
      let list: CameraOption[] = [];
      try {
        list = await camerasAfterPermission();
      } catch (err) {
        if (cancelled) return;
        setCamState(camErrorName(err));
        return;
      }
      if (cancelled) return;
      permittedRef.current = true;
      camerasRef.current = [];
      publishList(list, "initial");
    })();
    return () => {
      cancelled = true;
    };
  }, [active, publishList, stopStream]);

  useEffect(() => {
    if (!active || !cameraId) return;
    let cancelled = false;
    stopStream();
    setCamState("starting");
    openChosenCamera(cameraId)
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch((e) => console.warn("[camera] preview play failed", e));
        }
        setCamState("live");
        // Some Chrome builds only list a Continuity Camera once a capture is running.
        void refreshRef.current();
      })
      .catch((err) => {
        if (cancelled) return;
        setCamState(camErrorName(err));
      });
    return () => {
      cancelled = true;
    };
  }, [active, cameraId, stopStream]);

  useEffect(() => () => stopStream(), [stopStream]);

  // Safari often never fires devicechange when a Continuity Camera wakes up.
  useEffect(() => {
    if (!active || camState !== "live") return;
    const timers = [1500, 4000].map((ms) => window.setTimeout(() => void refreshRef.current(), ms));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [active, camState]);

  const chooseCamera = (id: string) => {
    userPickedRef.current = true;
    setCameraId(id);
    rememberCamera(id);
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshCameras();
    } finally {
      setRefreshing(false);
    }
  };

  const continuityListed = cameras.some((c) => isIphoneCamera(c.label));

  return { cameras, cameraId, camState, refreshing, refresh, chooseCamera, continuityListed };
}
