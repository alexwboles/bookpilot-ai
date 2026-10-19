#!/usr/bin/env bash
# BookPilot AI smoke tests — files, syntax, logic, DOM ids, design rules. Fails fast on first failure.
set -u
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "== bookpilot-ai smoke =="

# 1-6: files exist
for f in index.html css/style.css js/logic.js js/app.js js/qrcodegen.js README.md tools/send-reminders.js tools/README.md tools/gmail-config.example.json; do
  if [ -f "$f" ]; then ok "file exists: $f"; else bad "missing file: $f"; fi
done

# 7-9: JS syntax
if node --check js/logic.js 2>/dev/null; then ok "logic.js syntax"; else bad "logic.js syntax"; fi
if node --check js/app.js 2>/dev/null; then ok "app.js syntax"; else bad "app.js syntax"; fi
if node --check js/qrcodegen.js 2>/dev/null; then ok "qrcodegen.js syntax"; else bad "qrcodegen.js syntax"; fi
if node --check tools/send-reminders.js 2>/dev/null; then ok "send-reminders.js syntax"; else bad "send-reminders.js syntax"; fi

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
(lines.length === 3 && lines[0] === 'Ref,Date,Time,Customer,Phone,Email,Service,Team member,Duration (min),Price,Status,Notes' && /"Jane, Jr\."/.test(lines[1]) && /Bob/.test(lines[2]) && /^B-[0-9A-Z]{4},/.test(lines[1]))
  ? ok('bookingsToCSV: header + 2 rows, comma name quoted, ref column present') : bad('csv=' + csv.slice(0, 140));

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
for id in fltSearch exportCsv svcRevenue bkNextAvail lkPhone lkFind lkResults waitlistBox svcBuf bkStaff bkEmail fltStaff staffName staffAdd staffList staffMatrix schedDate schedStaff schedToday schedView syncExport syncFile syncPaste syncImportPaste syncImportResult qrShow qrCopy qrMeta qrWarn qrCanvas notifEnable notifTest notifAuto ntfyTopic ntfySave ntfyTest ntfyPushDue ntfyStatus webNotifStatus; do
  if grep -q "id=\"$id\"" index.html; then ok "index.html has #$id"; else bad "index.html missing #$id"; fi
done
for tab in team sync; do
  if grep -q "id=\"tab-$tab\"" index.html; then ok "index.html has #tab-$tab"; else bad "index.html missing #tab-$tab"; fi
  if grep -q "data-tab=\"$tab\"" index.html; then ok "nav has data-tab=$tab"; else bad "nav missing data-tab=$tab"; fi
done
# qrcodegen vendored + loaded before app.js
if grep -q 'src="js/qrcodegen.js"' index.html; then ok "index.html loads js/qrcodegen.js"; else bad "index.html missing qrcodegen script tag"; fi

# 19: buffer time blocks cleanup windows in the slot grid
node << 'EOF'
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
const svc = { id: 's1', name: 'Cut', durationMin: 30, price: 35, bufferMin: 15 };
const hours = B.defaultHours();
const st = { services: [svc], hours: hours, blockedDates: [], bookings: [] };
const r = B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'A', phone: '1' });
if (!r.ok) { console.log('book failed'); process.exit(1); }
// 30-min cut at 9:00 with 15-min buffer blocks 9:30 (needs 9:30+30+15)
const slots = B.slotsFor('2026-10-05', svc, hours, [], st.bookings, { today: '2026-09-28', nowMin: 0, services: st.services });
if (slots.indexOf(570) !== -1) { console.log('930 not blocked by buffer'); process.exit(1); }
if (slots.indexOf(600) === -1) { console.log('1000 should be free'); process.exit(1); }
// double-booking into the buffer window is rejected at book time too
const r2 = B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 570, name: 'B', phone: '2' });
if (r2.ok) { console.log('buffer overlap booked'); process.exit(1); }
console.log('buffer blocks 9:30 slot and booking; 10:00 stays free');
EOF
[ $? -eq 0 ] && ok "bufferMin enforced in slotsFor + bookSlot" || bad "buffer enforcement"

# 20: booking refs are stable, formatted, and stored on new bookings
node << 'EOF'
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
const st = { services: [{ id: 's1', name: 'Cut', durationMin: 30, price: 35 }], hours: B.defaultHours(), blockedDates: [], bookings: [] };
const r = B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'A', phone: '1' });
if (!r.ok || !/^B-[0-9A-Z]{4}$/.test(r.booking.ref)) { console.log('ref bad: ' + (r.booking && r.booking.ref)); process.exit(1); }
if (B.bookingRef(r.booking.id) !== r.booking.ref) { console.log('ref not deterministic'); process.exit(1); }
if (B.bookingRef('old-id-without-ref') === B.bookingRef('other-id')) { console.log('refs collide'); process.exit(1); }
console.log('ref ' + r.booking.ref + ' ok');
EOF
[ $? -eq 0 ] && ok "bookingRef generated, stable, formatted B-XXXX" || bad "bookingRef"

# 21: waitlist add / duplicate / remove / filter
node << 'EOF'
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
const st = { services: [{ id: 's1', name: 'Cut', durationMin: 30, price: 35 }], hours: B.defaultHours(), blockedDates: [], bookings: [], waitlist: [] };
const a = B.addToWaitlist(st, { serviceId: 's1', date: '2026-10-05', name: 'Ann', phone: '(555) 111-2222' });
const dup = B.addToWaitlist(st, { serviceId: 's1', date: '2026-10-05', name: 'Ann', phone: '5551112222' });
const bad = B.addToWaitlist(st, { serviceId: 's1', date: '2026-10-05', name: '', phone: '1' });
if (!a.ok || dup.ok || bad.ok) { console.log('add/dup/bad wrong'); process.exit(1); }
if (B.waitlistFor(st, 's1', '2026-10-05').length !== 1) { console.log('filter wrong'); process.exit(1); }
if (!B.removeFromWaitlist(st, a.entry.id) || B.waitlistFor(st).length !== 0) { console.log('remove wrong'); process.exit(1); }
if (B.removeFromWaitlist(st, 'nope')) { console.log('bad remove'); process.exit(1); }
console.log('waitlist lifecycle ok');
EOF
[ $? -eq 0 ] && ok "waitlist: add, dup-reject, validation, remove, filter" || bad "waitlist"

# 23: redesign — month calendar with availability, two-pane booking face, embed chrome
node << 'EOF'
const fs = require('fs');
const h = fs.readFileSync('/home/hatch/workspace/bookpilot-ai/index.html', 'utf8');
const a = fs.readFileSync('/home/hatch/workspace/bookpilot-ai/js/app.js', 'utf8');
const c = fs.readFileSync('/home/hatch/workspace/bookpilot-ai/css/style.css', 'utf8');
for (const id of ['calGrid', 'calTitle', 'calPrev', 'calNext', 'bookBizName', 'svcSummary', 'bkDate']) {
  if (!h.includes('id="' + id + '"')) { console.log('missing ' + id); process.exit(1); }
}
for (const s of ['renderCalendar', 'calShift', 'slotGroupLabel', 'renderSvcSummary', 'syncBizName',
                "classList.add('embed')", 'data-day', 'slot-group-h', 'Morning', 'Afternoon', 'Evening']) {
  if (!a.includes(s)) { console.log('app missing ' + s); process.exit(1); }
}
for (const s of ['.cal-grid', '.cal-day', '.dcnt', '.book-grid', '.book-info', '.svc-summary', 'body.embed .masthead']) {
  if (!c.includes(s)) { console.log('css missing ' + s); process.exit(1); }
}
// no rounded corners (true circles excepted)
if (/border-radius:\s*(?!50%)[1-9]/.test(c.replace(/border-radius:\s*50%/g, ''))) {
  console.log('rounded edges found'); process.exit(1);
}
console.log('redesign wiring ok');
EOF
[ $? -eq 0 ] && ok "redesign: month calendar, two-pane booking, embed mode" || bad "redesign wiring"
# 22: new UI wiring — capacity strip, returning hint, waitlist book button
node << 'EOF'
const fs = require('fs');
const h = fs.readFileSync('/home/hatch/workspace/bookpilot-ai/index.html', 'utf8');
const a = fs.readFileSync('/home/hatch/workspace/bookpilot-ai/js/app.js', 'utf8');
const c = fs.readFileSync('/home/hatch/workspace/bookpilot-ai/css/style.css', 'utf8');
for (const id of ['capacityStrip', 'bkReturning']) {
  if (!h.includes('id="' + id + '"')) { console.log('missing ' + id); process.exit(1); }
}
for (const s of ['renderCapacity', 'renderReturning', 'B.customerStats(', 'B.weekUtilization(', 'B.waitlistEntry(', 'data-wl-book', 'ret-badge']) {
  if (!a.includes(s)) { console.log('app missing ' + s); process.exit(1); }
}
for (const s of ['.cap-bar', '.ret-badge', '.returning']) {
  if (!c.includes(s)) { console.log('css missing ' + s); process.exit(1); }
}
console.log('new sweep wiring ok');
EOF
[ $? -eq 0 ] && ok "capacity strip + returning customer + waitlist book wired" || bad "new sweep wiring"
# 23: booking step rail — markup, 3 steps, styles present
node << 'EOF'
const fs = require('fs');
const h = fs.readFileSync('/home/hatch/workspace/bookpilot-ai/index.html', 'utf8');
const a = fs.readFileSync('/home/hatch/workspace/bookpilot-ai/js/app.js', 'utf8');
const c = fs.readFileSync('/home/hatch/workspace/bookpilot-ai/css/style.css', 'utf8');
if (!h.includes('id="bookSteps"')) { console.log('missing #bookSteps'); process.exit(1); }
for (const n of ['1', '2', '3']) {
  if (!h.includes('data-step="' + n + '"')) { console.log('missing step ' + n); process.exit(1); }
}
for (const s of ["setStep(1)", "setStep(2)", "setStep(3)", ".book-steps"]) {
  if (!(a.includes(s) || c.includes(s))) { console.log('missing ' + s); process.exit(1); }
}
console.log('step rail wiring ok');
EOF
[ $? -eq 0 ] && ok "booking step rail (#bookSteps, 3 steps, styles) wired" || bad "step rail wiring"

# 24: multi-staff logic — roster, eligibility, per-staff slot isolation, first-available
node << 'EOF'
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS: ' + m); };
const bad = (m) => { fail++; console.log('  FAIL: ' + m); };
const st = { services: [{ id: 's1', name: 'Cut', durationMin: 30, price: 35 }], hours: B.defaultHours(), blockedDates: [], bookings: [], staff: [] };
const a = B.addStaffMember(st, 'Maya');
const b = B.addStaffMember(st, 'Leo');
const dup = B.addStaffMember(st, 'maya');
const empty = B.addStaffMember(st, '  ');
(a.ok && b.ok && !dup.ok && !empty.ok && B.staffList(st).length === 2) ? ok('addStaffMember: 2 added, dup + blank rejected') : bad('addStaff');
B.setServiceStaff(st, 's1', [a.member.id]);
const elig = B.eligibleStaff(st, st.services[0]);
(elig.length === 1 && elig[0].name === 'Maya') ? ok('eligibleStaff: only Maya performs Cut') : bad('elig');
// Maya books 9:00; Leo (not eligible) cannot book the service at all; Maya's 9:00 is taken for her but free for nobody else eligible
const r1 = B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'A', phone: '1', staffId: a.member.id });
const rLeo = B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 600, name: 'B', phone: '2', staffId: b.member.id });
const rDup = B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'C', phone: '3', staffId: a.member.id });
(r1.ok && r1.booking.staffId === a.member.id && !rLeo.ok && !rDup.ok) ? ok('bookSlot: staff assignment stored; ineligible staff rejected; double-book per staff rejected') : bad('staff booking');
// per-staff availability: Maya's 9:00 gone for Maya, but a second eligible staffer would still show it
B.setServiceStaff(st, 's1', [a.member.id, b.member.id]);
const mayaSlots = B.slotsForStaff('2026-10-05', st.services[0], a.member.id, st, { today: '2026-09-28', nowMin: 0 });
const leoSlots = B.slotsForStaff('2026-10-05', st.services[0], b.member.id, st, { today: '2026-09-28', nowMin: 0 });
(mayaSlots.indexOf(540) === -1 && leoSlots.indexOf(540) !== -1) ? ok('slotsForStaff: booking blocks only its own staff member') : bad('isolation');
// first-available picks earliest free qualified person
const fa = B.firstAvailable(st, st.services[0], '2026-10-05', { today: '2026-09-28', nowMin: 0 });
(fa && fa.staffId === b.member.id && fa.start === 540) ? ok('firstAvailable: Leo at 9:00 (Maya busy)') : bad('fa=' + JSON.stringify(fa));
// unassigned booking blocks everyone
const rU = B.bookSlot(st, { serviceId: 's1', date: '2026-10-06', start: 540, name: 'U', phone: '9' });
const leoAfter = B.slotsForStaff('2026-10-06', st.services[0], b.member.id, st, { today: '2026-09-28', nowMin: 0 });
(rU.ok && rU.booking.staffId === null && leoAfter.indexOf(540) === -1) ? ok('unassigned booking blocks all staff') : bad('unassigned');
// staff day schedule + removal unassigns
const sched = B.staffDaySchedule(st, '2026-10-05', a.member.id);
const n = B.removeStaffMember(st, a.member.id);
(sched.length === 1 && sched[0].name === 'A' && n === 1 && B.staffList(st).length === 1 && st.bookings[0].staffId === null)
  ? ok('staffDaySchedule + removeStaffMember unassigns bookings') : bad('schedule/remove');
// email validation + storage
const rBadEmail = B.bookSlot(st, { serviceId: 's1', date: '2026-10-06', start: 600, name: 'E', phone: '5', email: 'not-an-email' });
const rEmail = B.bookSlot(st, { serviceId: 's1', date: '2026-10-06', start: 660, name: 'E2', phone: '6', email: 'e2@example.com' });
(!rBadEmail.ok && rEmail.ok && rEmail.booking.email === 'e2@example.com') ? ok('email: invalid rejected, valid stored') : bad('email');
console.log('staff node checks: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
EOF
[ $? -eq 0 ] && ok "multi-staff: roster, eligibility, isolation, first-available, email" || bad "multi-staff logic"

# 25: blocked dates stored as objects are honored everywhere (regression)
node << 'EOF'
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
const st = { services: [{ id: 's1', name: 'Cut', durationMin: 30, price: 35 }], hours: B.defaultHours(), blockedDates: [{ date: '2026-10-06', note: 'Holiday' }], bookings: [] };
const s = B.slotsFor('2026-10-06', st.services[0], st.hours, st.blockedDates, [], { today: '2026-10-05', nowMin: 0 });
const nx = B.nextOpenDates(st, 's1', 2, '2026-10-05').map(o => o.date);
const u = B.dayUtilization(st, '2026-10-06');
const rb = B.bookSlot(st, { serviceId: 's1', date: '2026-10-06', start: 540, name: 'X', phone: '1' });
if (s.length !== 0) { console.log('slotsFor not blocked'); process.exit(1); }
if (JSON.stringify(nx) !== JSON.stringify(['2026-10-05', '2026-10-07'])) { console.log('nextOpenDates: ' + JSON.stringify(nx)); process.exit(1); }
if (u.openMin !== 0) { console.log('dayUtilization not zeroed'); process.exit(1); }
if (rb.ok) { console.log('bookSlot on blocked date allowed'); process.exit(1); }
console.log('object blocked dates honored in slots/next-open/utilization/booking');
EOF
[ $? -eq 0 ] && ok "blocked-date objects honored everywhere" || bad "blocked-date objects"

# 26: sync — export/import round-trip, QR payload, BP1: import
node << 'EOF'
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
const st = { bizName: 'Test Salon', services: [{ id: 's1', name: 'Cut', durationMin: 30, price: 35 }], hours: B.defaultHours(), blockedDates: [], bookings: [], waitlist: [], staff: [], settings: { ntfyTopic: 'x' } };
B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'A', phone: '1' });
const exp = B.exportStore(st);
const imp = B.importStore(exp);
if (!imp.ok || imp.state.bookings.length !== 1 || imp.state.settings.ntfyTopic !== 'x' || imp.meta.bookings !== 1) { console.log('roundtrip failed'); process.exit(1); }
const p = B.syncPayload(st);
if (!p.ok || p.encoding !== 'BP1' || p.payload.slice(0, 4) !== 'BP1:') { console.log('payload failed'); process.exit(1); }
const imp2 = B.importStore(p.payload);
if (!imp2.ok || imp2.state.bookings.length !== 1) { console.log('payload import failed'); process.exit(1); }
if (B.importStore('garbage').ok || B.importStore('').ok || B.importStore('{"app":"other"}').ok) { console.log('bad input accepted'); process.exit(1); }
// oversized store is refused with a clear message
const big = JSON.parse(JSON.stringify(st));
for (let i = 0; i < 200; i++) big.bookings.push({ id: 'b' + i, name: 'X'.repeat(50), phone: '1', serviceId: 's1', date: '2026-10-05', start: 540, end: 570, status: 'confirmed' });
const pb = B.syncPayload(big);
if (pb.ok) { console.log('oversize not refused'); process.exit(1); }
console.log('export/import round-trip ok; BP1: payload imports; oversize refused');
EOF
[ $? -eq 0 ] && ok "sync: export/import round-trip, QR payload, oversize guard" || bad "sync logic"

# 27: QR library — vendored, exposes QRCodeGen, encodes with correct structure
node << 'EOF'
const fs = require('fs');
const self = {};
new Function('self', fs.readFileSync('/home/hatch/workspace/bookpilot-ai/js/qrcodegen.js', 'utf8'))(self);
const QRC = self.QRCodeGen;
if (!QRC || !QRC.QrCode || !QRC.QrSegment) { console.log('QRCodeGen not exposed'); process.exit(1); }
const qr = QRC.QrCode.encodeText('BP1:dGVzdA', QRC.QrCode.Ecc.QUARTILE);
if (qr.size < 21 || qr.size > 177) { console.log('bad size ' + qr.size); process.exit(1); }
// finder pattern sanity: 7x7 dark border rows/cols at top-left
let finderOK = true;
for (let d = 0; d < 7; d++) {
  if (!qr.getModule(d, 0) || !qr.getModule(0, d) || !qr.getModule(d, 6) || !qr.getModule(6, d)) finderOK = false;
}
if (!finderOK) { console.log('finder broken'); process.exit(1); }
// realistic payload size: a small store must fit comfortably
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
const st = { services: [{ id: 's1', name: 'Cut', durationMin: 30, price: 35 }], hours: B.defaultHours(), blockedDates: [], bookings: [], staff: [] };
B.bookSlot(st, { serviceId: 's1', date: '2026-10-05', start: 540, name: 'A', phone: '1' });
const p = B.syncPayload(st);
const qr2 = QRC.QrCode.encodeText(p.payload, QRC.QrCode.Ecc.QUARTILE);
console.log('QR ok: ' + p.bytes + ' chars -> version ' + qr2.version + ' (' + qr2.size + 'x' + qr2.size + ')');
EOF
[ $? -eq 0 ] && ok "qrcodegen: encodes payloads with valid structure" || bad "qrcodegen"

# 28: ntfy digest + reminder message with staff name
node << 'EOF'
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
const st = { services: [{ id: 's1', name: 'Cut', durationMin: 30, price: 35 }], hours: B.defaultHours(), blockedDates: [], bookings: [], staff: [{ id: 'st-1', name: 'Maya' }] };
B.bookSlot(st, { serviceId: 's1', date: '2026-10-20', start: 540, name: 'Jane', phone: '555-1', staffId: 'st-1' });
const due = B.dayBeforeList(st, '2026-10-19');
const txt = B.ntfyReminderText('Salon', due, st);
const msg = B.reminderMessage('Salon', due[0], 'Maya');
if (due.length !== 1 || txt.indexOf('with Maya') === -1 || txt.indexOf('Jane') === -1 || msg.indexOf('with Maya') === -1) {
  console.log('ntfy/message wrong: ' + txt.slice(0, 100)); process.exit(1);
}
console.log('ntfy digest + staff reminder message ok');
EOF
[ $? -eq 0 ] && ok "ntfy digest + staff-aware reminder message" || bad "notifications logic"

# 29: gmail tool — config example is a template (no real credentials), real config gitignored
if grep -q "PASTE_YOUR_CLIENT_ID" tools/gmail-config.example.json; then ok "gmail-config.example.json is an unfilled template"; else bad "example config looks filled in"; fi
if [ -f tools/gmail-config.json ]; then bad "tools/gmail-config.json exists in repo (must stay gitignored)"; else ok "no real gmail-config.json committed"; fi
if grep -q "tools/gmail-config.json" .gitignore; then ok ".gitignore covers tools/gmail-config.json"; else bad ".gitignore missing gmail-config.json"; fi
# tool refuses to run without config, cleanly
if node tools/send-reminders.js --store /tmp/does-not-exist.json 2>&1 | grep -q "no config found"; then ok "send-reminders.js fails cleanly without config"; else bad "send-reminders.js error path"; fi

# 30: v2 DOM ids (HUD, ticket rail, team hours, reschedule)
for id in hud hudDate hudToday hudNext apptTicket shStaff shCopyBiz shSave shGrid shNote; do
  if grep -q "id=\"$id\"" index.html; then ok "index.html has #$id"; else bad "index.html missing #$id"; fi
done
# consolidated day+time layout present
if grep -q "book-cols" index.html; then ok "index.html has .book-cols layout"; else bad "index.html missing .book-cols"; fi

# 31: redesign v2 wiring — ticket rail, HUD, reschedule, staff hours, timeline
node << 'EOF'
const fs = require('fs');
const h = fs.readFileSync('/home/hatch/workspace/bookpilot-ai/index.html', 'utf8');
const a = fs.readFileSync('/home/hatch/workspace/bookpilot-ai/js/app.js', 'utf8');
const c = fs.readFileSync('/home/hatch/workspace/bookpilot-ai/css/style.css', 'utf8');
for (const id of ['hudDate', 'hudToday', 'hudNext', 'apptTicket', 'shStaff', 'shSave', 'shGrid']) {
  if (!h.includes('id="' + id + '"')) { console.log('missing ' + id); process.exit(1); }
}
for (const s of ['updateTicket', 'renderHud', 'renderReschedulePanel', 'reschedSlots',
                'B.rescheduleBooking(', 'B.bookingToICS(', 'B.setStaffHours(', 'B.staffHours(',
                'renderShGrid', 'tl-block', 'data-selfresched', 'data-move', 'data-ics']) {
  if (!a.includes(s)) { console.log('app missing ' + s); process.exit(1); }
}
for (const s of ['.book-cols', '.appt-ticket', '.ticket', '.ticket-perf', '.ticket-actions',
                '.tl-block', '.tl-colhead', '.resched', '.hud', '.tk-row']) {
  if (!c.includes(s)) { console.log('css missing ' + s); process.exit(1); }
}
console.log('v2 wiring ok');
EOF
[ $? -eq 0 ] && ok "redesign v2: ticket rail, HUD, reschedule, staff hours, timeline wired" || bad "v2 wiring"

# 32: design rules — zero rounded edges, no color gradients
node << 'EOF'
const fs = require('fs');
const c = fs.readFileSync('/home/hatch/workspace/bookpilot-ai/css/style.css', 'utf8');
if (/border-radius/.test(c)) { console.log('rounded edges found'); process.exit(1); }
// the only gradient allowed is the gray "closed day" hatch in the capacity strip
const grads = c.match(/[a-z-]*linear-gradient\(/g) || [];
const bad = grads.filter(g => g !== 'repeating-linear-gradient(');
if (bad.length) { console.log('color gradients found: ' + bad.join(',')); process.exit(1); }
console.log('design rules ok (' + grads.length + ' hatch-only gradient)');
EOF
[ $? -eq 0 ] && ok "design rules: no rounded edges, no color gradients" || bad "design rules"

# 33: reschedule logic — move, conflict, blocked/closed/past, non-confirmed, reminded reset
# (dates are future relative to real today; rescheduleBooking guards past dates)
node << 'EOF'
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
const svc = { id: 's1', name: 'Cut', durationMin: 30, price: 35 };
const st = { services: [svc], hours: B.defaultHours(), blockedDates: [], bookings: [], staff: [] };
B.bookSlot(st, { serviceId: 's1', date: '2026-10-20', start: 540, name: 'A', phone: '1' });
const id = st.bookings[0].id;
B.markReminded(st, id);
let r = B.rescheduleBooking(st, id, '2026-10-21', 600);
if (!r.ok || r.booking.date !== '2026-10-21' || r.booking.start !== 600 || r.booking.end !== 630) { console.log('move failed: ' + JSON.stringify(r).slice(0,100)); process.exit(1); }
if (r.booking.reminded !== false) { console.log('reminded not reset'); process.exit(1); }
// old slot freed, new slot consumed
const oldSlots = B.slotsFor('2026-10-20', svc, st.hours, [], st.bookings, { today: '2026-10-19', nowMin: 0 });
const newSlots = B.slotsFor('2026-10-21', svc, st.hours, [], st.bookings, { today: '2026-10-19', nowMin: 0 });
if (oldSlots.indexOf(540) === -1 || newSlots.indexOf(600) !== -1) { console.log('slot freed/consumed wrong'); process.exit(1); }
B.bookSlot(st, { serviceId: 's1', date: '2026-10-22', start: 660, name: 'B', phone: '2' });
r = B.rescheduleBooking(st, id, '2026-10-22', 660);
if (r.ok || !/taken/.test(r.error)) { console.log('conflict not rejected'); process.exit(1); }
r = B.rescheduleBooking(st, id, '2026-10-25', 600); // Sunday: closed
if (r.ok || !/Closed/.test(r.error)) { console.log('closed day not rejected'); process.exit(1); }
st.blockedDates.push('2026-10-23');
r = B.rescheduleBooking(st, id, '2026-10-23', 600);
if (r.ok || !/blocked/.test(r.error)) { console.log('blocked not rejected'); process.exit(1); }
r = B.rescheduleBooking(st, id, '2020-01-06', 600);
if (r.ok || !/future/.test(r.error)) { console.log('past date not rejected'); process.exit(1); }
B.setStatus(st, id, 'cancelled');
r = B.rescheduleBooking(st, id, '2026-10-27', 600);
if (r.ok || !/Only upcoming/.test(r.error)) { console.log('cancelled move not rejected'); process.exit(1); }
r = B.rescheduleBooking(st, 'nope', '2026-10-27', 600);
if (r.ok || !/not found/.test(r.error)) { console.log('missing id not rejected'); process.exit(1); }
console.log('reschedule lifecycle ok');
EOF
[ $? -eq 0 ] && ok "rescheduleBooking: move, conflict, blocked/closed/past, status guards" || bad "rescheduleBooking"

# 34: ICS export — calendar fields, times, escaping
node << 'EOF'
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
const b = { id: 'bk-1', ref: 'B-7X2Q', serviceName: 'Cut, Deluxe', date: '2026-10-05', start: 540, end: 570, name: 'Jane', notes: 'arrive; early' };
const ics = B.bookingToICS(b, 'Main St Salon', 'Maya');
const need = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'END:VEVENT', 'END:VCALENDAR',
  'UID:bk-1@bookpilot-ai', 'DTSTART:20261005T090000', 'DTEND:20261005T093000',
  'SUMMARY:Cut\\, Deluxe with Maya', 'LOCATION:Main St Salon', 'STATUS:CONFIRMED',
  'DESCRIPTION:Booking ref B-7X2Q\\nNotes: arrive\\; early', 'DTSTAMP:'];
for (const s of need) { if (!ics.includes(s)) { console.log('ics missing: ' + s); process.exit(1); } }
console.log('ics ok');
EOF
[ $? -eq 0 ] && ok "bookingToICS: VEVENT fields, local times, escaping" || bad "bookingToICS"

# 35: per-staff hours — validation, set/clear, slot engine honors, import sanitizes
node << 'EOF'
const B = require('/home/hatch/workspace/bookpilot-ai/js/logic.js');
const svc = { id: 's1', name: 'Cut', durationMin: 30, price: 35 };
const st = { services: [svc], hours: B.defaultHours(), blockedDates: [], bookings: [], staff: [] };
const m = B.addStaffMember(st, 'Maya').member;
if (!B.validStaffHours(null) || !B.validStaffHours(undefined)) { console.log('null hours invalid'); process.exit(1); }
if (B.validStaffHours({ 1: [900, 600] })) { console.log('bad range accepted'); process.exit(1); }
if (B.validStaffHours('nope')) { console.log('non-object accepted'); process.exit(1); }
// unset = business hours
if (B.staffHours(st, m.id) !== st.hours) { console.log('fallback wrong'); process.exit(1); }
let r = B.setStaffHours(st, m.id, { 0: null, 1: [600, 840], 2: [600, 840], 3: [600, 840], 4: [600, 840], 5: [600, 840], 6: null });
if (!r.ok) { console.log('set failed'); process.exit(1); }
const base = { today: '2026-10-19', nowMin: 0, services: [svc] };
const ms = B.slotsForStaff('2026-10-20', svc, m.id, st, base); // Tuesday
if (ms.length !== 8 || ms[0] !== 600) { console.log('staff slots wrong: ' + ms.length); process.exit(1); }
const sat = B.slotsForStaff('2026-10-24', svc, m.id, st, base); // Saturday: staff closed
if (sat.length !== 0) { console.log('staff saturday should be closed'); process.exit(1); }
// first-available still matches through the restricted hours
const fa = B.firstAvailable(st, svc, '2026-10-20', base);
if (!fa || fa.staffId !== m.id || fa.start !== 600) { console.log('firstAvailable wrong: ' + JSON.stringify(fa)); process.exit(1); }
// reschedule honors staff hours: 9:00 is outside Maya's hours
B.bookSlot(st, { serviceId: 's1', date: '2026-10-20', start: 600, name: 'A', phone: '1', staffId: m.id });
const id = st.bookings[0].id;
r = B.rescheduleBooking(st, id, '2026-10-20', 540);
if (r.ok || !/Outside working hours/.test(r.error)) { console.log('staff-hours reschedule guard failed'); process.exit(1); }
// clear back to business hours
r = B.setStaffHours(st, m.id, null);
if (!r.ok || m.hours !== undefined || B.staffHours(st, m.id) !== st.hours) { console.log('clear failed'); process.exit(1); }
// import sanitizes garbage hours, keeps good ones
const imp = B.importStore(JSON.stringify({ app: 'bookpilot-ai', format: 1, state: {
  services: [svc], bookings: [], staff: [{ id: 'a', name: 'Ok', hours: { 1: [540, 1020] } }, { id: 'b', name: 'Bad', hours: { 1: [1020, 540] } }, { id: 'c', name: 'Legacy' }]
}}));
if (!imp.ok || imp.state.staff[0].hours[1][0] !== 540 || imp.state.staff[1].hours || imp.state.staff[2].hours) {
  console.log('sanitize wrong: ' + JSON.stringify(imp.state.staff)); process.exit(1);
}
console.log('staff hours ok');
EOF
[ $? -eq 0 ] && ok "per-staff hours: validation, engine, reschedule guard, import sanitize" || bad "per-staff hours"

echo ""
echo "smoke: $PASS passed, $FAIL failed"
exit $FAIL
