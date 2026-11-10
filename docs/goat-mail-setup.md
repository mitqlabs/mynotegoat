# GOAT Mail setup

This is for the person who runs NoteGoat. Office staff never see these steps. Until this is done, GOAT Mail shows “GOAT Mail is coming soon.” After it is done, each office sees **Connect mailbox**.

GOAT Mail only requests Microsoft Graph delegated **Mail.Read** and **User.Read**. It never sends, deletes, or changes email.

1. Sign in to the Microsoft Entra admin center (https://entra.microsoft.com) with an account that can register applications.
2. Go to Identity → Applications → App registrations → New registration.
3. Name it NoteGoat GOAT Mail. Supported account types: Accounts in any organizational directory and personal Microsoft accounts.
4. Redirect URI: platform Web, and the exact address `https://<your NoteGoat host>/api/goat-mail/callback` (for this office, `https://mynotegoat.com/api/goat-mail/callback`).
5. Open the new app and copy the Application (client) ID.
6. Certificates & secrets → New client secret. Copy the secret Value right away. It is shown only once.
7. API permissions → Add a permission → Microsoft Graph → Delegated permissions → Mail.Read and User.Read. Do not add Mail.Send, Mail.ReadWrite, or any permission that can send, delete, or change mail. Grant admin consent if the tenant requires it.
8. On the NoteGoat server (the host’s environment variables, never in the browser), set `GOAT_MAIL_CLIENT_ID` to the Application (client) ID, `GOAT_MAIL_CLIENT_SECRET` to the secret Value, and `GOAT_MAIL_TENANT_ID` to `common` (or the office tenant id if the app is single-tenant).
9. In the Supabase SQL editor, run `supabase/migrations/20261109210000_goat_mail_connections.sql`. The table stores the mailbox refresh token with row level security and no policies, so only the server can read it.
10. Redeploy so the server sees the variables. Open GOAT Mail and choose Connect mailbox. Sign in to the office mailbox and accept the read-only Mail.Read prompt.

If `GOAT_MAIL_CLIENT_ID` or `GOAT_MAIL_CLIENT_SECRET` is missing, or the `goat_mail_connections` table is missing, the app keeps showing “GOAT Mail is coming soon.” It does not call Microsoft and it does not show this page.
