/* bookpilot-ai shared logic — works in Node (module.exports) and browsers (window.Bookpilot).
 * No dependencies. All scheduling math is local; no network calls. */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Bookpilot = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;
  var STATUSES = ['confirmed', 'completed', 'no-show', 'cancelled'];
  var ACTIVE_STATUSES = ['confirmed']; // statuses that block a slot

  var DEFAULT_SERVICES = [
    { id: 'svc-cut', name: 'Haircut', durationMin: 30, price: 35, bufferMin: 0 },
    { id: 'svc-color', name: 'Full color', durationMin: 120, price: 120, bufferMin: 15 },
    { id: 'svc-massage', name: 'Deep tissue massage (60 min)', durationMin: 60, price: 90, bufferMin: 10 }
  ];

  // Default working hours in minutes from midnight, keyed by JS weekday (0=Sun).
  // null = closed that day.
  function defaultHours() {
    return {
      0: null,
      1: [540, 1020],  // Mon 9:00-17:00
      2: [540, 1020],
      3: [540, 1020],
      4: [540, 1020],
      5: [540, 1020],
      6: [600, 840]    // Sat 10:00-14:00
    };
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function fmtTime(min) {
    var h = Math.floor(min / 60), m = min % 60;
    var ap = h >= 12 ? 'PM' : 'AM';
    var hh = h % 12; if (hh === 0) hh = 12;
    return hh + ':' + pad(m) + ' ' + ap;
  }

  function fmtRange(start, end) { return fmtTime(start) + ' – ' + fmtTime(end); }

  function fmtDate(dateStr) {
    var d = new Date(dateStr + 'T12:00:00Z');
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return days[d.getUTCDay()] + ', ' + months[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }

  // Weekday 0-6 for a YYYY-MM-DD string, computed in UTC to avoid TZ drift.
  function weekdayOf(dateStr) {
    return new Date(dateStr + 'T12:00:00Z').getUTCDay();
  }

  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T12:00:00Z');
    d = new Date(d.getTime() + n * DAY_MS);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function nowMinutes() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  }

  // Buffer time: cleanup/setup minutes blocked after each appointment.
  // Returns 0-120 (0 when the service has none or is unknown).
  function bufferOf(service) {
    var b = parseInt(service && service.bufferMin, 10);
    if (isNaN(b) || b < 0) return 0;
    return Math.min(b, 120);
  }

  // Blocked window of an existing booking, extended by its own service's buffer.
  function bookingBlockWindow(state, b) {
    var svc = getService(state.services, b.serviceId);
    return { start: b.start, end: b.end + bufferOf(svc) };
  }

  function validateService(s) {
    var errs = [];
    if (!s || !s.name || !String(s.name).trim()) errs.push('Service needs a name.');
    var d = parseInt(s.durationMin, 10);
    if (!(d >= 5 && d <= 480)) errs.push('Duration must be 5–480 minutes.');
    var p = parseFloat(s.price);
    if (isNaN(p) || p < 0) errs.push('Price must be 0 or more.');
    var bf = (s.bufferMin == null || s.bufferMin === '') ? 0 : parseInt(s.bufferMin, 10);
    if (isNaN(bf) || bf < 0 || bf > 120) errs.push('Buffer must be 0–120 minutes.');
    return errs;
  }

  function getService(services, id) {
    for (var i = 0; i < services.length; i++) if (services[i].id === id) return services[i];
    return null;
  }

  // Blocked dates may be stored as plain 'YYYY-MM-DD' strings (older data)
  // or {date, note} objects (current). Normalize to strings for every check
  // so callers passing the raw state array still honor blocked days.
  function blockedList(blockedDates) {
    return (blockedDates || []).map(function (bd) {
      return typeof bd === 'string' ? bd : (bd && bd.date);
    });
  }

  function isBlocked(dateStr, blockedDates) {
    return blockedList(blockedDates).indexOf(dateStr) !== -1;
  }

  // All bookable start-times (minutes) for a service on a date.
  // opts: { today: 'YYYY-MM-DD', nowMin: 123, services: [...] } to hide past
  // slots when date is today. Buffer minutes extend every blocked window:
  // the new service's buffer after the candidate slot, and each existing
  // booking's own service buffer after it.
  function slotsFor(dateStr, service, hours, blockedDates, bookings, opts) {
    opts = opts || {};
    if (!service || !dateStr) return [];
    if (isBlocked(dateStr, blockedDates)) return [];
    var dayHours = (hours || {})[weekdayOf(dateStr)];
    if (!dayHours) return []; // closed
    var open = dayHours[0], close = dayHours[1];
    var dur = service.durationMin;
    var bufNew = bufferOf(service);
    var svcs = opts.services || [];
    var out = [];
    var isToday = opts.today && dateStr === opts.today;
    var cutoff = isToday ? (opts.nowMin != null ? opts.nowMin : nowMinutes()) : -1;
    for (var t = open; t + dur <= close; t += dur) {
      if (isToday && t <= cutoff) continue;
      var clash = false;
      for (var i = 0; i < bookings.length; i++) {
        var b = bookings[i];
        if (b.date !== dateStr) continue;
        if (ACTIVE_STATUSES.indexOf(b.status) === -1) continue;
        var svcB = getService(svcs, b.serviceId);
        if (overlaps(t, t + dur + bufNew, b.start, b.end + bufferOf(svcB))) { clash = true; break; }
      }
      if (!clash) out.push(t);
    }
    return out;
  }

  function validateBookingInput(inp, services) {
    var errs = [];
    var svc = getService(services, inp.serviceId);
    if (!svc) errs.push('Pick a service.');
    if (!inp.date || !/^\d{4}-\d{2}-\d{2}$/.test(inp.date)) errs.push('Pick a valid date.');
    if (!(inp.start >= 0)) errs.push('Pick a time slot.');
    if (!inp.name || !String(inp.name).trim()) errs.push('Your name is required.');
    if (!inp.phone || !String(inp.phone).trim()) errs.push('A phone number is required so we can confirm.');
    if (inp.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(inp.email).trim())) errs.push('That email address does not look valid.');
    return { errors: errs, service: svc };
  }

  // Short human-readable booking reference, e.g. "B-7X2Q". Deterministic from
  // the booking id so old bookings (stored before refs existed) resolve too.
  function bookingRef(id) {
    var h = 0;
    var s = String(id || '');
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return 'B-' + Math.abs(h).toString(36).toUpperCase().padStart(4, '0').slice(-4);
  }

  // Attempt to book. Returns { ok:true, booking } or { ok:false, error }.
  function bookSlot(state, inp) {
    var v = validateBookingInput(inp, state.services);
    if (v.errors.length) return { ok: false, error: v.errors[0] };
    var svc = v.service;
    if (isBlocked(inp.date, state.blockedDates)) return { ok: false, error: 'That date is blocked — please pick another.' };
    var dayHours = (state.hours || {})[weekdayOf(inp.date)];
    if (!dayHours) return { ok: false, error: 'Closed that day — please pick another.' };
    var end = inp.start + svc.durationMin;
    if (inp.start < dayHours[0] || end > dayHours[1]) return { ok: false, error: 'Outside working hours.' };
    var bufNew = bufferOf(svc);
    for (var i = 0; i < state.bookings.length; i++) {
      var b = state.bookings[i];
      if (b.date !== inp.date || ACTIVE_STATUSES.indexOf(b.status) === -1) continue;
      // A booking assigned to another team member does not block this one;
      // unassigned bookings block everyone.
      if (inp.staffId && b.staffId && b.staffId !== inp.staffId) continue;
      var win = bookingBlockWindow(state, b);
      if (overlaps(inp.start, end + bufNew, win.start, win.end)) return { ok: false, error: 'That slot was just taken — please pick another.' };
    }
    var staffErr = validateStaffBooking(state, svc, inp.staffId);
    if (staffErr) return { ok: false, error: staffErr };
    var id = uid('bk');
    var booking = {
      id: id,
      ref: bookingRef(id),
      serviceId: svc.id,
      serviceName: svc.name,
      durationMin: svc.durationMin,
      price: svc.price,
      date: inp.date,
      start: inp.start,
      end: end,
      name: String(inp.name).trim(),
      phone: String(inp.phone).trim(),
      email: inp.email ? String(inp.email).trim() : '',
      notes: inp.notes ? String(inp.notes).trim() : '',
      staffId: inp.staffId || null,
      status: 'confirmed',
      reminded: false,
      createdAt: new Date().toISOString()
    };
    state.bookings.push(booking);
    return { ok: true, booking: booking };
  }

  function setStatus(state, bookingId, status) {
    if (STATUSES.indexOf(status) === -1) return { ok: false, error: 'Unknown status.' };
    for (var i = 0; i < state.bookings.length; i++) {
      if (state.bookings[i].id === bookingId) {
        state.bookings[i].status = status;
        return { ok: true, booking: state.bookings[i] };
      }
    }
    return { ok: false, error: 'Booking not found.' };
  }

  function markReminded(state, bookingId) {
    for (var i = 0; i < state.bookings.length; i++) {
      if (state.bookings[i].id === bookingId) { state.bookings[i].reminded = true; return true; }
    }
    return false;
  }

  function upcomingBookings(state, fromDate) {
    var from = fromDate || todayStr();
    return state.bookings
      .filter(function (b) { return b.date >= from && b.status === 'confirmed'; })
      .sort(function (a, b) { return (a.date + pad5(a.start)) < (b.date + pad5(b.start)) ? -1 : 1; });
  }

  function pad5(n) { var s = String(n); while (s.length < 5) s = '0' + s; return s; }

  // Bookings happening "tomorrow" (relative to refDate) that still need a reminder.
  function dayBeforeList(state, refDate) {
    var ref = refDate || todayStr();
    var tomorrow = addDays(ref, 1);
    return state.bookings.filter(function (b) {
      return b.date === tomorrow && b.status === 'confirmed' && !b.reminded;
    });
  }

  function stats(bookings) {
    var s = { total: 0, confirmed: 0, completed: 0, noShow: 0, cancelled: 0, revenue: 0 };
    bookings.forEach(function (b) {
      s.total++;
      if (b.status === 'confirmed') s.confirmed++;
      if (b.status === 'completed') { s.completed++; s.revenue += (b.price || 0); }
      if (b.status === 'no-show') s.noShow++;
      if (b.status === 'cancelled') s.cancelled++;
    });
    var denom = s.completed + s.noShow;
    s.noShowRate = denom ? Math.round((s.noShow / denom) * 100) : 0;
    return s;
  }

  // Next N open dates with at least one free slot for a service (for the widget).
  function nextOpenDates(state, serviceId, n, refDate) {
    var svc = getService(state.services, serviceId);
    if (!svc) return [];
    var out = [];
    var d = refDate || todayStr();
    for (var i = 0; i < 60 && out.length < n; i++) {
      var slots = slotsFor(d, svc, state.hours, state.blockedDates, state.bookings, { today: refDate || todayStr(), nowMin: 0 });
      if (slots.length) out.push({ date: d, slots: slots });
      d = addDays(d, 1);
    }
    return out;
  }

  // Copy-paste embed snippet for a customer-facing booking widget.
  function embedSnippet(pageUrl, serviceId) {
    var src = pageUrl + (pageUrl.indexOf('?') === -1 ? '?' : '&') + 'embed=1' + (serviceId ? '&service=' + encodeURIComponent(serviceId) : '');
    return '<iframe src="' + src + '" width="100%" height="640" style="border:0;border-radius:0" title="Book online"></iframe>';
  }

  function reminderMessage(bizName, b, staffName) {
    var who = staffName ? ' with ' + staffName : '';
    return 'Hi ' + b.name + '! Reminder: you have ' + b.serviceName + who + ' at ' + bizName +
      ' on ' + fmtDate(b.date) + ' at ' + fmtTime(b.start) + '. Booking ref ' +
      (b.ref || bookingRef(b.id)) + '. Reply to confirm or reschedule. Thanks!';
  }

  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Full bookings export (owner). Sorted chronologically; CSV-safe escaping.
  function bookingsToCSV(state) {
    var header = ['Ref', 'Date', 'Time', 'Customer', 'Phone', 'Email', 'Service', 'Team member', 'Duration (min)', 'Price', 'Status', 'Notes'];
    var list = (state.bookings || []).slice().sort(function (a, b) {
      return (a.date + pad5(a.start)) < (b.date + pad5(b.start)) ? -1 : 1;
    });
    var rows = [header];
    list.forEach(function (b) {
      var m = b.staffId ? getStaffMember(state, b.staffId) : null;
      rows.push([b.ref || bookingRef(b.id), b.date, fmtRange(b.start, b.end), b.name || '', b.phone || '', b.email || '',
        b.serviceName || '', m ? m.name : '', b.durationMin || '', b.price || 0, b.status || '', b.notes || '']);
    });
    return rows.map(function (r) { return r.map(csvEscape).join(','); }).join('\r\n');
  }

  function normalizePhone(p) { return String(p || '').replace(/\D/g, ''); }

  // Search across name, service, and (digits of) phone. Returns matching bookings.
  function searchBookings(state, q) {
    var s = String(q == null ? '' : q).trim().toLowerCase();
    if (!s) return (state.bookings || []).slice();
    var digits = normalizePhone(s);
    return (state.bookings || []).filter(function (b) {
      return String(b.name || '').toLowerCase().indexOf(s) !== -1 ||
        String(b.serviceName || '').toLowerCase().indexOf(s) !== -1 ||
        (digits.length >= 3 && normalizePhone(b.phone).indexOf(digits) !== -1);
    });
  }

  // Revenue attributed per service name, from completed bookings.
  function revenueByService(bookings) {
    var out = {};
    (bookings || []).forEach(function (b) {
      var key = b.serviceName || 'Unnamed service';
      var o = out[key] || (out[key] = { service: key, revenue: 0, completed: 0, bookings: 0 });
      o.bookings++;
      if (b.status === 'completed') { o.completed++; o.revenue += (b.price || 0); }
    });
    return Object.keys(out).map(function (k) { return out[k]; })
      .sort(function (a, b) { return b.revenue - a.revenue; });
  }

  // Customer self-service: find their upcoming confirmed bookings by phone.
  function findBookingsByPhone(state, phone) {
    var q = normalizePhone(phone);
    if (q.length < 4) return [];
    return (state.bookings || []).filter(function (b) {
      return b.status === 'confirmed' && normalizePhone(b.phone).indexOf(q) !== -1;
    }).sort(function (a, b) { return (a.date + pad5(a.start)) < (b.date + pad5(b.start)) ? -1 : 1; });
  }

  // Customer self-service cancellation (confirmed bookings only).
  function cancelBooking(state, bookingId) {
    for (var i = 0; i < state.bookings.length; i++) {
      if (state.bookings[i].id === bookingId) {
        if (state.bookings[i].status !== 'confirmed') {
          return { ok: false, error: 'Only upcoming confirmed bookings can be cancelled.' };
        }
        state.bookings[i].status = 'cancelled';
        return { ok: true, booking: state.bookings[i] };
      }
    }
    return { ok: false, error: 'Booking not found.' };
  }

  // Move a confirmed booking to a new date/start. The booking's service,
  // staff assignment, and customer stay the same; the new slot is validated
  // exactly like a fresh booking (blocked/closed/hours/conflict, honoring
  // the assigned staff member's own working hours). The booking itself is
  // ignored in the conflict check. Reminded resets — the new date needs a
  // fresh day-before reminder.
  function rescheduleBooking(state, bookingId, newDate, newStart) {
    var b = null;
    for (var i = 0; i < state.bookings.length; i++) {
      if (state.bookings[i].id === bookingId) { b = state.bookings[i]; break; }
    }
    if (!b) return { ok: false, error: 'Booking not found.' };
    if (b.status !== 'confirmed') return { ok: false, error: 'Only upcoming confirmed bookings can be rescheduled.' };
    if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { ok: false, error: 'Pick a valid date.' };
    if (newDate < todayStr()) return { ok: false, error: 'Pick a future date.' };
    if (!(newStart >= 0)) return { ok: false, error: 'Pick a time slot.' };
    var svc = getService(state.services, b.serviceId);
    if (!svc) return { ok: false, error: 'That service no longer exists.' };
    if (isBlocked(newDate, state.blockedDates)) return { ok: false, error: 'That date is blocked — please pick another.' };
    var dayHours = (staffHours(state, b.staffId) || {})[weekdayOf(newDate)];
    if (!dayHours) return { ok: false, error: 'Closed that day — please pick another.' };
    var end = newStart + svc.durationMin;
    if (newStart < dayHours[0] || end > dayHours[1]) return { ok: false, error: 'Outside working hours.' };
    var bufNew = bufferOf(svc);
    for (var j = 0; j < state.bookings.length; j++) {
      var o = state.bookings[j];
      if (o.id === bookingId || o.date !== newDate || ACTIVE_STATUSES.indexOf(o.status) === -1) continue;
      if (b.staffId && o.staffId && o.staffId !== b.staffId) continue;
      var win = bookingBlockWindow(state, o);
      if (overlaps(newStart, end + bufNew, win.start, win.end)) {
        return { ok: false, error: 'That slot is taken — please pick another.' };
      }
    }
    var staffErr = validateStaffBooking(state, svc, b.staffId);
    if (staffErr) return { ok: false, error: staffErr };
    b.date = newDate;
    b.start = newStart;
    b.end = end;
    b.reminded = false;
    return { ok: true, booking: b };
  }

  function icsEsc(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  // RFC 5545 VEVENT for a booking — floating local times (no TZ guessing).
  // Lets customers add the appointment to any calendar app with one click.
  function bookingToICS(b, bizName, staffNm) {
    function stamp(dateStr, mins) {
      var d = dateStr.replace(/-/g, '');
      return d + 'T' + pad(Math.floor(mins / 60)) + pad(mins % 60) + '00';
    }
    var who = staffNm ? ' with ' + staffNm : '';
    var dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '') + 'Z';
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BookPilot AI//Booking//EN',
      'BEGIN:VEVENT',
      'UID:' + icsEsc(b.id || b.ref || 'bookpilot') + '@bookpilot-ai',
      'DTSTAMP:' + dtstamp,
      'DTSTART:' + stamp(b.date, b.start),
      'DTEND:' + stamp(b.date, b.end),
      'SUMMARY:' + icsEsc(b.serviceName + who + ' — ' + (bizName || 'Booking')),
      'DESCRIPTION:' + icsEsc('Booking ref ' + (b.ref || bookingRef(b.id)) + (b.notes ? '\nNotes: ' + b.notes : '')),
      'LOCATION:' + icsEsc(bizName || ''),
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    return lines.join('\r\n') + '\r\n';
  }

  // Waitlist: customers join when a day is fully booked. The owner sees who
  // is waiting per service+date and can reach out when a slot frees up.
  // inp: { serviceId, date, name, phone }.
  function addToWaitlist(state, inp) {    var errs = [];
    var svc = getService(state.services, inp.serviceId);
    if (!svc) errs.push('Pick a service.');
    if (!inp.date || !/^\d{4}-\d{2}-\d{2}$/.test(inp.date)) errs.push('Pick a valid date.');
    if (!inp.name || !String(inp.name).trim()) errs.push('Your name is required.');
    if (!inp.phone || !String(inp.phone).trim()) errs.push('A phone number is required so we can reach you.');
    if (errs.length) return { ok: false, error: errs[0] };
    state.waitlist = state.waitlist || [];
    var dup = state.waitlist.some(function (w) {
      return w.serviceId === inp.serviceId && w.date === inp.date &&
        normalizePhone(w.phone) === normalizePhone(inp.phone);
    });
    if (dup) return { ok: false, error: 'You are already on the waitlist for that day.' };
    var entry = {
      id: uid('wl'),
      serviceId: svc.id,
      serviceName: svc.name,
      date: inp.date,
      name: String(inp.name).trim(),
      phone: String(inp.phone).trim(),
      createdAt: new Date().toISOString()
    };
    state.waitlist.push(entry);
    return { ok: true, entry: entry };
  }

  function removeFromWaitlist(state, id) {
    state.waitlist = state.waitlist || [];
    for (var i = 0; i < state.waitlist.length; i++) {
      if (state.waitlist[i].id === id) { state.waitlist.splice(i, 1); return true; }
    }
    return false;
  }

  // Waitlist entries for a service+date (either filter optional), oldest first.
  function waitlistFor(state, serviceId, date) {
    return (state.waitlist || []).filter(function (w) {
      return (!serviceId || w.serviceId === serviceId) && (!date || w.date === date);
    }).sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
  }

  // Waitlist entry by id (for the one-click "book this person" flow).
  function waitlistEntry(state, id) {
    var list = state.waitlist || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // Day utilization: booked minutes (confirmed + completed, including each
  // service's buffer) vs open minutes. Returns { openMin, bookedMin, pct }.
  function dayUtilization(state, date) {
    var dayHours = (state.hours || {})[weekdayOf(date)];
    if (!dayHours || isBlocked(date, state.blockedDates)) return { openMin: 0, bookedMin: 0, pct: 0 };
    var openMin = dayHours[1] - dayHours[0];
    var bookedMin = 0;
    (state.bookings || []).forEach(function (b) {
      if (b.date !== date) return;
      if (b.status !== 'confirmed' && b.status !== 'completed') return;
      bookedMin += Math.max(0, b.end - b.start) + bufferOf(getService(state.services, b.serviceId));
    });
    return { openMin: openMin, bookedMin: bookedMin, pct: openMin ? Math.min(100, Math.round((bookedMin / openMin) * 100)) : 0 };
  }

  // Utilization for 7 days starting at refDate (default today).
  function weekUtilization(state, refDate) {
    var d = refDate || todayStr();
    var out = [];
    for (var i = 0; i < 7; i++) {
      var u = dayUtilization(state, d);
      u.date = d;
      out.push(u);
      d = addDays(d, 1);
    }
    return out;
  }

  // Repeat-customer recognition keyed by normalized phone:
  // { bookings, completed, totalSpent, lastVisit } or null when unknown.
  function customerStats(state, phone) {
    var q = normalizePhone(phone);
    if (q.length < 4) return null;
    var hits = (state.bookings || []).filter(function (b) {
      return normalizePhone(b.phone).indexOf(q) !== -1;
    });
    if (!hits.length) return null;
    var completed = 0, spent = 0, last = '';
    hits.forEach(function (b) {
      if (b.status === 'completed') { completed++; spent += (b.price || 0); }
      var key = b.date + pad5(b.start);
      if (!last || key > last) last = key;
    });
    return { bookings: hits.length, completed: completed, totalSpent: spent, lastVisit: last.slice(0, 10) };
  }

  // ---------- multi-staff ----------
  // Staff model is single-browser (front-desk / shared tablet): state.staff =
  // [{id, name}]. Services optionally list staffIds who perform them (empty =
  // anyone). Bookings carry staffId (null = unassigned). A booking assigned to
  // one staff member does NOT block other staff members' slots; an unassigned
  // booking blocks everyone (safe legacy behavior).

  function staffList(state) {
    return state.staff || [];
  }

  function getStaffMember(state, id) {
    var list = staffList(state);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // Per-team-member working hours. A member's `hours` is either null/absent
  // ("same as business hours") or a full 0-6 map like state.hours (null =
  // closed that day). staffHours() returns the effective map; slotsForStaff()
  // honors it automatically, including "first available" matching.
  function validStaffHours(hours) {
    if (hours == null) return true; // absent = business hours
    if (typeof hours !== 'object') return false;
    for (var d = 0; d < 7; d++) {
      var r = hours[d];
      if (r == null) continue;
      var from = parseInt(r[0], 10), to = parseInt(r[1], 10);
      if (isNaN(from) || isNaN(to) || from < 0 || to > 1440 || to <= from) return false;
    }
    return true;
  }

  function staffHours(state, staffId) {
    var m = staffId ? getStaffMember(state, staffId) : null;
    if (m && m.hours && typeof m.hours === 'object' && validStaffHours(m.hours)) return m.hours;
    return state.hours;
  }

  // hours: null = back to business hours; otherwise a 0-6 map (null per day =
  // closed). Returns { ok } or { ok:false, error }.
  function setStaffHours(state, staffId, hours) {
    var m = getStaffMember(state, staffId);
    if (!m) return { ok: false, error: 'Team member not found.' };
    if (hours == null) { delete m.hours; return { ok: true }; }
    if (!validStaffHours(hours)) return { ok: false, error: 'Closing time must be after opening time on every open day.' };
    var clean = {};
    for (var d = 0; d < 7; d++) {
      var r = hours[d];
      clean[d] = (r == null) ? null : [parseInt(r[0], 10), parseInt(r[1], 10)];
    }
    m.hours = clean;
    return { ok: true };
  }

  function addStaffMember(state, name) {
    var n = String(name == null ? '' : name).trim();
    if (!n) return { ok: false, error: 'Enter a team member name.' };
    if (n.length > 60) return { ok: false, error: 'Name is too long (60 characters max).' };
    state.staff = staffList(state);
    var dup = state.staff.some(function (m) { return m.name.toLowerCase() === n.toLowerCase(); });
    if (dup) return { ok: false, error: 'That team member is already listed.' };
    var member = { id: uid('st'), name: n };
    state.staff.push(member);
    return { ok: true, member: member };
  }

  // Removing a team member unassigns their bookings (staffId -> null) rather
  // than deleting history. Returns the count of bookings unassigned.
  function removeStaffMember(state, id) {
    state.staff = staffList(state).filter(function (m) { return m.id !== id; });
    var n = 0;
    (state.bookings || []).forEach(function (b) {
      if (b.staffId === id) { b.staffId = null; n++; }
    });
    (state.services || []).forEach(function (s) {
      if (s.staffIds) s.staffIds = s.staffIds.filter(function (sid) { return sid !== id; });
    });
    return n;
  }

  function setServiceStaff(state, serviceId, staffIds) {
    var svc = getService(state.services, serviceId);
    if (!svc) return { ok: false, error: 'Service not found.' };
    var ids = (staffIds || []).filter(function (id) { return getStaffMember(state, id); });
    svc.staffIds = ids;
    return { ok: true, service: svc };
  }

  // Staff members who can perform a service. [] when no staff exist at all.
  function eligibleStaff(state, service) {
    var list = staffList(state);
    if (!list.length || !service) return [];
    var ids = service.staffIds;
    if (!ids || !ids.length) return list.slice();
    return list.filter(function (m) { return ids.indexOf(m.id) !== -1; });
  }

  // Slot availability for one staff member. Unassigned bookings block every
  // staff member; bookings assigned to someone else do not block this one.
  // staffId null/undefined = legacy behavior (every active booking blocks).
  function slotsForStaff(dateStr, service, staffId, state, opts) {
    opts = opts || {};
    if (!service || !dateStr) return [];
    var list = staffList(state);
    if (staffId) {
      var member = getStaffMember(state, staffId);
      if (!member) return [];
      if (list.length && eligibleStaff(state, service).every(function (m) { return m.id !== staffId; })) return [];
    }
    var blockedDates = opts.blockedDates !== undefined ? opts.blockedDates : state.blockedDates;
    var hours = opts.hours || staffHours(state, staffId);
    var bookings = opts.bookings || state.bookings;
    var scoped = (bookings || []).filter(function (b) {
      if (!staffId) return true;
      return !b.staffId || b.staffId === staffId;
    });
    return slotsFor(dateStr, service, hours, blockedDates, scoped,
      { today: opts.today, nowMin: opts.nowMin, services: opts.services || state.services });
  }

  // Earliest bookable { staffId, start } for a service on a date, across the
  // eligible staff ("first available"). staffId is null when no staff exist.
  // Returns null when nothing is free.
  function firstAvailable(state, service, dateStr, opts) {
    opts = opts || {};
    var cands = eligibleStaff(state, service);
    if (!cands.length) {
      var solo = slotsForStaff(dateStr, service, null, state, opts);
      return solo.length ? { staffId: null, start: solo[0] } : null;
    }
    var best = null;
    cands.forEach(function (m) {
      var slots = slotsForStaff(dateStr, service, m.id, state, opts);
      if (slots.length && (!best || slots[0] < best.start)) best = { staffId: m.id, start: slots[0] };
    });
    return best;
  }

  // One staff member's day: bookings sorted by start (pad-safe).
  function staffDaySchedule(state, dateStr, staffId) {
    return (state.bookings || []).filter(function (b) {
      return b.date === dateStr && (!staffId || b.staffId === staffId || (!b.staffId && staffId === 'unassigned'));
    }).sort(function (a, b) {
      return (pad5(a.start) < pad5(b.start)) ? -1 : 1;
    });
  }

  function validateStaffBooking(state, service, staffId) {
    if (!staffId) return null; // "first available" / no preference
    var member = getStaffMember(state, staffId);
    if (!member) return 'Unknown team member — please pick again.';
    var ok = eligibleStaff(state, service).some(function (m) { return m.id === staffId; });
    if (!ok) return member.name + ' does not perform ' + service.name + '.';
    return null;
  }

  // ---------- notifications (free channels) ----------
  // Plain-text digest of due reminders for ntfy.sh / email bodies.
  function ntfyReminderText(bizName, due, state) {
    var lines = ['BookPilot — ' + due.length + ' booking(s) tomorrow need a reminder (' + (bizName || 'your business') + '):'];
    due.forEach(function (b) {
      var m = state && b.staffId ? getStaffMember(state, b.staffId) : null;
      var who = m ? ' with ' + m.name : '';
      lines.push('- ' + b.name + ' (' + b.phone + ') — ' + b.serviceName + ' at ' + fmtTime(b.start) + who + ' [ref ' + (b.ref || bookingRef(b.id)) + ']');
    });
    return lines.join('\n');
  }

  // ---------- multi-device sync (export / import / QR payload) ----------
  var SYNC_APP = 'bookpilot-ai';
  var SYNC_FORMAT = 1;

  function exportStore(state) {
    return JSON.stringify({ app: SYNC_APP, format: SYNC_FORMAT, exportedAt: new Date().toISOString(), state: state });
  }

  // Base64url helpers without atob/btoa (logic.js runs in Node too).
  var B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function b64uEncode(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += B64U[(n >>> 18) & 63] + B64U[(n >>> 12) & 63] +
        (i + 1 < bytes.length ? B64U[(n >>> 6) & 63] : '') +
        (i + 2 < bytes.length ? B64U[n & 63] : '');
    }
    return out;
  }
  function b64uDecode(s) {
    var clean = String(s || '').replace(/[^A-Za-z0-9\-_]/g, '');
    var out = [];
    for (var i = 0; i < clean.length; i += 4) {
      var n = (B64U.indexOf(clean[i]) << 18) | (B64U.indexOf(clean[i + 1]) << 12) |
        ((i + 2 < clean.length ? B64U.indexOf(clean[i + 2]) : 0) << 6) |
        (i + 3 < clean.length ? B64U.indexOf(clean[i + 3]) : 0);
      out.push((n >>> 16) & 255);
      if (i + 2 < clean.length) out.push((n >>> 8) & 255);
      if (i + 3 < clean.length) out.push(n & 255);
    }
    return out;
  }
  function utf8Bytes(str) {
    var enc = encodeURIComponent(str);
    var out = [];
    for (var i = 0; i < enc.length; i++) {
      if (enc[i] === '%') { out.push(parseInt(enc.substr(i + 1, 2), 16)); i += 2; }
      else out.push(enc.charCodeAt(i));
    }
    return out;
  }
  function bytesToUtf8(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b < 128) s += String.fromCharCode(b);
      else if (b >= 194 && b < 224 && i + 1 < bytes.length) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i++; }
      else if (b >= 224 && b < 240 && i + 2 < bytes.length) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 2; }
      else s += '\uFFFD';
    }
    return s;
  }

  // Encode the store for QR transfer. Returns { ok, payload, encoding, bytes }
  // or { ok:false, error } when the store is too large for a QR code.
  // encoding is 'BP1' (base64url JSON) — callers may gzip first and use 'BP1Z'.
  function syncPayload(state, alreadyZipped) {
    var json = exportStore(state);
    var bytes = alreadyZipped || utf8Bytes(json);
    var payload = (alreadyZipped ? 'BP1Z:' : 'BP1:') + b64uEncode(bytes);
    if (payload.length > 2900) {
      return { ok: false, error: 'Store is too large for a QR code (' + payload.length + ' chars). Use file export instead.' };
    }
    return { ok: true, payload: payload, encoding: alreadyZipped ? 'BP1Z' : 'BP1', bytes: payload.length };
  }

  function sanitizeState(s) {
    s = s || {};
    // Staff records: id + name required; optional per-day hours map is kept
    // only when every day is valid (null = closed, [from,to] minutes).
    // Legacy records (no hours) load fine — they get business hours.
    var staff = Array.isArray(s.staff) ? s.staff.filter(function (m) { return m && m.id && m.name; }) : [];
    staff = staff.map(function (m) {
      var mm = { id: m.id, name: m.name };
      if (m.hours && typeof m.hours === 'object' && validStaffHours(m.hours)) {
        var clean = {};
        for (var d = 0; d < 7; d++) {
          var r = m.hours[d];
          clean[d] = (r == null) ? null : [parseInt(r[0], 10), parseInt(r[1], 10)];
        }
        mm.hours = clean;
      }
      return mm;
    });
    var staffIds = {};
    staff.forEach(function (m) { staffIds[m.id] = true; });
    return {
      bizName: typeof s.bizName === 'string' ? s.bizName : '',
      services: Array.isArray(s.services) ? s.services : [],
      hours: (s.hours && typeof s.hours === 'object') ? s.hours : defaultHours(),
      blockedDates: Array.isArray(s.blockedDates) ? s.blockedDates : [],
      bookings: Array.isArray(s.bookings) ? s.bookings : [],
      waitlist: Array.isArray(s.waitlist) ? s.waitlist : [],
      staff: staff,
      settings: (s.settings && typeof s.settings === 'object') ? s.settings : {}
    };
  }

  // Accept: sync envelope JSON, raw state JSON, or a BP1:/BP1Z: transfer
  // payload (BP1Z must be gunzipped by the caller first — see app.js).
  // Returns { ok:true, state, meta } or { ok:false, error }.
  function importStore(text) {
    var raw = String(text == null ? '' : text).trim();
    if (!raw) return { ok: false, error: 'Nothing to import — paste the transfer text or choose a file.' };
    try {
      var json = raw;
      if (/^BP1Z:/.test(raw)) return { ok: false, error: 'This is a compressed transfer — it needs decompressing first (use the Import box, not a raw paste here).' };
      if (/^BP1:/.test(raw)) json = bytesToUtf8(b64uDecode(raw.slice(4)));
      var parsed = JSON.parse(json);
      var s = parsed && parsed.app === SYNC_APP ? parsed.state : parsed;
      if (!s || typeof s !== 'object' || !Array.isArray(s.bookings) || !Array.isArray(s.services)) {
        return { ok: false, error: 'That does not look like a BookPilot backup.' };
      }
      var clean = sanitizeState(s);
      // Drop staff references that no longer exist in the imported roster.
      var okIds = {};
      clean.staff.forEach(function (m) { okIds[m.id] = true; });
      clean.services.forEach(function (svc) {
        if (svc.staffIds) svc.staffIds = svc.staffIds.filter(function (id) { return okIds[id]; });
      });
      clean.bookings.forEach(function (b) { if (b.staffId && !okIds[b.staffId]) b.staffId = null; });
      var meta = {
        bookings: clean.bookings.length,
        services: clean.services.length,
        staff: clean.staff.length,
        waitlist: clean.waitlist.length,
        exportedAt: (parsed && parsed.exportedAt) || null
      };
      return { ok: true, state: clean, meta: meta };
    } catch (e) {
      return { ok: false, error: 'Could not read that backup (' + (e && e.message ? e.message : 'invalid data') + ').' };
    }
  }

  return {
    STATUSES: STATUSES,
    DEFAULT_SERVICES: DEFAULT_SERVICES,
    defaultHours: defaultHours,
    fmtTime: fmtTime,
    fmtRange: fmtRange,
    fmtDate: fmtDate,
    weekdayOf: weekdayOf,
    addDays: addDays,
    todayStr: todayStr,
    overlaps: overlaps,
    uid: uid,
    validateService: validateService,
    getService: getService,
    isBlocked: isBlocked,
    slotsFor: slotsFor,
    validateBookingInput: validateBookingInput,
    bookSlot: bookSlot,
    setStatus: setStatus,
    markReminded: markReminded,
    upcomingBookings: upcomingBookings,
    dayBeforeList: dayBeforeList,
    stats: stats,
    nextOpenDates: nextOpenDates,
    embedSnippet: embedSnippet,
    reminderMessage: reminderMessage,
    bookingsToCSV: bookingsToCSV,
    searchBookings: searchBookings,
    revenueByService: revenueByService,
    findBookingsByPhone: findBookingsByPhone,
    cancelBooking: cancelBooking,
    rescheduleBooking: rescheduleBooking,
    bookingToICS: bookingToICS,
    validStaffHours: validStaffHours,
    staffHours: staffHours,
    setStaffHours: setStaffHours,
    bufferOf: bufferOf,
    bookingRef: bookingRef,
    addToWaitlist: addToWaitlist,
    removeFromWaitlist: removeFromWaitlist,
    waitlistFor: waitlistFor,
    waitlistEntry: waitlistEntry,
    dayUtilization: dayUtilization,
    weekUtilization: weekUtilization,
    customerStats: customerStats,
    blockedList: blockedList,
    // multi-staff
    staffList: staffList,
    getStaffMember: getStaffMember,
    addStaffMember: addStaffMember,
    removeStaffMember: removeStaffMember,
    setServiceStaff: setServiceStaff,
    eligibleStaff: eligibleStaff,
    slotsForStaff: slotsForStaff,
    firstAvailable: firstAvailable,
    staffDaySchedule: staffDaySchedule,
    // notifications (free channels)
    ntfyReminderText: ntfyReminderText,
    // multi-device sync
    exportStore: exportStore,
    importStore: importStore,
    syncPayload: syncPayload,
    b64uEncode: b64uEncode,
    b64uDecode: b64uDecode,
    utf8Bytes: utf8Bytes,
    bytesToUtf8: bytesToUtf8
  };
});
