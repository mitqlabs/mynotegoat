/**
 * Patient-as-folder preview switch.
 *
 * DEFAULT OFF. The live app does not read localStorage for this. It turns on
 * only when NEXT_PUBLIC_PATIENT_FOLDERS is exactly "on" at build time, or
 * after the demo office login has been confirmed for this tab.
 * Do not set that on production, and do not set it on a Vercel preview that
 * uses the production database. With the switch off, none of the folder
 * pages, nav items, or person-field guards run.
 */
import { demoFoldersActive } from "@/lib/demo-office";

export function patientFoldersEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PATIENT_FOLDERS === "on" || demoFoldersActive();
}
