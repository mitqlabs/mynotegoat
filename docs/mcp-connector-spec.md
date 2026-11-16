# NoteGoat connector spec

This is a design only. It adds no app code, no database change, no environment variable, and no data change. Production, including Supabase project `ywmxnyacponabxgxjzed`, stays untouched.

NoteGoat is the Next.js app on Vercel, with Supabase underneath. This spec describes a remote MCP server on that same app so each office can connect **its own** AI (Claude, ChatGPT, a Grok bot, or another MCP client) and use NoteGoat as a personal assistant. The connected AI becomes that office's **G.O.A.T.** The name is always written with the dots.

Web G.O.A.T. and AI G.O.A.T. stay separate. Web G.O.A.T. is the page, the briefing boxes, and the chat that already live inside NoteGoat. AI G.O.A.T. is the office's own assistant, running in Claude, ChatGPT, a Grok bot, or another app they connect. This connector does not replace web G.O.A.T., and it does not add an AI chat box inside NoteGoat. People keep talking to their AI in that AI's app. NoteGoat gives them a settings and help page, a sign-in, and the records their login can already see.

## Hard rules

1. NoteGoat never calls an AI model, and never spends the owner's API key on one. All reasoning happens in the AI account the office connects. The server returns records and instructions. It does not summarize them with a model.
2. The connector exposes chosen actions and chosen fields. It never returns source code, the git repo, environment variables, secrets, service-role keys, delete-password hashes, mail refresh tokens, or another person's session.
3. Each person signs in with their own NoteGoat login. The connector sees only what that person's role and office membership already allow inside NoteGoat.
4. Reads and writes run as that person. Row Level Security applies. The service-role key is not a back door. The one existing exception is called out under G.O.A.T. Mail.
5. Phase 1 is read-only. Phase 2 writes are create-patient, add-case, and an MRI referral. All three reuse the functions the app already uses. All three stop and wait for an explicit yes. Nothing is created on a guess.
6. The connector never edits an existing SOAP note. It never sends mail, deletes mail, or marks mail read. "Send an MRI" means fill the referral and save the PDF on the chart. It never emails or faxes that PDF. The person sends it themselves.
7. The feature ships off. An office owner turns it on for that office. Until both switches are on, the route does not exist for that office.
8. Web G.O.A.T. and AI G.O.A.T. stay separate. NoteGoat does not grow an AI chat box. Morning, end-of-day, Monday, and Friday routines run on a schedule inside the office's own AI app. NoteGoat does not run those clocks and does not call a model when they fire.

## What the connected AI is

The connected AI is the office's G.O.A.T. It greets in the G.O.A.T. voice, answers from NoteGoat records, and prepares work the person still has to approve.

It is a personal assistant for the signed-in user, not a second product with its own permissions. If Staff cannot open Billing in NoteGoat, G.O.A.T. cannot quote balances. If an owner can open Settings, G.O.A.T. can describe the settings that owner can see, and still withholds passwords and secrets.

The MCP handshake includes server instructions, a persona prompt, and a short office guide resource. Those texts tell the AI how to behave. They are not a model call from NoteGoat.

### Server instructions

Put this in the MCP `instructions` field. Keep it short enough that clients actually send it.

> You are G.O.A.T., the personal assistant for this NoteGoat office. Speak in plain English, in complete sentences. Use the name G.O.A.T. with the dots. Answer only from tool results. Do not answer with a clipped label such as "3 left, last 11/28". If a tool says the person cannot see that area, say so and stop. Do not invent patients, dates, balances, or attorneys. Today follows the office timezone returned by goat_whoami. When the office has more than one location, ask or accept "all locations" versus one location, and say which scope you used. Reads are immediate. Writes are not. To create a patient, add a case, or prepare an MRI referral, call the prepare tool, show the preview in your own words, and wait. Call confirm only after the person clearly agrees. A vague "ok" after a different question is not agreement. "Send an MRI" saves a PDF on the chart. It does not email or fax anyone. Never claim you edited a SOAP note, sent email, faxed a referral, or marked email read. You cannot see source code, passwords, or other offices.

### Prompt and resources

| Name | Kind | What it gives the AI |
| --- | --- | --- |
| `goat-persona` | MCP prompt | The voice and the habits: greet with the time of day, lead with what needs attention, name the location scope, cite the patient and the date you used, ask a follow-up only when a tool returned an open question (compound last name, missing phone, which attorney). Every reply is plain, complete sentences. |
| `goat://persona` | Resource, `text/plain` | The same persona, so a client that ignores prompts can still read it. |
| `goat://office-guide` | Resource, `text/plain` | A plain-language map of this office: office name, locations, what this user can open, whether SOAP text is shared, the word the office uses (Lien or LOP), and how a case number is built. Built per request from records this user can see. No raw settings blob. |

The persona resource includes the greeting rule the page already uses: Good Morning before noon, Good Afternoon from noon until 5:00 PM, Good Evening from 5:00 PM on, then "Happy" and the date, in the office timezone.

### How answers are spoken

The words the person hears are plain, complete sentences. A tool may return counts and dates as structured fields. The AI turns those fields into sentences. It does not read the field names out loud, and it does not answer with a fragment such as "3 left, last one on 11/28/2026". One fact can be its own sentence. Two related facts can share a sentence when that still reads naturally. Use he or she only when the chart's sex is Male or Female. When sex is blank, repeat the patient's name.

## How an office is really stored

This is from the code. There is no separate `offices` table and no `locations` table.

**One login owner is one office.** The workspace id is `<owner auth user id>:<office id>`. The office id defaults to `main-office`. Patients, appointments, encounter notes, files, and the settings bag are all rows in that workspace.

**A member is not a second office.** `workspace_members` links `member_user_id` to `workspace_owner_id`. The lookup takes one row. A person works inside one owner's workspace. Dr. Abi Mitchell's Texas practice is one owner and one workspace, not three accounts.

**Locations are settings, not tenants.** When Multi-Location is on, `OfficeSettings.locations` holds the buildings (id, nickname, address, phone, doctors, hours). That object lives in the workspace settings bag (`casemate.office-settings.v1`), which is mirrored to `workspace_kv`. A patient row has `location_id`. An appointment has a location label. "Three Texas locations under one owner" is three location records in one workspace.

**Location is a filter, not a lock.** The Patients list and the Schedule can show all locations, one location, or "No office set". A member's `mainLocationId` is the location they land on at login. They can still switch. The database does not hide other locations from them. The connector does the same: it can answer across every location in the workspace, or one location, and it says which. It does not pretend a front-desk user at one building is forbidden from the others, because NoteGoat does not forbid that today.

**Roles live on the member, and the owner has no member row.**

| Who | How the code knows | What they can open |
| --- | --- | --- |
| Owner | No `workspace_members` row. Their user id is the workspace prefix. | Everything the office has switched on, including Settings and Team. |
| Admin | `permissions.roleTier = "admin"`, or the older `permissions.officeAdmin = true`. | Same pages as the owner. Only the owner can grant or remove Admin. Admins edit the role grid only if the owner turned that on. |
| Manager | `roleTier = "manager"`. | The Manager column in Settings → Roles & Permissions. Billing is off in the default grid. Dashboard business numbers stay admin-only. |
| Staff | `roleTier = "staff"`, or an old member with no role and no admin flag. | The Staff column. Default is day-to-day pages, billing off, deletes off. |
| Disabled | `permissions.disabled = true`. | Cannot use NoteGoat. The connector refuses them. |

Page access is the role grid, capped by office module visibility. Patients and Settings cannot be hidden office-wide. Settings stays admin-only in the role grid. A hidden patient-page section (`permissions.hiddenSections`, or the office hide) is hidden here too. The money half of Additional Details is its own section, `billingFigures`. A person can see discharge dates and still be blocked from billed / paid / owed.

**Row Level Security is wider than the screen.** `can_access_owner` lets the owner, and any member who is not disabled, read and write the office's patients, encounter notes, appointments, files, and `workspace_kv`. Staff who "cannot see Billing" are stopped by the app, not by a billing policy. The role-settings row is the exception the database does guard. The connector must apply the same screen checks before it returns data, and it must still query with the user's own login so a bug cannot cross into another owner's workspace.

The browser fails open to "owner" if the membership lookup errors, so a real owner is never locked out. The connector fails closed. A lookup error returns "I can't verify your access" and reads nothing. A lookup that correctly finds no member row still means owner.

Account approval still applies. A login that is pending, rejected, or suspended cannot use the connector.

**There is no patient photo column.** A photo is a file in My Files or on the patient, same as a scan. The connector can name that file when the person can see files. It does not invent a headshot field.

**"Self" is the attorney sentinel.** An empty attorney is stored as `Self`. Cash / non-PI patients are `Self` and skip the attorney, injury date, and case-number workflow. Attorney cleanup skips `Self` because it is not a firm. Answers say "no attorney" for `Self` unless the person asked for the stored word.

## What Phase 1 can view

Every area below is a tool the person can call when NoteGoat would let them open that area. If the area is off for the office, or the role cannot view it, the tool returns a short refusal and no rows. Hidden patient-page sections come back as empty, the way in-app G.O.A.T. already passes them as null.

| Area | NoteGoat gate | What comes back |
| --- | --- | --- |
| Patient List and the patient page | `patients` view. Hidden panels dropped per person. | Name, DOB, phone, email, address, sex, marital status, location, cash flag, alerts, compliance if the office uses it. General notes from case notes, falling back to the old notes field, only if the notes panel is visible. |
| Cases | Same as patients. | Attorney (with `Self` explained), date of injury, extra injury dates, case number, status, lien or LOP stage, Initial Exam, discharge, R&B sent, related cases. Case number uses the stamp on the patient, or the office format when there is no stamp. The default format is date of injury as MMDDYY plus the first two letters of the last name plus the first two letters of the first name. |
| Schedule | `appointments` view. | Visits with time, type, status, provider, location, room. Status values stay the stored ones: Scheduled, Check In, Check Out, Canceled, No Show, Reschedule. Labels say Checked In and Checked Out. |
| Encounters | `encounters` view. | Date, provider, type, signed or not, diagnosis names, charge totals. |
| SOAP text | Encounters view, **and** the office SOAP switch, default off. | Subjective, objective, assessment, plan. With the switch off, G.O.A.T. can still say a note exists. It cannot quote it. Existing notes are never edited. |
| Key Dates | `keyDates` view. | Office closed / covered / open days, reasons, special hours. These are office calendar days, not clinical exam dates. Clinical dates stay on the case. |
| Billing | `billing` view, and the `billingFigures` panel when the question is about a chart. | Billed, paid, paid date, adjustments, owed. Billed uses the patient-page rule: the sum of encounter charges when that sum is greater than zero, otherwise the stored billed figure. Owed is billed minus paid, and not below zero. |
| Contacts | `contacts` view. | Name, category, phone, email, address. Attorney contacts feed the case list. |
| My Files | `myFiles` view, and the patient-files panel on a chart. | File name, folder, date, type, size. Phase 1 returns metadata, not the file bytes. |
| Messages | `messages` view. | Thread titles and unread state this user can see. |
| G.O.A.T. Page and G.O.A.T. Mail | Page boxes follow the same admin split as the chat chips. Mail requires the office mailbox to be connected. | Described under the briefing tools. |
| Dashboard | `statistics` view for the page. The business-numbers section stays owner/admin only, matching `canSeeDashboardSection`. Managers can see Weekly Summary, Reviews, and Activity Log only when those boxes are on for Manager. | The same counts the page shows. No export of the raw activity payload beyond what that role can read. |
| Settings the user can see | Owner or Admin, and only the screens Settings shows them. | Office name, locations, hours, doctors, case statuses, Lien vs LOP, case-number format, which modules are on, role names. |
| Timers, Marketing, Handbook | The matching module, when it is on and the role can view it. | The same lists the page shows. |

Settings answers never include the delete password, its hash, its salt, Stripe secrets, Supabase keys, or the Microsoft mail secret.

G.O.A.T. admin boxes stay admin boxes. Appointment Check, Quick Biz, and Case Review are for the owner and admins, same as the chat. Everyone with access to the page can use G.O.A.T. Mail and Today's Schedule. A Staff person who asks for Quick Biz gets the same idea as today's reply: office numbers are for admins, and Today's Schedule is still available.

## Auth

People already sign in to NoteGoat with email and password through Supabase Auth. MCP clients expect OAuth. NoteGoat becomes the authorization server for this connector. It does not ask the office to paste a NoteGoat password into Claude or ChatGPT.

1. The AI app sends the person to NoteGoat.
2. They sign in on the normal NoteGoat login if they are not already signed in.
3. A consent screen names the AI app and says, in plain language, that G.O.A.T. will see whatever this login can already see, that SOAP text is included only when the office turned that on, and that creating a patient still requires a second yes in that AI app. The consent screen is not a chat.
4. NoteGoat stores a connector session for that user and that client, and returns the usual OAuth authorization code. The code exchange uses PKCE.
5. Later calls send the connector access token. The server loads the matching NoteGoat user, refreshes that user's own Supabase session with the public anon key, and queries with that user's JWT. Row Level Security then sees the same `auth.uid()` the app sees.

Token storage:

- Access tokens are short-lived (about one hour) and opaque. They are not Supabase service keys and they are not put in the URL.
- Refresh tokens are stored encrypted, one row per client connection, with the user id, the workspace id, the client name, and the created time. The browser cannot read that table.
- The user's Supabase refresh token, captured at consent, is stored encrypted beside it so the server can keep acting as that user. Losing it means the person signs in again. It is never returned to the AI.

Revocation:

- The person can disconnect their own client from the G.O.A.T. Connector page.
- The owner, and an admin, can disconnect anyone in the office.
- Turning the office switch off revokes every connection in that workspace.
- Disabling the member, or suspending the account, makes the next call fail even if the token has not expired.
- Rotating or deleting the stored Supabase refresh token forces a fresh login.

Owner switch:

- Default off, stored with the office settings the owner controls (`casemate.mcp-connector.v1` is the proposed key).
- Only the owner can turn the office on or off. Admins cannot.
- Turning it on asks for the office timezone, because "today" on the G.O.A.T. Page uses the computer's clock and the server has no clock of its own. That timezone is what "today", the greeting, and "this week" use.
- A second owner switch, SOAP text, defaults off. It can be on only when the connector itself is on.

Clients should be registered NoteGoat knows about (Claude, ChatGPT, Grok, and a local test client). Dynamic registration of arbitrary clients stays off until the owner asks for it.

## G.O.A.T. Connector page

NoteGoat gets one new page named **G.O.A.T. Connector**. It is a settings and help page. It has a switch, a short explanation, a connect button, and a list of prompts the person can copy. It has no message box, no send button, and no streaming reply. Typing a question to an AI stays in the AI's own app.

Web G.O.A.T. keeps its own page and its own chat. Those screens are not wired to Claude, ChatGPT, or Grok. The Connector page does not sit inside that chat and does not reuse its composer.

Who can open it:

- Any active member can open the help and the tips, because each person connects their own login. Settings in NoteGoat is otherwise owner and admin only, so this page is its own route, linked from the G.O.A.T. Page and from Settings → G.O.A.T. for people who can open Settings.
- The on/off switch, the office timezone, the SOAP-text switch, and "disconnect everyone" are on that same page and visible only to the owner.
- An admin can open the help and can disconnect a connection, and cannot flip the office switch.
- When the owner has not turned the office on, members see one line: ask the owner to turn on G.O.A.T. Connector. They do not see a chat.

What the page is for:

- Explain that AI G.O.A.T. runs in the office's AI app, on that app's account, and that NoteGoat never calls a model.
- Explain that a routine ("every morning at 8:00") is a schedule the person sets in Claude, ChatGPT, or their Grok bot. NoteGoat does not store that schedule and does not fire it.
- Show how to connect, which is the OAuth sign-in already described. The person comes back to this page already connected. They can disconnect themselves here.
- Show **Tips: things to tell your AI.** Each tip is a prompt they copy and paste into their AI, then set that AI's own reminder or scheduled task if they want it to repeat.

Each tip respects the person looking at the page, and the connector enforces that again when the prompt actually runs.

- The Friday billing tip is shown only when this login can see Billing. Everyone else sees a line that billing routines are hidden for their role. The Monday tip stays visible and is labeled owner and admin, because the words are still useful and the connector will refuse the numbers if this login cannot see them.
- A tip that mixes areas still runs after they paste it. Any part their role cannot see comes back as a refusal for that part only. The morning briefing does not start returning Quick Biz to Staff just because the words were copied from this page.
- The copied words tell the AI to use the signed-in person's permissions, to say which locations it used, and to wait for a yes before creating a patient.

These are the starter tips. The page shows them as copy blocks, in this order.

**Every working morning**

> Every working business morning at 8:00, give me my G.O.A.T. briefing: today's schedule per location, who's new, re-exams due, pending New Patient Intake from G.O.A.T. Mail, to-dos and alerts.

Shown to anyone who can view the schedule or the patient list. G.O.A.T. Mail is included because mail is one of the boxes everyone with the page can use. The 8:00 clock is the AI app's schedule, in the office timezone from `goat_whoami`. "Who's new" means today's new-patient visits. "Re-exams due" means saved re-exam dates and re-exam visits, the same definition as `reexam_this_week`.

**End of day**

> End of day: who didn't check in, unsigned or unfinished notes, cases discharged but not submitted, tomorrow's first patients.

This is the End of Day Handoff, asked from the AI app. "Who didn't check in" is still Scheduled today. Unsigned notes are returned only when this person can view Encounters. Discharged but not submitted is case status Discharged. Tomorrow's first patients are the next open office day's first visits.

**Every Monday**

> Every Monday: open cases per attorney and anything not seen in 30 days.

Shown with the note that office case counts and Appointment Check are for the owner and admins in NoteGoat today. A manager or staff member who pastes it anyway gets the same refusal web G.O.A.T. already gives for office numbers, and can still ask for Today's Schedule. The Monday clock is the AI app's schedule.

**Every Friday**

> Every Friday: billing totals owed by attorney.

Owner and admin, or anyone else whose role can view Billing and billing figures. Hidden from everyone else. Owed uses the patient-page billed-minus-paid rule. `Self` is left out unless they ask for no-attorney cases. The Friday clock is the AI app's schedule.

**When a referral or an ID photo shows up**

> When I paste a referral or ID photo, prepare the new patient and wait for my OK.

Shown to anyone who can edit patients, and labeled so they know a chart is created only after Phase 2 writes are on and they confirm. They paste the referral text or the photo into their AI app. That app reads the image on the office's own AI account. NoteGoat does not run OCR and does not call a model to read the photo. The AI then calls `goat_prepare_create_patient` with the text or the fields it read. NoteGoat still has no patient-photo column. The prepare step does not save the photo into the chart. Saving the patient waits for confirm, and a duplicate date of injury still blocks the save.

The page can later hold more tips the owner writes for the office. Those extra tips are plain text on the office settings bag, editable by the owner only, and they do not bypass permissions. The five starters above ship with the page. They are not a hidden prompt sent to a model by NoteGoat.

## Scoping on every call

Every tool runs this checklist in order. The first failure stops the call.

1. Feature flag on, and this office's connector switch on. Otherwise the route answers as if it is not there.
2. Connector token valid, not revoked, and tied to this client.
3. NoteGoat user is approved, and the member row is not disabled.
4. Workspace resolved the same way the app resolves it: member row wins, otherwise the user is the owner of `<their id>:main-office` (or the configured office id).
5. Supabase client uses that user's JWT. No service role on patient, schedule, note, file, billing, or settings rows.
6. Role grid plus module visibility. Unknown role fails closed.
7. Patient-page section hides applied before fields are copied into the answer.
8. Location argument applied as a filter: `all`, one location id or nickname, or `no-office`. Omitted means `all`. The reply states the scope ("all 3 locations" or "Hulen only").
9. Deleted patients stay out unless the tool is explicitly the deleted-patient list and the person could see those in the app.
10. The audit row is written even when the call is refused.

## Tools

Names are stable. Inputs are the arguments. Outputs are JSON the AI reads. Amounts are numbers of dollars plus a display string. Dates in answers are US dates, matching the screens. Ids stay in the payload so a later call can target the same row.

### Shared inputs

Most list tools accept:

- `location`: `all` (default), a location id, a nickname, or `no-office`.
- `limit`: default 50, max 100.
- `cursor`: for the next page.

### Session and the G.O.A.T. day

**`goat_whoami`**

- Inputs: none.
- Output: person name, role (owner, admin, manager, staff), office name, timezone, locations (id, nickname, city), the location they usually land on, which areas they can view, which they can edit, whether SOAP text is shared, Lien vs LOP. No ids of other users beyond display names already on the team screen they can see.

**`goat_daily_briefing`**

- Inputs: `location`, optional `boxes` (subset).
- Output: the G.O.A.T. Page for this user, in the office timezone. The greeting line matches the page. Boxes the person cannot see are omitted, not zeroed out in a way that looks like "nothing to do".
- Boxes, in the page's default order, and where the numbers come from:
  - **G.O.A.T. Mail.** Count of mail that still needs a decision, plus the intake slice below. Read-only.
  - **Appointment Check.** Owner/admin. Active patients with nothing booked today or later, and active patients whose last booked visit is still this week. Canceled, no-show, and reschedule visits do not count. Same groups as `appointmentCheckGroups`.
  - **Quick Biz.** Owner/admin. Active, submitted, and ready-to-submit counts, new patients this month, visits this week and this month, collected this month, repeated per location when there are several.
  - **Case Review.** Owner/admin. Open Case Flow rows (Initial Visit, X-ray, MRI/CT, Specialist, Lien/LOP), cleared tasks already left out.
  - **Today's Schedule.** Visits today: New Patient, Seen (Checked Out), No Show, Rebook, Canceled, plus who is still Scheduled and has not checked in.
  - **Tomorrow's Schedule.** The next open office day, same visit groups.
  - **New Patient Intake.** PI charts with no date of injury that are not marked on the Patient List. Cash charts stay on the list.
  - **G.O.A.T. Answers.** The open questions already stored for this user, if that store exists for them. Empty is a real empty.
  - **To-Do's & Alerts.** Open to-dos, overdue first, then due today. Patient alerts that are still active. Cleared to-dos stay hidden.
  - **Case Snapshot.** Default window is this year. Open cases, waiting on R&B (status Discharged or Ready To Submit), missing lien, still in intake.
  - **End of Day Handoff.** Seen, new patients seen, no-shows, canceled, rebooks, unsigned notes, checked in with no note, tomorrow's appointments, intake still missing pieces.

**`goat_attention_today`**

- Inputs: `location`.
- Output: a short list built only from boxes this user can see. Order: overdue to-dos, patients not checked in yet today, intake still waiting, no-shows today, admin-only items (Appointment Check, cases ready to submit, unsigned notes) when the role allows. Each line has a reason and a patient id. This is the "what needs my attention today" answer. It is assembled from the same records as the briefing. NoteGoat does not ask a model to rank them.

**`goat_mail_intake_pending`**

- Inputs: `location` is ignored for mail, because the mailbox is the office mailbox.
- Output: pending new-patient referrals already parsed by the mail rules: first name, last name, phone, date of injury, attorney, sender, and the questions the parser still has (missing last name, unknown attorney, and so on). Skips referrals already turned into a chart or dismissed.
- Mail stays **Mail.Read** and **User.Read**, the scopes G.O.A.T. Mail already requests. The connector never sends, deletes, or marks read. It does not ask Microsoft for a broader scope.
- The mail refresh token already sits in `goat_mail_connections`, which has Row Level Security and no policies, so the existing mail route reads it with the service role. The connector may call that same mail-read path, and only that path, after the user's JWT has proved they belong to this workspace and may see G.O.A.T. Mail. The service role is not used to read patients or anything else. If that path cannot run without widening access, mail tools return "G.O.A.T. Mail isn't connected" and the rest of the briefing still works.

**`goat_mail_summary`**

- Inputs: optional `bucket` (new patient, lien, R&B, medicals, specialist, bounced, other).
- Output: counts and subject, sender, and date for messages the office has not resolved. Body text is included only for the pending-intake preview the mail page already builds. No attachments in Phase 1.

### Patients, cases, schedule, money

**`goat_search_patients`**

- Inputs: `query` (name, phone, or case number), `location`, `status`, `attorney`, `include_intake` (default true).
- Output: id, display name, DOB, phone, location nickname, status, attorney, date of injury, case number. Name matching may use the app's existing patient-name match so "Maria" still finds "Garcia, Maria Elena". Ambiguous names return the short list and do not pick one.

**`goat_get_patient`**

- Inputs: `patient_id`.
- Output: the basics and the case block this person can see, location, alerts, general notes if visible, last visit, next visit, whether they are in intake. Photo: file names that look like photos, only if files are visible. SOAP is not in this payload.

**`goat_list_cases`**

- Inputs: `location`, plus one mode:
  - `not_seen_in_days` (example 30). Active, non-cash charts whose last kept visit is older than that, or who have never been seen. Canceled, no-show, and reschedule do not count as a visit.
  - `reexam_this_week`. Saved re-exam dates (`reExam1`, `reExam2`, `reExam3`) that fall in the current Monday–Sunday week, plus visits this week whose type is a re-exam. The app does not compute a "due every N weeks" date. This tool does not invent one.
  - `attorney_and_doi`. Requires a patient. Returns attorney and date of injury.
  - `discharged_not_submitted`. Status is Discharged, so they are not Ready To Submit, Submitted, or Paid.
  - `open_by_attorney`. Open charts (not cash, not a closed status, not still in intake) grouped by attorney, with a count of kept visits.
  - `discharged_owed_over`. Discharged charts whose owed amount is over the given dollars, sorted by attorney then by owed. Requires billing access. Without it, the tool refuses the whole question rather than returning names stripped of the money the person asked for.
  - `owed_for_attorney`. Sum of owed, and the per-chart breakdown, for one attorney. `Self` is included only when the person asked for self or no-attorney. Matching uses the existing attorney-name rules so "Smith Law" and "Smith Law Firm" can group when those rules already say they are the same firm.
- Output: rows plus the totals the mode implies, the location scope, and the definition in one sentence so the AI can repeat it.

**`goat_schedule_day`**

- Inputs: `date` (default today in the office timezone), `location`, `unchecked_in_only`.
- Output: time, patient, type, status, location, provider. "Who hasn't checked in" is status Scheduled for that day. Checked In, Checked Out, Canceled, No Show, and Reschedule are not that list.

**`goat_appointments_left`**

- Inputs: `patient` (name or id), optional `type_query` (for example "cervical decompression"), `location`.
- This reads **scheduled appointments only**. It does not read treatment plans, and it does not read packages. A plan that says decompression three times a week does not add visits. A package that still has visits on it does not add visits. Encounter notes are not a second copy of the schedule.
- A visit counts as left when its date is today or later in the office timezone and its stored status is Scheduled. Canceled and No Show are left out. Checked In, Checked Out, and Reschedule are left out too: those are not still-booked visits. A past row that is still marked Scheduled is not left. It can be named in one extra sentence so nobody thinks it was forgotten. It is not part of the count.
- Type matching reuses `typesAsked`, `isDecompression`, and `decompRegions` in `src/lib/goat-appointments.ts`. "Cervical decompression" matches a booked type such as "Spinal Decompression - C/S". "Lumbar decompression" matches "Spinal Decompression - L/S". Rows are grouped by the type name stored on the visit. They are not merged just because two types share a word.
- Each type returns a count, the next date (soonest), the last date (latest), and the visits in date order, then by time. Types are ordered by their next date.
- When the question names one type, that type comes first. Other remaining types whose next visit is after that type's last visit follow it, in date order. If another type is mixed in before that last date, it gets its own sentence with its next and last dates. Do not say "after that" for a visit that is not after that.
- Schedule permission is required. If this person cannot view appointments, the tool refuses and does not fill the gap from a plan or a package. The location filter applies to the visit's location. Two patients with the same name are a question, not a guess.
- The spoken answer is complete sentences. For a male patient named Zhora with 3 cervical visits whose last one is 11/28/2026, and 10 lumbar visits all after that date, the answer is: "Zhora has 3 cervical decompression visits left, and the last one is on 11/28/2026. After that, he has 10 lumbar decompression visits scheduled." The next date of each type is in the tool result so the sentence can include it when the person asked, or when naming it makes the answer clearer.

**`goat_appointment_check`**, **`goat_quick_biz`**, **`goat_case_review`**, **`goat_case_snapshot`**, **`goat_end_of_day`**

- Inputs: `location`, and for case review an optional patient or category, and for snapshot an optional year.
- Output: the same figures as those boxes. Owner/admin only for Appointment Check, Quick Biz, and Case Review.

**`goat_list_todos`**

- Inputs: `location`, `overdue_only`.
- Output: open to-dos with title, due date, patient, assignee. Alerts on those patients if the person can see the chart.

**`goat_billing_for_patient`** and **`goat_billing_totals`**

- Inputs: patient id, or the attorney / status filters on the totals tool. `location`.
- Output: billed, paid, adjustments, owed, using the rule above. Refused when billing or `billingFigures` is blocked.

### The rest of the site

**`goat_list_encounters`**

- Inputs: `patient_id` optional, `date_from`, `date_to`, `unsigned_only`, `location`.
- Output: encounter id, date, provider, type, signed flag, charge total if billing figures are visible. No SOAP body.

**`goat_get_soap`**

- Inputs: `encounter_id`.
- Output: the four SOAP parts, read-only, only when the office SOAP switch is on and this user can view Encounters. Otherwise a refusal that says the note exists without quoting it.

**`goat_list_key_dates`**

- Inputs: `date_from`, `date_to`.
- Output: closed, covered, and open days in range.

**`goat_list_contacts`**

- Inputs: `query`, `category` (Attorney, Imaging Center, Specialist, Acute Care, Insurance Agent).
- Output: the contact card fields. The Attorney category is the list the + Case popup uses, plus the stored `Self` choice described as no firm.

**`goat_list_files`**

- Inputs: `patient_id` optional, `query`.
- Output: metadata only.

**`goat_list_messages`**

- Inputs: `unread_only`.
- Output: what this user can see on Messages. No send.

**`goat_dashboard`**

- Inputs: `section` (`statistics`, `weekly_summary`, `reviews`, `activity_log`), `location`.
- Output: that section, or a refusal. Activity Log entries follow the existing rule that a manager does not read rows written by an owner or an admin.

**`goat_settings_overview`**

- Inputs: none.
- Output: the non-secret settings this user can open. Role grid summaries for an owner. Team display names for an owner or admin. Never a secret.

**`goat_list_marketing`**, **`goat_list_timers`**

- Inputs: the obvious date or query filters.
- Output: the page's list, or a refusal when the module is off or the role cannot view it.

Handbook content is not PHI. A later tiny tool can point at a handbook topic. It is not required for the example questions, so it waits.

## Phase 2 writes

Three workflows. Each is prepare, then confirm. The prepare tool writes nothing. The confirm tool writes once, and only with a live preview id the person just accepted.

The AI shows the preview in words and waits. "Yes, create that patient" is a yes. "Yes" in reply to a different question is not. The confirm call includes `preview_id` and `confirmed: true`. The preview expires in 10 minutes, works once, and only for the same user who prepared it.

The patient and case workflows call the existing helpers. They do not reimplement them. The MRI workflow below does the same with the imaging form.

| Step | Existing behavior to reuse |
| --- | --- |
| Read a pasted referral | `parseIntakeText` and `referralNameFromSubject` in `src/lib/new-patient-intake.ts`. Strip email signatures and fax numbers the way that parser already does. |
| Compound last names | A labeled name or a scheduling subject keeps every word after the first as the last name ("De La Cruz" stays intact). Three loose words do not guess. The preview asks the question the parser already asks: is the last name the final word, or the last two words? Confirm is refused until that question is answered. |
| Bad names | One-letter names and filler words ("This") are rejected, same as `isObviouslyBadPatientName`. |
| Duplicates | `findDuplicateCases`. The same first and last name is not a duplicate. The same first name, last name, and date of injury is. The preview lists the existing chart and confirm does not create a second one. |
| Attorney list | Contacts in the Attorney category, plus a typed new name, plus `Self`. Picking a contact fills the phone. Blank becomes `Self`. Cash / non-PI clears the attorney workflow. |
| Case number | `renderCaseNumber` with the office's format. Default is MMDDYY + first two of last + first two of first, from the date of injury. No date of injury means no case number. The number is stamped at creation so a later format change does not rename the case. |
| + Case rules | Attorney, date of injury, and Initial Exam date and time are all optional. A date of injury moves the chart from New Patient Intake onto the Patient List and fills the case number. The exam date is saved as the Initial Exam. Exam date plus time books the office's New Patient visit. A taken slot, or a time outside office hours when hours are enforced, returns the nearby open times. "Book anyway" is offered only when Settings → Schedule already allows overrides. |
| Where it saves | The same patient create and appointment create paths the New Patient form uses, including location when the office has several. |

**`goat_prepare_create_patient`**

- Inputs: `referral_text` or structured fields (first, last, phone, DOB, address, attorney, date of injury, exam date, exam time, location, note), plus `name_choice` when a compound-name question is open.
- Output: `preview_id`, the parsed card, case number preview, location, duplicate hits, and every question still open. `ready: false` while a question or a duplicate blocks it.

**`goat_confirm_create_patient`**

- Inputs: `preview_id`, `confirmed: true`.
- Output: the new patient id, the case number if any, and the appointment id if a visit was booked. Writes the normal activity-log row the app writes for a created patient.

**`goat_prepare_add_case`** and **`goat_confirm_add_case`**

- For a chart that already exists, usually someone still in New Patient Intake. Inputs name the patient and the + Case fields. The same duplicate, attorney, case-number, and slot rules apply. Adding a case does not create a second patient and does not touch SOAP notes.
- A second injury on someone who already has a case (related case, extra date of injury) is not this tool. That stays a later decision.

### MRI referral

People will say "send MRI for Zhora to Insight cervical lumbar" or "send MRI for Zhora to Insight CL R shoulder." The word **send** here is the same word as the chart button **Add MRI / CT Sent**. It means write the referral on the chart and save the filled PDF into that patient's files. The connector never emails it, never faxes it, and never calls an outside delivery API. The fax and email on the imaging center's contact may be printed on the PDF, because the office template already prints them. They are not used to transmit anything.

This needs edit access to patients and to My Files, and the patient-files section must be visible to this person. Without both, prepare refuses and confirm writes nothing. A half-saved referral with no PDF, or a PDF with no referral row, is not allowed.

**`goat_prepare_mri_referral`**

- Inputs: the person's words, or structured fields (`patient`, `center`, `regions`, optional `sent_date`, optional answers to an open question).
- Output: `preview_id`, the patient, the center, the regions with laterality, the sent date, any open MRI referrals already on that chart, the file name the PDF will get, and every question still open. `ready: false` until the patient, the center, and at least one region are settled. Writes nothing.

**`goat_confirm_mri_referral`**

- Inputs: `preview_id`, `confirmed: true`.
- Output: the new referral id, the file id, and the file name. One new row on `mriReferrals`, `matrix.mriSent` set to the sent date, and one PDF in the patient's folder.

Resolve in this order. Stop and ask when a step is ambiguous. Do not guess.

1. **Patient.** Same name match as the other tools. "Zhora" with two charts returns the short list and does not pick one. A deleted chart is not a match.
2. **Imaging center.** Match Contacts whose category is Imaging Center, case-insensitive, the way the chart's center dropdown does. "Insight" may resolve to "Insight Imaging" when that is the only center whose name contains those words. Two Insights, or no close match, is a question. The form also allows a typed name that is not a contact. The preview may keep a typed name, and it asks the same question the chart asks: this center is not in Contacts yet, add them? Adding the contact is its own yes. Declining still allows the referral to keep the typed name. The connector does not invent a center and does not add a contact silently.
3. **Regions.** Use the MRI checklist on the chart, not a new list. MRI regions are Brain, Cervical, Thoracic, Lumbar, Chest, Sacrum, Shoulder, Elbow, Wrist, Hand, Hip, Knee, Ankle, and Foot. Humerus, Forearm, Femur, and Tibia/Fibula are X-ray only. An MRI command that names one of those is refused for that region and the preview says so. Laterality (`L`, `R`, `BL`) is stored only where the form allows it: Shoulder, Elbow, Wrist, Hand, Hip, Knee, Ankle, Foot. Cervical, Thoracic, and Lumbar do not take a side.
4. **Shorthand.** Map the words onto that checklist. Reuse `src/lib/goat-regions.ts` where it already knows a word (`cervical`, `c-spine`, `neck`, `lumbar`, `l-spine`, `low back`, `thoracic`, `shoulder`, `knee`, and the rest of that file). Add the office shorthand the form's word list does not spell out, without letting a spinal level get eaten:
   - `CL` or `C/L` means Cervical and Lumbar.
   - A lone `C`, `T`, or `L` next to the MRI wording means Cervical, Thoracic, or Lumbar.
   - `C5`, `C5-6`, `L4-5`, and `L5-S1` stay levels. The level picks the region (C → Cervical, T → Thoracic, L → Lumbar). The form stores the region, not the disc level. The preview can mention the level in words. It does not invent a new region field.
   - `R shoulder` is Shoulder with laterality R. `L knee` is Knee with L. `BL knee` is Knee with BL. A side sticks to the body part beside it. In "CL R shoulder", the L inside CL is Lumbar, and the R belongs to the shoulder.
   - Knee, shoulder, and the other sided regions with no side stated are a question. Spine regions never ask for a side.
5. **MRI, not CT, not a prior study.** "Send MRI" sets `isCt` false and `modalityLabel` MRI. CT only when they said CT. `isPrior` stays off. A prior study does not write `matrix.mriSent` and does not move Case Flow, so this command must not create one.
6. **Sent date.** The chart requires a sent date. The preview defaults it to today in the office timezone and shows it. They can change it before confirm.
7. **What confirm writes.** The same shape as **Add MRI / CT Sent**: id, modality, sent date, center, regions, laterality, and empty scheduled, done, received, reviewed, and findings. `matrix.mriSent` is that sent date. That is what takes the chart off Case Flow's MRI "Needs Referral" stage under the office's existing rules (`mriAppearMode`, the day count from the initial exam, cleared-by, and patient-refused). Do not clear a referral by hand. Do not change X-ray or specialist rows.
8. **The PDF.** Reuse the active Imaging Request template (`scope: imagingRequest`), the same token fill as `generateImagingRequestPdf`, and `buildDocumentTitle` for the name. Regions print the way the chart summarizes them, such as `Cervical, Lumbar, Shoulder (R)`. The center's phone, fax, email, and address come from the Imaging Center contact when this person can view Contacts. If they cannot view Contacts, those tokens stay blank. The center name they already said can still appear. If the template or its header has `[[prompt]]` tokens, the preview asks for each one and confirm waits. If the office has no Imaging Request template, the preview says "NO PDF. Create Template?" and confirm does nothing. Today the chart opens a print dialog and the person chooses Save as PDF. The connector does not open that dialog. It renders that same document to a PDF and saves it in the patient's system folder in My Files, through the same file bucket an upload uses. The file name is the document title, for example `071826SMJO Smith, John - Imaging Request - MRI.pdf`, and it is not prefixed a second time. The tool result returns the file id and name. It does not return the PDF bytes.
9. **Suggested from MRI stays a diagnosis helper.** `src/lib/dx-suggest.ts` reads MRI findings that are already on the chart and suggests ICD-10 codes. Nothing is added unless someone clicks Add on the chart. Preparing an MRI referral does not run that suggester, does not add a diagnosis, and does not write findings. There is no separate engine that picks cervical or lumbar for the patient. The regions come from the person's words, mapped as above. The preview can mention an open "Needs Referral" Case Flow row so they see why this chart was waiting. It does not order regions the person did not name.

Out of Phase 2 even if the person can do them in the app: editing a chart, editing or signing SOAP, deleting, billing edits, sending texts, scheduling except the first exam that create-patient already books, any mail change, X-ray referrals, specialist referrals, and emailing or faxing an MRI referral.

## Example questions

These are acceptance examples. Each answer names the location scope. The words are complete sentences, as in "How answers are spoken" above.

| Question | Tool | Shape of the answer |
| --- | --- | --- |
| What's today's schedule, and who hasn't checked in? | `goat_schedule_day` | Times and names, then the Scheduled rows, spoken in complete sentences. |
| How many cervical decompression are left for Zhora? | `goat_appointments_left` | "Zhora has 3 cervical decompression visits left, and the last one is on 11/28/2026. After that, he has 10 lumbar decompression visits scheduled." Booked visits only. No package balance and no treatment-plan count. |
| Who hasn't been seen in 30 days? | `goat_list_cases` mode `not_seen_in_days` | Name, last kept visit, location. |
| Which re-exams are due this week? | `goat_list_cases` mode `reexam_this_week` | Saved re-exam dates and re-exam visits this week. Say that a computed interval is not in the product. |
| Who is this patient's attorney, and what's the DOI? | `goat_get_patient` or `attorney_and_doi` | Attorney, or "no attorney" when the value is `Self`, and the injury date. |
| What's the total owed for this attorney? | `owed_for_attorney` | One total and the charts in it. Refused without billing access. |
| Which discharged cases haven't been submitted? | `discharged_not_submitted` | Status Discharged. |
| How many open cases does each attorney have, and how many visits? | `open_by_attorney` | One row per firm, visit counts beside it. |
| Discharged cases that owe more than $5,000, by attorney. | `discharged_owed_over` with `5000` | Sorted by attorney, then amount. |
| What needs my attention today? | `goat_attention_today` | The short list from the boxes this user can see. |
| Any new patients waiting in the mail? | `goat_mail_intake_pending` | Parsed referrals not yet made into charts. Creating one is a Phase 2 confirm. |
| Send MRI for Zhora to Insight cervical lumbar. | `goat_prepare_mri_referral` | Preview: one patient, Insight Imaging if that is the only match, Cervical and Lumbar, sent date today, file name. Nothing saved until confirm. |
| Send MRI for Zhora to Insight CL R shoulder. | `goat_prepare_mri_referral` | Cervical, Lumbar, and Shoulder (R). The L in CL is Lumbar. |

"All locations" and "just the Dallas office" are the `location` argument on these tools. Nicknames match the location nicknames in Office settings.

## Rate limits

Counted per user and again per office. A refused call still counts.

| Kind | Limit |
| --- | --- |
| Reads | 60 a minute per user, 300 a minute per office |
| Briefing and attention | 10 a minute per user (they pull a wide set of rows) |
| Mail reads | 20 a minute per office, and they stop when Microsoft throttles |
| Phase 2 prepare | 10 a minute per user |
| Phase 2 confirm | 5 a minute per user |

Over the limit, the tool returns a plain "slow down" and the time to wait. Limits are enforced in the route, before the query. They are not a substitute for the permission checks.

## Audit

Every call appends to the existing `audit_log`, including refusals.

- Who: the NoteGoat user id, email, display name, and role at that moment.
- What: `mcp.<tool name>`, success or refusal reason, location scope, result count, preview id when there is one.
- When and which workspace.
- Patient ids when the call targeted specific charts.

The row does not store the tool's answer, SOAP text, phone numbers, note text, or the pasted referral. The activity screen already lets the owner and admins read the log, and a manager still cannot read owner or admin rows. Clearing the log keeps the existing protection for "who cleared the log" entries. MCP rows follow that same screen. They are not a second, hidden log.

Phase 2 confirm also writes the normal activity row the app writes for that action, so the Dashboard story matches a patient created from the form or a file saved on the chart. The MRI audit row records the patient id, the file id, and that nothing was emailed or faxed. It does not store the PDF.

## HIPAA

NoteGoat already holds patient information for the office. Connecting an outside AI is a new disclosure, because the words leave NoteGoat and enter that AI vendor's service.

- The business associate agreement for the AI is between the office and that vendor (Anthropic, OpenAI, xAI, or whoever they connect). NoteGoat cannot sign that agreement for them. The consent screen says that in one sentence and links to whatever notice the owner supplies.
- NoteGoat's own agreement with the office still covers NoteGoat storing the records. This connector does not change who the system of record is.
- The owner opts in per office. Staff cannot turn it on. Default is off.
- Data minimization is the tool list above. The AI does not get a database dump, a settings blob, or file bytes in Phase 1. SOAP text is a separate opt-in and stays off until the owner turns it on. Even then it is read-only.
- Logs store ids and counts, not chart contents.
- The connector runs as the user, so a front-desk login cannot pull billing the screen already hides.
- Sessions can be revoked the same day. A disabled employee loses access on the next call.
- Mail is read-only and only for the mailbox the office already connected to G.O.A.T. Mail.
- If the owner has not turned the connector on, no PHI is available at the MCP route.

Open product copy for the consent screen belongs to the owner. The spec requires the points above. It does not invent legal language.

## Hosting and cost

Host the MCP endpoint on the existing Vercel project, as `https://www.mynotegoat.com/api/mcp` (the same host G.O.A.T. Mail already uses). Use the streamable HTTP transport MCP clients speak today. OAuth discovery and token routes sit beside it under `/api/mcp/`. No second app, no second database, no new model vendor.

Cost is more Vercel function time and more Supabase reads when people ask questions. There is no model bill on the owner's key, because NoteGoat never calls a model. Mail adds Microsoft Graph reads the office already pays for with G.O.A.T. Mail, only when a mail tool is used. A briefing is heavier than a single-patient lookup, which is why its rate limit is lower. File bytes stay out of Phase 1 so the connector does not become a download pipe.

The route stays dark until the feature flag and the office switch are both on, so an unused office adds no traffic.

## Feature flag and rollout

Two switches, both default off:

1. A server flag, `MCP_CONNECTOR_ENABLED`, read on the server only. Off means `/api/mcp` returns 404 for everyone.
2. The per-office owner switch. Off means a signed-in user of that office gets 404 even if the server flag is on.

Phase 2 has its own server flag, `MCP_CONNECTOR_WRITES_ENABLED`, also default off, plus the office switch already being on. Writes cannot turn on while reads are off.

Rollout:

1. This spec. No behavior change.
2. Build the route dark. Automated tests use fixtures, not production.
3. Turn the server flag on in a preview deployment. The owner switch stays off.
4. One pilot office. Owner only. Read-only. Walk the example questions across all locations and one location. Open the G.O.A.T. Connector page and confirm it has tips and no chat box.
5. Admins in that office, then a Manager and a Staff login. Confirm billing, SOAP, Quick Biz, and Settings refuse exactly where the screen refuses.
6. SOAP switch stays off through that pilot. Turn it on only after the owner says the AI vendor's agreement is in place.
7. Phase 2 for the pilot: pasted referral, compound last name question, duplicate date-of-injury block, `Self`, case number, slot conflict, a confirm that creates one test patient the office expects, and one MRI referral whose PDF lands in that patient's files and is not emailed or faxed.
8. More offices only after the pilot's audit log looks right and the owner says so.

Turning either switch off stops new calls immediately. It does not delete charts that were created while it was on.

## Test plan

Use fixtures and a non-production Supabase project. Do not run these against production.

Permissions

- Owner sees every area the office has on, including Settings minus secrets.
- Admin matches the owner on data, and cannot toggle the office connector switch.
- Manager and Staff match the role grid, including a customized grid, not only the defaults.
- Billing figures hidden on the chart: patient basics still return, owed does not.
- Encounters hidden: no encounter list and no SOAP.
- SOAP switch off: encounter list works, SOAP body does not.
- Another owner's user id returns nothing, even if someone passes a foreign workspace id.
- Disabled member and unapproved account fail.
- Membership lookup error fails closed and writes an audit row.
- A test double that spies on the Supabase client asserts the service role is never used for patients, notes, files, or settings. Mail, if tested, goes through the existing mail reader only.

Locations

- A workspace with three locations answers "all" with three groups and "one nickname" with one group.
- Patients with a blank or unknown `location_id` appear under all and under no-office, and not under a real building. That matches `matchesOfficeFilter`.
- A member whose usual location is one building still gets all locations when they ask for all.

Briefing

- The greeting hour follows the office timezone, not UTC.
- Staff briefing has Today's Schedule, intake, to-dos, and mail. It has no Quick Biz and no Appointment Check.
- Admin briefing includes those boxes.
- "What needs my attention" uses only allowed boxes.
- Pending mail referrals show parsed names and do not mark the message read.

Phase 1 questions

- The reporting questions in the table, plus attention and mail, against a fixture set with known totals.
- "How many cervical decompression are left for Zhora?" counts only future Scheduled visits. Canceled, no-show, checked-out, and reschedule rows are not in the count. A treatment plan and a package with visits remaining do not change the number. The spoken answer is the two full sentences in the table, and each type includes a next date and a last date in the tool result.
- A reply that is only "3 left, last 11/28" fails the sentence check.

Phase 2

- Pasted referral fills the preview and writes nothing until confirm.
- "Maria Elena De La Cruz" keeps the compound last name when the referral labels the name, and asks when the name is three loose words.
- Same name and same date of injury blocks confirm and points at the existing chart.
- Same name and a different date of injury is allowed.
- Blank attorney previews as `Self`.
- Case number matches `renderCaseNumber` for the office format, including an office that changed the format.
- Taken appointment time returns nearby times and does not book.
- Confirm twice does not create two patients.
- Expired preview does not write.
- No path updates `encounter_notes`.

MRI referral

- "Send MRI for Zhora to Insight cervical lumbar" resolves one patient, one Imaging Center contact, and regions Cervical and Lumbar. Prepare writes nothing.
- "CL R shoulder" is Cervical, Lumbar, and Shoulder with laterality R. The L inside CL is not Left.
- Two patients named Zhora, or two centers named Insight, return a question and do not pick.
- A region that is X-ray only, such as Humerus, is left off and named in the preview.
- Confirm writes one `mriReferrals` row, sets `matrix.mriSent`, and saves one PDF in the patient's folder under the Imaging Request title. It does not add a diagnosis from Suggested from MRI.
- No email is sent and no fax is sent. A missing Imaging Request template saves nothing.
- A login that cannot edit patients or My Files is refused before any row or file is written.

G.O.A.T. Connector page

- The page renders the five starter tips as copy text and has no chat input.
- A Staff session does not show the Friday billing tip. An owner session does.
- The Monday tip is labeled for owner and admin. Pasting it as Staff still returns the office-numbers refusal.
- Nothing on the page calls a model, and nothing on the page stores an 8:00, end-of-day, Monday, or Friday schedule.

Audit and limits

- Every tool, including a refusal, writes one audit row without the answer body.
- The 61st read in a minute is refused.

## Open questions

1. Timezone per location. The spec stores one timezone for the office when the owner turns the connector on. Split that only if a later office actually spans two timezones.
2. Re-exam "due". Today the product stores re-exam dates and re-exam visits. It does not compute "due 30 days after the initial exam". The week list uses stored dates and visits. A computed rule needs the owner to name the interval.
3. File bytes and patient photos. Phase 1 is names only. If the owner wants the AI to see a photo or a PDF, that is a later phase with a short-lived link, not a copy pasted into the transcript by default.
4. Extra injury on an existing patient. Phase 2 "add case" is the + Case popup. Related cases and additional dates of injury stay out until the owner says they are in.
5. Whether Manager should ever see Quick Biz. Today they do not. Changing that is a product change in NoteGoat itself, not a connector-only exception.
6. How long connector audit rows live. They follow the activity log's current retention unless the owner wants a longer one.
7. Which AI apps to pre-register first. The spec assumes Claude, ChatGPT, and a Grok bot, plus one test client. The exact client ids come from those vendors when someone builds this.
8. Consent wording and where the owner puts the link to their AI vendor's agreement.
9. Whether a connected assistant may run while the person's NoteGoat password was changed. The spec says the stored Supabase refresh token stops working when Supabase invalidates it, which is the safe default.

## Out of scope

- Any change to production data, production Supabase, or environment variables in this spec's pull request.
- NoteGoat calling OpenAI, Anthropic, xAI, or any other model.
- A service-role query path for chart data.
- Editing SOAP notes, sending or modifying mail, silent creates, and emailing or faxing an MRI referral. The PDF is saved on the chart. The person sends it.
- Publishing the repo, env files, or internal keys to the client.
- Replacing web G.O.A.T. The G.O.A.T. Page and its chat stay. AI G.O.A.T. stays in the office's own AI app. No AI chat box is added inside NoteGoat.
- Running morning, end-of-day, Monday, or Friday routines on NoteGoat's servers or on a NoteGoat clock. Those schedules belong to the AI app.
