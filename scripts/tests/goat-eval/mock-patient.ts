/** Made-up patient, doctors and file text for the G.O.A.T. eval. No real patient data. */
import type { GoatContext } from "../../../src/lib/goat";
import type { GoatFile } from "../../../src/lib/goat-docs";

const file = (id: string, name: string, pages: string[]): GoatFile => ({ id, name, folder: "Records", uploaded: "2026-03-01", status: "read", pages } as GoatFile);

export const FILES: GoatFile[] = [
  file("f-ref", "Specialist Referral - DR. JANE MOCKERTON.pdf", [
    "SPECIALIST REFERRAL FORM\nPatient: Testpatient, Kara\nDate of Injury: 12/01/2025\nRefer to: Dr. Jane Mockerton — Pain Management\nDate of Referral: 01/20/2026\nReason: neck and low back pain",
  ]),
  file("f-pm", "Specialist Report - DR. JANE MOCKERTON.pdf", [
    "JANE MOCKERTON, M.D.\nInterventional Pain Management\nPatient: Kara Testpatient\nConsultation Visit\n\n02/25/2026\nHISTORY: Neck and low back pain after MVA on 12/01/2025.",
    "PHYSICAL EXAM\nRange of Motion:\nCervical flexion 35 degrees with pain\nCervical extension 40 degrees with pain\nLumbar flexion 60 degrees with pain\nASSESSMENT:\nM54.2 Cervicalgia\nM54.50 Low back pain\nRECOMMENDATIONS:\nRecommend lumbar epidural steroid injection at L4-L5.\nAs an alternative, continue chiropractic care 2x per week.\nMedications: Ibuprofen 600 mg as needed\nFollow up in 4 weeks.",
  ]),
  file("f-xr", "XR Cervical Spine - Mockview Imaging.pdf", [
    "MOCKVIEW IMAGING\nCERVICAL SPINE X-RAY, 3 VIEWS\nExam Date: 12/10/2025\nFINDINGS:\nStraightening of the normal cervical lordosis.\nNo fracture.\nIMPRESSION:\nStraightening of the cervical lordosis, may reflect muscle spasm.\nNo acute fracture.",
  ]),
];

export function mockContext(over: Partial<GoatContext> = {}): GoatContext {
  return {
    today: "2026-10-12", patientName: "Testpatient, Kara", dob: "1985-04-02", phone: "", email: "", address: "", alerts: [], attorney: "", caseStatus: "", lien: "", review: "", isCashPatient: false,
    doi: "2025-12-01", initialExam: "2025-12-03", priorCare: "", xrayFindings: "", mriFindings: "", specialistRecommendations: "",
    imaging: [{ modality: "X-Ray", center: "Mockview Imaging", regions: ["Cervical"], sentDate: "2025-12-05", scheduledDate: "", doneDate: "2025-12-10", reportReceivedDate: "", reportReviewedDate: "", findings: "", refused: false }],
    specialists: [], notes: "", plans: [], diagnoses: [], details: null, billing: null,
    encounters: [],
    appointments: [
      { date: "2026-09-28", startTime: "10:00", type: "Follow-Up Visit", status: "Check Out" },
      { date: "2026-10-06", startTime: "10:00", type: "Follow-Up Visit", status: "Check Out" },
      { date: "2026-10-15", startTime: "11:30", type: "PI Re-Exam", status: "Scheduled" },
    ],
    termGroups: [{ id: "pm", terms: ["PM", "pain management", "Mockerton"], updatedAt: "" }],
    people: [{ name: "Dr. Jane Mockerton", specialty: "Pain Management" } as never],
    files: FILES,
    ...over,
  };
}
