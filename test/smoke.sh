#!/usr/bin/env bash
# BookPilot AI smoke tests — 16 top-level checks (incl. new-feature node checks + DOM ids). Fails fast on first failure.
set -u
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "== bookpilot-ai smoke =="

# 1-5: files exist
for f in index.html css/style.css js/logic.js js/app.js README.md; do
  if [ -f "$f" ]; then ok "file exists: $f"; else bad "missing file: $f"; fi
done

# 6-7: JS syntax
if node --check js/logic.js 2>/dev/null; then ok "logic.js syntax"; else bad "logic.js syntax"; fi
if node --check js/app.js 2>/dev/null; then ok "app.js syntax"; else bad "app.js syntax"; fi

# 8-12: logic checks in Node
node << 'EOF'
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS: ' + m); };
const bad = (m) => { fail++; console.log('  FAIL: ' + m); };

// 8: slot generation — 30-min service, Mon 9-17 => 16 slots; Sunday closed => 0
const svc = { id: 's1', name: 'Cut', durationMin: 30, price: 35 };
const hours = B.defaultHours();
// 2026-10-05 is a Monday, 2026-10-04 a Sunday
const mon = B.slotsFor('2026-10-05', svc, hours, [], [], { today: '2026-09-28', nowMin: 0 });
const sun = B.slotsFor('2026-10-04', svc, hours, [], [], { today: '2026-09-28', nowMin: 0 });
(mon.length === 16) ? ok('slotsFor: Monday 9-17, 30min => 16 slots') : bad('mon slots=' + mon.length);
(sun.length === 0) ? ok('slotsFor: Sunday closed => 0 slots') : bad('sun slots=' + sun.length);

// 9: booking + double-book rejection
const state = { services: [svc], hours: hours, blockedDates: [], bookings: [] };
const r1 = B.bookSlot(state, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'Jane', phone: '555-1' });
const r2 = B.bookSlot(state, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'Bob', phone: '555-2' });
(r1.ok && r1.booking.end === 570) ? ok('bookSlot: books 9:00-9:30, end=570') : bad('book1=' + JSON.stringify(r1).slice(0, 80));
(!r2.ok && /taken/.test(r2.error)) ? ok('bookSlot: double-book rejected') : bad('book2=' + JSON.stringify(r2).slice(0, 80));

// 10: blocked date + validation
state.blockedDates.push('2026-10-06');
const r3 = B.bookSlot(state, { serviceId: 's1', date: '2026-10-06', start: 540, name: 'Zed', phone: '555-3' });
const r4 = B.bookSlot(state, { serviceId: 's1', date: '2026-10-05', start: 600, name: '', phone: '' });
(!r3.ok && /blocked/.test(r3.error)) ? ok('bookSlot: blocked date rejected') : bad('blocked=' + JSON.stringify(r3).slice(0, 80));
(!r4.ok && /name/i.test(r4.error)) ? ok('bookSlot: missing name rejected') : bad('noname=' + JSON.stringify(r4).slice(0, 80));

// 11: reminders + no-show stats
const st2 = { services: [svc], hours: hours, blockedDates: [], bookings: [] };
B.bookSlot(st2, { serviceId: 's1', date: '2026-09-29', start: 540, name: 'A', phone: '1' });
B.bookSlot(st2, { serviceId: 's1', date: '2026-09-30', start: 540, name: 'C', phone: '3' });
const due = B.dayBeforeList(st2, '2026-09-28');
B.setStatus(st2, st2.bookings[0].id, 'no-show');
B.setStatus(st2, st2.bookings[1].id, 'completed');
const stats = B.stats(st2.bookings);
(due.length === 1 && due[0].name === 'A') ? ok('dayBeforeList: 1 reminder due for 9/29') : bad('due=' + due.length);
(stats.noShowRate === 50 && stats.revenue === 35) ? ok('stats: 50% no-show rate, $35 revenue') : bad('stats=' + JSON.stringify(stats));

// 12: embed snippet + time formatting
const snip = B.embedSnippet('https://example.com/book/', 's1');
(B.fmtTime(540) === '9:00 AM' && B.fmtTime(780) === '1:00 PM' && /embed=1/.test(snip) && /service=s1/.test(snip))
  ? ok('fmtTime + embedSnippet correct') : bad('fmt/embed');

console.log('node checks: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
EOF
[ $? -eq 0 ] && ok "node logic checks" || bad "node logic checks"

# 13-17: new-feature logic checks in Node
node << 'EOF'
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS: ' + m); };
const bad = (m) => { fail++; console.log('  FAIL: ' + m); };

const svc = { id: 's1', name: 'Cut', durationMin: 30, price: 35 };
const hours = B.defaultHours();
const st = { services: [svc], hours: hours, blockedDates: [], bookings: [] };
B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'Jane, Jr.', phone: '(555) 123-4567', notes: 'first visit' });
B.bookSlot(st, { serviceId: 's1', date: '2026-10-06', start: 600, name: 'Bob', phone: '555-9999', notes: '' });

// 13: bookings CSV export — header, row count, comma-in-name escaped
const csv = B.bookingsToCSV(st);
const lines = csv.split('\r\n');
(lines.length === 3 && lines[0] === 'Date,Time,Customer,Phone,Service,Duration (min),Price,Status,Notes' && /"Jane, Jr\."/.test(lines[1]) && /Bob/.test(lines[2]))
  ? ok('bookingsToCSV: header + 2 rows, comma name quoted') : bad('csv=' + csv.slice(0, 120));

// 14: search — by name (case-insensitive), by phone digits, empty q returns all
const byName = B.searchBookings(st, 'jane');
const byPhone = B.searchBookings(st, '9999');
const bySvc = B.searchBookings(st, 'cut');
const all = B.searchBookings(st, '');
(byName.length === 1 && byName[0].name === 'Jane, Jr.' && byPhone.length === 1 && byPhone[0].name === 'Bob' && bySvc.length === 2 && all.length === 2)
  ? ok('searchBookings: name/phone/service/empty queries') : bad('search');

// 15: revenue by service — completed bookings only, sorted desc
B.setStatus(st, st.bookings[0].id, 'completed');
B.setStatus(st, st.bookings[1].id, 'completed');
const rev = B.revenueByService(st.bookings);
(rev.length === 1 && rev[0].service === 'Cut' && rev[0].revenue === 70 && rev[0].completed === 2 && rev[0].bookings === 2)
  ? ok('revenueByService: Cut $70 from 2 completed') : bad('rev=' + JSON.stringify(rev));

// 16: customer lookup by phone + self-cancel
const st2 = { services: [svc], hours: hours, blockedDates: [], bookings: [] };
B.bookSlot(st2, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'Zoe', phone: '555-4321' });
B.bookSlot(st2, { serviceId: 's1', date: '2026-10-05', start: 600, name: 'Zoe', phone: '555-4321' });
const found = B.findBookingsByPhone(st2, '5554321');
const none = B.findBookingsByPhone(st2, '12');
const c1 = B.cancelBooking(st2, found[0].id);
const c2 = B.cancelBooking(st2, found[0].id);
const c3 = B.cancelBooking(st2, 'nope');
(found.length === 2 && none.length === 0 && c1.ok && c1.booking.status === 'cancelled' && !c2.ok && !c3.ok)
  ? ok('findBookingsByPhone + cancelBooking: 2 found; cancel works once; unknown id fails') : bad('lookup/cancel');

// 17: next-available finder for a service with a full day blocked
const st3 = { services: [svc], hours: hours, blockedDates: [], bookings: [] };
for (let t = 540; t < 1020; t += 30) B.bookSlot(st3, { serviceId: 's1', date: '2026-10-05', start: t, name: 'F' + t, phone: '1' });
const nxt = B.nextOpenDates(st3, 's1', 1, '2026-10-05');
(nxt.length === 1 && nxt[0].date === '2026-10-06')
  ? ok('nextOpenDates: full Monday -> next open is Tuesday 2026-10-06') : bad('nxt=' + JSON.stringify(nxt));

console.log('new-feature node checks: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
EOF
[ $? -eq 0 ] && ok "new-feature node checks" || bad "new-feature node checks"

# 18: new DOM ids present in index.html
for id in fltSearch exportCsv svcRevenue bkNextAvail lkPhone lkFind lkResults; do
  if grep -q "id=\"$id\"" index.html; then ok "index.html has #$id"; else bad "index.html missing #$id"; fi
done

echo ""
echo "smoke: $PASS passed, $FAIL failed"
exit $FAIL
