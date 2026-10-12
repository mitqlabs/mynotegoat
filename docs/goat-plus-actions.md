# G.O.A.T. + mode: actions (Phase 2 design, not built)

Phase 1 (this PR) gives + mode **read-only tools**. The local model picks tools, NoteGoat runs them on this browser's data, and the model writes the answer. The tools are `searchPatients`, `getTodos`, `caseCounts`, `listCases`, `findContact`, `getSchedule` and `findSetting` (`src/lib/goat-practice.ts`). Phase 2 adds **write actions** using the same loop. The difference is that a write tool never writes. It only returns a **proposal**, and the app writes after the user taps Confirm on a card.

## Principles
1. **Confirm-first.** The model can propose, but only the user's tap on a card commits. No write happens from model text alone.
2. **Deterministic checks.** Availability, conflicts and validation run in app code, never in the model.
3. **Same store, same path.** Appointments are created through `useScheduleAppointments().addAppointment` / `saveScheduleAppointments`, which does the Supabase dual-write and logs to the Activity Log. That way + mode writes behave exactly like a manual booking.
4. **Everything local.** Nothing is sent to a server except the normal app save.

## Example: "schedule armen thursday at 1pm"
1. **Parse** (model tool call): `proposeAppointment {"patient":"armen","date":"thursday","time":"1pm","type"?:string}`.
2. **Resolve the patient**: `searchPatients`. If there's one confident match, use it. Otherwise show "Did you mean" buttons, the same as the patient chat.
3. **Resolve the date and time** in code. "thursday" means the next Thursday from today in the office timezone, and "1pm" becomes 13:00. Anything ambiguous ("next week") is asked back.
4. **Appointment type**: default to the patient's usual type (the most common of their last 5 visits) or the office default. The card shows a dropdown of the office's appointment types.
5. **Availability** (code): check office hours and holidays (Settings → Schedule), the room or provider, and existing appointments at that time.
   - **Free**: show the card.
   - **Taken**: offer **2 open slots before and 2 after** at the office interval, plus **Pick another time** and **Book anyway (override)**. Override sets `overrideOfficeHours` the same way the manual modal does.
6. **Confirmation card**: shows the patient, date, time, type, provider and room, with **Confirm** and **Cancel**. Nothing is written before Confirm.
7. **Commit** on Confirm: add the appointment through the normal hook, then show "Booked Thu 10/15 at 1:00 PM for Armen …" with an Open schedule link. Cancel discards the proposal.
8. **Safety**:
   - A proposal expires after 10 minutes or after the next question.
   - The card is required even if the model says "booked".
   - Every action is written to the Activity Log as "via G.O.A.T. + mode".
   - Read-only staff never see write tools (`useWorkspaceAccess`).

## Later actions using the same pattern
Reschedule or cancel an appointment, add a to-do, mark a to-do done, and change a case status. Each one is a `propose*` tool, code validation, a card, then the normal store write.

## Model assessment and recommendation
- **Qwen3-4B (q4f16, ~2.3 GB, current default).** Its tool selection in Qwen3's published function-calling results (BFCL) is solid for its size. It handles a small fixed tool list with JSON output well. It is less reliable at multi-step chains, at filling arguments from long histories, and at strict JSON every time, especially in no-thinking mode. Phase 1 handles this by:
  - running the tool pick at temperature 0 with a short schema prompt;
  - validating tool names against an allow-list and turning arguments into strings;
  - falling back to rule-based tool calls whenever the JSON isn't valid;
  - computing every number in code, so the model only phrases the answer.
  - **This is reliable enough for read-only tools.** For writes, the confirm card and the code checks make a wrong pick harmless: the user sees the wrong proposal and cancels.
- **Qwen2.5-1.5B (fast option).** Its tool picks are noticeably weaker, and the rules fallback will do most of the work. It's fine for older computers, but the phrasing is plainer.
- **Larger models (Qwen3-8B, ~5 GB).** These are better at multi-turn tool use, but the download is too big and many office laptops' graphics chips don't have enough memory. Not recommended in the browser for now.
- **Recommendation.** Keep **Qwen3-4B** as the default and keep the rules fallback.
  - Before shipping Phase 2, add a small offline evaluation of about 100 recorded office questions to `llm-eval/`, measuring tool-pick accuracy and the JSON-valid rate.
  - Ship write actions only if the tool pick is at least 95% correct on that set. The confirm card stays mandatory either way.
  - Revisit when web-llm adds native function calling for Qwen3, or when a 3–4B model with better tool scores gets an MLC build.
