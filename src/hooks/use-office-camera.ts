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
    if (!permittedRef.current) {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        probe.getTracks().forEach((t) => t.stop());
        permittedRef.current = true;
      } catch (err) {
        setCamState(camErrorName(err));
        return;
      }
    }
    try {
      const list = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
      publishList(list, "refresh");
    } catch (e) {
      console.warn("[camera] refresh failed", e);
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
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        probe.getTracks().forEach((t) => t.stop());
      } catch (err) {
        if (cancelled) return;
        setCamState(camErrorName(err));
        return;
      }
      if (cancelled) return;
      permittedRef.current = true;
      try {
        const list = (await navigator.mediaDevices.enumerateDevices())
          .filter((d) => d.kind === "videoinput")
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
        if (cancelled) return;
        camerasRef.current = [];
        publishList(list, "initial");
      } catch (e) {
        if (!cancelled) {
          console.warn("[camera] list failed", e);
          setCamState("error");
        }
      }
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
    navigator.mediaDevices
      .getUserMedia({
        video: { deviceId: { exact: cameraId }, width: { ideal: 4032 }, height: { ideal: 3024 } },
        audio: false,
      })
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
