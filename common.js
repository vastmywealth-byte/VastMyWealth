/* ============================================================
   VastMyWealth — shared helpers (network, toasts, autosuggest,
   uploads, status labels, links). Loaded by every page after config.js
   ============================================================ */
(function (w) {
  'use strict';
  var C = w.VMW_CONFIG || {};
  var VMW = w.VMW = {};

  /* ---------- basics ---------- */
  VMW.$ = function (id) { return document.getElementById(id); };
  VMW.esc = function (s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  VMW.digits = function (s) { return String(s || '').replace(/\D/g, ''); };
  VMW.mobile10 = function (s) { return VMW.digits(s).slice(-10); };
  VMW.inr = function (n) {
    var v = parseFloat(String(n === undefined || n === null ? '' : n).replace(/[^0-9.]/g, ''));
    return isNaN(v) ? '—' : '₹' + v.toLocaleString('en-IN');
  };
  VMW.wireAmount = function (el) {
    if (!el) return;
    el.addEventListener('input', function () {
      var d = el.value.replace(/[^0-9]/g, '');
      el.value = d ? Number(d).toLocaleString('en-IN') : '';
    });
  };
  VMW.wireDigits = function (el, max) {
    if (!el) return;
    el.addEventListener('input', function () { el.value = el.value.replace(/\D/g, '').slice(0, max || 10); });
  };

  VMW.PRODUCTS = { PL: 'Personal Loan', BL: 'Business Loan', HL: 'Home Loan', LAP: 'Loan Against Property', VL: 'Vehicle Loan', EL: 'Education Loan' };
  VMW.productLabel = function (p) { return VMW.PRODUCTS[p] || p || ''; };

  /* ---------- network ---------- */
  function fetchJson(url, opts, tries, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var attempt = 0;
      (function go() {
        attempt++;
        var ctrl = w.AbortController ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
        var o = {}; for (var k in opts) o[k] = opts[k];
        if (ctrl) o.signal = ctrl.signal;
        fetch(url, o).then(function (r) { return r.text(); }).then(function (raw) {
          if (timer) clearTimeout(timer);
          var j;
          try { j = JSON.parse(raw); } catch (e) { throw new Error('The server sent an unexpected reply. Please try again.'); }
          resolve(j);
        }).catch(function (err) {
          if (timer) clearTimeout(timer);
          if (attempt < tries) return setTimeout(go, 700 * attempt);
          reject(err && err.name === 'AbortError' ? new Error('The server is taking too long. Please try again.') : err);
        });
      })();
    });
  }
  VMW.get = function (action, params, o) {
    o = o || {};
    var q = 'action=' + encodeURIComponent(action);
    for (var k in (params || {})) if (params[k] !== undefined && params[k] !== null) q += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    return fetchJson(C.BACKEND_URL + '?' + q, {}, o.tries || 2, o.timeout || 40000);
  };
  VMW.post = function (payload, o) {
    o = o || {};
    return fetchJson(C.BACKEND_URL, { method: 'POST', body: JSON.stringify(payload) }, o.tries || 1, o.timeout || 60000);
  };
  VMW.errMsg = function (e) {
    var m = e && e.message ? e.message : String(e || '');
    if (/failed to fetch|networkerror|load failed|network request/i.test(m)) return 'Could not reach the server. Please check your internet connection and try again.';
    return m || 'Something went wrong. Please try again.';
  };

  /* ---------- feedback ---------- */
  VMW.toast = function (msg, type) {
    var t = VMW.$('vmwToast');
    if (!t) { t = document.createElement('div'); t.id = 'vmwToast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'toast show ' + (type || '');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.className = 'toast'; }, 3400);
  };
  VMW.showMsg = function (el, text, type) {
    if (!el) return;
    el.className = 'alert ' + (type || 'info');
    el.textContent = text;
  };
  VMW.hideMsg = function (el) { if (el) { el.className = 'alert hidden'; el.textContent = ''; } };
  VMW.busy = function (btn, label, fn) {
    var orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner sm"></span> ' + VMW.esc(label);
    var p;
    try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
    return p.then(function (v) { btn.disabled = false; btn.innerHTML = orig; return v; },
                  function (e) { btn.disabled = false; btn.innerHTML = orig; throw e; });
  };
  // Field-level errors: setErr('f_name', 'Enter your name'); clearErrors(container)
  VMW.setErr = function (id, msg) {
    var el = VMW.$(id); if (!el) return;
    var f = el.closest('.field'); if (!f) return;
    f.classList.add('invalid');
    var e = f.querySelector('.err');
    if (!e) { e = document.createElement('div'); e.className = 'err'; f.appendChild(e); }
    e.textContent = msg;
  };
  VMW.clearErrors = function (root) {
    (root || document).querySelectorAll('.field.invalid').forEach(function (f) { f.classList.remove('invalid'); });
  };
  VMW.focusFirstError = function (root) {
    var f = (root || document).querySelector('.field.invalid');
    if (!f) return;
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var i = f.querySelector('input,select,textarea'); if (i) { try { i.focus({ preventScroll: true }); } catch (e) { i.focus(); } }
  };

  /* ---------- instant autosuggest (filters a local list, no network, no delay) ---------- */
  VMW.autosuggest = function (input, getItems, onPick) {
    if (!input) return;
    var box = document.createElement('div');
    box.className = 'suggest';
    input.parentNode.appendChild(box);
    var active = -1, current = [];
    function hide() { box.style.display = 'none'; active = -1; }
    function paint() {
      Array.prototype.forEach.call(box.children, function (c, i) { c.classList.toggle('act', i === active); });
    }
    function render() {
      var q = input.value.trim().toLowerCase();
      if (!q) { hide(); return; }
      var items = getItems() || [], starts = [], contains = [];
      for (var i = 0; i < items.length; i++) {
        var p = String(items[i]).toLowerCase().indexOf(q);
        if (p === 0) { if (starts.length < 8) starts.push(items[i]); }
        else if (p > 0 && contains.length < 8) contains.push(items[i]);
        if (starts.length >= 8) break;
      }
      current = starts.concat(contains).slice(0, 8);
      if (!current.length) {
        box.innerHTML = '<div class="none">No match — you can type it manually.</div>';
      } else {
        box.innerHTML = current.map(function (b, i) { return '<div data-i="' + i + '">' + VMW.esc(b) + '</div>'; }).join('');
      }
      active = -1;
      box.style.display = 'block';
    }
    function pick(i) {
      if (!current[i]) return;
      input.value = current[i];
      hide();
      if (onPick) onPick(current[i]);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('keydown', function (e) {
      if (box.style.display !== 'block') return;
      if (e.key === 'ArrowDown') { active = Math.min(current.length - 1, active + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter' && active >= 0) { pick(active); e.preventDefault(); }
      else if (e.key === 'Escape') hide();
    });
    // mousedown fires before the input loses focus, so the tap always registers
    box.addEventListener('mousedown', function (e) {
      var el = e.target.closest('[data-i]'); if (!el) return;
      e.preventDefault(); pick(parseInt(el.getAttribute('data-i'), 10));
    });
    box.addEventListener('touchstart', function (e) {
      var el = e.target.closest('[data-i]'); if (!el) return;
      e.preventDefault(); pick(parseInt(el.getAttribute('data-i'), 10));
    }, { passive: false });
    document.addEventListener('click', function (e) { if (e.target !== input && !box.contains(e.target)) hide(); });
  };

  /* ---------- State / bank lists: show instantly from the device, refresh quietly ---------- */
  VMW.STATES_FALLBACK = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
    'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand',
    'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
    'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
  VMW.lists = { banks: [], states: VMW.STATES_FALLBACK.slice() };
  var LISTS_KEY = 'vmw_lists_v2';
  function readCache() { try { return JSON.parse(localStorage.getItem(LISTS_KEY) || '{}'); } catch (e) { return {}; } }
  function applyCache() {
    var c = readCache();
    if (c.states && c.states.length) VMW.lists.states = c.states;
    if (c.banks && c.banks.length) VMW.lists.banks = c.banks;
  }
  // need = 'states' (customers) | 'both' (bankers)
  VMW.loadLists = function (need) {
    applyCache();
    return VMW.get(need === 'both' ? 'getBankList' : 'getStates', null, { tries: 2 }).then(function (r) {
      if (r && r.states && r.states.length) VMW.lists.states = r.states;
      if (r && r.banks && r.banks.length) VMW.lists.banks = r.banks;
      try { localStorage.setItem(LISTS_KEY, JSON.stringify({ banks: VMW.lists.banks, states: VMW.lists.states })); } catch (e) { /* storage full — fine */ }
    }).catch(function () { /* keep whatever we already have */ });
  };
  // Returns the official spelling of a state, or '' if it is not in the list
  VMW.canonicalState = function (v) {
    var t = String(v || '').trim().toLowerCase();
    if (!t) return '';
    for (var i = 0; i < VMW.lists.states.length; i++) if (String(VMW.lists.states[i]).toLowerCase() === t) return VMW.lists.states[i];
    return '';
  };

  /* ---------- statuses ---------- */
  var STATUS = {
    'awaiting lender match': ['Matching lenders', ''], 'in process': ['In process', 'info'], 'approved': ['Approved', 'ok'],
    'disbursed': ['Disbursed', 'ok'], 'rejected': ['Rejected', 'bad'], 'not eligible': ['Not eligible', 'bad'],
    'active': ['With you', 'info'], 'policy rejected': ['Policy rejected', 'bad'], 'submitted': ['Submitted', 'ok'],
    'pending': ['Documents pending', 'warn']
  };
  VMW.statusInfo = function (s) {
    var k = String(s || '').trim().toLowerCase();
    return STATUS[k] ? { label: STATUS[k][0], cls: STATUS[k][1] } : { label: s || '—', cls: '' };
  };
  VMW.badge = function (s) { var i = VMW.statusInfo(s); return '<span class="badge ' + i.cls + '">' + VMW.esc(i.label) + '</span>'; };
  VMW.docBadge = function (docStatus) {
    return String(docStatus || '').toLowerCase() === 'submitted'
      ? '<span class="badge ok">Documents received</span>' : '<span class="badge warn">Documents pending</span>';
  };

  /* ---------- links ---------- */
  // Link that opens a lead in the RIGHT live page (never an old/trial page)
  VMW.leadLink = function (o) {
    var base = (o.product === 'VL' || o.product === 'EL') ? C.VL_EL_URL : C.APPLY_URL;
    var q = [];
    if (o.leadId) { q.push('leadId=' + encodeURIComponent(o.leadId)); if (o.product) q.push('product=' + encodeURIComponent(o.product)); }
    else if (o.mobile) q.push('mobile=' + encodeURIComponent(o.mobile));
    if (o.ref) q.push('ref=' + encodeURIComponent(o.ref));
    return base + (q.length ? '?' + q.join('&') : '');
  };
  VMW.startLink = function (mobile, ref) { return VMW.leadLink({ mobile: mobile, ref: ref }); };
  VMW.refLink = function (ref) { return C.APPLY_URL + '?ref=' + encodeURIComponent(ref); };
  VMW.waLink = function (number, text) { return 'https://wa.me/' + VMW.digits(number) + (text ? '?text=' + encodeURIComponent(text) : ''); };
  VMW.copy = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      try {
        var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select(); var ok = document.execCommand('copy'); document.body.removeChild(t);
        ok ? res() : rej(new Error('copy failed'));
      } catch (e) { rej(e); }
    });
  };
  VMW.store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  /* ---------- document uploads (used by apply.html and vl-el-application.html) ---------- */
  var MAX_FILE = 10 * 1024 * 1024;
  VMW.docBox = function (key, label, sub, accept, multiple) {
    return '<div class="upload-box" id="box_' + VMW.esc(key) + '"><div class="upload-icon">📄</div>' +
      '<div class="upload-text"><div class="upload-title">' + VMW.esc(label) + '</div><div class="upload-sub">' + VMW.esc(sub) + '</div></div>' +
      '<span class="upload-cta">Choose file</span>' +
      '<input type="file" accept="' + VMW.esc(accept) + '"' + (multiple ? ' multiple' : '') + ' data-key="' + VMW.esc(key) + '" data-label="' + VMW.esc(label) + '" aria-label="' + VMW.esc(label) + '"></div>';
  };
  function markFilled(box, val) {
    var names = Array.isArray(val) ? val.map(function (f) { return f.name; }).join(', ') : val.name;
    box.classList.add('filled');
    box.querySelector('.upload-sub').textContent = names;
    box.querySelector('.upload-icon').textContent = '✓';
  }
  VMW.wireDocBoxes = function (container, store) {
    store.__labels = store.__labels || {};
    container.querySelectorAll('.upload-box input[type=file]').forEach(function (input) {
      var key = input.getAttribute('data-key');
      store.__labels[key] = input.getAttribute('data-label');
      if (store[key]) markFilled(input.closest('.upload-box'), store[key]);
      input.addEventListener('change', function () {
        var files = Array.prototype.slice.call(input.files || []);
        if (!files.length) return;
        for (var i = 0; i < files.length; i++) {
          if (files[i].size > MAX_FILE) { VMW.toast('"' + files[i].name + '" is larger than 10 MB. Please choose a smaller file.', 'error'); input.value = ''; return; }
        }
        store[key] = files.length > 1 ? files : files[0];
        markFilled(input.closest('.upload-box'), store[key]);
      });
    });
  };
  VMW.collectJobs = function (container, store) {
    var jobs = [];
    container.querySelectorAll('input[type=file]').forEach(function (inp) {
      var k = inp.getAttribute('data-key'), v = store[k];
      if (!v) return;
      var arr = Array.isArray(v) ? v : [v];
      arr.forEach(function (f, i) { jobs.push({ key: arr.length > 1 ? k + '_' + i : k, file: f, label: (store.__labels || {})[k] || k }); });
    });
    return jobs;
  };
  VMW.missingDocs = function (container, store) {
    var out = [];
    container.querySelectorAll('input[type=file]').forEach(function (inp) {
      if (!store[inp.getAttribute('data-key')]) out.push(inp.getAttribute('data-label'));
    });
    return out;
  };
  function fileToB64(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1]); };
      r.onerror = function () { rej(new Error('Could not read "' + file.name + '".')); };
      r.readAsDataURL(file);
    });
  }
  // Uploads one file per request (a weak connection only retries a small upload).
  // Returns the list of files that FAILED — empty list means everything is safely uploaded.
  VMW.uploadAll = async function (jobs, base, action, onProgress) {
    var failed = [];
    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i];
      if (j.file.__uploaded) continue;
      if (onProgress) onProgress(i + 1, jobs.length, j.label);
      var ok = false, lastErr = '';
      for (var attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          var b64 = await fileToB64(j.file);
          var payload = {}; for (var k in base) payload[k] = base[k];
          payload.action = action; payload.fileKey = j.key;
          payload.file = { name: j.label.replace(/[^\w\- ]+/g, '').trim() + ' - ' + j.file.name, mimeType: j.file.type || 'application/octet-stream', base64: b64 };
          var r = await VMW.post(payload, { timeout: 120000 });
          if (r && r.success) { ok = true; j.file.__uploaded = true; } else lastErr = (r && r.error) || 'Upload failed';
        } catch (e) { lastErr = VMW.errMsg(e); }
      }
      if (!ok) failed.push({ label: j.label, error: lastErr });
    }
    return failed;
  };

  /* ---------- announcement popup (shown once per session) ---------- */
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? u : ''; }
  VMW.showAnnouncement = function (audience) {
    VMW.get('getAnnouncement', { audience: audience }, { tries: 1 }).then(function (r) {
      if (!r || !r.success || !r.announcement) return;
      var a = r.announcement, key = 'vmw_ann_' + (a.id || a.title);
      try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) { /* ignore */ }
      var overlay = document.createElement('div'); overlay.className = 'modal';
      var box = document.createElement('div'); box.className = 'modal-box'; overlay.appendChild(box);
      if (safeUrl(a.imageUrl)) { var im = document.createElement('img'); im.src = a.imageUrl; im.alt = ''; box.appendChild(im); }
      var h = document.createElement('h3'); h.textContent = a.title || ''; box.appendChild(h);
      var p = document.createElement('p'); p.textContent = a.body || ''; box.appendChild(p);
      if (a.buttonText && safeUrl(a.buttonUrl)) {
        var l = document.createElement('a'); l.className = 'btn btn-primary btn-block'; l.href = a.buttonUrl; l.target = '_blank'; l.rel = 'noopener'; l.textContent = a.buttonText; box.appendChild(l);
      }
      var d = document.createElement('button'); d.className = 'link-btn'; d.style.marginTop = '12px'; d.textContent = 'Dismiss';
      d.onclick = function () { overlay.remove(); }; box.appendChild(d);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    }).catch(function () { /* announcements are optional */ });
  };

  /* ---------- sheets ---------- */
  VMW.openSheet = function (sheetId, backdropId) { VMW.$(backdropId).style.display = 'block'; VMW.$(sheetId).style.display = 'block'; };
  VMW.closeSheet = function (sheetId, backdropId) { VMW.$(sheetId).style.display = 'none'; VMW.$(backdropId).style.display = 'none'; };

  /* ---------- offline / installable app ---------- */
  if ('serviceWorker' in navigator) {
    w.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () { /* optional */ }); });
  }
})(window);
