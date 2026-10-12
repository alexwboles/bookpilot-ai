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

  function isBlocked(dateStr, blockedDates) {
    return (blockedDates || []).indexOf(dateStr) !== -1;
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
      var win = bookingBlockWindow(state, b);
      if (overlaps(inp.start, end + bufNew, win.start, win.end)) return { ok: false, error: 'That slot was just taken — please pick another.' };
    }
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
      notes: inp.notes ? String(inp.notes).trim() : '',
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

  function reminderMessage(bizName, b) {
    return 'Hi ' + b.name + '! Reminder: you have ' + b.serviceName + ' at ' + bizName +
      ' on ' + fmtDate(b.date) + ' at ' + fmtTime(b.start) + '. Booking ref ' +
      (b.ref || bookingRef(b.id)) + '. Reply to confirm or reschedule. Thanks!';
  }

  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Full bookings export (owner). Sorted chronologically; CSV-safe escaping.
  function bookingsToCSV(state) {
    var header = ['Ref', 'Date', 'Time', 'Customer', 'Phone', 'Service', 'Duration (min)', 'Price', 'Status', 'Notes'];
    var list = (state.bookings || []).slice().sort(function (a, b) {
      return (a.date + pad5(a.start)) < (b.date + pad5(b.start)) ? -1 : 1;
    });
    var rows = [header];
    list.forEach(function (b) {
      rows.push([b.ref || bookingRef(b.id), b.date, fmtRange(b.start, b.end), b.name || '', b.phone || '',
        b.serviceName || '', b.durationMin || '', b.price || 0, b.status || '', b.notes || '']);
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

  // Waitlist: customers join when a day is fully booked. The owner sees who
  // is waiting per service+date and can reach out when a slot frees up.
  // inp: { serviceId, date, name, phone }.
  function addToWaitlist(state, inp) {
    var errs = [];
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
    bufferOf: bufferOf,
    bookingRef: bookingRef,
    addToWaitlist: addToWaitlist,
    removeFromWaitlist: removeFromWaitlist,
    waitlistFor: waitlistFor
  };
});
