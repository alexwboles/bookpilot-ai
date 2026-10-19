# BookPilot AI

**Online booking for local service businesses — without the monthly fee.** Big scheduling platforms charge $15–50/month and lock your calendar in their cloud. BookPilot AI is a free, local-first booking widget: set your services, hours, and blocked dates, then embed the booking form on your own website. Bookings live in the browser's localStorage — no accounts, no uploads, no subscriptions.

## Problem
Salons, barbers, repair shops, cleaners, tutors, and therapists lose bookings to phone tag. The free alternatives are either ad-supported, take a cut, or (since Cal.com went closed-source in 2026) leave self-hosters with bare community forks.

## Solution
A single static page with two faces: a **customer booking widget** (service → date → time → confirm, embeddable via iframe with `?embed=1`) and an **owner dashboard** (upcoming bookings, day-before reminder nudges, no-show tracking, revenue stats).

## Features
1. **Service menu** — name, duration, price, and buffer time. Duration drives the slot grid; price feeds revenue stats; the buffer blocks cleanup/setup minutes after every appointment.
2. **Availability rules** — per-day working hours, one-click closed days, blocked dates (holidays/vacations).
3. **Smart slot grid** — slots generated from hours − existing bookings − blocked dates − buffer windows; past times hidden; no double-booking (overlap-checked).
4. **Waitlist** — when a day is fully booked, customers join a waitlist; the owner sees who's waiting per day with a "slot may be free" flag when a cancellation opens time, and one-tap phone copying.
5. **Booking references** — every booking gets a short ref code (e.g. B-7X2Q), shown at confirmation, in the owner ledger, the customer lookup, CSV exports, and reminder texts.
4. **Owner bookings board** — filter by status; mark completed / no-show / cancelled.
5. **Day-before reminders** — auto-flags tomorrow's un-reminded bookings; one-click copy of a personalized SMS reminder; tracks who was reminded.
6. **No-show tracker + stats** — no-show rate, completed revenue, upcoming count.
7. **Embed widget** — generates an iframe snippet (optionally locked to one service); `?embed=1` shows the customer view only.
8. **Week capacity strip** — 7-day booked-vs-open-hours view (booked minutes include service buffers) in The numbers card, so slow days are obvious at a glance.
9. **Returning-customer recognition** — typing a known phone number in the booking form shows visit count, completed visits, and lifetime spend; the owner ledger badges repeat customers.
10. **Waitlist one-click book** — when a "slot may be free" flag shows, one tap pre-fills the whole booking form (service, date, name, phone) for that waitlister.
11. **Notifications over free channels** — browser notifications (permission-based, shown on open when reminders are due), phone push via the free [ntfy.sh](https://ntfy.sh) service (install the app, subscribe to your topic, push from the Bookings tab), and email reminders through **your own Gmail** via the included `tools/send-reminders.js` (OAuth2, documented setup, credentials in a gitignored config file — never hardcoded). No SMS: sending real text messages requires a paid gateway (Twilio and similar charge per message), which would break the free-forever model — so BookPilot deliberately does not implement SMS. The reminder box still offers one-click copy of the SMS text for sending from your own phone.
12. **Multi-device sync** — everything lives in this browser's localStorage. Move it with a backup file (export/import, with automatic pre-import backup) or a **QR code transfer**: the Sync tab encodes the whole store into a QR code (compressed when the browser supports it); scan it with any QR reader app on the other device, copy the text, paste it into the Import box there. Large histories should use the backup file — QR codes hold a few thousand characters.
13. **Multi-staff calendars** — team roster, per-service "who performs what" assignment, per-staff slot availability in the booking widget ("first available" matches the earliest free qualified person), staff filter on the bookings board, and a per-day/per-person schedule view. This works on one shared device (front-desk tablet / shop computer).
14. **Customer email (optional)** — bookings can carry an email address; it flows into the CSV export and powers the Gmail reminder tool above.
15. **Add to calendar (.ics)** — the confirmation ticket and the self-service lookup offer a one-click `.ics` download, generated entirely client-side (no service, no account) — the appointment lands in the customer's phone calendar instead of evaporating when they close the tab.
16. **Reschedule, not just cancel** — customers can move an upcoming booking from "Find my bookings" (date + time picker honoring the booking's service and team member); owners get a "Move" action on every ledger row. Moved bookings use the exact same validation as new ones (blocked/closed/hours/conflicts) and reset their reminder flag.
17. **Per-staff working hours** — optional per-day open/close times per team member (Team tab → Team hours); the slot engine honors them automatically, including "first available" matching. Unset = business hours, so part-timers stop showing as bookable at times they never work.

## Pricing vision
Free forever for one location, including multi-staff calendars and all notification channels above · **$19/mo Pro** (online deposits, review-request automation) · $49/mo Multi-location.

## Honest limits
- **Live multi-device / multi-user concurrency is out of scope.** Two devices can each hold a copy and hand data back and forth (export/import/QR), but there is no live shared calendar — that needs a server, which needs hosting, which costs money. The sync tools here are the free answer; a hosted realtime backend is not.
- **No automatic SMS.** Same reason: every real SMS gateway is pay-per-message. The day-before reminder flow (copy text, ntfy push, Gmail tool) covers the job without it.

## Run it
No build step. Open `index.html` in a browser, or:

```bash
python3 -m http.server 8080   # then http://localhost:8080
```

Append `?embed=1` for the customer-only widget view.

## Tests
```bash
bash test/smoke.sh   # 90 checks: files, syntax, slots, booking, blocked dates, reminders, stats, embed, staff, sync, QR, notifications, gmail tool, reschedule, ICS, staff hours, v2 design rules
bash test/e2e.sh     # 31 end-to-end flows in Node against js/logic.js
```

## Multi-device sync flow
1. This device: Sync tab -> Show QR code (or Download backup for large histories).
2. Other device: scan the QR with any QR reader app -> copy the text -> open BookPilot -> Sync tab -> paste into the transfer box -> Import -> confirm.
3. Your current data is backed up automatically before anything is replaced.

## Email reminders (Gmail, free)
Bookings with an email address can get day-before reminders sent from your
Gmail account - no paid email service. One-time Google Cloud setup (about 5 min),
then:
```bash
node tools/send-reminders.js --store bookpilot-backup-2026-10-19.json --apply
```
Full setup in `tools/README.md`. Credentials live in `tools/gmail-config.json`
(gitignored, never committed).

## Architecture
```
index.html        customer booking tab + owner tabs (single page)
css/style.css     theme (appointment-book identity), cards, slot grid, pills
js/logic.js       pure scheduling logic (UMD: Node + browser)
js/qrcodegen.js   vendored Nayuki QR-Code-generator v1.6.0 (MIT), type-stripped
js/app.js         DOM wiring + localStorage persistence (key: bookpilot-ai-v1)
tools/            send-reminders.js (Gmail OAuth reminder sender, zero deps)
test/smoke.sh     file/syntax/logic/UI-wiring checks
test/e2e.sh       27 user-journey flows in Node
```
All logic is dependency-free and offline-capable. Data never leaves the browser
(ntfy.sh pushes and Gmail sends are explicit owner actions).
