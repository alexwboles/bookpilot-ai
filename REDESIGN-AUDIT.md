# BookPilot AI — Redesign Audit v2 (2026-10-19)

The Oct 13 redesign (v1, section 6 below for reference) shipped the
appointment-book identity and closed its four gaps. This pass re-audits against
the three products customers and owners actually compare BookPilot to, and takes
the UI from "good" to shippable premium.

## 1. Competitors studied

- **Calendly** — public scheduling page (two-pane: event info left, day+time
  picker right in ONE consolidated screen), 4-step booking funnel teardown
  (closetrace), booking-page options (buffers, minimum notice, start-time
  increments), confirmation screen with **Add to calendar / reschedule / cancel**
  actions.
- **Square Appointments** — owner calendar with day/week views and a **side-by-side
  multi-staff view**, per-employee recurring schedules, customer profiles with
  history + notes, waitlist, recurring appointments, no-show fee tooling.
- **Booksy** — service menu with duration+price driving the slot engine, **staff
  profiles as the trust surface** (photo, services, working hours), real-time
  availability, automated reminders, client cards with history, rebooking
  prompts, single-view multi-staff calendar.

## 2. Layout / IA / visual patterns worth borrowing (6)

1. **Calendly's consolidated day+time panel.** Calendly puts calendar and times on
   the same screen — pick a day and the times appear beside it, no scroll between
   the two decisions. v1 stacks them. v2 puts the slot panel in a sticky right
   column next to the calendar on desktop.
2. **Calendly's live booking summary.** The left panel shows a running summary
   (what/when/with whom) that fills in as you pick. v2 adds an "appointment
   ticket" card in the info panel that updates live through the 3 steps.
3. **Square's day timeline with side-by-side staff columns.** The owner day view
   becomes a vertical time ruler with booking blocks positioned by start time and
   length, one column per team member — scan a day the way a front desk does.
4. **Calendly confirmation ticket.** Confirmation is a stub: ref code prominent,
   perforated divider, and real actions — **Add to calendar (.ics download)**,
   reschedule, book another. v1 shows a plain notice box.
5. **Per-staff recurring schedules (Square/Booksy).** "Everyone works the shop
   hours" is not how teams work. v2 adds optional per-team-member working hours
   that override the business hours in the slot engine (defaults = business hours,
   so existing data is unaffected).
6. **Editorial display typography.** Booking tools sell trust; oversized serif
   numerals for stats, hairline rules with brass accents, uppercase micro-labels,
   and ticket-stub motifs beat another card grid. Kept from v1: warm paper, deep
   ink-green, brass — sharpened, layered, more distinctive.

## 3. Functional gaps vs competitors (the 3 this redesign closes)

1. **No "Add to calendar" for the customer.** Calendly and Booksy both end with
   the appointment in the customer's phone calendar. BookPilot's confirmation
   ends at a message on screen — the booking evaporates the moment they close the
   tab. CLOSED: one-click `.ics` download generated client-side (no service, no
   account) from the confirmation ticket and from the self-service lookup.
2. **No self-service or owner reschedule — cancel-and-rebook only.** Square lets
   customers move an appointment; BookPilot forces cancel + start over, and the
   owner had no way to move a booking at all. CLOSED: reschedule flow in "Find my
   bookings" (date + slot picker honoring the booking's service and staff) and a
   "Move" action on every owner ledger row. Same validation as booking
   (blocked/closed/conflict checks), fully tested.
3. **No per-staff working hours.** Square and Booksy both let each person set
   their own schedule. BookPilot applied global hours to everyone, so a part-time
   stylist showed as bookable at times they never work. CLOSED: optional per-day
   open/close times per team member in the Team tab ("Same as business hours" is
   the default); the slot engine uses them automatically, including "first
   available" matching.

Noted but descoped (documented honestly, not hidden): online payments/deposits
(needs a processor = money); live multi-device concurrency (needs a server =
money); automatic SMS (pay-per-message, already documented in README).

## 4. New visual identity — "The Concierge Desk"

An evolution of v1's appointment-book, not a replacement: warm cream paper
(`#f7f4ec`), deep ink-green (`#14291d`) sidebar and type, brass (`#a97b2f`)
hairlines and accents, Georgia serif display with tabular-mono times. What v2
adds: a **sidebar HUD** ("Today at a glance": date, today's count, next
appointment), a **live appointment ticket** in the booking rail, a
**perforated confirmation stub** (square punch notches via clip-path — zero
border-radius anywhere), a **day-timeline schedule board** with staff columns,
oversized display numerals for stats, and a tighter, calmer responsive rhythm.
No gradients, no rounded edges, no emoji chrome.

## 5. Preservation contract (from the 2026-10-19 consolidation)

All preserved, untouched in behavior: free notifications (browser Notifications
API opt-in + auto-alert on open; ntfy.sh phone push with per-reminder Push and
push-all-due; email via the owner's own Gmail through `tools/send-reminders.js`,
OAuth2 loopback, gitignored config — never hardcoded credentials); multi-device
sync (backup export/import with auto-backup-before-replace; QR transfer with
`BP1:`/`BP1Z:` payloads, vendored Nayuki qrcodegen v1.6.0 MIT header retained);
multi-staff calendars (roster, per-service performer matrix, per-staff slot
availability, "first available" matching, staff filter + per-day schedule view);
booking wizard, services, hours, blocked dates, waitlist (incl. one-click book),
same-day slots, booking refs, CSV export, customer search, revenue by service,
next-available finder, customer self-service lookup + cancel, returning-customer
recognition, week capacity strip, embed widget (`?embed=1`). No SMS — README
keeps the honest rationale. localStorage key `bookpilot-ai-v1` unchanged; staff
records gain an optional `hours` field (absent = business hours), so old stores
load with zero migration.

## 6. QA plan for this pass

- `test/smoke.sh` + `test/e2e.sh` green, extended: reschedule (happy path,
  conflict rejection, invalid date, owner move), `.ics` field checks (UID,
  DTSTART/DTEND, SUMMARY, ref in DESCRIPTION), per-staff hours (override
  restricts slots, unset = business hours, sanitize strips bad values),
  import of legacy staff records without `hours`.
- Screenshot QA (desktop 1440×900, mobile 390×844): booking face with ticket
  rail, confirmation stub, day timeline, team hours editor; before/after under
  `redesign-shots/v2/`.

## 7. v1 audit (2026-10-13) — reference

Competitors: Calendly (day+time consolidated, left info panel), Acuity
(editorial booking face, service cards), Setmore (sidebar owner desk). v1 closed:
month calendar with availability counts; two-pane booking face; owner front-desk
sidebar shell; embed customer-only mode. Visual gaps closed: scheduler-first
booking face, decorative steps rail → real 3-step progress, owner card stack →
sidebar desk, plain slot pills → grouped morning/afternoon/evening grid, generic
teal → warm paper + forest green + serif appointment-book identity.
