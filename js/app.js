/* bookpilot-ai app wiring — DOM + localStorage. Requires js/logic.js (window.Bookpilot). */
(function () {
  'use strict';
  var B = window.Bookpilot;
  var LS_KEY = 'bookpilot-ai-v1';
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function $(id) { return document.getElementById(id); }

  function defaultState() {
    return {
      bizName: '',
      services: JSON.parse(JSON.stringify(B.DEFAULT_SERVICES)),
      hours: B.defaultHours(),
      blockedDates: [],       // [{date, note}]
      bookings: [],
      waitlist: []            // [{id, serviceId, serviceName, date, name, phone, createdAt}]
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        s.services = s.services || [];
        s.hours = s.hours || B.defaultHours();
        s.blockedDates = s.blockedDates || [];
        s.bookings = s.bookings || [];
        s.waitlist = s.waitlist || [];
        return s;
      }
    } catch (e) {}
    return defaultState();
  }

  function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

  var state = load();
  var selSlot = null;
  var EMBED = /[?&]embed=1/.test(location.search);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) { return '$' + (Math.round(n * 100) / 100); }

  // ---------- tabs ----------
  function showTab(name) {
    var tabs = document.querySelectorAll('#mainTabs button');
    tabs.forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.id === 'tab-' + name);
    });
  }
  document.querySelectorAll('#mainTabs button').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); });
  });

  if (EMBED) {
    document.querySelector('header p').textContent = 'Book online in seconds — pick a service, day, and time.';
    var tabsEl = $('mainTabs');
    if (tabsEl) tabsEl.style.display = 'none';
    showTab('book');
  }

  // ---------- booking step rail ----------
  function setStep(n) {
    var rail = $('bookSteps');
    if (!rail) return;
    rail.querySelectorAll('.step').forEach(function (li) {
      var s = parseInt(li.dataset.step, 10);
      li.classList.toggle('active', s === n);
      li.classList.toggle('done', s < n);
    });
  }

  // ---------- services ----------
  function serviceOptions(sel, includeAll) {
    var html = includeAll ? '<option value="">All services</option>' : '';
    state.services.forEach(function (s) {
      var buf = B.bufferOf(s) ? ' · +' + B.bufferOf(s) + 'm buffer' : '';
      html += '<option value="' + esc(s.id) + '">' + esc(s.name) + ' — ' + s.durationMin + ' min · $' + s.price + buf + '</option>';
    });
    sel.innerHTML = html;
  }

  function renderSvcCards() {
    var host = $('svcCards');
    if (!host) return;
    var cur = $('bkService').value;
    host.innerHTML = state.services.map(function (s) {
      return '<button type="button" class="svc-card' + (s.id === cur ? ' sel' : '') + '" data-svc="' + esc(s.id) + '">' +
        '<span class="svc-name">' + esc(s.name) + '</span>' +
        '<span class="svc-meta">' + s.durationMin + ' min · $' + s.price + '</span></button>';
    }).join('') || '<p class="muted">No services yet.</p>';
    host.querySelectorAll('[data-svc]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $('bkService').value = btn.dataset.svc;
        renderSvcCards();
        renderBookingForm();
      });
    });
  }

  function renderServices() {
    serviceOptions($('bkService'), false);
    serviceOptions($('embService'), true);
    renderSvcCards();
    var html = '<table><tr><th>Service</th><th>Duration</th><th>Buffer</th><th>Price</th><th></th></tr>';
    state.services.forEach(function (s) {
      var buf = B.bufferOf(s) ? B.bufferOf(s) + ' min' : '—';
      html += '<tr><td>' + esc(s.name) + '</td><td>' + s.durationMin + ' min</td><td>' + buf + '</td><td>$' + s.price +
        '</td><td><button class="danger small" data-del-svc="' + esc(s.id) + '">Delete</button></td></tr>';
    });
    $('serviceList').innerHTML = html + '</table>';
    $('serviceList').querySelectorAll('[data-del-svc]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var hasBookings = state.bookings.some(function (b) { return b.serviceId === btn.dataset.delSvc && b.status === 'confirmed'; });
        if (hasBookings && !confirm('This service has upcoming bookings. Delete anyway?')) return;
        state.services = state.services.filter(function (s) { return s.id !== btn.dataset.delSvc; });
        save(); renderServices(); renderBookingForm();
      });
    });
    // preselect ?service= in embed mode
    var m = /[?&]service=([^&]+)/.exec(location.search);
    if (m && EMBED) {
      var sid = decodeURIComponent(m[1]);
      if (B.getService(state.services, sid)) $('bkService').value = sid;
    }
  }

  $('svcAdd').addEventListener('click', function () {
    var s = { id: B.uid('svc'), name: $('svcName').value, durationMin: $('svcDur').value,
      price: $('svcPrice').value, bufferMin: $('svcBuf').value };
    var errs = B.validateService(s);
    if (errs.length) { alert(errs[0]); return; }
    s.durationMin = parseInt(s.durationMin, 10);
    s.price = parseFloat(s.price);
    s.bufferMin = parseInt(s.bufferMin, 10) || 0;
    state.services.push(s);
    $('svcName').value = ''; $('svcDur').value = 30; $('svcPrice').value = 25; $('svcBuf').value = 0;
    save(); renderServices();
  });

  // ---------- hours ----------
  function renderHours() {
    var g = $('hoursGrid');
    g.innerHTML = '';
    for (var d = 0; d < 7; d++) {
      (function (day) {
        var h = state.hours[day];
        var box = document.createElement('div');
        box.className = 'daybox';
        var open = h ? B.fmtTime(h[0]).replace(':00 ', ' ') : '';
        box.innerHTML = '<div class="d">' + DAYS[day] + '</div>' +
          '<label style="display:flex;gap:6px;align-items:center;font-size:13px;text-transform:none;letter-spacing:0">' +
          '<input type="checkbox" data-h-open="' + day + '"' + (h ? ' checked' : '') + '> Open</label>' +
          '<div style="display:flex;gap:6px;margin-top:6px">' +
          '<input type="time" data-h-from="' + day + '" value="' + (h ? to24(h[0]) : '09:00') + '">' +
          '<input type="time" data-h-to="' + day + '" value="' + (h ? to24(h[1]) : '17:00') + '">' +
          '</div>';
        g.appendChild(box);
      })(d);
    }
    function to24(min) {
      var h = Math.floor(min / 60), m = min % 60;
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    }
  }

  function toMin(t) {
    var p = t.split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }

  $('hoursSave').addEventListener('click', function () {
    for (var d = 0; d < 7; d++) {
      var open = document.querySelector('[data-h-open="' + d + '"]').checked;
      if (!open) { state.hours[d] = null; continue; }
      var from = toMin(document.querySelector('[data-h-from="' + d + '"]').value || '09:00');
      var to = toMin(document.querySelector('[data-h-to="' + d + '"]').value || '17:00');
      if (to <= from) { alert(DAYS[d] + ': closing time must be after opening time.'); return; }
      state.hours[d] = [from, to];
    }
    save(); renderBookingForm();
    alert('Hours saved.');
  });

  // ---------- blocked dates ----------
  function renderBlocked() {
    var list = state.blockedDates.slice().sort();
    var html = list.length ? '<table><tr><th>Date</th><th>Note</th><th></th></tr>' : '<p class="muted">No blocked dates.</p>';
    list.forEach(function (bd) {
      var date = typeof bd === 'string' ? bd : bd.date;
      var note = typeof bd === 'string' ? '' : (bd.note || '');
      html += '<tr><td>' + esc(B.fmtDate(date)) + '</td><td>' + esc(note) + '</td>' +
        '<td><button class="danger small" data-unblock="' + esc(date) + '">Unblock</button></td></tr>';
    });
    $('blkList').innerHTML = list.length ? html + '</table>' : html;
    $('blkList').querySelectorAll('[data-unblock]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.blockedDates = state.blockedDates.filter(function (bd) {
          return (typeof bd === 'string' ? bd : bd.date) !== btn.dataset.unblock;
        });
        save(); renderBlocked(); renderBookingForm();
      });
    });
  }

  $('blkAdd').addEventListener('click', function () {
    var d = $('blkDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { alert('Pick a date first.'); return; }
    var dates = state.blockedDates.map(function (bd) { return typeof bd === 'string' ? bd : bd.date; });
    if (dates.indexOf(d) === -1) state.blockedDates.push({ date: d, note: $('blkNote').value });
    $('blkDate').value = ''; $('blkNote').value = '';
    save(); renderBlocked(); renderBookingForm();
  });

  // ---------- customer booking ----------
  function blockedDateList() {
    return state.blockedDates.map(function (bd) { return typeof bd === 'string' ? bd : bd.date; });
  }

  function renderBookingForm() {
    var svc = B.getService(state.services, $('bkService').value);
    var date = $('bkDate').value;
    var wrap = $('slotWrap');
    $('bkForm').style.display = 'none';
    selSlot = null;
    if (!svc) { wrap.innerHTML = '<p class="muted">Add a service first (Services tab).</p>'; setStep(1); return; }
    if (!date) { wrap.innerHTML = '<p class="muted">Pick a date to see available times.</p>'; setStep(1); return; }
    if (B.isBlocked(date, blockedDateList())) { wrap.innerHTML = '<div class="warnbox">That date is blocked — please pick another day.</div>'; setStep(2); return; }
    var slots = B.slotsFor(date, svc, state.hours, blockedDateList(), state.bookings,
      { today: B.todayStr(), services: state.services });
    if (!slots.length) {
      wrap.innerHTML = '<div class="warnbox">No availability on ' + esc(B.fmtDate(date)) + ' — try another day, or join the waitlist below.</div>' +
        '<div class="waitlist-join"><h4>Join the waitlist</h4>' +
        '<p class="muted small">We\'ll hold your spot — if a time opens up, the owner can call you.</p>' +
        '<div class="row"><div><label for="wlName">Your name</label><input type="text" id="wlName" placeholder="Jane Doe"></div>' +
        '<div><label for="wlPhone">Phone</label><input type="tel" id="wlPhone" placeholder="555-123-4567"></div></div>' +
        '<div style="margin-top:10px"><button class="btn primary" id="wlJoin">Join waitlist</button></div>' +
        '<div id="wlResult" style="margin-top:10px"></div></div>';
      setStep(2);
      $('wlJoin').addEventListener('click', function () {
        var r = B.addToWaitlist(state, {
          serviceId: svc.id, date: date,
          name: $('wlName').value, phone: $('wlPhone').value
        });
        if (!r.ok) { $('wlResult').innerHTML = '<div class="warnbox">' + esc(r.error) + '</div>'; return; }
        save();
        $('wlResult').innerHTML = '<div class="notice"><strong>You\'re on the waitlist</strong> for ' +
          esc(svc.name) + ' on ' + esc(B.fmtDate(date)) + '. We\'ll call ' + esc(r.entry.phone) + ' if a spot opens.</div>';
      });
      return;
    }
    var html = '<div class="slot-label">Available times — ' + esc(B.fmtDate(date)) + '</div><div class="slotgrid">';
    slots.forEach(function (t) {
      html += '<button data-slot="' + t + '">' + B.fmtTime(t) + '</button>';
    });
    wrap.innerHTML = html + '</div>';
    setStep(2);
    wrap.querySelectorAll('[data-slot]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        wrap.querySelectorAll('[data-slot]').forEach(function (x) { x.classList.remove('sel'); });
        btn.classList.add('sel');
        selSlot = parseInt(btn.dataset.slot, 10);
        $('bkForm').style.display = 'block';
        $('bkResult').innerHTML = '';
        renderReturning();
        setStep(3);
      });
    });
  }

  // ---------- repeat-customer recognition ----------
  function renderReturning() {
    var host = $('bkReturning');
    if (!host) return;
    var cs = B.customerStats(state, $('bkPhone').value);
    host.innerHTML = cs
      ? '<span class="ret-badge">Returning customer</span> ' + cs.bookings + ' booking' +
        (cs.bookings === 1 ? '' : 's') + ' · ' + cs.completed + ' completed · $' +
        cs.totalSpent + ' lifetime' +
        (cs.lastVisit ? ' · last visit ' + esc(B.fmtDate(cs.lastVisit)) : '')
      : '';
  }
  $('bkPhone').addEventListener('input', renderReturning);
  $('bkService').addEventListener('change', function () { renderSvcCards(); renderBookingForm(); });
  $('bkDate').addEventListener('change', renderBookingForm);

  $('bkConfirm').addEventListener('click', function () {
    if (selSlot == null) { alert('Pick a time slot first.'); return; }
    var r = B.bookSlot(state, {
      serviceId: $('bkService').value,
      date: $('bkDate').value,
      start: selSlot,
      name: $('bkName').value,
      phone: $('bkPhone').value,
      notes: $('bkNotes').value
    });
    if (!r.ok) { $('bkResult').innerHTML = '<div class="warnbox">' + esc(r.error) + '</div>'; return; }
    save();
    var b = r.booking;
    $('bkResult').innerHTML = '<div class="notice"><strong>Booked!</strong> ' + esc(b.serviceName) +
      ' on ' + esc(B.fmtDate(b.date)) + ' at ' + esc(B.fmtTime(b.start)) +
      '. We\'ll see you then, ' + esc(b.name.split(' ')[0]) + '.' +
      '<br><span class="muted">Your booking ref: <strong>' + esc(b.ref || B.bookingRef(b.id)) + '</strong> — keep it handy.</span></div>';
    $('bkForm').style.display = 'none';
    $('bkName').value = ''; $('bkPhone').value = ''; $('bkNotes').value = '';
    renderReturning();
    renderSvcCards();
    renderBookingForm(); renderBookings(); renderStats(); renderSvcRevenue();
  });

  // ---------- owner: bookings ----------
  function renderBookings() {
    var f = $('fltStatus').value;
    var today = B.todayStr();
    var list = state.bookings.slice().sort(function (a, b) {
      return (a.date + a.start) < (b.date + b.start) ? -1 : 1;
    });
    if (f === 'upcoming') list = list.filter(function (b) { return b.date >= today && b.status === 'confirmed'; });
    else if (f !== 'all') list = list.filter(function (b) { return b.status === f; });
    var q = $('fltSearch') ? $('fltSearch').value : '';
    if (q && q.trim()) {
      var hits = B.searchBookings({ bookings: list }, q);
      var hitIds = {};
      hits.forEach(function (b) { hitIds[b.id] = true; });
      list = list.filter(function (b) { return hitIds[b.id]; });
    }

    if (!list.length) { $('bookingsTable').innerHTML = '<p class="muted">No bookings here yet.</p>'; }
    else {
      var html = '<table><tr><th>When</th><th>Customer</th><th>Service</th><th>Ref</th><th>Status</th><th>Actions</th></tr>';
      list.forEach(function (b) {
        var cs = B.customerStats(state, b.phone);
        html += '<tr><td>' + esc(B.fmtDate(b.date)) + '<br><span class="muted">' + esc(B.fmtRange(b.start, b.end)) + '</span></td>' +
          '<td>' + esc(b.name) +
          (cs && cs.bookings > 1 ? ' <span class="ret-badge">returning · ' + cs.bookings + '</span>' : '') +
          '<br><span class="muted">' + esc(b.phone) + '</span></td>' +
          '<td>' + esc(b.serviceName) + '<br><span class="muted">$' + b.price + '</span></td>' +
          '<td><span class="refcode">' + esc(b.ref || B.bookingRef(b.id)) + '</span></td>' +
          '<td><span class="pill ' + b.status + '">' + b.status + '</span></td><td>' +
          '<button class="ghost small" data-act="completed" data-id="' + b.id + '">Complete</button> ' +
          '<button class="ghost small" data-act="no-show" data-id="' + b.id + '">No-show</button> ' +
          '<button class="danger small" data-act="cancelled" data-id="' + b.id + '">Cancel</button>' +
          '</td></tr>';
      });
      $('bookingsTable').innerHTML = html + '</table>';
      $('bookingsTable').querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          B.setStatus(state, btn.dataset.id, btn.dataset.act);
          save(); renderBookings(); renderStats(); renderSvcRevenue();
        });
      });
    }

    // day-before reminders
    var due = B.dayBeforeList(state, today);
    var rb = $('remindBox');
    if (due.length) {
      var h = '<div class="warnbox"><strong>' + due.length + ' booking(s) tomorrow need a reminder:</strong><ul style="margin:8px 0 0;padding-left:18px">';
      due.forEach(function (b) {
        h += '<li>' + esc(b.name) + ' (' + esc(b.phone) + ') — ' + esc(b.serviceName) + ' at ' + esc(B.fmtTime(b.start)) +
          ' <button class="ghost small" data-remind="' + b.id + '">Copy reminder text</button></li>';
      });
      rb.innerHTML = h + '</ul></div>';
      rb.querySelectorAll('[data-remind]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var bk = null;
          state.bookings.forEach(function (x) { if (x.id === btn.dataset.remind) bk = x; });
          if (!bk) return;
          var msg = B.reminderMessage(state.bizName || 'us', bk);
          copyText(msg);
          B.markReminded(state, bk.id);
          save(); renderBookings();
        });
      });
    } else {
      rb.innerHTML = '<div class="notice">No reminders due — nothing booked for tomorrow, or all reminders sent.</div>';
    }

    renderWaitlist();
  }

  // ---------- owner: waitlist ----------
  function renderWaitlist() {
    var host = $('waitlistBox');
    if (!host) return;
    var list = B.waitlistFor(state, null, null);
    if (!list.length) {
      host.innerHTML = '<p class="muted">Waitlist is empty — customers can join it when a day has no free slots.</p>';
      return;
    }
    var today = B.todayStr();
    var html = '<table><tr><th>When</th><th>Customer</th><th>Service</th><th>Opening?</th><th></th></tr>';
    list.forEach(function (w) {
      var svc = B.getService(state.services, w.serviceId);
      var open = false;
      if (svc && w.date >= today && !B.isBlocked(w.date, blockedDateList())) {
        open = B.slotsFor(w.date, svc, state.hours, blockedDateList(), state.bookings,
          { today: today, services: state.services, nowMin: 0 }).length > 0;
      }
      html += '<tr><td>' + esc(B.fmtDate(w.date)) + '</td>' +
        '<td>' + esc(w.name) + '<br><span class="muted">' + esc(w.phone) + '</span></td>' +
        '<td>' + esc(w.serviceName) + '</td>' +
        '<td>' + (open ? '<span class="pill confirmed">slot may be free</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (open ? '<button class="primary small" data-wl-book="' + w.id + '">Book</button> ' : '') +
        '<button class="ghost small" data-wl-copy="' + w.id + '">Copy number</button> ' +
        '<button class="danger small" data-wl-del="' + w.id + '">Remove</button></td></tr>';
    });
    host.innerHTML = html + '</table>';
    host.querySelectorAll('[data-wl-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        B.removeFromWaitlist(state, btn.dataset.wlDel);
        save(); renderWaitlist();
      });
    });
    // One-click: book the freed slot for this waitlister — pre-fills the
    // booking form and takes the owner straight to the slot grid.
    host.querySelectorAll('[data-wl-book]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var w = B.waitlistEntry(state, btn.dataset.wlBook);
        if (!w) return;
        showTab('book');
        $('bkService').value = w.serviceId;
        renderSvcCards();
        $('bkDate').value = w.date;
        renderBookingForm();
        $('bkName').value = w.name;
        $('bkPhone').value = w.phone;
        renderReturning();
        $('bkResult').innerHTML = '<div class="notice">Booking for waitlist customer <strong>' + esc(w.name) +
          '</strong> (' + esc(w.serviceName) + ' on ' + esc(B.fmtDate(w.date)) + ') — pick a time slot above.</div>';
        window.scrollTo(0, 0);
      });
    });
    host.querySelectorAll('[data-wl-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var found = null;
        (state.waitlist || []).forEach(function (w) { if (w.id === btn.dataset.wlCopy) found = w; });
        if (found) copyText(found.phone);
      });
    });
  }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { alert('Reminder copied — paste into SMS/WhatsApp.'); });
    } else {
      prompt('Copy this reminder:', t);
    }
  }

  $('fltStatus').addEventListener('change', renderBookings);
  if ($('fltSearch')) {
    $('fltSearch').addEventListener('input', renderBookings);
  }

  // ---------- bookings CSV export ----------
  function downloadCSV(filename, csv) {
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  $('exportCsv').addEventListener('click', function () {
    var csv = B.bookingsToCSV(state);
    var fname = 'bookpilot-bookings-' + B.todayStr() + '.csv';
    downloadCSV(fname, csv);
  });

  // ---------- revenue by service ----------
  function renderSvcRevenue() {
    var host = $('svcRevenue');
    if (!host) return;
    var rows = B.revenueByService(state.bookings);
    if (!rows.length) { host.innerHTML = '<p class="muted">No revenue yet — completed bookings will show here by service.</p>'; return; }
    var html = '<table><tr><th>Service</th><th>Bookings</th><th>Completed</th><th>Revenue</th></tr>';
    rows.forEach(function (r) {
      html += '<tr><td>' + esc(r.service) + '</td><td>' + r.bookings + '</td><td>' + r.completed +
        '</td><td>' + money(r.revenue) + '</td></tr>';
    });
    host.innerHTML = html + '</table>';
  }

  // ---------- next-available finder ----------
  $('bkNextAvail').addEventListener('click', function () {
    var svcId = $('bkService').value;
    var svc = B.getService(state.services, svcId);
    if (!svc) { alert('Pick a service first.'); return; }
    var open = B.nextOpenDates(state, svcId, 1, B.todayStr());
    if (!open.length) { alert('No availability for ' + svc.name + ' in the next 60 days.'); return; }
    $('bkDate').value = open[0].date;
    renderBookingForm();
  });

  // ---------- customer self-service lookup ----------
  function renderLookup() {
    var host = $('lkResults');
    var phone = $('lkPhone').value;
    var hits = B.findBookingsByPhone(state, phone);
    if (!hits.length) {
      host.innerHTML = '<p class="muted">No upcoming bookings found for that phone number. Check the number and try again.</p>';
      return;
    }
    var html = '<table><tr><th>When</th><th>Service</th><th>Ref</th><th>Status</th><th></th></tr>';
    hits.forEach(function (b) {
      html += '<tr><td>' + esc(B.fmtDate(b.date)) + '<br><span class="muted">' + esc(B.fmtRange(b.start, b.end)) + '</span></td>' +
        '<td>' + esc(b.serviceName) + '<br><span class="muted">' + esc(b.name) + '</span></td>' +
        '<td><span class="refcode">' + esc(b.ref || B.bookingRef(b.id)) + '</span></td>' +
        '<td><span class="pill confirmed">confirmed</span></td>' +
        '<td><button class="danger small" data-selfcancel="' + b.id + '">Cancel booking</button></td></tr>';
    });
    host.innerHTML = html + '</table>';
    host.querySelectorAll('[data-selfcancel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('Cancel this booking? The business owner will be notified.')) return;
        var r = B.cancelBooking(state, btn.dataset.selfcancel);
        if (!r.ok) { alert(r.error); return; }
        save();
        renderLookup();
        renderBookings(); renderStats(); renderSvcRevenue(); renderBookingForm();
      });
    });
  }

  $('lkFind').addEventListener('click', renderLookup);
  $('lkPhone').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); renderLookup(); } });

  function renderStats() {
    var s = B.stats(state.bookings);
    $('statsRow').innerHTML =
      stat(s.total, 'Total bookings') + stat(s.confirmed, 'Upcoming') +
      stat(s.completed, 'Completed') + stat(s.noShowRate + '%', 'No-show rate') +
      stat('$' + s.revenue, 'Revenue (completed)');
    function stat(n, l) { return '<div class="stat"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
    renderCapacity();
  }

  // 7-day capacity strip: how full each day is (booked incl. buffers vs open).
  function renderCapacity() {
    var host = $('capacityStrip');
    if (!host) return;
    var week = B.weekUtilization(state, B.todayStr());
    host.innerHTML = '<div class="cap-h">Week capacity — booked vs open hours</div><div class="cap-row">' +
      week.map(function (d) {
        var label = B.fmtDate(d.date).split(',')[0];
        var bar = d.openMin
          ? '<div class="cap-bar"><span style="width:' + d.pct + '%"></span></div>'
          : '<div class="cap-bar closed"></div>';
        return '<div class="cap-day"><span class="cap-d">' + esc(label) + '</span>' + bar +
          '<span class="cap-p">' + (d.openMin ? d.pct + '%' : 'closed') + '</span></div>';
      }).join('') + '</div>';
  }

  // ---------- embed ----------
  $('embGen').addEventListener('click', function () {
    var url = $('embUrl').value.trim();
    if (!url) { alert('Enter the page URL where this file is hosted first.'); return; }
    var sid = $('embService').value || null;
    var out = $('embOut');
    out.style.display = 'block';
    out.textContent = B.embedSnippet(url, sid);
  });

  // ---------- misc ----------
  $('bizName').value = state.bizName || '';
  $('bizName').addEventListener('input', function () { state.bizName = $('bizName').value; save(); });

  $('resetDemo').addEventListener('click', function () {
    if (!confirm('Load demo services, hours, and sample bookings? This replaces current data.')) return;
    localStorage.removeItem(LS_KEY);
    state = load();
    var t = B.todayStr();
    var d2 = B.addDays(t, 2);
    B.bookSlot(state, { serviceId: 'svc-cut', date: d2, start: 540, name: 'Demo Client', phone: '555-0100', notes: '' });
    B.bookSlot(state, { serviceId: 'svc-massage', date: d2, start: 660, name: 'Sam Rivera', phone: '555-0101', notes: '' });
    state.bizName = 'Main Street Salon';
    save(); boot();
  });

  $('wipeAll').addEventListener('click', function () {
    if (!confirm('Erase ALL BookPilot data in this browser?')) return;
    localStorage.removeItem(LS_KEY);
    state = defaultState();
    save(); boot();
  });

  function boot() {
    $('bizName').value = state.bizName || '';
    renderServices();
    renderHours();
    renderBlocked();
    renderBookings();
    renderStats();
    renderSvcRevenue();
    $('bkDate').min = B.todayStr();
    renderBookingForm();
  }

  boot();
})();
