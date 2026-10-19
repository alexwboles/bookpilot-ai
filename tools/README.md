# BookPilot email reminders — free via your own Gmail

`send-reminders.js` sends day-before reminder emails through **your** Gmail
account (OAuth2, `gmail.send` scope only). No paid email service, no stored
password, no dependencies — just Node.js.

## One-time setup (~5 minutes)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a
   project (any name, e.g. `bookpilot`).
2. **APIs & Services → Library** → search **Gmail API** → Enable.
3. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name: `BookPilot reminders`, your email as support contact
   - Scopes: add `https://www.googleapis.com/auth/gmail.send`
   - Test users: add your own Gmail address
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Desktop app** → Create
   - Copy the **Client ID** and **Client secret**.
5. In this folder:
   ```bash
   cp gmail-config.example.json gmail-config.json
   ```
   Paste your client ID, secret, and Gmail address (`sender`) into
   `gmail-config.json`. This file is **gitignored — never commit it**.

## First run (authorizes the app)

```bash
node tools/send-reminders.js --store bookpilot-backup.json --dry-run
```

The script prints a Google consent URL. Open it, sign in, allow the
`gmail.send` scope. Google redirects to a localhost address the script is
listening on; it captures the code, exchanges it for a **refresh token**,
and saves it into `gmail-config.json` (file mode 0600). You only do this
once — the refresh token is reused silently afterwards.

## Daily use

1. In BookPilot: **Sync & transfer → Download backup**.
2. Run:
   ```bash
   node tools/send-reminders.js --store bookpilot-backup-2026-10-19.json --apply
   ```
   Sends to every booking **tomorrow** that has an email address and hasn't
   been reminded yet, then writes `bookpilot-backup-2026-10-19.sent.json`.
3. In BookPilot: **Sync & transfer → Import backup file…** → pick the
   `.sent.json`. The sent reminders are now marked as reminded.

Flags: `--dry-run` (list only), `--date YYYY-MM-DD` (pretend today is that
date — handy for testing), `--apply` (write the `.sent.json`).

Run it daily from a scheduler (cron / Task Scheduler) and reminders go out
on their own — still free, still your Gmail.

## Security notes

- `gmail-config.json` holds OAuth credentials. It is gitignored; keep it
  that way. If it ever leaks, revoke it at
  [Google Account → Security → Third-party access](https://myaccount.google.com/permissions).
- The app requests the narrowest scope that works: `gmail.send` (send only,
  no inbox read).
- Bookings store the customer's email only if they typed it into the booking
  form. No email on file → the booking is listed as "no email on file" and
  skipped, never guessed.
