# REDESIGN-AUDIT.md — BookPilot AI (2026-10-13)

## Competitors researched
- **Calendly** — new scheduling page: monthly calendar + daily availability on one screen, day+time consolidated, event-type cards, left info panel / right calendar split on public booking pages, blue accent, clean sidebar on owner side.
- **Acuity / Squarespace Scheduling** — warm editorial booking face: service menu as selectable cards, calendar with available-day highlighting, timezone-aware slots, confirmation summary.
- **Setmore** — owner dashboard: calendar-first day/week view, appointment list with status pills, customer records, left sidebar nav.

## Visual gaps vs competitors
1. **Booking face is a form, not a scheduler.** Calendly/Acuity lead with a month calendar; we have a bare `<input type="date">`. No month view, no available-day highlighting — the core scheduling metaphor is missing.
2. **Steps rail is decorative.** Numbered 1-2-3 but the flow is really service → date → time on one screen; Calendly consolidates day+time into one panel.
3. **No left info panel.** Calendly's public page shows business/event context beside the calendar; ours shows a bare service dropdown.
4. **Owner view is a stack of cards**, not a desk. Setmore's owner side is a sidebar + schedule list; ours is undifferentiated cards down the page.
5. **Slot buttons are plain pills** — no grouping by morning/afternoon, no selected-state emphasis.
6. **Identity is generic teal** — says nothing about local service businesses (salons, barbers, repair shops).

## Functional/flow gaps vs competitors
1. **No month calendar with availability dots** — the single biggest "real software" gap. Customers can't scan for open days.
2. **No business context on the booking face** — no business name display, no service summary panel.
3. **Embed mode still shows the full masthead** — should be a clean customer-only widget.
4. **No per-day slot counts** for the owner (capacity strip exists as a week summary only).

## What this redesign does
- **Calendly-grade booking face:** two-pane scheduler — left info panel (business name, selected service summary, duration/price) + right month calendar with availability highlighting + slot grid grouped by part of day.
- **Month calendar component** (new in app.js): prev/next month, closed/blocked dimming, open-slot counts per day, drives the existing slot logic (bkDate kept as the state input).
- **Owner "front desk" shell:** deep-green fixed sidebar (brand, business name, vertical tabs, demo/wipe) + main workspace; tomorrow's book as a schedule list.
- **Identity:** warm cream paper + forest-green accent + serif display (appointment-book editorial), mono tabular times. Zero rounded edges.
- **Embed mode:** body.embed class → minimal chrome, booking face fills the viewport.
- Preserves: all services/hours/blocked/waitlist/reminder/no-show/stats/embed flows and IDs; smoke + e2e extended for the calendar.
