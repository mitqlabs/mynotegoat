"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollLock } from "@/components/scroll-lock";
import { CameraPicker, cameraProblemText } from "@/components/camera-picker";
import { useOfficeCamera } from "@/hooks/use-office-camera";
import {
  idImageName,
  idWrite,
  matchIdPatients,
  nameConflict,
  planIdUpdate,
  valuesFromRead,
  type IdFormValues,
  type IdPatchKey,
  type IdPatientLike,
  type IdRead,
  type IdUpdatePlan,
} from "@/lib/id-scan";
import { readIdPhoto } from "@/lib/id-scan-read";

export interface IdScanResult {
  values: IdFormValues;
  /** Set when Confirm should update this patient. Absent when it only fills the New Patient form. */
  update?: { patientId: string; patientName: string; patch: ReturnType<typeof idWrite> & { fullName?: string } };
  saveImage: boolean;
  file: File | null;
}

type ImageCaptureLike = { takePhoto: () => Promise<Blob> };
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

function loadImage(blob: Blob): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that picture"));
    };
    img.src = url;
  });
}

function canvasFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(new File([b], name, { type: "image/jpeg" })) : reject(new Error("Couldn't save the picture"))),
      "image/jpeg",
      0.92,
    );
  });
}

const inputClass = "w-full min-w-0 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2";

/**
 * Scan a license with the computer's camera (including a Continuity Camera).
 * Confirm fills the New Patient form or updates the patient. It never creates a patient by itself.
 */
export function IdScanModal({
  open,
  onClose,
  onConfirm,
  patient = null,
  patients = [],
  allowMatch = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (result: IdScanResult) => void;
  /** Chart this was opened on. Confirm updates this person. */
  patient?: IdPatientLike | null;
  /** Used only when allowMatch and there is no chart patient. */
  patients?: IdPatientLike[];
  /** G.O.A.T. away from a chart: one name+DOB match can be updated. The New Patient form never does this. */
  allowMatch?: boolean;
}) {
  const [phase, setPhase] = useState<"camera" | "reading" | "confirm">("camera");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const camera = useOfficeCamera(open && phase === "camera", videoRef, streamRef);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [read, setRead] = useState<IdRead | null>(null);
  const [side, setSide] = useState<"front" | "back">("back");
  const [values, setValues] = useState<IdFormValues | null>(null);
  const [preview, setPreview] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saveImage, setSaveImage] = useState(true);
  const [useId, setUseId] = useState<Partial<Record<IdPatchKey | "name", boolean>>>({});

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const resetShot = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview("");
    setFile(null);
    setRead(null);
    setValues(null);
    setUseId({});
    setStatus("");
    setMessage("");
    setPhase("camera");
  };

  const close = () => {
    if (preview) URL.revokeObjectURL(preview);
    onClose();
  };

  const ingest = async (canvas: HTMLCanvasElement) => {
    setPhase("reading");
    setMessage("");
    setStatus("Looking for the barcode…");
    try {
      const result = await readIdPhoto(canvas, setStatus);
      const next = valuesFromRead(result.read);
      const jpeg = await canvasFile(canvas, idImageName(result.side, next.lastName, next.firstName));
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(jpeg));
      setFile(jpeg);
      setRead(result.read);
      setSide(result.side);
      setValues(next);
      setUseId({});
      setPhase("confirm");
      setStatus("");
    } catch (e) {
      console.warn("[id-scan] read failed", e);
      setPhase("camera");
      setStatus("");
      setMessage("Couldn't read that picture. Try again.");
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!video || !track) return;
    setMessage("");
    try {
      let canvas: HTMLCanvasElement | null = null;
      const IC = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
      if (IC) {
        try {
          canvas = await loadImage(await new IC(track).takePhoto());
        } catch {
          canvas = null;
        }
      }
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        if (!canvas.width || !canvas.height) {
          setMessage("The camera isn't ready yet. Try Capture again.");
          return;
        }
        canvas.getContext("2d")!.drawImage(video, 0, 0);
      }
      await ingest(canvas);
    } catch {
      setMessage("That picture didn't take. Try Capture again.");
    }
  };

  const confirm = () => {
    if (!values) return;
    const target = resolveTarget(patient, allowMatch ? patients : [], values);
    let update: IdScanResult["update"];
    if (target) {
      const plan = planIdUpdate(target, {
        lastName: values.lastName,
        firstName: values.firstName,
        dob: values.dob,
        sex: values.sex,
        street: values.street,
        unit: values.unit,
        city: values.city,
        state: values.state,
        zip: values.zip,
      });
      const patch = idWrite(plan, useId);
      const name = nameConflict(target.fullName, values.lastName, values.firstName);
      if (name && useId.name) patch.fullName = name.fromId;
      update = { patientId: target.id, patientName: target.fullName, patch };
    }
    const named = file && values ? new File([file], idImageName(side, values.lastName, values.firstName), { type: file.type }) : file;
    onConfirm({ values, update, saveImage: saveImage && !!named, file: saveImage ? named : null });
  };

  if (!open) return null;

  const target = values ? resolveTarget(patient, allowMatch ? patients : [], values) : null;
  const plan: IdUpdatePlan | null = target && values
    ? planIdUpdate(target, {
        lastName: values.lastName,
        firstName: values.firstName,
        dob: values.dob,
        sex: values.sex,
        street: values.street,
        unit: values.unit,
        city: values.city,
        state: values.state,
        zip: values.zip,
      })
    : null;
  const name = target && values ? nameConflict(target.fullName, values.lastName, values.firstName) : null;
  const problem = cameraProblemText(camera.camState);

  return (
    <div className="modal-overlay fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/45 px-4 py-6">
      <ScrollLock />
      <section className="panel-card w-full max-w-3xl p-5" data-testid="id-scan">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-semibold">{phase === "confirm" ? "Check this ID" : "Scan ID"}</h3>
          <button className="btn btn-secondary btn-sm" onClick={close} type="button">
            Close
          </button>
        </div>

        {phase === "camera" && (
          <>
            <div className="mt-3">
              <CameraPicker
                cameraId={camera.cameraId}
                cameras={camera.cameras}
                continuityListed={camera.continuityListed}
                onChange={camera.chooseCamera}
                onRefresh={() => void camera.refresh()}
                refreshing={camera.refreshing}
              />
            </div>
            <video
              className="mt-3 max-h-[46vh] w-full rounded-xl bg-black object-contain"
              muted
              playsInline
              ref={videoRef}
              style={{ display: camera.camState === "live" ? "block" : "none" }}
            />
            {camera.camState !== "live" && problem && <p className="mt-3 text-sm">{problem}</p>}
            {message && <p className="mt-2 text-sm font-semibold text-[#b43b34]">{message}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-primary" disabled={camera.camState !== "live"} onClick={() => void capture()} type="button">
                Capture
              </button>
              <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} type="button">
                Use a picture
              </button>
            </div>
            <input
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                void loadImage(f).then((c) => ingest(c)).catch(() => setMessage("Couldn't read that picture. Try a JPG or PNG."));
              }}
              ref={fileRef}
              type="file"
            />
          </>
        )}

        {phase === "reading" && <p className="mt-3 text-sm">{status || "Reading the ID…"}</p>}

        {phase === "confirm" && values && read && (
          <div className="mt-3" data-testid="id-confirm">
            <p className="text-sm">
              {target
                ? `Confirm updates ${target.fullName}.`
                : "Confirm fills the New Patient form. It does not create the patient."}
            </p>
            {read.notes.map((n) => (
              <p className="mt-1 text-sm" key={n}>
                {n}
              </p>
            ))}
            <div className="mt-3 flex gap-4">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="ID" className="h-28 w-auto rounded border border-[var(--line-soft)]" src={preview} />
              )}
              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold">
                  Last name
                  <input className={inputClass} onChange={(e) => setValues({ ...values, lastName: e.target.value })} value={values.lastName} />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  First name
                  <input className={inputClass} onChange={(e) => setValues({ ...values, firstName: e.target.value })} value={values.firstName} />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  DOB
                  <input className={inputClass} onChange={(e) => setValues({ ...values, dob: e.target.value })} placeholder="MM/DD/YYYY" value={values.dob} />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Sex
                  <select className={inputClass} onChange={(e) => setValues({ ...values, sex: e.target.value as IdFormValues["sex"] })} value={values.sex}>
                    <option value="">—</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
                  Street
                  <input className={inputClass} onChange={(e) => setValues({ ...values, street: e.target.value })} value={values.street} />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Unit
                  <input className={inputClass} onChange={(e) => setValues({ ...values, unit: e.target.value })} value={values.unit} />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  City
                  <input className={inputClass} onChange={(e) => setValues({ ...values, city: e.target.value })} value={values.city} />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  State
                  <input className={inputClass} maxLength={2} onChange={(e) => setValues({ ...values, state: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} value={values.state} />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  ZIP
                  <input className={inputClass} onChange={(e) => setValues({ ...values, zip: e.target.value.replace(/[^\d-]/g, "") })} value={values.zip} />
                </label>
              </div>
            </div>
            {name && (
              <fieldset className="mt-3 text-sm">
                <legend className="font-semibold">Name on file is {name.current}.</legend>
                <label className="mr-4 mt-1 inline-flex items-center gap-1">
                  <input checked={!useId.name} name="id-name" onChange={() => setUseId({ ...useId, name: false })} type="radio" />
                  Keep on file
                </label>
                <label className="inline-flex items-center gap-1">
                  <input checked={!!useId.name} name="id-name" onChange={() => setUseId({ ...useId, name: true })} type="radio" />
                  Use ID ({name.fromId})
                </label>
              </fieldset>
            )}
            {plan?.conflicts.map((c) => (
              <fieldset className="mt-2 text-sm" key={c.key}>
                <legend className="font-semibold">
                  {c.label} on file is {c.current}.
                </legend>
                <label className="mr-4 mt-1 inline-flex items-center gap-1">
                  <input checked={!useId[c.key]} name={`id-${c.key}`} onChange={() => setUseId({ ...useId, [c.key]: false })} type="radio" />
                  Keep on file
                </label>
                <label className="inline-flex items-center gap-1">
                  <input checked={!!useId[c.key]} name={`id-${c.key}`} onChange={() => setUseId({ ...useId, [c.key]: true })} type="radio" />
                  Use ID ({c.fromId})
                </label>
              </fieldset>
            ))}
            {plan && plan.fills.length > 0 && (
              <p className="mt-2 text-sm">Fills in: {plan.fills.map((f) => `${f.label} ${f.value}`).join(", ")}.</p>
            )}
            <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
              <input checked={saveImage} onChange={(e) => setSaveImage(e.target.checked)} type="checkbox" />
              Save ID image to Files
            </label>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button className="btn btn-secondary" onClick={resetShot} type="button">
                Retake
              </button>
              <button className="btn btn-primary" data-testid="id-confirm-button" onClick={confirm} type="button">
                Confirm
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function resolveTarget(patient: IdPatientLike | null, patients: IdPatientLike[], values: IdFormValues): IdPatientLike | null {
  if (patient && !patient.deleted) return patient;
  const matches = matchIdPatients(
    { lastName: values.lastName, firstName: values.firstName, dob: values.dob },
    patients,
  );
  return matches.length === 1 ? matches[0] : null;
}
