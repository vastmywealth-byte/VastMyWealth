/* ============================================================
   admin-org-ranks.js  —  add-on for the admin page (Organisation tab)

   HOW TO INSTALL: save this file next to the admin page and add ONE line just before </body>, after the main <script>:
       <script src="admin-org-ranks.js"></script>
   Nothing else in the admin page needs editing. This file:
     * adds three sections to Organisation: Ranks (rules, close month, report), Discrepancies, Payout awaited
     * replaces the old "commission shares" panel (shares now follow the rank table)
     * changes the team-member form: people join as Partner or Support, rank is earned; optional zone and starting rank
     * adds the "Disbursed amount per lender statement" field to Record commission and shows discrepancy flags
     * shows rank progress on each person in the list and a Deactivate / Reactivate button
   It re-uses the page's own helpers ($, esc, escA, orgCall, orgInr, fmtDate, withBusy, showToast, ORG, orgShow ...).
   ============================================================ */
(function () {
  if (typeof orgShow !== 'function' || !document.getElementById('tabOrg')) return;

  var RK = { rules: [], settings: {}, lastClosed: '', openMonth: '', loaded: false };
  var HELD_OPTS = [['RM', 'Relationship Manager'], ['Area', 'Area Manager'], ['Regional', 'Regional Manager'], ['Zonal', 'Zonal Manager']];
  var SETTINGS = [
    ['Demote After Months', 'Title drops after this many months in a row below target'],
    ['Deactivate After Months', 'Flag for deactivation after this many months with no business'],
    ['Company Floor %', 'Company floor: minimum % of each commission the company keeps (0 = none)'],
    ['Discrepancy Tolerance %', 'Amount mismatch tolerance (%)'],
    ['Discrepancy Tolerance Rs', 'Amount mismatch tolerance (Rs)'],
    ['Payout Rate Min %', 'Expected payout rate: minimum (%)'],
    ['Payout Rate Max %', 'Expected payout rate: maximum (%)'],
    ['Payout Awaited Days', 'Payout awaited: overdue after (days)']
  ];

  function rankTitle(key) { var r = RK.rules.filter(function (x) { return x.key === key; })[0]; return r ? r.title : (key || ''); }
  function canRecruitKey(key) { var r = RK.rules.filter(function (x) { return x.key === key; })[0]; return !!(r && r.canRecruit); }
  function nextMonth(m) { var y = Number(m.slice(0, 4)), mo = Number(m.slice(5)) + 1; if (mo > 12) { mo = 1; y++; } return y + '-' + ('0' + mo).slice(-2); }
  function box(v, l) { return '<div class="stat-box"><b>' + v + '</b><span>' + l + '</span></div>'; }
  // special actions need a reason; it is saved in the Admin Actions Log
  function askReason(msg) {
    var r = prompt(msg + '\n\nReason (required, saved in the Admin Actions Log):', '');
    if (r === null) return null;
    r = r.trim();
    if (!r) { showToast('A reason is required', true); return null; }
    return r;
  }
  function loadRules(cb) {
    orgCall('adminOrgRankRules').then(function (r) {
      if (r && r.success) { RK.rules = r.rules || []; RK.settings = r.settings || {}; RK.lastClosed = r.lastClosed || ''; RK.openMonth = r.openMonth || ''; RK.loaded = true; }
      if (cb) cb(r);
    }).catch(function () { if (cb) cb(null); });
  }

  /* ---------- toolbar buttons and new sections ---------- */
  var tab = $('tabOrg'), tb = tab.querySelector('.toolbar');
  [['orgRank', 'Ranks'], ['orgDisc', 'Discrepancies'], ['orgAwait', 'Payout awaited'], ['orgLog', 'Sign-ups & log']].forEach(function (x) {
    var b = document.createElement('button');
    b.className = 'btn btn-line btn-sm'; b.setAttribute('data-orgsec', x[0]); b.textContent = x[1];
    b.addEventListener('click', function () { orgShow(x[0]); });
    tb.appendChild(b);
  });
  var sec = document.createElement('div');
  sec.innerHTML =
    '<div id="orgRank" class="org-sec hidden">' +
      '<div class="card"><div class="name">Close a month</div>' +
      '<div class="sub" id="rkInfo" style="margin-bottom:8px;"></div>' +
      '<div class="sub" style="margin-bottom:8px;">Run after all lender payouts for the month are recorded. Preview first. Closing books the team overrides, updates ranks and cannot be undone; late receipts and corrections then fall into the next month.</div>' +
      '<div class="field"><label>Month (yyyy-mm)</label><input id="rkMonth"></div>' +
      '<div style="display:flex;gap:8px;"><button class="btn btn-line" id="rkPreview">Preview close</button><button class="btn btn-gold" id="rkClose">Close month</button></div>' +
      '<div id="rkRes" style="margin-top:10px;"></div></div>' +
      '<div class="card"><div class="name">Rank rules</div>' +
      '<div class="sub" style="margin-bottom:8px;">Monthly target is the disbursed amount (own + team) counted in a month. Override % is the share of what is left in the company pool that this rank takes, from the sourcer upwards.</div>' +
      '<div id="rkRules"></div><div class="section-label" style="margin-top:14px;">Timers and checks</div><div id="rkSettings"></div>' +
      '<button class="btn btn-gold" id="rkSave" style="margin-top:10px;">Save rules</button><div id="rkSaveRes" class="sub" style="margin-top:8px;"></div></div>' +
      '<div class="card"><div class="name">Last closed month</div><div id="rkRep" style="margin-top:8px;"><div class="sub">Loading…</div></div></div>' +
    '</div>' +
    '<div id="orgDisc" class="org-sec hidden"><div class="sub" style="margin-bottom:8px;">Payouts where the lender\'s figures do not match our records. Business counts at the lender-confirmed amount once you resolve them.</div><div id="discList"><div class="empty">Loading…</div></div></div>' +
    '<div id="orgAwait" class="org-sec hidden"><div class="sub" style="margin-bottom:8px;">Leads marked disbursed for which no lender payout has been recorded yet, oldest first.</div><div id="awaitList"><div class="empty">Loading…</div></div></div>' +
    '<div id="orgLog" class="org-sec hidden"><div class="section-label">Recent sign-ups</div><div id="logSignups"><div class="empty">Loading…</div></div>' +
    '<div class="section-label" style="margin-top:14px;">Admin actions log</div><div id="logList"><div class="empty">Loading…</div></div></div>';
  while (sec.firstChild) tab.appendChild(sec.firstChild);

  /* ---------- section loading ---------- */
  var _orgShow = orgShow;
  orgShow = function (id) {
    _orgShow(id);
    if (!RK.loaded) loadRules(function () { if (id === 'orgSeats') orgFillSelects(); if (id === 'orgRank') rkInit(); });
    if (id === 'orgRank' && RK.loaded) rkInit();
    if (id === 'orgDisc') discLoad();
    if (id === 'orgAwait') awaitLoad();
    if (id === 'orgLog') logLoad();
  };

  /* ---------- Ranks ---------- */
  function rkInit() {
    $('rkInfo').textContent = 'Last closed: ' + (RK.lastClosed || 'none yet') + '  ·  Receipts now count in: ' + RK.openMonth;
    if (!$('rkMonth').value) $('rkMonth').value = RK.lastClosed ? nextMonth(RK.lastClosed) : RK.openMonth;
    rkRenderRules(); rkLoadReport();
  }
  function rkRenderRules() {
    $('rkRules').innerHTML = RK.rules.map(function (r) {
      var partner = r.key === 'Partner';
      return '<div class="mini-row"><div class="mini-row-top"><span class="lbl">' + esc(r.key) + '</span></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">' +
        '<div class="field" style="margin:0;"><label>Title</label><input data-rk="' + esc(r.key) + '" data-f="title" value="' + escA(r.title) + '"></div>' +
        '<div class="field" style="margin:0;"><label>Monthly target (Rs)</label><input data-rk="' + esc(r.key) + '" data-f="target" inputmode="decimal" value="' + escA(r.target) + '"' + (partner ? ' disabled' : '') + '></div>' +
        '<div class="field" style="margin:0;"><label>Override %</label><input data-rk="' + esc(r.key) + '" data-f="pct" inputmode="decimal" value="' + escA(r.pct) + '"' + (partner ? ' disabled' : '') + '></div>' +
        '<div class="field" style="margin:0;"><label>Can add team members</label><select data-rk="' + esc(r.key) + '" data-f="rec"><option' + (r.canRecruit ? '' : ' selected') + '>No</option><option' + (r.canRecruit ? ' selected' : '') + '>Yes</option></select></div>' +
        '</div></div>';
    }).join('');
    $('rkSettings').innerHTML = SETTINGS.map(function (s, i) {
      return '<div class="field"><label>' + esc(s[1]) + '</label><input data-sname="' + escA(s[0]) + '" inputmode="decimal" value="' + escA(RK.settings[s[0]] === undefined ? '' : RK.settings[s[0]]) + '"></div>';
    }).join('');
  }
  $('rkSave').addEventListener('click', function () {
    var rules = RK.rules.map(function (r) {
      function v(f) { return tab.querySelector('[data-rk="' + r.key + '"][data-f="' + f + '"]').value; }
      return { key: r.key, title: v('title'), target: v('target'), pct: v('pct'), canRecruit: v('rec') === 'Yes' };
    });
    var settings = {};
    tab.querySelectorAll('[data-sname]').forEach(function (i) { if (i.value !== '') settings[i.getAttribute('data-sname')] = i.value; });
    withBusy($('rkSave'), 'Saving…', function () {
      return orgCall('adminOrgRankRules', { save: true, rules: rules, settings: settings }).then(function (r) {
        $('rkSaveRes').innerHTML = r.success ? 'Saved. New targets apply from the next close.' : '<span style="color:var(--bad)">' + esc(r.error || 'Failed') + '</span>';
        if (r.success) { RK.rules = r.rules; RK.settings = r.settings; RK.lastClosed = r.lastClosed; RK.openMonth = r.openMonth; rkInit(); }
      });
    }).catch(function (e) { $('rkSaveRes').textContent = e.message; });
  });
  function rkRenderClose(r) {
    var h = '<div class="sub"><b>' + (r.dryRun ? 'Preview for ' + esc(r.month) + ' (nothing saved)' : 'Closed ' + esc(r.month)) + '</b></div>' +
      '<div class="stats-row" style="margin-top:8px;">' + box(r.records, 'Payouts') + box(orgInr(r.totalBusiness), 'Business counted') + box(orgInr(r.overridesTotal), 'Team overrides') + box(orgInr(r.companyKept), 'Company keeps of pool') +
      box(r.promoted, 'Promoted') + box(r.demoted, 'Demoted') + '</div>';
    if (r.unresolvedDiscrepancies) h += '<div class="error-box" style="text-align:left;">' + r.unresolvedDiscrepancies + ' payout(s) this month still have an unresolved discrepancy. They are counted at the lender-confirmed amount. Resolve them under Discrepancies before closing if the amount is wrong.</div>';
    if ((r.dueDeactivation || []).length) h += '<div class="section-label" style="margin-top:10px;">Due for deactivation</div>' + r.dueDeactivation.map(function (d) {
      return '<div class="mini-row"><div class="mini-row-top"><span class="lbl">' + esc(d.code) + ' ' + esc(d.name) + '</span><button class="btn btn-bad btn-sm" data-rkdeact="' + escA(d.code) + '">Deactivate</button></div><div class="sub">No business for ' + d.months + ' months</div></div>';
    }).join('');
    h += '<div class="section-label" style="margin-top:10px;">People with business or a change</div>' + ((r.seats || []).length ? r.seats.map(function (s) {
      return '<div class="mini-row"><div class="mini-row-top"><span class="lbl">' + esc(s.code) + ' ' + esc(s.name) + '</span><span class="tag">' + orgInr(s.business) + '</span></div>' +
        '<div class="sub">Pay rank ' + esc(s.payRank) + ' · held ' + esc(s.heldRank) + (s.overrides ? ' · overrides ' + orgInr(s.overrides) : '') + (s.action ? ' · <b>' + esc(s.action) + '</b>' : '') + '</div></div>';
    }).join('') : '<div class="sub">None.</div>');
    return h;
  }
  function rkRun(dry, btn) {
    var month = $('rkMonth').value.trim();
    withBusy(btn, dry ? 'Checking…' : 'Closing…', function () {
      return orgCall('adminOrgCloseMonth', { month: month, dryRun: dry }).then(function (r) {
        if (!r.success) { $('rkRes').innerHTML = '<div class="error-box">' + esc(r.error || 'Failed') + '</div>'; return; }
        $('rkRes').innerHTML = rkRenderClose(r);
        if (!dry) { showToast('Month closed'); $('rkMonth').value = ''; loadRules(function () { rkInit(); orgLoadSeats(); }); }
      });
    }).catch(function (e) { $('rkRes').innerHTML = '<div class="error-box">' + esc(e.message) + '</div>'; });
  }
  $('rkPreview').addEventListener('click', function () { rkRun(true, $('rkPreview')); });
  $('rkClose').addEventListener('click', function () {
    if (confirm('Close ' + $('rkMonth').value + '? This books the overrides and updates ranks. It cannot be undone.')) rkRun(false, $('rkClose'));
  });
  $('rkRes').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rkdeact]'); if (!b) return;
    var why = askReason('Deactivate ' + b.getAttribute('data-rkdeact') + '? Access stops now; their team and history stay. This is refused while anything is still payable to them.');
    if (why === null) return;
    withBusy(b, 'Please wait…', function () {
      return orgCall('adminOrgDeactivate', { code: b.getAttribute('data-rkdeact'), reason: why }).then(function (r) { showToast(r.success ? (r.message || 'Done') : (r.error || 'Failed'), !r.success); if (r.success) orgLoadSeats(); });
    }).catch(function (er) { showToast(er.message, true); });
  });
  function rkLoadReport() {
    orgCall('adminOrgRankReport', {}).then(function (r) {
      if (!r.success) { $('rkRep').innerHTML = '<div class="error-box">' + esc(r.error || 'Failed') + '</div>'; return; }
      if (!r.month || !(r.rows || []).length) { $('rkRep').innerHTML = '<div class="sub">No month has been closed yet.</div>'; return; }
      $('rkRep').innerHTML = '<div class="sub">' + esc(r.month) + '</div>' + r.rows.slice(0, 60).map(function (x) {
        return '<div class="mini-row"><div class="mini-row-top"><span class="lbl">' + esc(x['Seat Code']) + ' ' + esc(x['Name']) + '</span><span class="tag">' + orgInr(x['Business']) + '</span></div>' +
          '<div class="sub">Pay ' + esc(x['Pay Rank']) + ' · held ' + esc(x['Held Rank']) + ' · overrides ' + orgInr(x['Overrides Earned']) + (x['Action'] ? ' · ' + esc(x['Action']) : '') + '</div></div>';
      }).join('');
    }).catch(function (e) { $('rkRep').innerHTML = '<div class="error-box">' + esc(e.message) + '</div>'; });
  }

  /* ---------- Discrepancies ---------- */
  function discLoad() {
    $('discList').innerHTML = '<div class="empty">Loading…</div>';
    orgCall('adminOrgDiscrepancies', {}).then(function (r) {
      if (!r.success) { $('discList').innerHTML = '<div class="error-box">' + esc(r.error || 'Failed') + '</div>'; return; }
      var list = r.discrepancies || [];
      if (!list.length) { $('discList').innerHTML = '<div class="empty">No open discrepancies.</div>'; return; }
      $('discList').innerHTML = list.map(function (x) {
        return '<div class="card"><div class="card-row" style="cursor:default;"><div><div class="name">' + esc(x.leadId) + ' · ' + esc(x.customer || '') + '</div>' +
          '<div class="sub">' + esc(x.product || '') + ' · ' + esc(x.channel || '') + ' · counted in ' + esc(x.month) + (x.monthStatus === 'Closed' ? ' (closed)' : ' (open)') + '</div>' +
          '<div class="sub">Our system ' + orgInr(x.systemAmount) + ' · lender ' + (x.lenderAmount ? orgInr(x.lenderAmount) : '—') + ' · counted ' + orgInr(x.businessAmount) + ' · commission ' + orgInr(x.commission) + '</div>' +
          '<div class="sub" style="color:var(--warn);">' + esc(x.note) + '</div></div>' +
          '<button class="btn btn-gold btn-sm" data-resolve="' + escA(x.recordId) + '" data-biz="' + escA(x.businessAmount) + '">Resolve</button></div></div>';
      }).join('');
    }).catch(function (e) { $('discList').innerHTML = '<div class="error-box">' + esc(e.message) + '</div>'; });
  }
  $('discList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-resolve]'); if (!b) return;
    var amt = prompt('Business amount (Rs) that should count for this lead. OK keeps the current figure:', b.getAttribute('data-biz'));
    if (amt === null) return;
    var note = prompt('Note (what was agreed with the lender or partner):', '');
    if (note === null) return;
    withBusy(b, 'Saving…', function () {
      return orgCall('adminOrgResolveDiscrepancy', { recordId: b.getAttribute('data-resolve'), businessAmount: amt, note: note }).then(function (r) { showToast(r.success ? 'Resolved' : (r.error || 'Failed'), !r.success); if (r.success) discLoad(); });
    }).catch(function (er) { showToast(er.message, true); });
  });

  /* ---------- Sign-ups and admin actions log ---------- */
  function logLoad() {
    orgCall('adminOrgSignups', {}).then(function (r) {
      var list = (r && r.signups) || [];
      $('logSignups').innerHTML = list.length ? list.slice(0, 50).map(function (x) {
        return '<div class="mini-row"><div class="mini-row-top"><span class="lbl">' + esc(x['Seat Code']) + ' · ' + esc(x['Name']) + '</span><span class="tag">' + esc(x['Zone']) + '</span></div>' +
          '<div class="sub">' + fmtDate(x['Time']) + ' · goal ' + esc(rankTitle(x['Goal']) || x['Goal']) + ' · under ' + esc(x['Placed Under'] || 'HQ') + (x['Referred By'] ? ' · referred by ' + esc(x['Referred By']) : '') + '</div>' +
          (x['Note'] ? '<div class="sub" style="color:var(--warn);">' + esc(x['Note']) + '</div>' : '') + '</div>';
      }).join('') : '<div class="sub">No self sign-ups yet.</div>';
    }).catch(function (e) { $('logSignups').innerHTML = '<div class="error-box">' + esc(e.message) + '</div>'; });
    orgCall('adminOrgActionLog', {}).then(function (r) {
      var list = (r && r.log) || [];
      $('logList').innerHTML = list.length ? list.slice(0, 100).map(function (x) {
        return '<div class="mini-row"><div class="mini-row-top"><span class="lbl">' + esc(x['Action']) + ' · ' + esc(x['Target']) + '</span><span class="tag">' + fmtDate(x['Time']) + '</span></div>' +
          '<div class="sub">' + esc(x['Detail']) + '</div>' + (x['Reason'] ? '<div class="sub"><b>Reason:</b> ' + esc(x['Reason']) + '</div>' : '') + '</div>';
      }).join('') : '<div class="sub">No special actions yet.</div>';
    }).catch(function (e) { $('logList').innerHTML = '<div class="error-box">' + esc(e.message) + '</div>'; });
  }

  /* ---------- Payout awaited ---------- */
  function awaitLoad() {
    $('awaitList').innerHTML = '<div class="empty">Loading…</div>';
    orgCall('adminOrgPayoutAwaited', {}).then(function (r) {
      if (!r.success) { $('awaitList').innerHTML = '<div class="error-box">' + esc(r.error || 'Failed') + '</div>'; return; }
      var list = r.leads || [];
      if (!list.length) { $('awaitList').innerHTML = '<div class="empty">Every disbursed lead has a payout recorded.</div>'; return; }
      $('awaitList').innerHTML = '<div class="sub" style="margin-bottom:6px;">' + r.total + ' awaiting payout. Overdue after ' + r.overdueDays + ' days.</div>' + list.map(function (x) {
        return '<div class="card"><div class="card-row" style="cursor:default;"><div><div class="name">' + esc(x.leadId) + ' · ' + esc(x.name) + (x.overdue ? ' <span class="tag bad">Overdue</span>' : '') + '</div>' +
          '<div class="sub">' + esc(x.product) + ' · ' + (x.amount ? orgInr(x.amount) : 'amount not saved') + (x.bank ? ' · ' + esc(x.bank) : '') + ' · owner ' + esc(x.owner) + '</div>' +
          '<div class="sub">' + x.ageDays + ' day(s) since disbursal' + (x.since ? ' (' + fmtDate(x.since) + ')' : '') + '</div></div>' +
          '<button class="btn btn-line btn-sm" data-rec="' + escA(x.leadId) + '">Record payout</button></div></div>';
      }).join('');
    }).catch(function (e) { $('awaitList').innerHTML = '<div class="error-box">' + esc(e.message) + '</div>'; });
  }
  $('awaitList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rec]'); if (!b) return;
    $('ocLead').value = b.getAttribute('data-rec');
    orgShow('orgComm'); window.scrollTo(0, 0);
  });

  /* ---------- Commission form: disbursed amount + discrepancy flags ---------- */
  $('ocAmt').closest('.field').insertAdjacentHTML('afterend',
    '<div class="field"><label>Disbursed amount per the lender\'s statement (Rs)</label><input id="ocDisb" inputmode="decimal" placeholder="Leave blank to use the amount saved on the lead"></div>');
  (function () {
    var old = $('ocSave'), nb = old.cloneNode(true);
    old.parentNode.replaceChild(nb, old);
    nb.addEventListener('click', function () {
      withBusy(nb, 'Recording…', function () {
        return orgCall('adminOrgRecordCommission', { leadId: $('ocLead').value.trim(), commission: $('ocAmt').value.trim(), disbursed: $('ocDisb').value.trim(),
          receivedOn: $('ocDate').value.trim(), channel: $('ocChan').value.trim(), note: $('ocNote').value.trim() }).then(function (r) {
          if (!r.success) { $('ocRes').innerHTML = '<span style="color:var(--bad)">' + esc(r.error || 'Failed') + '</span>'; return; }
          var h = esc(r.message) + '<br>Commission ' + orgInr(r.commission) + ' · business counted ' + orgInr(r.businessAmount) + ' · company share ' + r.companySharePct + '% · sourcer share booked ' + orgInr(r.sourcerShare);
          if ((r.discrepancy || []).length) h += '<div class="error-box" style="margin-top:8px;text-align:left;">Discrepancy flagged:<br>' + r.discrepancy.map(esc).join('<br>') + '<br>Check it under Discrepancies.</div>';
          if ((r.notes || []).length) h += '<br><i>' + esc(r.notes.join('; ')) + '</i>';
          $('ocRes').innerHTML = h; $('ocDisb').value = '';
          orgLoadLedger();
        });
      }).catch(function (e) { $('ocRes').textContent = e.message; });
    });
  })();

  /* ---------- Statements: show the warning about an open month ---------- */
  orgStmtRun = function (dry, btn) {
    withBusy(btn, dry ? 'Checking…' : 'Creating…', function () {
      return orgCall('adminOrgBuildStatement', { month: $('osMonth').value.trim(), dryRun: dry }).then(function (r) {
        if (!r.success) { $('osRes').innerHTML = '<div class="error-box">' + esc(r.error || 'Failed') + '</div>'; return; }
        $('osRes').innerHTML = '<div class="sub"><b>' + (r.dryRun ? 'Preview (nothing saved)' : 'Created') + '</b></div>' +
          (r.warning ? '<div class="error-box" style="text-align:left;">' + esc(r.warning) + '</div>' : '') +
          (r.statements || []).map(function (s) { return '<div class="sub">' + esc(s.seat) + ' ' + esc(s.payee) + ' · ' + s.entries + ' entries · base ' + orgInr(s.base) + ' · GST ' + orgInr(s.gst) + ' · TDS ' + orgInr(s.tds) + ' · <b>net ' + orgInr(s.net) + '</b></div>'; }).join('') +
          ((r.carried || []).length ? '<div class="sub" style="margin-top:6px;">Carried forward: ' + r.carried.map(function (c) { return esc(c.seat) + ' (' + esc(c.reason) + ')'; }).join('; ') + '</div>' : '') +
          (!(r.statements || []).length ? '<div class="sub">Nothing to pay this time.</div>' : '');
        if (!dry) orgLoadStmts();
      });
    }).catch(function (e) { $('osRes').innerHTML = '<div class="error-box">' + esc(e.message) + '</div>'; });
  };

  /* ---------- Approvals: moves only; the share panel goes ---------- */
  Array.prototype.slice.call($('orgAppr').children).forEach(function (el) {
    var isMoveLabel = el.classList.contains('section-label') && /Move requests/i.test(el.textContent);
    if (el.id !== 'orgMoves' && !isMoveLabel) el.style.display = 'none';
  });
  orgRenderAppr = function () {
    $('orgMoves').innerHTML = (ORG.moves || []).map(function (m) {
      return '<div class="card"><div class="name">' + esc(m.seat) + ': ' + esc(m.from) + ' → ' + esc(m.to) + '</div><div class="sub">Requested by ' + esc(m.by) + (m.on ? ' · ' + fmtDate(m.on) : '') + (m.note ? ' · ' + esc(m.note) : '') + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:8px;"><button class="btn btn-ok btn-sm" data-omv="' + escA(m.id) + '" data-ok="1">Approve</button><button class="btn btn-bad btn-sm" data-omv="' + escA(m.id) + '" data-ok="0">Decline</button></div></div>';
    }).join('') || '<div class="sub">No pending move requests.</div>';
  };

  /* ---------- Team members list and form ---------- */
  $('orgNewSeat').textContent = '+ New team member';
  orgRenderSeats = function () {
    $('orgSeatList').innerHTML = orgOrdered().map(function (s) {
      var d = orgDepth(s.code), vac = s.status === 'Vacant', inactive = s.status === 'Inactive', isHq = s.code === 'HQ';
      var tag = s.status === 'Active' ? '<span class="tag ok">Active</span>' : vac ? '<span class="tag warn">Vacant</span>' : '<span class="tag bad">' + esc(s.status) + '</span>';
      var rankLine = isHq || s.role === 'Support' ? '' :
        '<div class="sub">Rank ' + esc(s.heldTitle || rankTitle(s.heldRank)) + (s.rankSince ? ' since ' + esc(s.rankSince) : '') + ' · pay rank ' + esc(rankTitle(s.payRank) || '—') +
        ' · last month ' + orgInr(s.lastBusiness) + (s.monthsBelow ? ' · <b>' + s.monthsBelow + ' mo below target</b>' : '') + (s.monthsAtZero ? ' · ' + s.monthsAtZero + ' mo no business' : '') + '</div>';
      return '<div class="card" style="margin-left:' + Math.min(d, 5) * 10 + 'px;"><div class="card-row" style="cursor:default;"><div>' +
        '<div class="name">' + esc(s.code) + ' · ' + esc(isHq ? 'Head office' : (s.role === 'Support' ? 'Support' : (s.heldTitle || s.role))) + (s.territory ? ' · ' + esc(s.territory) : '') + ' ' + tag + (s.locked ? ' <span class="tag bad">Locked</span>' : '') + '</div>' +
        '<div class="sub">' + (vac ? 'No one assigned' : esc(s.name) + ' · ' + esc(s.mobile) + ' · ' + esc(s.email)) + '</div>' +
        '<div class="sub">' + esc(s.zone) + ' · PAN ' + esc(s.pan || 'No') + ' · GST ' + esc(s.gst || 'No') + (s.alias ? ' · ' + esc(s.alias) : '') + '</div>' + rankLine + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">' +
        (!isHq ? '<button class="btn btn-line btn-sm" data-oedit="' + escA(s.code) + '">' + (vac ? 'Assign person' : 'Edit') + '</button>' : '') +
        (!vac && !isHq && !inactive ? '<button class="btn btn-line btn-sm" data-oreset="' + escA(s.code) + '">Reset PIN</button>' : '') +
        (s.locked ? '<button class="btn btn-ok btn-sm" data-ounlock="' + escA(s.code) + '">Unlock</button>' : '') +
        ((s.monthsBelow || s.monthsAtZero) && !isHq && !inactive && s.role !== 'Support' ? '<button class="btn btn-line btn-sm" data-ocounter="' + escA(s.code) + '">Reset counters</button>' : '') +
        (!vac && !isHq && !inactive ? '<button class="btn btn-bad btn-sm" data-odeact="' + escA(s.code) + '">Deactivate</button>' : '') +
        (inactive ? '<button class="btn btn-ok btn-sm" data-orea="' + escA(s.code) + '">Reactivate</button>' : '') +
        '</div></div></div>';
    }).join('') || '<div class="empty">No team members.</div>';
  };
  $('orgSeatList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-orea],[data-odeact],[data-ocounter]'); if (!b) return;
    var action, code, msg;
    if (b.hasAttribute('data-orea')) { action = 'adminOrgReactivate'; code = b.getAttribute('data-orea'); msg = 'Reactivate ' + code + '? They start again as a Partner and get a new PIN by email.'; }
    else if (b.hasAttribute('data-odeact')) { action = 'adminOrgDeactivate'; code = b.getAttribute('data-odeact'); msg = 'Deactivate ' + code + '? Access stops now; their team and history stay. This is refused while anything is still payable to them.'; }
    else { action = 'adminOrgResetCounter'; code = b.getAttribute('data-ocounter'); msg = 'Clear the months-below-target and no-business counters for ' + code + '? Use this for genuine hardship only.'; }
    var why = askReason(msg);
    if (why === null) return;
    withBusy(b, 'Please wait…', function () {
      return orgCall(action, { code: code, reason: why }).then(function (r) { showToast(r.success ? (r.message || 'Done') : (r.error || 'Failed'), !r.success); if (r.success) orgLoadSeats(); });
    }).catch(function (er) { showToast(er.message, true); });
  });

  orgFillSelects = function () {
    var ok = orgOrdered().filter(function (s) { return s.code === 'HQ' || (s.status === 'Active' && s.role !== 'Support' && canRecruitKey(s.heldRank)); });
    var cur = $('orgfParent').value;
    $('orgfParent').innerHTML = ok.map(function (s) { return '<option value="' + escA(s.code) + '">' + esc(s.code + ' — ' + (s.name || 'head office') + ' (' + (s.heldTitle || s.role) + ')') + '</option>'; }).join('');
    if (cur) $('orgfParent').value = cur;
    var sc = $('omScope'), cv = sc.value;
    sc.innerHTML = '<option value="">Whole company</option>' + orgOrdered().filter(function (s) { return s.code !== 'HQ'; }).map(function (s) { return '<option value="' + escA(s.code) + '">' + esc(s.code + ' — ' + (s.name || 'vacant')) + '</option>'; }).join('');
    if (cv) sc.value = cv;
  };

  // form: new Zone and Starting rank fields, relabelled territory
  $('orgfParent').closest('.field').insertAdjacentHTML('afterend',
    '<div class="field"><label>Zone (needed when reporting to head office)</label><select id="orgfZone"><option>West</option><option>North</option><option>East</option><option>South</option></select></div>');
  $('orgfNotes').closest('.field').insertAdjacentHTML('afterend',
    '<div class="field"><label>Starting rank (special placements only; leave on default)</label><select id="orgfHeld"><option value="">Default (Partner / no change)</option>' +
    HELD_OPTS.map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('') + '</select></div>');
  $('orgfTerr').previousElementSibling.textContent = 'Territory / area (optional label)';
  $('orgfHeld').closest('.field').insertAdjacentHTML('afterend', '<div class="field"><label>Reason for the starting rank (required if you choose one)</label><input id="orgfHeldWhy"></div>');

  orgOpenForm = function (code) {
    var s = code ? ORG.seats.filter(function (x) { return x.code === code; })[0] : null;
    $('orgfErr').classList.add('hidden');
    $('orgFormTitle').textContent = s ? (s.status === 'Vacant' ? 'Assign a person to ' + s.code : 'Edit ' + s.code) : 'New team member';
    $('orgfCode').value = s ? s.code : '';
    var sel = $('orgfRole'); sel.innerHTML = '<option>Partner</option><option>Support</option>';
    if (s && s.role !== 'Partner' && s.role !== 'Support') sel.innerHTML += '<option>' + esc(s.role) + '</option>';
    sel.value = s ? s.role : 'Partner'; sel.disabled = !!s;
    if (s) { $('orgfParent').value = s.parent; } else if ($('orgfParent').options.length) { $('orgfParent').selectedIndex = 0; }
    $('orgfParent').disabled = !!s;
    $('orgfZone').value = (s && s.zone && s.zone !== 'All') ? s.zone : 'West'; $('orgfZone').disabled = !!s;
    $('orgfHeld').value = ''; $('orgfHeld').disabled = !!(s && s.role === 'Support'); $('orgfHeldWhy').value = '';
    $('orgfTerr').value = s ? s.territory : ''; $('orgfName').value = s ? s.name : ''; $('orgfMobile').value = s ? s.mobile : ''; $('orgfEmail').value = s ? s.email : '';
    $('orgfPan').value = s && s.pan === 'Yes' ? 'Yes' : 'No'; $('orgfGst').value = s && s.gst === 'Yes' ? 'Yes' : 'No';
    $('orgfAlias').value = s ? s.alias : ''; $('orgfPcode').value = s ? s.partnerCode : ''; $('orgfNotes').value = s ? s.notes : '';
    $('orgForm').classList.remove('hidden'); $('orgForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  (function () {
    var old = $('orgfSave'), nb = old.cloneNode(true);
    old.parentNode.replaceChild(nb, old);
    nb.addEventListener('click', function () {
      var p = { code: $('orgfCode').value.trim(), role: $('orgfRole').value, parent: $('orgfParent').value, zone: $('orgfZone').value, territory: $('orgfTerr').value.trim(), name: $('orgfName').value.trim(),
        seatMobile: $('orgfMobile').value.trim(), email: $('orgfEmail').value.trim(), pan: $('orgfPan').value, gst: $('orgfGst').value, alias: $('orgfAlias').value.trim(),
        partnerCode: $('orgfPcode').value.trim(), notes: $('orgfNotes').value.trim(), heldRank: $('orgfHeld').value, reason: $('orgfHeldWhy').value.trim() };
      if (p.heldRank && !p.reason) { $('orgfErr').textContent = 'Enter the reason for the starting rank.'; $('orgfErr').classList.remove('hidden'); return; }
      withBusy(nb, 'Saving…', function () {
        return orgCall('adminOrgSaveSeat', p).then(function (r) {
          if (!r.success) { $('orgfErr').textContent = r.error || 'Failed'; $('orgfErr').classList.remove('hidden'); return; }
          showToast(r.message || 'Saved'); $('orgForm').classList.add('hidden'); orgLoadSeats();
        });
      }).catch(function (e) { $('orgfErr').textContent = e.message; $('orgfErr').classList.remove('hidden'); });
    });
  })();

  // if the Organisation tab was already open when this file loaded, load the rules now
  if (ORG && ORG.loaded && typeof ADMIN_PASSWORD !== 'undefined' && ADMIN_PASSWORD !== undefined) loadRules(function () { orgFillSelects(); });
})();
