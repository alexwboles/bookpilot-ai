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
      waitlist: [],           // [{id, serviceId, serviceName, date, name, phone, createdAt}]
      staff: [],              // [{id, name}]
      settings: {}            // { notifyAuto, ntfyTopic }
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
        s.staff = s.staff || [];
        s.settings = s.settings || {};
        return s;
      }
    } catch (e) {}
    return defaultState();
  }

  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked/full: non-fatal */ } }

  var state = load();
  var selSlot = null;
  var selStaff = ''; // '' = first available / no preference
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
    document.body.classList.add('embed');
    var hp = document.querySelector('header p');
    if (hp) hp.textContent = 'Book online in seconds — pick a service, day, and time.';
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

  // ---------- team (multi-staff) ----------
  function staffName(id) {
    var m = id ? B.getStaffMember(state, id) : null;
    return m ? m.name : '';
  }

  // Slots honoring the team-member picker. '' = first available (union across
  // eligible staff); a staff id = that person's availability only.
  function staffSlots(date, svc, staffId) {
    var blocked = blockedDateList();
    var base = { today: B.todayStr(), services: state.services };
    if (!B.staffList(state).length) {
      return B.slotsFor(date, svc, state.hours, blocked, state.bookings, base);
    }
    if (staffId) {
      return B.slotsForStaff(date, svc, staffId, state, base);
    }
    var seen = {}, out = [];
    B.eligibleStaff(state, svc).forEach(function (m) {
      B.slotsForStaff(date, svc, m.id, state, base).forEach(function (t) {
        if (!seen[t]) { seen[t] = true; out.push(t); }
      });
    });
    return out.sort(function (a, b) { return a - b; });
  }

  function renderStaffSelect() {
    var sel = $('bkStaff');
    if (!sel) return;
    var svc = B.getService(state.services, $('bkService').value);
    var wrap = sel.parentElement;
    var list = B.staffList(state);
    if (!list.length) { if (wrap) wrap.style.display = 'none'; selStaff = ''; return; }
    if (wrap) wrap.style.display = '';
    var elig = svc ? B.eligibleStaff(state, svc) : [];
    var html = '<option value="">First available</option>';
    elig.forEach(function (m) {
      html += '<option value="' + esc(m.id) + '"' + (selStaff === m.id ? ' selected' : '') + '>' + esc(m.name) + '</option>';
    });
    sel.innerHTML = html;
    if (selStaff && !elig.some(function (m) { return m.id === selStaff; })) { selStaff = ''; sel.value = ''; }
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
        save(); renderServices(); renderStaffMatrix(); renderBookingForm();
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
    save(); renderServices(); renderStaffMatrix();
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

  // Month calendar with per-day availability (Calendly-style).
  var calCursor = null; // 'YYYY-MM'
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function calSetCursor(ym) { calCursor = ym; }
  function renderCalendar() {
    var grid = $('calGrid');
    if (!grid) return;
    var svc = B.getService(state.services, $('bkService').value);
    var today = B.todayStr();
    if (!calCursor) {
      var now = new Date();
      calCursor = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
    }
    var parts = calCursor.split('-');
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    var monthName = new Date(y, m - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' });
    $('calTitle').textContent = monthName;
    var first = new Date(y, m - 1, 1).getDay();
    var days = new Date(y, m, 0).getDate();
    var blocked = blockedDateList();
    var html = DAYS.map(function (d) { return '<span class="cal-dow">' + d + '</span>'; }).join('');
    for (var i = 0; i < first; i++) html += '<span class="cal-day pad"></span>';
    for (var d = 1; d <= days; d++) {
      var ds = y + '-' + pad2(m) + '-' + pad2(d);
      var dow = new Date(y, m - 1, d).getDay();
      var closed = !state.hours[dow] || B.isBlocked(ds, blocked);
      var past = ds < today;
      var n = 0;
      if (svc && !closed && !past) {
        n = staffSlots(ds, svc, selStaff).length;
      }
      var cls = 'cal-day' + (closed || past ? ' off' : '') + (n > 0 ? ' open' : '') +
        ($('bkDate').value === ds ? ' sel' : '');
      html += '<button type="button" class="' + cls + '" data-day="' + ds + '"' +
        ((closed || past) ? ' disabled' : '') + ' aria-label="' + esc(B.fmtDate(ds)) +
        (n > 0 ? ', ' + n + ' times available' : '') + '">' +
        '<span class="dnum">' + d + '</span>' +
        (n > 0 ? '<span class="dcnt">' + n + '</span>' : '') + '</button>';
    }
    grid.innerHTML = html;
    grid.querySelectorAll('[data-day]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $('bkDate').value = btn.dataset.day;
        renderBookingForm();
      });
    });
  }
  function calShift(delta) {
    var parts = (calCursor || B.todayStr().slice(0, 7)).split('-');
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1 + delta, 1);
    calCursor = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
    renderCalendar();
  }

  function renderSvcSummary(svc) {
    var host = $('svcSummary');
    if (!host) return;
    if (!svc) { host.innerHTML = '<p class="muted small">Pick a service to see details.</p>'; return; }
    var buf = B.bufferOf(svc) ? ' · +' + B.bufferOf(svc) + 'm buffer' : '';
    host.innerHTML = '<div class="svc-sum-name">' + esc(svc.name) + '</div>' +
      '<div class="svc-sum-meta">' + svc.durationMin + ' min · $' + svc.price + buf + '</div>' +
      '<p class="muted small">Selected service — change it on the right if you need.</p>';
  }

  function slotGroupLabel(t) {
    return t < 720 ? 'Morning' : (t < 1020 ? 'Afternoon' : 'Evening');
  }

  function renderBookingForm() {
    var svc = B.getService(state.services, $('bkService').value);
    var date = $('bkDate').value;
    var wrap = $('slotWrap');
    $('bkForm').style.display = 'none';
    selSlot = null;
    renderStaffSelect();
    if (!svc) {
      wrap.innerHTML = '<p class="muted">Add a service first (Services tab).</p>';
      renderSvcSummary(null); renderCalendar(); setStep(1); return;
    }
    if (!date) {
      wrap.innerHTML = '<p class="muted">Pick a highlighted day to see available times.</p>';
      renderSvcSummary(svc); renderCalendar(); setStep(1); return;
    }
    if (B.isBlocked(date, blockedDateList())) { wrap.innerHTML = '<div class="warnbox">That date is blocked — please pick another day.</div>'; renderCalendar(); setStep(2); return; }
    var slots = staffSlots(date, svc, selStaff);
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
    var groups = {};
    slots.forEach(function (t) {
      var g = slotGroupLabel(t);
      (groups[g] = groups[g] || []).push(t);
    });
    var html = '<div class="slot-label">Available times — ' + esc(B.fmtDate(date)) + '</div>';
    ['Morning', 'Afternoon', 'Evening'].forEach(function (g) {
      if (!groups[g]) return;
      html += '<div class="slot-group"><span class="slot-group-h">' + g + '</span><div class="slotgrid">';
      groups[g].forEach(function (t) {
        html += '<button data-slot="' + t + '">' + B.fmtTime(t) + '</button>';
      });
      html += '</div></div>';
    });
    wrap.innerHTML = html;
    renderSvcSummary(svc);
    renderCalendar();
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
  $('bkService').addEventListener('change', function () { selStaff = ''; renderSvcCards(); renderBookingForm(); });
  $('bkStaff').addEventListener('change', function () { selStaff = $('bkStaff').value; renderBookingForm(); });
  $('bkDate').addEventListener('change', renderBookingForm);
  if ($('calPrev')) $('calPrev').addEventListener('click', function () { calShift(-1); });
  if ($('calNext')) $('calNext').addEventListener('click', function () { calShift(1); });

  $('bkConfirm').addEventListener('click', function () {
    if (selSlot == null) { alert('Pick a time slot first.'); return; }
    var svc = B.getService(state.services, $('bkService').value);
    var staffId = selStaff || null;
    if (!staffId && B.staffList(state).length && svc) {
      // "First available": match the slot to the earliest free qualified person.
      var elig = B.eligibleStaff(state, svc);
      for (var i = 0; i < elig.length; i++) {
        var sl = B.slotsForStaff($('bkDate').value, svc, elig[i].id, state,
          { today: B.todayStr(), services: state.services });
        if (sl.indexOf(selSlot) !== -1) { staffId = elig[i].id; break; }
      }
      if (!staffId) { alert('That time just filled — please pick another slot.'); renderBookingForm(); return; }
    }
    var r = B.bookSlot(state, {
      serviceId: $('bkService').value,
      date: $('bkDate').value,
      start: selSlot,
      name: $('bkName').value,
      phone: $('bkPhone').value,
      email: $('bkEmail').value,
      notes: $('bkNotes').value,
      staffId: staffId
    });
    if (!r.ok) { $('bkResult').innerHTML = '<div class="warnbox">' + esc(r.error) + '</div>'; return; }
    save();
    var b = r.booking;
    var withWhom = b.staffId ? ' with ' + esc(staffName(b.staffId)) : '';
    $('bkResult').innerHTML = '<div class="notice"><strong>Booked!</strong> ' + esc(b.serviceName) + withWhom +
      ' on ' + esc(B.fmtDate(b.date)) + ' at ' + esc(B.fmtTime(b.start)) +
      '. We\'ll see you then, ' + esc(b.name.split(' ')[0]) + '.' +
      '<br><span class="muted">Your booking ref: <strong>' + esc(b.ref || B.bookingRef(b.id)) + '</strong> — keep it handy.</span></div>';
    $('bkForm').style.display = 'none';
    $('bkName').value = ''; $('bkPhone').value = ''; $('bkEmail').value = ''; $('bkNotes').value = '';
    renderReturning();
    renderSvcCards();
    renderBookingForm(); renderBookings(); renderStats(); renderSvcRevenue();
  });

  // ---------- owner: bookings ----------
  function padStart5(n) { var s = String(n); while (s.length < 5) s = '0' + s; return s; }

  function renderStaffFilter() {
    var sel = $('fltStaff');
    if (!sel) return;
    var cur = sel.value;
    var html = '<option value="">Everyone</option><option value="unassigned">Unassigned</option>';
    B.staffList(state).forEach(function (m) {
      html += '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>';
    });
    sel.innerHTML = html;
    sel.value = cur;
  }

  function renderBookings() {
    renderStaffFilter();
    var f = $('fltStatus').value;
    var today = B.todayStr();
    var list = state.bookings.slice().sort(function (a, b) {
      var ka = a.date + padStart5(a.start), kb = b.date + padStart5(b.start);
      return ka < kb ? -1 : 1;
    });
    if (f === 'upcoming') list = list.filter(function (b) { return b.date >= today && b.status === 'confirmed'; });
    else if (f !== 'all') list = list.filter(function (b) { return b.status === f; });
    var sf = $('fltStaff') ? $('fltStaff').value : '';
    if (sf === 'unassigned') list = list.filter(function (b) { return !b.staffId; });
    else if (sf) list = list.filter(function (b) { return b.staffId === sf; });
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
        var who = b.staffId ? '<br><span class="muted">with ' + esc(staffName(b.staffId)) + '</span>' : '';
        html += '<tr><td>' + esc(B.fmtDate(b.date)) + '<br><span class="muted">' + esc(B.fmtRange(b.start, b.end)) + '</span></td>' +
          '<td>' + esc(b.name) +
          (cs && cs.bookings > 1 ? ' <span class="ret-badge">returning · ' + cs.bookings + '</span>' : '') +
          '<br><span class="muted">' + esc(b.phone) + '</span></td>' +
          '<td>' + esc(b.serviceName) + who + '<br><span class="muted">$' + b.price + '</span></td>' +
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
    var topic = (state.settings.ntfyTopic || '').trim();
    if (due.length) {
      var h = '<div class="warnbox"><strong>' + due.length + ' booking(s) tomorrow need a reminder:</strong><ul style="margin:8px 0 0;padding-left:18px">';
      due.forEach(function (b) {
        var w = b.staffId ? ' with ' + esc(staffName(b.staffId)) : '';
        h += '<li>' + esc(b.name) + ' (' + esc(b.phone) + ') — ' + esc(b.serviceName) + w + ' at ' + esc(B.fmtTime(b.start)) +
          ' <button class="ghost small" data-remind="' + b.id + '">Copy reminder text</button>' +
          (topic ? ' <button class="ghost small" data-push="' + b.id + '">Push</button>' : '') +
          (b.email ? ' <button class="ghost small" data-email="' + b.id + '">Email</button>' : '') + '</li>';
      });
      rb.innerHTML = h + '</ul></div>';
      rb.querySelectorAll('[data-remind]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var bk = findBooking(btn.dataset.remind);
          if (!bk) return;
          copyText(B.reminderMessage(state.bizName || 'us', bk, staffName(bk.staffId)));
          B.markReminded(state, bk.id);
          save(); renderBookings();
        });
      });
      rb.querySelectorAll('[data-push]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var bk = findBooking(btn.dataset.push);
          if (!bk) return;
          pushNtfy('Reminder due: ' + bk.name, B.reminderMessage(state.bizName || 'us', bk, staffName(bk.staffId)), function (ok, msg) {
            if (ok) { B.markReminded(state, bk.id); save(); renderBookings(); }
            else alert('Push failed: ' + msg);
          });
        });
      });
      rb.querySelectorAll('[data-email]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var bk = findBooking(btn.dataset.email);
          if (!bk || !bk.email) return;
          emailReminder(bk);
          B.markReminded(state, bk.id);
          save(); renderBookings();
        });
      });
    } else {
      rb.innerHTML = '<div class="notice">No reminders due — nothing booked for tomorrow, or all reminders sent.</div>';
    }

    renderWaitlist();
  }

  function findBooking(id) {
    for (var i = 0; i < state.bookings.length; i++) if (state.bookings[i].id === id) return state.bookings[i];
    return null;
  }

  function emailReminder(bk) {
    var subject = 'Reminder: ' + bk.serviceName + ' tomorrow at ' + B.fmtTime(bk.start);
    var body = B.reminderMessage(state.bizName || 'us', bk, staffName(bk.staffId));
    location.href = 'mailto:' + encodeURIComponent(bk.email) +
      '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
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

  function copyText(t, msg) {
    var done = msg || 'Reminder copied — paste into SMS/WhatsApp.';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { alert(done); });
    } else {
      prompt('Copy this text:', t);
    }
  }

  // ---------- notifications (free channels) ----------
  function pushNtfy(title, message, cb) {
    var topic = (state.settings.ntfyTopic || '').trim();
    if (!topic) { if (cb) cb(false, 'Set an ntfy.sh topic first.'); return; }
    fetch('https://ntfy.sh/' + encodeURIComponent(topic), {
      method: 'POST',
      body: message,
      headers: { 'Title': title }
    }).then(function (res) {
      if (cb) cb(res.ok, res.ok ? '' : 'ntfy.sh returned HTTP ' + res.status);
    }).catch(function (err) {
      if (cb) cb(false, (err && err.message) || 'network error');
    });
  }

  function renderNotifStatus() {
    var host = $('webNotifStatus');
    if (!host) return;
    if (!('Notification' in window)) {
      host.textContent = 'This browser does not support notifications.';
      return;
    }
    var p = Notification.permission;
    host.textContent = p === 'granted' ? 'Enabled — this device can show booking reminders.' :
      p === 'denied' ? 'Blocked — allow notifications in your browser settings to use this.' :
      'Not enabled yet.';
    $('notifAuto').checked = !!state.settings.notifyAuto;
    $('ntfyTopic').value = state.settings.ntfyTopic || '';
  }

  function webNotify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    try { new Notification(title, { body: body }); return true; }
    catch (e) { return false; }
  }

  function autoNotifyIfDue() {
    if (!state.settings.notifyAuto) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var due = B.dayBeforeList(state, B.todayStr());
    if (due.length) {
      webNotify('BookPilot: ' + due.length + ' reminder(s) due',
        due.slice(0, 3).map(function (b) { return b.name + ' — ' + b.serviceName + ' at ' + B.fmtTime(b.start); }).join('\n') +
        (due.length > 3 ? '\n…and ' + (due.length - 3) + ' more' : ''));
    }
  }

  $('notifEnable').addEventListener('click', function () {
    if (!('Notification' in window)) { alert('This browser does not support notifications.'); return; }
    Notification.requestPermission().then(function () { renderNotifStatus(); });
  });
  $('notifTest').addEventListener('click', function () {
    if (!webNotify('BookPilot test', 'Notifications are working on this device.')) {
      alert('Enable notifications first.');
    }
  });
  $('notifAuto').addEventListener('change', function () {
    state.settings.notifyAuto = $('notifAuto').checked;
    save();
  });
  $('ntfySave').addEventListener('click', function () {
    state.settings.ntfyTopic = $('ntfyTopic').value.trim();
    save();
    $('ntfyStatus').textContent = state.settings.ntfyTopic ? 'Topic saved.' : 'Topic cleared.';
    renderBookings();
  });
  $('ntfyTest').addEventListener('click', function () {
    pushNtfy('BookPilot test', 'Push notifications are working.', function (ok, msg) {
      $('ntfyStatus').textContent = ok ? 'Test push sent — check the ntfy app.' : 'Push failed: ' + msg;
    });
  });
  $('ntfyPushDue').addEventListener('click', function () {
    var due = B.dayBeforeList(state, B.todayStr());
    if (!due.length) { $('ntfyStatus').textContent = 'No reminders due right now.'; return; }
    pushNtfy('BookPilot: ' + due.length + ' reminder(s) due',
      B.ntfyReminderText(state.bizName, due, state), function (ok, msg) {
        if (!ok) { $('ntfyStatus').textContent = 'Push failed: ' + msg; return; }
        due.forEach(function (b) { B.markReminded(state, b.id); });
        save();
        $('ntfyStatus').textContent = 'Pushed ' + due.length + ' reminder(s).';
        renderBookings();
      });
  });

  $('fltStatus').addEventListener('change', renderBookings);
  $('fltStaff').addEventListener('change', renderBookings);
  // ---------- team tab ----------
  function renderStaff() {
    var host = $('staffList');
    if (!host) return;
    var list = B.staffList(state);
    if (!list.length) {
      host.innerHTML = '<p class="muted">No team members yet — bookings work fine without them. Add people here when more than one person takes appointments.</p>';
    } else {
      var html = '<table><tr><th>Name</th><th>Upcoming bookings</th><th></th></tr>';
      var today = B.todayStr();
      list.forEach(function (m) {
        var n = state.bookings.filter(function (b) { return b.staffId === m.id && b.date >= today && b.status === 'confirmed'; }).length;
        html += '<tr><td>' + esc(m.name) + '</td><td>' + n + '</td>' +
          '<td><button class="danger small" data-del-staff="' + esc(m.id) + '">Remove</button></td></tr>';
      });
      host.innerHTML = html + '</table>';
      host.querySelectorAll('[data-del-staff]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var m = B.getStaffMember(state, btn.dataset.delStaff);
          if (!m) return;
          if (!confirm('Remove ' + m.name + '? Their bookings become unassigned (history is kept).')) return;
          B.removeStaffMember(state, m.id);
          save(); renderStaff(); renderStaffMatrix(); renderStaffFilter(); renderSchedule(); renderBookingForm(); renderBookings();
        });
      });
    }
    renderStaffMatrix();
  }

  $('staffAdd').addEventListener('click', function () {
    var r = B.addStaffMember(state, $('staffName').value);
    if (!r.ok) { alert(r.error); return; }
    $('staffName').value = '';
    save(); renderStaff(); renderStaffFilter(); renderSchedule(); renderBookingForm();
  });
  $('staffName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('staffAdd').click(); }
  });

  function renderStaffMatrix() {
    var host = $('staffMatrix');
    if (!host) return;
    var list = B.staffList(state);
    if (!list.length) {
      host.innerHTML = '<p class="muted">Add team members above first — then tick who performs each service here.</p>';
      return;
    }
    if (!state.services.length) {
      host.innerHTML = '<p class="muted">No services yet — add some on the Services tab first.</p>';
      return;
    }
    var html = '<table><tr><th>Service</th>' + list.map(function (m) {
      return '<th>' + esc(m.name) + '</th>';
    }).join('') + '</tr>';
    state.services.forEach(function (s) {
      var ids = s.staffIds || [];
      html += '<tr><td>' + esc(s.name) + '</td>' + list.map(function (m) {
        return '<td><input type="checkbox" data-svc="' + esc(s.id) + '" data-staff="' + esc(m.id) + '"' +
          (ids.indexOf(m.id) !== -1 ? ' checked' : '') + ' aria-label="' + esc(m.name + ' performs ' + s.name) + '"></td>';
      }).join('') + '</tr>';
    });
    host.innerHTML = html + '</table><p class="muted small">Unticked = anyone can take it.</p>';
    host.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var svc = B.getService(state.services, cb.dataset.svc);
        if (!svc) return;
        var ids = svc.staffIds || [];
        if (cb.checked && ids.indexOf(cb.dataset.staff) === -1) ids.push(cb.dataset.staff);
        if (!cb.checked) ids = ids.filter(function (id) { return id !== cb.dataset.staff; });
        B.setServiceStaff(state, svc.id, ids);
        save(); renderBookingForm();
      });
    });
  }

  function renderSchedStaffOptions() {
    var sel = $('schedStaff');
    if (!sel) return;
    var cur = sel.value || 'all';
    var html = '<option value="all">Everyone</option><option value="unassigned">Unassigned</option>';
    B.staffList(state).forEach(function (m) {
      html += '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>';
    });
    sel.innerHTML = html;
    sel.value = cur;
  }

  function renderSchedule() {
    var host = $('schedView');
    if (!host) return;
    var date = $('schedDate').value || B.todayStr();
    var f = $('schedStaff').value || 'all';
    var groups;
    if (f === 'all') {
      groups = B.staffList(state).map(function (m) {
        return { name: m.name, rows: B.staffDaySchedule(state, date, m.id) };
      });
      var un = B.staffDaySchedule(state, date, 'unassigned');
      if (un.length) groups.push({ name: 'Unassigned', rows: un });
      if (!groups.length) groups = [{ name: 'All bookings', rows: B.staffDaySchedule(state, date, null) }];
    } else {
      var label = f === 'unassigned' ? 'Unassigned' : staffName(f);
      groups = [{ name: label, rows: B.staffDaySchedule(state, date, f === 'all' ? null : f) }];
    }
    var anyRows = groups.some(function (g) { return g.rows.length; });
    if (!anyRows) {
      host.innerHTML = '<p class="muted">Nothing booked on ' + esc(B.fmtDate(date)) + '.</p>';
      return;
    }
    host.innerHTML = groups.filter(function (g) { return g.rows.length; }).map(function (g) {
      var rows = g.rows.map(function (b) {
        return '<tr><td>' + esc(B.fmtTime(b.start)) + ' – ' + esc(B.fmtTime(b.end)) + '</td>' +
          '<td>' + esc(b.name) + '<br><span class="muted">' + esc(b.phone) + '</span></td>' +
          '<td>' + esc(b.serviceName) + '</td>' +
          '<td><span class="pill ' + b.status + '">' + b.status + '</span></td></tr>';
      }).join('');
      return '<h3 class="form-title">' + esc(g.name) + '</h3>' +
        '<table><tr><th>Time</th><th>Customer</th><th>Service</th><th>Status</th></tr>' + rows + '</table>';
    }).join('');
  }

  $('schedToday').addEventListener('click', function () {
    $('schedDate').value = B.todayStr();
    renderSchedule();
  });
  $('schedDate').addEventListener('change', renderSchedule);
  $('schedStaff').addEventListener('change', renderSchedule);
  if ($('fltSearch')) {
    $('fltSearch').addEventListener('input', renderBookings);
  }

  // ---------- sync & transfer (multi-device) ----------
  function downloadFile(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  $('syncExport').addEventListener('click', function () {
    downloadFile('bookpilot-backup-' + B.todayStr() + '.json', B.exportStore(state), 'application/json');
  });

  function doImport(text) {
    var host = $('syncImportResult');
    var t = String(text || '').trim();
    if (/^BP1Z:/.test(t)) {
      if (typeof DecompressionStream === 'undefined' || typeof Blob === 'undefined') {
        host.innerHTML = '<div class="warnbox">This transfer is compressed, but this browser cannot decompress it. Use the backup file instead.</div>';
        return;
      }
      var bytes = B.b64uDecode(t.slice(5));
      new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip')))
        .arrayBuffer().then(function (buf) {
          doImport(B.bytesToUtf8(Array.prototype.slice.call(new Uint8Array(buf))));
        }).catch(function () {
          host.innerHTML = '<div class="warnbox">Could not decompress that transfer text.</div>';
        });
      return;
    }
    var r = B.importStore(t);
    if (!r.ok) { host.innerHTML = '<div class="warnbox">' + esc(r.error) + '</div>'; return; }
    var when = r.meta.exportedAt ? ' (exported ' + esc(String(r.meta.exportedAt).slice(0, 10)) + ')' : '';
    host.innerHTML = '<div class="notice">Backup looks good' + when + ': <strong>' + r.meta.bookings + '</strong> bookings, ' +
      r.meta.services + ' services, ' + r.meta.staff + ' team members, ' + r.meta.waitlist + ' waitlist entries.' +
      '<br><button class="btn primary" id="syncConfirm" style="margin-top:10px">Replace my data with this backup</button> ' +
      '<span class="muted small">A backup of your current data downloads first.</span></div>';
    $('syncConfirm').addEventListener('click', function () {
      downloadFile('bookpilot-backup-before-import-' + B.todayStr() + '.json', B.exportStore(state), 'application/json');
      state = r.state;
      selStaff = '';
      save();
      host.innerHTML = '<div class="notice">Import complete.</div>';
      $('syncPaste').value = '';
      boot();
    });
  }

  $('syncFile').addEventListener('change', function () {
    var f = $('syncFile').files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { doImport(rd.result); };
    rd.readAsText(f);
    $('syncFile').value = '';
  });
  $('syncImportPaste').addEventListener('click', function () { doImport($('syncPaste').value); });

  function gzipBytes(bytes) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    try {
      var cs = new CompressionStream('gzip');
      var writer = cs.writable.getWriter();
      writer.write(new Uint8Array(bytes));
      writer.close();
      return new Response(cs.readable).arrayBuffer().then(function (buf) { return new Uint8Array(buf); })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function drawQR(canvas, text) {
    // ECC LOW: qrcodegen auto-boosts the level when it doesn't grow the symbol,
    // so we get the smallest scannable code with the best ECC that fits.
    var qr = QRCodeGen.QrCode.encodeText(text, QRCodeGen.QrCode.Ecc.LOW);
    var scale = Math.max(2, Math.floor(300 / qr.size));
    var border = 2;
    canvas.width = canvas.height = (qr.size + border * 2) * scale;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#14231a';
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
      }
    }
    canvas.style.display = 'block';
  }

  var lastQrPayload = null;
  $('qrShow').addEventListener('click', function () {
    var warn = $('qrWarn'), meta = $('qrMeta'), canvas = $('qrCanvas'), copyBtn = $('qrCopy');
    warn.innerHTML = '';
    copyBtn.style.display = 'none';
    canvas.style.display = 'none';
    lastQrPayload = null;
    if (typeof QRCodeGen === 'undefined') {
      warn.innerHTML = '<div class="warnbox">QR library failed to load.</div>';
      return;
    }
    meta.textContent = 'Preparing…';
    var jsonBytes = B.utf8Bytes(B.exportStore(state));
    gzipBytes(jsonBytes).then(function (zipped) {
      var useZip = !!(zipped && zipped.length < jsonBytes.length);
      var r = B.syncPayload(state, useZip ? Array.prototype.slice.call(zipped) : null);
      if (!r.ok) {
        warn.innerHTML = '<div class="warnbox">' + esc(r.error) + '</div>';
        meta.textContent = '';
        return;
      }
      try { drawQR(canvas, r.payload); }
      catch (e) {
        warn.innerHTML = '<div class="warnbox">QR code too large to render — use the backup file instead.</div>';
        meta.textContent = '';
        return;
      }
      lastQrPayload = r.payload;
      meta.textContent = r.bytes + ' characters (' + (useZip ? 'compressed' : 'plain') + ') — scan it, copy the text, paste it on the other device.';
      copyBtn.style.display = '';
    });
  });
  $('qrCopy').addEventListener('click', function () {
    if (lastQrPayload) copyText(lastQrPayload, 'Transfer text copied — paste it into BookPilot on the other device.');
  });

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
  function syncBizName() {
    var el = $('bookBizName');
    if (el) el.textContent = state.bizName || 'Your business';
  }
  $('bizName').addEventListener('input', function () { state.bizName = $('bizName').value; save(); syncBizName(); });

  $('resetDemo').addEventListener('click', function () {
    if (!confirm('Load demo services, hours, and sample bookings? This replaces current data.')) return;
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* storage blocked: non-fatal */ }
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
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* storage blocked: non-fatal */ }
    state = defaultState();
    save(); boot();
  });

  function boot() {
    $('bizName').value = state.bizName || '';
    syncBizName();
    renderServices();
    renderHours();
    renderBlocked();
    renderStaff();
    renderSchedStaffOptions();
    if (!$('schedDate').value) $('schedDate').value = B.todayStr();
    renderSchedule();
    renderBookings();
    renderStats();
    renderSvcRevenue();
    renderNotifStatus();
    $('bkDate').min = B.todayStr();
    renderBookingForm();
    autoNotifyIfDue();
  }

  boot();
})();
