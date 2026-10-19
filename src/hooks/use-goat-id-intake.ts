"use client";
/**
 * G.O.A.T. attachments: ID pictures → one confirm card; screenshots → text to
 * ask about. Reading happens in this browser (lib/goat-id-read). Saving
 * (patient, New Patient visit, ID picture) happens only on Confirm, through the
 * same cloud-backed stores the New Patient form, Schedule and Patient Files use.
 */
import { useRef, useState } from "react";
import type { ChatMessage } from "@/lib/goat-ai/global-chat";
import { MARITAL_CHIPS, answerFromText, buildIdCard, idAddress, idPatch, idVisitRecord, isAboutScreenshot, maritalAnswer, mdyIso, parseIdRequest, phoneAnswer, withIdVisit, type IdAsk, type IdCardState } from "@/lib/goat-id";
import { createPatientRecord, updatePatientRecordById, type PatientRecord } from "@/lib/mock-data";
import { createAppointmentId, type ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import type { ScheduleSettingsConfig } from "@/lib/schedule-settings";
import { loadAppointmentTypes } from "@/lib/schedule-appointment-types";
import { loadOfficeSettings } from "@/lib/office-settings";
import { newPatientVisitType } from "@/lib/new-patient-intake";
import { normalizeMaritalStatus } from "@/lib/marital-status";
import { dayLabel } from "@/lib/goat-howto";
import { to12hLabel } from "@/lib/time-12h";

type Push = (m: Omit<ChatMessage, "id" | "at">, patientId?: string | null) => void;

export interface GoatIdDeps {
  push: Push;
  setMsg: (id: string, patch: Partial<ChatMessage>) => void;
  setPatient: (id: string) => void;
  messages: () => ChatMessage[];
  patients: () => PatientRecord[];
  openPatientId: string | null;
  /** A patient named in the typed text (strict match), else null. */
  namedPatient: (text: string) => string | null;
  today: () => string;
  appointments: () => ScheduleAppointmentRecord[];
  settings: () => ScheduleSettingsConfig;
  addAppointments: (r: ScheduleAppointmentRecord[]) => void;
}

const fileKeyFor = () => `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const firstOf = (c: IdCardState) => c.values.firstName || "the patient";

export function useGoatIdIntake(deps: GoatIdDeps) {
  /** Pictures waiting for Confirm, in memory only (never browser storage). */
  const filesRef = useRef(new Map<string, File>());
  const pendingRef = useRef<{ card: IdCardState; asks: IdAsk[]; lead: string } | null>(null);
  const [reading, setReading] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const visitCtx = () => {
    const office = loadOfficeSettings();
    return {
      appointments: deps.appointments(),
      settings: deps.settings(),
      visitType: newPatientVisitType(loadAppointmentTypes()),
      office: { provider: (office.doctorName ?? "").trim(), location: (office.officeName ?? "").trim() },
    };
  };

  const showCard = (card: IdCardState, lead: string) => {
    deps.push({ role: "goat", text: lead, practice: true, idCard: card });
  };

  /** Ask the next question, or show the card when nothing is left to ask. */
  const nextStep = () => {
    const p = pendingRef.current;
    if (!p) return;
    const ask = p.asks[0];
    if (ask === "phone") {
      deps.push({ role: "goat", text: `What's ${firstOf(p.card)}'s phone number? (needed to add the patient)`, practice: true });
      return;
    }
    if (ask === "marital") {
      deps.push({ role: "goat", text: `Marital status? (optional)`, practice: true, choices: [...MARITAL_CHIPS, "Skip"].map((m) => ({ label: m, question: m })) });
      return;
    }
    pendingRef.current = null;
    showCard(p.card, p.lead);
  };

  /** Files attached / pasted / dropped / photographed, plus whatever was typed with them. */
  const attach = async (files: File[], typed: string) => {
    for (const file of files) {
      deps.push({ role: "user", text: `📎 ${file.name || "picture"}${typed ? `\n${typed}` : ""}`, practice: true });
      setReading("Reading the picture…");
      try {
        const { readAttachment } = await import("@/lib/goat-id-read");
        const r = await readAttachment(file, setReading);
        if (r.kind === "screenshot") {
          const text = r.text.trim();
          if (!text) deps.push({ role: "goat", text: "I couldn't find any text in that picture.", practice: true });
          else if (typed && isAboutScreenshot(typed)) answerScreenshot(text, typed);
          else deps.push({ role: "goat", text: `Here's the text I read (in your browser):\n${text.split("\n").slice(0, 30).join("\n")}${text.split("\n").length > 30 ? "\n…" : ""}\n\nAsk me about it, e.g. \u201cwhat's the phone number on it?\u201d`, practice: true, screenText: text, copy: text });
          continue;
        }
        const key = fileKeyFor();
        filesRef.current.set(key, file);
        const request = parseIdRequest(typed, deps.today(), deps.settings());
        const built = buildIdCard({ read: r.id!, side: r.side, request, patients: deps.patients(), pagePatientId: deps.openPatientId, namedPatientId: typed ? deps.namedPatient(typed) : null, fileKey: key, ...visitCtx() });
        const got = Object.keys(r.id!.fields).length;
        deps.push({ role: "goat", text: `I read ${got} field${got === 1 ? "" : "s"} from the ${r.side === "back" ? "barcode on the back of the ID (exact)" : "front of the ID (please check them)"}.`, practice: true });
        pendingRef.current = built;
        nextStep();
      } catch (e) {
        console.warn("[goat-id] read failed:", e);
        deps.push({ role: "goat", text: "I couldn't read that picture. Try a clearer photo, or the back of the ID (the barcode reads best).", practice: true });
      } finally {
        setReading("");
      }
    }
  };

  const answerScreenshot = (text: string, question: string) => {
    const lines = answerFromText(text, question);
    deps.push({ role: "goat", text: lines.length ? `From the screenshot:\n${lines.map((l) => `- ${l}`).join("\n")}` : "I don't see that in the screenshot's text.", practice: true, screenText: text });
  };

  /** Typed replies while an ID / screenshot is in play. True if handled (the caller pushed nothing yet). */
  const handleReply = (question: string): boolean => {
    const p = pendingRef.current;
    if (p) {
      const ask = p.asks[0];
      if (ask === "phone") {
        const ph = phoneAnswer(question);
        if (ph) {
          deps.push({ role: "user", text: question, practice: true });
          p.card = { ...p.card, phone: ph };
          p.asks = p.asks.slice(1);
          nextStep();
          return true;
        }
        if (/^skip$/i.test(question.trim())) {
          deps.push({ role: "user", text: question, practice: true });
          p.asks = p.asks.slice(1);
          nextStep();
          return true;
        }
      } else if (ask === "marital") {
        const m = maritalAnswer(question);
        if (m) {
          deps.push({ role: "user", text: question, practice: true });
          p.card = { ...p.card, marital: m === "skip" ? "" : m };
          p.asks = p.asks.slice(1);
          nextStep();
          return true;
        }
      }
      // A day/time while asking: book the New Patient visit on the same card.
      const req = parseIdRequest(question, deps.today(), deps.settings());
      if (req.date && req.time) {
        const next = withIdVisit(p.card, req, visitCtx());
        if (next) {
          deps.push({ role: "user", text: question, practice: true });
          p.card = next;
          deps.push({ role: "goat", text: `Got it — New Patient visit ${dayLabel(req.date)} at ${to12hLabel(req.time)}.`, practice: true });
          nextStep();
          return true;
        }
      }
      // Anything else: drop the questions and show the card as it is (still needs Confirm).
      pendingRef.current = null;
      showCard(p.card, p.lead);
      return false;
    }
    const msgs = deps.messages();
    const lastGoat = [...msgs].reverse().find((m) => m.role === "goat");
    // "wednesday 1pm" right after a new-patient card: re-issue the card with the visit.
    if (lastGoat?.idCard && lastGoat.idCard.state === "open" && lastGoat.idCard.mode === "new") {
      const req = parseIdRequest(question, deps.today(), deps.settings());
      const next = req.date && req.time ? withIdVisit(lastGoat.idCard, req, visitCtx()) : null;
      if (next) {
        deps.push({ role: "user", text: question, practice: true });
        deps.setMsg(lastGoat.id, { idCard: { ...lastGoat.idCard, state: "canceled" } });
        showCard(next, "Add new patient and book their New Patient visit?");
        return true;
      }
    }
    const shot = [...msgs].reverse().find((m) => m.role === "goat" && (m.screenText || m.idCard));
    if (shot?.screenText && msgs.indexOf(shot) >= msgs.length - 4 && isAboutScreenshot(question)) {
      deps.push({ role: "user", text: question, practice: true });
      answerScreenshot(shot.screenText, question);
      return true;
    }
    return false;
  };

  const confirm = async (msg: ChatMessage) => {
    const card = msg.idCard;
    if (!card || card.state !== "open" || busyKey) return;
    setBusyKey(card.fileKey);
    try {
      let patientId = card.patientId ?? "";
      let fullName = card.patientName ?? "";
      const done: string[] = [];
      if (card.mode === "new") {
        const created = createPatientRecord({
          firstName: card.values.firstName ?? "",
          lastName: card.values.lastName ?? "",
          dob: mdyIso(card.values.dob ?? "") || undefined,
          sex: (card.values.sex as PatientRecord["sex"]) || undefined,
          maritalStatus: normalizeMaritalStatus(card.marital),
          phone: card.phone,
          address: idAddress(card.values),
          dateOfLoss: "",
          initialExam: "",
        });
        if (!created) {
          deps.setMsg(msg.id, { idCard: { ...card, notes: [...card.notes, "Couldn't add the patient — first and last name are required."] } });
          return;
        }
        patientId = created.id;
        fullName = created.fullName;
        done.push(`Added ${fullName}`);
        const rec = idVisitRecord(card, createAppointmentId(), patientId, fullName);
        if (rec) {
          deps.addAppointments([rec]);
          done.push(`booked the New Patient visit ${dayLabel(rec.date)} at ${to12hLabel(rec.startTime)}`);
        }
      } else if (card.plan) {
        const patch = idPatch(card.plan, card.useId);
        if (Object.keys(patch).length) {
          updatePatientRecordById(patientId, patch);
          done.push(`Updated ${fullName} (${Object.keys(patch).map((k) => (k === "dob" ? "DOB" : k === "sex" ? "sex" : "address")).join(", ")})`);
        } else done.push(`No changes to ${fullName}`);
      }
      const file = filesRef.current.get(card.fileKey);
      if (card.saveId && file) {
        const { saveIdToPatientFile } = await import("@/lib/goat-id-save");
        const s = await saveIdToPatientFile(patientId, fullName, file, card.side);
        done.push(s.ok ? `saved "${s.name}" to Patient Files` : `couldn't save the ID picture (${s.error}) — upload it on the patient page`);
      } else if (card.saveId) done.push("the picture is no longer here (page reloaded), so attach it again to save it");
      filesRef.current.delete(card.fileKey);
      deps.setMsg(msg.id, { idCard: { ...card, state: "done", savedPatientId: patientId, result: `✓ ${done.join("; ")}.` }, patientId, patientName: fullName });
      // Follow-ups ("oh also add a note to check their prescription") now mean this patient.
      deps.setPatient(patientId);
    } finally {
      setBusyKey("");
    }
  };

  const cancel = (msg: ChatMessage) => {
    if (!msg.idCard) return;
    filesRef.current.delete(msg.idCard.fileKey);
    deps.setMsg(msg.id, { idCard: { ...msg.idCard, state: "canceled" } });
  };

  return { attach, handleReply, confirm, cancel, reading, busy: Boolean(busyKey) };
}
