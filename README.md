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

## Pricing vision
Free forever for one location · **$19/mo Pro** (multi-staff calendars, SMS reminders sent automatically, online deposits) · $49/mo Multi-location.

## Run it
No build step. Open `index.html` in a browser, or:

```bash
python3 -m http.server 8080   # then http://localhost:8080
```

Append `?embed=1` for the customer-only widget view.

## Tests
```bash
bash test/smoke.sh   # 12 checks: files, syntax, slots, booking, blocked dates, reminders, stats, embed
bash test/e2e.sh     # 8 end-to-end flows in Node against js/logic.js
```

## Architecture
```
index.html        customer booking tab + owner tabs (single page)
css/style.css     theme (teal accent), cards, slot grid, pills
js/logic.js       pure scheduling logic (UMD: Node + browser)
js/app.js         DOM wiring + localStorage persistence (key: bookpilot-ai-v1)
test/smoke.sh     file/syntax/logic checks
test/e2e.sh       8 user-journey flows in Node
```
All logic is dependency-free and offline-capable. Data never leaves the browser.
