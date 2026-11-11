# G.O.A.T. Mail setup

This is for the person who runs NoteGoat. Office staff never see these steps. Until this is done, the G.O.A.T. Mail page says it isn't turned on yet. After it is done, each office sees **Connect Outlook**.

G.O.A.T. Mail only requests Microsoft Graph delegated **Mail.Read** and **User.Read**. It never sends, deletes, or changes email.

1. Sign in to the Microsoft Entra admin center (https://entra.microsoft.com) with an account that can register applications.
2. Go to Identity → Applications → App registrations → New registration.
3. Name it NoteGoat G.O.A.T. Mail. Supported account types: Accounts in any organizational directory and personal Microsoft accounts.
4. Redirect URI: platform Web, and the exact address `https://<your NoteGoat host>/api/goat-mail/callback` (for this office, `https://mynotegoat.com/api/goat-mail/callback`).
5. Open the new app and copy the Application (client) ID.
6. Certificates & secrets → New client secret. Copy the secret Value right away. It is shown only once.
7. API permissions → Add a permission → Microsoft Graph → Delegated permissions → Mail.Read and User.Read. Do not add Mail.Send, Mail.ReadWrite, or any permission that can send, delete, or change mail. Grant admin consent if the tenant requires it.
8. On the NoteGoat server (the host’s environment variables, never in the browser), set `GOAT_MAIL_CLIENT_ID` to the Application (client) ID, `GOAT_MAIL_CLIENT_SECRET` to the secret Value, and `GOAT_MAIL_TENANT_ID` to `common` (or the office tenant id if the app is single-tenant).
9. In the Supabase SQL editor, run `supabase/migrations/20261109210000_goat_mail_connections.sql`. The table stores the mailbox refresh token with row level security and no policies, so only the server can read it.
10. Redeploy so the server sees the variables. Open G.O.A.T. Mail and choose Connect Outlook. Sign in to the office mailbox and accept the read-only Mail.Read prompt. Inbox is read until the office picks other folders. That choice is saved in the office workspace settings (`casemate.goat-mail-folders.v1`). No extra table column is required.

If `GOAT_MAIL_CLIENT_ID` or `GOAT_MAIL_CLIENT_SECRET` is missing, or the `goat_mail_connections` table is missing, the page says G.O.A.T. Mail isn't turned on yet. It does not call Microsoft and it does not show these steps.
