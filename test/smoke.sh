#!/usr/bin/env bash
# BookPilot AI smoke tests — 12 checks. Fails fast on first failure.
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

echo ""
echo "smoke: $PASS passed, $FAIL failed"
exit $FAIL
