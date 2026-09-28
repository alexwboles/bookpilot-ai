#!/usr/bin/env bash
# BookPilot AI end-to-end tests — 8 flows exercised in Node against js/logic.js.
set -u
cd "$(dirname "$0")/.."

node << 'EOF'
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS: ' + m); };
const bad = (m) => { fail++; console.log('  FAIL: ' + m); };
console.log('== bookpilot-ai e2e ==');

const svc = { id: 's1', name: 'Cut', durationMin: 30, price: 35 };
const svcLong = { id: 's2', name: 'Color', durationMin: 120, price: 120 };
function fresh() {
  return { services: [svc, svcLong], hours: B.defaultHours(), blockedDates: [], bookings: [] };
}
// Mondays: 2026-10-05, 2026-10-12. Saturday 2026-10-10 (10:00-14:00).

// Flow 1: full customer journey — service -> slots -> book -> appears upcoming
let st = fresh();
const slots = B.slotsFor('2026-10-05', svc, st.hours, [], st.bookings, { today: '2026-09-28', nowMin: 0 });
const r = B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: slots[0], name: 'Jane Doe', phone: '555-1234' });
const up = B.upcomingBookings(st, '2026-09-28');
(r.ok && up.length === 1 && up[0].name === 'Jane Doe') ? ok('flow1: slot -> booking -> upcoming list') : bad('flow1');

// Flow 2: slot shrinks after booking; overlapping partial booking rejected
const after = B.slotsFor('2026-10-05', svc, st.hours, [], st.bookings, { today: '2026-09-28', nowMin: 0 });
const partial = B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: slots[0] + 15, name: 'X', phone: '1' });
(after.length === slots.length - 1 && !partial.ok) ? ok('flow2: slot consumed; 15-min overlap rejected') : bad('flow2');

// Flow 3: 2-hour service generates fewer slots and can't overrun closing
const longSlots = B.slotsFor('2026-10-05', svcLong, st.hours, [], [], { today: '2026-09-28', nowMin: 0 });
const lastEnd = longSlots[longSlots.length - 1] + 120;
(longSlots.length === 4 && lastEnd === 1020) ? ok('flow3: 120min service -> 4 slots, last ends at close') : bad('flow3 n=' + longSlots.length);

// Flow 4: Saturday short hours + Sunday closed
const sat = B.slotsFor('2026-10-10', svc, st.hours, [], [], { today: '2026-09-28', nowMin: 0 });
const sunB = B.bookSlot(fresh(), { serviceId: 's1', date: '2026-10-04', start: 600, name: 'X', phone: '1' });
(sat.length === 8 && !sunB.ok && /Closed/.test(sunB.error)) ? ok('flow4: Sat 8 slots; Sun booking rejected as closed') : bad('flow4');

// Flow 5: blocked date blocks both slot list and booking
st.blockedDates.push('2026-10-12');
const blkSlots = B.slotsFor('2026-10-12', svc, st.hours, ['2026-10-12'], [], { today: '2026-09-28', nowMin: 0 });
const blkBook = B.bookSlot(st, { serviceId: 's1', date: '2026-10-12', start: 540, name: 'X', phone: '1' });
(blkSlots.length === 0 && !blkBook.ok) ? ok('flow5: blocked date -> no slots, booking rejected') : bad('flow5');

// Flow 6: lifecycle — complete one, no-show one, cancel one; stats + revenue
st = fresh();
const b1 = B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'A', phone: '1' }).booking;
const b2 = B.bookSlot(st, { serviceId: 's2', date: '2026-10-05', start: 600, name: 'B', phone: '2' }).booking;
const b3 = B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 720, name: 'C', phone: '3' }).booking;
B.setStatus(st, b1.id, 'completed');
B.setStatus(st, b2.id, 'no-show');
B.setStatus(st, b3.id, 'cancelled');
const s = B.stats(st.bookings);
(s.completed === 1 && s.noShow === 1 && s.cancelled === 1 && s.revenue === 35 && s.noShowRate === 50)
  ? ok('flow6: lifecycle -> stats correct (rev $35, 50% no-show)') : bad('flow6 ' + JSON.stringify(s));

// Flow 7: reminder flow — tomorrow's booking flagged, then marked reminded
st = fresh();
B.bookSlot(st, { serviceId: 's1', date: '2026-09-29', start: 540, name: 'Rem', phone: '9' });
B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'Later', phone: '8' });
const due1 = B.dayBeforeList(st, '2026-09-28');
B.markReminded(st, st.bookings[0].id);
const due2 = B.dayBeforeList(st, '2026-09-28');
const msg = B.reminderMessage('Salon', st.bookings[0]);
(due1.length === 1 && due2.length === 0 && /Rem/.test(msg) && /9:00 AM/.test(msg))
  ? ok('flow7: reminder due -> sent -> cleared; message personalized') : bad('flow7');

// Flow 8: next open dates skip closed/blocked days; service validation
st = fresh();
st.blockedDates.push('2026-10-05');
const open = B.nextOpenDates(st, 's1', 2, '2026-10-04'); // Sun closed, Mon 10-05 blocked
const badSvc = B.validateService({ name: '', durationMin: 9999, price: -5 });
(open.length === 2 && open[0].date === '2026-10-06' && open[1].date === '2026-10-07' && badSvc.length === 3)
  ? ok('flow8: next-open skips closed Sun + blocked Mon; bad service -> 3 errors') : bad('flow8 ' + JSON.stringify(open.map(o => o.date)));

console.log('');
console.log('e2e: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
EOF
echo "e2e exit: $?"
