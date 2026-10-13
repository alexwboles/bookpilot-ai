#!/usr/bin/env bash
# BookPilot AI end-to-end tests — 13 flows exercised in Node against js/logic.js.
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

// Flow 9: owner exports bookings to CSV and it round-trips the full ledger
st = fresh();
B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'Ann "Annie" Okafor', phone: '555-0101', notes: 'long hair, extra time' });
B.bookSlot(st, { serviceId: 's2', date: '2026-10-06', start: 600, name: 'Ben', phone: '555-0102' });
B.setStatus(st, st.bookings[0].id, 'completed');
const csv = B.bookingsToCSV(st);
const csvLines = csv.split('\r\n');
(csvLines.length === 3 && /"Ann ""Annie"" Okafor"/.test(csv) && /completed/.test(csvLines[1]) && /confirmed/.test(csvLines[2]) && /long hair, extra time/.test(csv))
  ? ok('flow9: CSV export quotes names, keeps notes + statuses') : bad('flow9 ' + csv.slice(0, 150));

// Flow 10: owner searches the ledger by customer name, service, phone
const hitName = B.searchBookings(st, 'okafor');
const hitSvc = B.searchBookings(st, 'color');
const hitPhone = B.searchBookings(st, '0102');
const hitNone = B.searchBookings(st, 'zzz-no-match');
(hitName.length === 1 && hitSvc.length === 1 && hitSvc[0].name === 'Ben' && hitPhone.length === 1 && hitPhone[0].name === 'Ben' && hitNone.length === 0)
  ? ok('flow10: search by name/service/phone-digits; no match -> empty') : bad('flow10');

// Flow 11: revenue-by-service reflects only completed bookings, ranked
const rev = B.revenueByService(st.bookings);
(rev.length === 2 && rev[0].service === 'Cut' && rev[0].revenue === 35 && rev[0].bookings === 1 &&
 rev[1].service === 'Color' && rev[1].revenue === 0 && rev[1].completed === 0)
  ? ok('flow11: revenue ranked Cut $35 > Color $0 (not yet completed)') : bad('flow11 ' + JSON.stringify(rev));

// Flow 12: next-available finder lands on first bookable day for the service
st = fresh();
for (let t = 540; t < 1020; t += 30) B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: t, name: 'Full' + t, phone: '1' });
const nxt = B.nextOpenDates(st, 's1', 2, '2026-10-05');
(nxt.length === 2 && nxt[0].date === '2026-10-06' && nxt[0].slots.length > 0 && nxt[1].date === '2026-10-07')
  ? ok('flow12: next-available skips fully-booked Monday -> Tue/Wed') : bad('flow12 ' + JSON.stringify(nxt.map(o => o.date)));

// Flow 13: customer self-service — find by phone, cancel, cancelled disappears from lookup
st = fresh();
B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'Cara', phone: '(555) 777-8888' });
B.bookSlot(st, { serviceId: 's2', date: '2026-10-06', start: 600, name: 'Cara', phone: '5557778888' });
const mine1 = B.findBookingsByPhone(st, '555-777-8888');
const c = B.cancelBooking(st, mine1[0].id);
const mine2 = B.findBookingsByPhone(st, '555-777-8888');
const stillThere = st.bookings.filter(b => b.id === mine1[0].id)[0];
(mine1.length === 2 && c.ok && mine2.length === 1 && stillThere.status === 'cancelled')
  ? ok('flow13: phone lookup finds 2; self-cancel works; cancelled hidden from lookup') : bad('flow13');

// Flow 14: buffer time shrinks availability end to end
st = fresh();
const svcBuf = { id: 's3', name: 'Color+', durationMin: 60, price: 100, bufferMin: 30 };
st.services.push(svcBuf);
const rb = B.bookSlot(st, { serviceId: 's3', date: '2026-10-05', start: 540, name: 'Buf', phone: '1' });
const bufSlots = B.slotsFor('2026-10-05', svcBuf, st.hours, [], st.bookings, { today: '2026-09-28', nowMin: 0, services: st.services });
(rb.ok && bufSlots.indexOf(600) === -1 && bufSlots.indexOf(660) !== -1)
  ? ok('flow14: 60min+30buf at 9:00 blocks 10:00, frees 11:00') : bad('flow14 ' + JSON.stringify(bufSlots.slice(0, 4)));
// other service's buffer also blocks: 30-min cut at 10:15 would overlap the buffer
const clashOther = B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 615, name: 'X', phone: '2' });
(!clashOther.ok) ? ok('flow14: another service cannot book inside the buffer window') : bad('flow14 cross-service');
// but exactly at the buffer end (10:30) is fine — back-to-back is allowed
const backToBack = B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 630, name: 'Y', phone: '3' });
(backToBack.ok) ? ok('flow14: booking exactly when the buffer ends is allowed') : bad('flow14 back-to-back');

// Flow 15: waitlist journey — join when full, owner sees it, remove works
st = fresh();
const wlSvc = { id: 's9', name: 'Quick', durationMin: 480, price: 10 };
st.services.push(wlSvc);
const full = B.slotsFor('2026-10-05', wlSvc, st.hours, [], st.bookings, { today: '2026-09-28', nowMin: 0, services: st.services });
const wb = B.bookSlot(st, { serviceId: 's9', date: '2026-10-05', start: full[0], name: 'Full', phone: '3' });
const fullAfter = B.slotsFor('2026-10-05', wlSvc, st.hours, [], st.bookings, { today: '2026-09-28', nowMin: 0, services: st.services });
const wj = B.addToWaitlist(st, { serviceId: 's9', date: '2026-10-05', name: 'Waiter', phone: '555-0000' });
(wb.ok && fullAfter.length === 0 && wj.ok && B.waitlistFor(st, 's9', '2026-10-05')[0].name === 'Waiter')
  ? ok('flow15: day fills -> waitlist join -> owner sees entry') : bad('flow15');
B.cancelBooking(st, wb.booking.id);
const freed = B.slotsFor('2026-10-05', wlSvc, st.hours, [], st.bookings, { today: '2026-09-28', nowMin: 0, services: st.services });
(freed.length > 0) ? ok('flow15: cancellation re-opens a slot for the waitlist') : bad('flow15 reopen');

// Flow 16: booking refs flow into CSV and reminders
st = fresh();
B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'Ref', phone: '4' });
const bk = st.bookings[0];
const csv16 = B.bookingsToCSV(st);
const msg16 = B.reminderMessage('Salon', bk);
(/^B-[0-9A-Z]{4}$/.test(bk.ref) && csv16.indexOf(bk.ref) !== -1 && msg16.indexOf(bk.ref) !== -1)
  ? ok('flow16: ref on booking, in CSV export, and in reminder text (' + bk.ref + ')') : bad('flow16');

// Flow 17: day utilization counts booked minutes (incl. buffers) vs open minutes
const st17 = {
  hours: B.defaultHours(), // Mon 9:00-17:00 = 480 open min
  services: [{ id: 's1', name: 'Cut', durationMin: 30, price: 35, bufferMin: 10 }],
  blockedDates: [],
  bookings: [
    { id: 'b1', serviceId: 's1', date: '2026-10-12', start: 540, end: 570, status: 'confirmed', price: 35 },
    { id: 'b2', serviceId: 's1', date: '2026-10-12', start: 600, end: 630, status: 'completed', price: 35 },
    { id: 'b3', serviceId: 's1', date: '2026-10-12', start: 700, end: 730, status: 'cancelled', price: 35 }
  ]
};
const u17 = B.dayUtilization(st17, '2026-10-12');
const u17closed = B.dayUtilization(st17, '2026-10-11'); // Sunday: closed
const w17 = B.weekUtilization(st17, '2026-10-12');
(u17.openMin === 480 && u17.bookedMin === 80 && u17.pct === 17 &&
  u17closed.openMin === 0 && w17.length === 7)
  ? ok('flow17: utilization = (30+10)*2 of 480 open min; closed day 0; week is 7 days') : bad('flow17 ' + JSON.stringify(u17));

// Flow 18: customerStats recognizes repeat customers; waitlistEntry by id
const st18 = {
  bookings: [
    { id: 'b1', name: 'Jane', phone: '555-123-4567', status: 'completed', price: 35, date: '2026-10-01', start: 540 },
    { id: 'b2', name: 'Jane', phone: '(555) 123-4567', status: 'completed', price: 90, date: '2026-10-08', start: 600 },
    { id: 'b3', name: 'Jane', phone: '555-123-4567', status: 'cancelled', price: 35, date: '2026-10-10', start: 540 }
  ],
  waitlist: [{ id: 'wl-1', serviceId: 's1', date: '2026-10-14', name: 'Jane', phone: '555-123-4567' }]
};
const cs18 = B.customerStats(st18, '5551234567');
const wl18 = B.waitlistEntry(st18, 'wl-1');
(cs18 && cs18.bookings === 3 && cs18.completed === 2 && cs18.totalSpent === 125 &&
  cs18.lastVisit === '2026-10-10' && B.customerStats(st18, '999') === null &&
  wl18 && wl18.name === 'Jane' && B.waitlistEntry(st18, 'nope') === null)
  ? ok('flow18: repeat customer stats (phone-normalized) + waitlistEntry lookup') : bad('flow18 ' + JSON.stringify(cs18));

console.log('');
console.log('e2e: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
EOF
echo "e2e exit: $?"
