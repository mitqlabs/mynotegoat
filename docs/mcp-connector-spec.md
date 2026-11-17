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

The words the person hears are plain, complete sentences. A tool may return counts and dates as structured fields. The AI turns those fields into sentences. It does not read the field names out loud, and it does not answer with a fragment such as "3 left, last one on 11/28/2026". One fact can be its own sentence. Two related facts can share a sentence when that still reads naturally. Use he or she only when the chart's sex is Male or Female. When sex is blank, repeat the patient's name. A visit answer names what happened to that visit, in the same sentence or the next one.

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

### Visit questions

**`goat_visits`** answers questions about one patient's appointments. It reads schedule rows only. It does not read treatment plans, and it does not read packages. A plan that says three visits a week does not add visits. A package balance does not add visits. Encounter notes are not a second schedule.

Schedule permission is required. If this person cannot view appointments, the tool refuses. The location filter applies to the visit's location. Two patients with the same name are a question, not a guess. Every spoken answer is a complete sentence, and it names the status in ordinary words.

The schedule stores exactly these statuses. The screen says "Checked In" and "Checked Out". The stored words stay "Check In" and "Check Out". The reschedule screen says "Rescheduled". The stored word is "Reschedule".

| Stored status | Say it as |
| --- | --- |
| `Scheduled` | scheduled. On a past date: never checked in. |
| `Check In` | checked in. |
| `Check Out` | checked out. This is an attended visit. |
| `Canceled` | canceled. |
| `No Show` | a no-show. |
| `Reschedule` | rescheduled. |

Inputs: `patient` (name or id), `kind`, optional `type_query`, optional `date_from` and `date_to`, `location`.

`kind` is one of `left`, `last`, `next`, `completed`, `missed`, or `range`.

**Left.** "How many appointments does Mike have left?" and "How many cervical decompression are left for Zhora?" A visit is left when its date is today or later and its stored status is `Scheduled`. Canceled, No Show, Check In, Check Out, and Reschedule are not left. A past row still marked Scheduled is not left. Name it in one extra sentence if it exists. It is not part of the count. Group by the type name stored on the visit. Reuse `typesAsked`, `isDecompression`, and `decompRegions` in `src/lib/goat-appointments.ts`, so "cervical decompression" matches a type such as "Spinal Decompression - C/S" and "lumbar decompression" matches "Spinal Decompression - L/S". Each type returns the count, the next date, the last date, and the visits in date order, then by time. Types are ordered by their next date. When the question names one type, that type comes first. Other remaining types whose next visit is after that type's last visit follow it. If another type starts before that last date, give it its own sentence with its next and last dates. Do not say "after that" unless those visits really are after that. A male patient named Zhora, with 3 cervical visits ending 11/28/2026 and 10 lumbar visits all after that date, is answered: "Zhora has 3 cervical decompression visits left, and the last one is on 11/28/2026. After that, he has 10 lumbar decompression visits scheduled." "How many appointments does Mike have left?" uses the same shape for every type he still has booked, each with its next date and its last date.

**Last.** The last appointment is the most recent visit whose date is before today, whatever its status. Always say that status. A visit dated today is not the last appointment. If there is a visit today, add one sentence for it and its status, so this morning is not hidden.

- Checked out: "Mike's last appointment was 11/17/2026, and he was checked out."
- Still Scheduled on a past date: "Mike's last appointment was 11/17/2026, and he was never checked in."
- Check In and not Check Out: "Mike's last appointment was 11/17/2026, and he was checked in."
- Canceled: "Mike's last appointment was 11/17/2026, and it was canceled."
- No Show: "Mike's last appointment was 11/17/2026, and it was a no-show."
- Reschedule: the old row is marked `Reschedule`, and the chart creates a new row. There is no field that points from the old row to the new one. When one later visit for that patient has the same type and is still `Scheduled`, the sentence may name that date: "Mike's last appointment was 11/17/2026, and it was rescheduled to 11/20/2026." When several later booked visits could be the new one, say it was rescheduled, then give the next booked visit as its own sentence. Do not invent a link the schedule does not store.

When the last visit is canceled, a no-show, or rescheduled, also say the most recent attended visit. Attended means stored status `Check Out`. "His last checked-out visit was 11/10/2026." If none exists, say he has no checked-out visit on file.

**Next.** The soonest visit dated today or later whose status is `Scheduled`. "Mike's next appointment is 11/20/2026 at 10:00 AM, and it is a cervical decompression." If none is booked, say so in a sentence. A Reschedule row is not the next appointment.

**Completed.** Visits completed so far are rows stored as `Check Out`, ordered by date. "Mike has 12 visits checked out, from 9/2/2026 through 11/17/2026." Check In rows that were never checked out are a separate sentence. They are not added into the completed count.

**Missed.** No-show count is rows stored as `No Show`. "Mike has 2 no-shows, on 10/3/2026 and 10/21/2026." If the person says "missed", also say the canceled count in the same answer, with the word canceled, so the two are not added into one silent total.

**Range.** `date_from` and `date_to` are inclusive. Return every status in that range, ordered by date, then time. Speak them as sentences. A long range gives the counts by status first, then the visits in order, and says how many were left off after the first 15.

### Full case read

**`goat_case_read`** answers questions about one chart: everything on that patient's page that this login can already see. A hidden panel comes back empty, the same way in-app G.O.A.T. passes it as null. The answer is full sentences. It quotes findings. It does not invent a reading that is not in the stored text.

Inputs: `patient` (name or id), optional `sections` (names from the table below), optional `region` (for an X-ray or MRI question), `location`. Two patients with the same name are a question.

The patient page, from top to bottom in `patient-case-file.tsx`, is the list below. Each row is what the connector may return, and which permission or hide switch blocks it.

| What is on the page | Read it as | Hidden when |
| --- | --- | --- |
| Name, sex, marital status, DOB, phone, email, address, text-reminders flag, alerts, compliance if the office turned it on, Non-PI badge | Case header | `patients` view is off |
| Case #, attorney, attorney phone and email, date of injury, extra injury dates, Initial Exam, case status, Lien or LOP, Review, Prior Care, location | Case details. `Self` is said as no attorney. Case # uses the stamp on the patient. | `patients` view is off. Cash / non-PI charts do not have the PI case fields. |
| Notes (the Case Notes log, seeded from the old general-notes field) | General Notes, as written | The Notes panel is hidden for this person |
| Quick Glance, including the Appointments box | The same counts as the chips | The Appointments panel is hidden |
| X-Ray referrals: center, regions, laterality, flex/ext, sent / done / received / reviewed dates, patient refused, prior study, and the findings text typed on that row | The typed findings for the region they asked about. An uploaded report is not opened unless they say yes. | `patients` view is off |
| MRI / CT referrals: the same dates and regions, the CT checkbox, and the findings text typed on that row | The typed results first. See Imaging results below. | `patients` view is off. A file is read only after they agree, and only if they can see Patient Files. |
| Specialist referrals, including Pain Management: the specialist name, sent / scheduled / completed / report received / report reviewed dates, the Recommendations box, and refused | Recommendations typed on that row. A report file is not opened unless they say yes. | `patients` view is off |
| Appointments / Encounters list, linked note signed or not, charges on those encounters | Visit rows and whether a note is signed. Charge amounts only with billing figures. | The Appointments panel is hidden. SOAP text is not in this list. |
| Appointment chips | Per type: Scheduled / Checked In / Checked Out / Canceled. No Show is added only when that count is above zero, which is how the chip is drawn. `Reschedule` is not one of those four numbers. If any exist, say that count in its own sentence. Example: "Lumbar Spinal Decompression is 10 scheduled, 0 checked in, 0 checked out, and 2 canceled." | The Appointments panel is hidden |
| Case Flow / To-Do | Open follow-ups and to-dos for this patient | The Case Flow & To-Do panel is hidden |
| Related Cases | The linked charts | The Related Cases panel is hidden |
| Letters | Which letter templates exist for this office. Generating one is not this read. | Letters are hidden, or the plan is not Complete |
| Diagnosis Codes, including Suggested from MRI and Suggested from X-ray | Codes already on the chart. Suggestions are named as suggestions. They are not added. | The Diagnosis panel is hidden |
| Reports | Which report templates exist. Generating one is not this read. | Reports are hidden, or the plan is not Complete |
| Treatment Plan | The plan dates, days, and regions, in sentences. This is not a count of booked visits. | The Treatment Plan panel is hidden |
| Patient Files | File name, date, and type. Bytes are the download action below. | My Files is off, or the Patient Files panel is hidden |
| Additional Details | Discharge, R&B sent, and the day counts between those dates | The Additional Details panel is hidden |
| Billed, paid, adjustments, balance, percent paid, cash payments, treatment packages | Money, only the figures the page shows | Billing is off, or the billing-figures half is hidden. A person can hear the discharge date and still not hear the balance. |
| Questionnaires received | The form cards on the chart | `patients` view is off |
| SOAP note text | Read-only, from `goat_get_soap`, and only when the office SOAP switch is on and this person can view Encounters | Otherwise say a note exists, with the date and whether it is signed, and do not quote it |

### Results: imaging and specialists

X-ray, MRI, CT, Pain Management, and every other specialist use one results pattern. The answer is always two labeled parts.

**Patient Page:** the words typed on the chart, quoted. If that box is empty, this part says nothing is typed on the patient page.

**Patient Files:** a summary of the uploaded report, and only after the person agrees to check the files. Before that yes, this part does not quote the PDF. If a matching file is sitting there, ask exactly: "There are no updated results on the patient page. Would you like me to check the patient files?" If no file is there, this part says no report is in the patient files.

When both the typed text and a file exist, still show both labels. Patient Page has the quote. Patient Files asks, and after yes it has the summary, labeled as coming from that file, plus the download. When the person asks to see both, use the same two labels. A missing side is stated under its label. It is not left blank and it is not invented.

Do not open the file on the first answer. On yes, and only if this person can view My Files and the Patient Files panel, read it the way an upload is already read (PDF text, or OCR for a scan). Offer the download from **Download a file**. Do not write that file text back into the findings or recommendations box. Putting it on the page is a separate preview and a separate yes. This read never does that.

Where the typed words live:

- **MRI.** `findings` on each MRI row. CT is the same panel with **CT instead of MRI** checked, so a CT question uses those rows. If the row is empty, the older MRI / CT findings field counts when `usableLegacyMriFindings` still treats it as real findings. A facility name in that old field is not a result. Split by the region headers the page writes, such as "Cervical:" or "Left Knee:".
- **X-ray.** `findings` on each X-ray row, then the older X-ray findings field if those rows are empty. A left-knee note that says there was no fracture or subluxation is quoted as "Zhora's X-ray of the left knee showed no fracture or subluxation."
- **Pain Management and other specialists.** There is no separate findings field. Pain Management is a Specialist contact subcategory, and the row stores the provider in `specialist` and the typed note in `recommendations` (the Recommendations box). The same box is used for orthopedics, neurology, and every other specialist. Dates on that row are sent, scheduled, completed, report received, and report reviewed. If the row's recommendations are empty, the older `matrix.specialistRecommendations` field on the page is the fallback. A Pain Management question uses the rows whose contact is in that subcategory, or whose name the person used.

A complete answer looks like this:

Patient Page: "Zhora's MRI of the cervical spine showed disc herniation at C5-6."

Patient Files: "From the uploaded file MRI Report.pdf, the report describes a disc herniation at C5-6."

If the page is empty and they have not said yes yet, Patient Page says nothing is typed there, and Patient Files is the question about checking the files. If neither the page nor a file has anything, both labels say so.

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
- Output: metadata only. The download is `goat_download_file`.

### Download a file

**`goat_download_file`** is how the person, inside Claude, ChatGPT, or their Grok bot, says "download the MRI referral for Zhora" and receives that file. It also covers an X-ray report, a notes PDF, an intake or questionnaire file, and any other document already saved in that patient's files.

It never emails the file, never faxes it, and never sends it anywhere except back to this signed-in session. The fax number and email printed on a referral are not used.

Who can get it: this person can view My Files, and the Patient Files panel is not hidden for them. The file has to sit in that patient's folder. Another patient's file, and another office's file, are refused. The lookup runs with the user's own login. The service role is not used to sign the link.

How a match is chosen:

- Search the patient's saved files by the words they used and by the document title. "MRI referral" matches a file whose name is the Imaging Request title, such as `071826SMJO Smith, John - Imaging Request - MRI.pdf`.
- One match returns that file. Several matches are listed in sentences and the person picks. No match for an X-ray report, a notes PDF, or an intake document says the file is not in the chart. Those are not generated on the spot.
- No saved MRI referral PDF is the one exception. The tool says none is saved and asks whether to create it. A yes reuses the MRI panel flow: preview first, then Add MRI / CT Sent, then Generate PDF. The new file is saved and handed back with the same embedded resource and 15-minute link. Phase 2 writes have to be on. If they are off, the answer stops at "that PDF is not in the chart yet."

How the file comes back:

- The MCP result includes a resource named `goat://file/{file_id}` with the file name and the media type.
- A file of about 5 MB or less is also embedded in that resource so the AI app can offer a download without a second hop.
- Every file also gets a short-lived signed link, created the same way the app already does (`createSignedUrl` on the `user-files` bucket) but for 15 minutes. The app's own preview link lasts an hour. The connector link is shorter because it will sit in an outside chat. When it expires, a new call can sign a new link. The old one stops working.
- The signed link is not copied into the audit log. The log records the user, the patient id, the file id, the file name, and whether a new MRI PDF was created. It does not record the file bytes or the link.

The spoken line is a sentence, for example "Here is Zhora's MRI referral. Tap the file to save it on this device." The AI app shows the embedded file or the link. The person taps or clicks to save it on the phone, laptop, or desktop they are using. The download itself is the resource, not a paragraph of the PDF's text. A PDF just created by Generate PDF uses this same handoff.

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

People will say "send MRI for Zhora to Insight cervical lumbar" or "send MRI for Zhora to Insight CL R shoulder." This follows the MRI panel on the chart, in the same order, through the same save and the same Generate PDF path. The word **send** is the chart button **Add MRI / CT Sent**. It does not email, fax, or call a delivery API. Phone, fax, and email from the imaging center may be printed on the PDF because the template already prints them. They are not used to transmit anything.

This needs edit access to patients and to My Files, and the Patient Files panel must be visible. Without both, prepare refuses and confirm writes nothing. A referral row without its PDF, or a PDF without the row, is not allowed.

**`goat_prepare_mri_referral`** fills the panel and writes nothing. `ready` stays false until the patient, the center, the sent date, and at least one region are settled. Two patients with the same name are a question.

**`goat_confirm_mri_referral`** runs only after the person accepts that preview. It does steps 5 and 6 below, then hands the PDF back as a download.

The panel fields, in order:

1. **CT instead of MRI.** The checkbox stays off. `isCt` is false and the label is MRI. Check it only when the person said CT. This is not a prior or outside study. `isPrior` stays off, because a prior study does not write the sent date and does not move Case Flow.
2. **Sent Date.** Fill it. The default is today in the office timezone, as MM/DD/YYYY, the same format as the Sent Date box. If the person names a date, use that date instead. The preview shows the date. Confirm does not leave Sent blank.
3. **Imaging Center.** The same dropdown as the panel: saved Contacts in the Imaging Center category. "Insight" matches "Insight Imaging Center" when that is the only center whose name contains those words. Two matches, or none, is a question. A typed name that is not a contact is allowed, the way "Someone else" is allowed on the chart, and the preview asks whether to add that contact. Adding the contact is its own yes. The referral can still keep the typed name if they decline.
4. **Regions.** The MRI region list and nothing else: Brain, Cervical, Thoracic, Lumbar, Chest, Sacrum, Shoulder, Elbow, Wrist, Hand, Hip, Knee, Ankle, Foot. Humerus, Forearm, Femur, and Tibia/Fibula are X-ray only, so they are named and left off. Laterality is stored only for Shoulder, Elbow, Wrist, Hand, Hip, Knee, Ankle, and Foot. `CL` or `C/L` is Cervical and Lumbar. A lone `C`, `T`, or `L` beside the MRI wording is Cervical, Thoracic, or Lumbar. `R shoulder` is Shoulder with R. In "CL R shoulder" the L inside CL is Lumbar, and the R belongs to the shoulder. A sided region with no side is a question. Spine regions do not ask for a side. `C5-6` or `L4-5` picks the spine region and is not stored as its own region.

The preview shows those four fields in sentences, plus any open MRI row already on the chart. Nothing is saved yet.

5. **Add MRI / CT Sent.** Confirm calls the same save as that button. The new row is modality MRI (or CT if the box was checked), the center, the regions and laterality, the sent date, and empty scheduled, completed, received, reviewed, and findings. `matrix.mriSent` is that sent date, which is what moves Case Flow off MRI "Needs Referral" under the office's existing rules. The row reads the way the panel reads it: "MRI — Insight Imaging Center", then "Regions: Cervical, Lumbar, Shoulder (R)", then "Sent: 11/16/2026 | Scheduled: - | Completed: - | Received: - | Reviewed: -".
6. **Generate PDF.** Confirm then uses the Generate PDF button on that new row: `generateImagingRequestPdf` for the MRI entry, the active Imaging Request template, and `buildDocumentTitle` for the file name. The chart opens a print dialog here. The connector does not. It renders that same document and saves the PDF in the patient's folder. If the template has `[[prompt]]` tokens, those questions are in the preview and confirm waits. If there is no Imaging Request template, nothing is saved and the answer is "NO PDF. Create Template?"

**Hand the PDF back.** As soon as that file is saved, the confirm result also returns it with the download method in **Download a file**: an MCP resource `goat://file/{file_id}`, the bytes embedded when the PDF is about 5 MB or less, and a 15-minute signed link created with this user's login. The AI app shows that file or that link. The person taps or clicks it to save the PDF on the phone, laptop, or desktop they are using. The connector does not push the file onto the device by itself, and it does not email or fax it. The audit row stores the patient id and the file id. It does not store the link or the PDF bytes.

Suggested from MRI stays a diagnosis helper. This action does not run it and does not add a diagnosis code.

### Notes, to-dos, and alerts

These follow the buttons on the patient page. Find the patient first. Two matches are a question. The preview shows the exact text, the place it will be saved, the author name, and the date. Nothing is written until a clear yes. The reply after save is a full sentence.

**Add a note.** "Add note to Mike Galstyan: spoke to the attorney." The default place is General Notes, which is the Notes box on the patient page. That box is a list of entries in `casemate.case-note-entries.v1`, not the older free-form blob. Confirm calls the same add as the Add note button: `makeEntry` and `addEntry`. The entry stores `text`, `date` (today, YYYY-MM-DD), `author` and `authorUserId` from `currentAuthor` / `authorDisplayName` for the signed-in person, plus `createdAt` and `updatedAt`. A doctor is stamped "Dr. Mike". Everyone else is first name plus last initial, "Hannah M.". The author is that real person. It is not "Mike (AI)". The activity row is `case_note.added`, the same action the Notes box writes. The Notes panel must be visible, and this person must be able to edit patients. A hidden Notes panel refuses the write.

There is no second note log called a case note. If they say "case note", it is this same Notes box. The older text in `casemate.case-notes.v1` and `matrix.notes` is Earlier notes. New notes are not appended there.

If they name an Additional Details field, the preview is that one field, not a free note. Those fields are discharge, R&B sent, billed, paid, and paid date. Billed, paid, and paid date also need the billing-figures edit. A sentence with no field name asks which field. It is not stored as a note.

**Add a to-do.** "Add a to-do for Mike: call the attorney Friday." Confirm calls `addTask`. The row is a `TaskRecord`: `title`, `priority` (Medium when they do not name one), `dueDate` (YYYY-MM-DD, empty when they do not name one), `done: false`, `patientId`, `patientName`, optional `assignee` (the label the To-Do box already stores), `createdAt`, and `updatedAt`. The activity row is `task.created`. To-dos have no author column. The signed-in person is recorded only on the activity row.

**Mark a to-do done.** Confirm calls `toggleTaskDone` on that id, sets `done` true, updates `updatedAt`, and writes `task.completed`. If more than one open to-do matches the words, the preview lists them and waits.

**Add an alert.** The header box stores `patients.alerts` as a list of strings, uppercased, the way the + Alert button does. Confirm appends one string on the patient row. It does not replace the list. The activity row is `alert.added`, because that button does not already write its own log line. The connector still records it.

Existing notes, to-dos, and alerts are not edited or deleted unless the person asks for that change and confirms a second preview. Editing a note uses `updateEntry` and `case_note.edited`, and only when `canEditEntryText` would allow it on the page. Deleting a note is the tombstone (`deleted: true`), not a hard delete. SOAP notes are never created, edited, or deleted by these tools.

### Activity log for every connector write

Every write the connector confirms, including a new patient, an MRI PDF, a note, a to-do, and an alert, is one row in the existing `audit_log`, under the signed-in user. `actor_user_id`, `actor_email`, `actor_label`, and `actor_role` are that person, the same values `logActivity` already stores. The note's `author` and `authorUserId` stay that real name. They do not gain an "(AI)" suffix.

The minimal change:

- Add a text column `source` on `public.audit_log`, default `''`. Connector rows set it to `mcp`. Rows written from the app stay blank, so old rows need no backfill. `details` may repeat `"source": "mcp"` for readers that already look at JSON. The column is what the screen filters on.
- `logActivity` accepts an optional source. The connector passes `mcp`. The app does not.
- The Activity Log table (`activity-log-panel.tsx`) shows the name as `Mike (AI)` when `source` is `mcp`. The stored `actor_label` stays `Mike`. The "(AI)" is only display. A manager still cannot read owner or admin rows. The row does not store the note body beyond the short summary the Notes box already logs, and it does not store file bytes or signed links.

Out of Phase 2 even if the person can do them in the app: editing SOAP, deleting patients or files, billing edits other than a named Additional Details field they confirmed, sending texts, scheduling except the first exam that create-patient already books, any mail change, X-ray referrals, specialist referrals, and emailing or faxing an MRI referral.

## Example questions

These are acceptance examples. Each answer names the location scope. The words are complete sentences, as in "How answers are spoken" above.

| Question | Tool | Shape of the answer |
| --- | --- | --- |
| What's today's schedule, and who hasn't checked in? | `goat_schedule_day` | Times and names, then the Scheduled rows, spoken in complete sentences. |
| How many appointments does Mike have left? | `goat_visits` kind `left` | One sentence per booked type, with the count, the next date, and the last date. |
| How many cervical decompression are left for Zhora? | `goat_visits` kind `left` | "Zhora has 3 cervical decompression visits left, and the last one is on 11/28/2026. After that, he has 10 lumbar decompression visits scheduled." Booked `Scheduled` rows only. |
| When was Mike's last appointment? | `goat_visits` kind `last` | "Mike's last appointment was 11/17/2026, and he was checked out." The same question uses "he was never checked in", "it was canceled", "it was a no-show", or "it was rescheduled to 11/20/2026" when that is the stored status. Canceled, no-show, and rescheduled also name the last checked-out visit. |
| When is Mike's next appointment? | `goat_visits` kind `next` | The soonest future `Scheduled` visit, with the date, time, and type. |
| How many visits has Mike completed? | `goat_visits` kind `completed` | The `Check Out` count, with the first and last of those dates. |
| How many no-shows does Mike have? | `goat_visits` kind `missed` | The `No Show` count and those dates. |
| What appointments does Mike have from 11/1/2026 to 11/30/2026? | `goat_visits` kind `range` | Those visits in date order, each with its status, in complete sentences. |
| What were the MRI results for Zhora? | `goat_case_read` results | Two labels. Patient Page quotes the typed findings. Patient Files is filled only after they agree to check the files. |
| What did Zhora's left knee X-ray show? | `goat_case_read` results | Patient Page: "Zhora's X-ray of the left knee showed no fracture or subluxation." when that text is typed. Patient Files says whether a report is there, and summarizes it only after yes. |
| What did pain management recommend for Zhora? | `goat_case_read` results | Patient Page quotes the Recommendations box on that specialist row. Patient Files waits for yes before reading an uploaded PM report. |
| Add note to Mike Galstyan: spoke to the attorney. | `goat_prepare_note` | Preview of the Notes entry, with today's date and his real author name. After yes: "Added that note to Mike Galstyan's Notes." The activity line shows Mike (AI). |
| Add a to-do for Mike: call the attorney Friday. | `goat_prepare_todo` | Preview with the title, due date, and assignee if they named one. Saved only after yes. |
| How do Zhora's lumbar decompression appointments break down? | `goat_case_read` appointments chip | "Lumbar Spinal Decompression is 10 scheduled, 0 checked in, 0 checked out, and 2 canceled." |
| Download the MRI referral for Zhora. | `goat_download_file` | The saved PDF as a download. If none is saved, ask before generating one. It is not emailed or faxed. |
| Who hasn't been seen in 30 days? | `goat_list_cases` mode `not_seen_in_days` | Name, last kept visit, location. |
| Which re-exams are due this week? | `goat_list_cases` mode `reexam_this_week` | Saved re-exam dates and re-exam visits this week. Say that a computed interval is not in the product. |
| Who is this patient's attorney, and what's the DOI? | `goat_get_patient` or `attorney_and_doi` | Attorney, or "no attorney" when the value is `Self`, and the injury date. |
| What's the total owed for this attorney? | `owed_for_attorney` | One total and the charts in it. Refused without billing access. |
| Which discharged cases haven't been submitted? | `discharged_not_submitted` | Status Discharged. |
| How many open cases does each attorney have, and how many visits? | `open_by_attorney` | One row per firm, visit counts beside it. |
| Discharged cases that owe more than $5,000, by attorney. | `discharged_owed_over` with `5000` | Sorted by attorney, then amount. |
| What needs my attention today? | `goat_attention_today` | The short list from the boxes this user can see. |
| Any new patients waiting in the mail? | `goat_mail_intake_pending` | Parsed referrals not yet made into charts. Creating one is a Phase 2 confirm. |
| Send MRI for Zhora to Insight cervical lumbar. | `goat_prepare_mri_referral` | Preview with CT off, Sent Date today, the matched center, and Cervical and Lumbar. After confirm, the row is added, the PDF is saved, and the same download is shown for the person to tap or click. |
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
- "How many cervical decompression are left for Zhora?" counts only future rows stored as `Scheduled`. Canceled, No Show, Check In, Check Out, and Reschedule are not in that count. A treatment plan and a package with visits remaining do not change the number. The spoken answer is the two full sentences in the table, and each type includes a next date and a last date.
- "When was Mike's last appointment?" uses the latest date before today and states the stored status in a sentence. A past `Scheduled` row is "never checked in". A `Check Out` row is "checked out". A `Canceled` or `Reschedule` row also names the latest `Check Out`. "Rescheduled to 11/20/2026" is said only when one later same-type `Scheduled` visit is the clear new row. The old row has no pointer to it.
- "How many visits has Mike completed?" counts `Check Out` only. "How many no-shows" counts `No Show` only.
- A reply that is only "3 left, last 11/28" fails the sentence check.
- A case read for a Staff login with billing hidden includes the X-ray sentence and the appointment chip, and does not include a balance. A hidden Notes panel does not return general notes. SOAP text is absent while the office SOAP switch is off.
- "What were the MRI results?" with typed cervical findings quotes that text under Patient Page and does not open a file. With an empty findings box and an uploaded MRI PDF, Patient Files asks before reading, and the PDF is not read. A yes summarizes it as from the uploaded file and offers the download. The findings box is unchanged. X-ray, CT, Pain Management, and other specialists follow the same two labels. Pain Management text is the specialist row's `recommendations` field.
- "Add note to Mike Galstyan" previews one new Notes entry and writes nothing until yes. The stored author is the signed-in person. The activity row has source `mcp` and the screen shows that name with (AI). An existing note is not changed. SOAP is not changed.
- "Add a to-do for Mike" creates one open task with the due date they named. "Mark it done" sets `done` on that task only after a second yes.
- "Download the MRI referral for Zhora" returns a resource for a file in that patient's folder. A second patient with the same name asks. No saved PDF does not generate one until confirm, and no email or fax is sent. The audit row has the file id and not the signed link.

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
- The preview has CT off unless the person said CT, and Sent Date filled as today in MM/DD/YYYY unless they named another date.
- Confirm writes one `mriReferrals` row, sets `matrix.mriSent`, and saves one PDF in the patient's folder under the Imaging Request title. It does not add a diagnosis from Suggested from MRI.
- That confirm also returns the PDF as an embedded resource and a 15-minute signed link. The AI app shows it. The person taps or clicks to save it. No email is sent and no fax is sent. A missing Imaging Request template saves nothing.
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
