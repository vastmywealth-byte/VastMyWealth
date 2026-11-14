/* VastMyWealth Legal: customer PWA. Vanilla JS, no build step.
   Rule: server/AI text is only ever put into the page with textContent (via h()), never innerHTML. */
(() => {
'use strict';
const API = (window.VMW && window.VMW.API) || '';
const $app = document.getElementById('app');

// ---------- safe storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ---------- state ----------
const S = {
  cfg: null,
  lang: store.get('vmw.lang', (navigator.language || '').startsWith('hi') ? 'hi' : 'en'),
  form: { state: store.get('vmw.state', ''), when: '', amount: '', party: '', docs: [], text: '' },
  step: 1,
  timers: [],
};
const t = (k, v) => {
  let s = (I18N[S.lang] && I18N[S.lang][k]) || I18N.en[k] || k;
  if (v) for (const x in v) s = s.replace('{' + x + '}', v[x]);
  return s;
};
const L = o => (o && (o[S.lang] || o.en)) || '';
const inr = n => '₹' + Number(n).toLocaleString('en-IN');

// ---------- dom helper ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const k in (props || {})) {
    const v = props[k];
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'disabled' || k === 'value' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
const rc = (el, ...k) => el.replaceChildren(...k.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false));
const clearTimers = () => { S.timers.forEach(clearInterval); S.timers = []; };

function toast(msg) {
  const el = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(el); setTimeout(() => el.remove(), 3800);
}

// ---------- api ----------
function tokenFor(caseId) { return (store.get('vmw.cases', []).find(c => c.caseId === caseId) || {}).token; }
async function api(path, { method = 'GET', body, token, raw, headers } = {}) {
  const opts = { method, headers: { ...(headers || {}) } };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  if (body !== undefined && !(body instanceof ArrayBuffer) && !(body instanceof Blob)) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  else if (body) opts.body = body;
  let res;
  try { res = await fetch(API + path, opts); } catch { throw new Error(t('err_network')); }
  if (raw) { if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t('err_generic')); return res; }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error || t('err_generic')); e.status = res.status; throw e; }
  return j;
}

// ---------- privacy: same patterns as the server, so the user can see what will be hidden ----------
const PATTERNS = [
  /\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, /\b[A-Z]{5}\d{4}[A-Z]\b/gi, /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, /\b(?:\d[ -]?){12,19}\b/g, /\b\d{9,18}\b/g, /\b[\w.-]{2,}@[a-z]{2,}\b/gi,
];
function maskCount(text) {
  let n = 0;
  for (const re of PATTERNS) text = text.replace(re, () => { n++; return '·'; });
  return n;
}

// ---------- scripts ----------
const loaded = {};
function loadScript(src) {
  return loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(t('err_network'))); document.head.append(s); }));
}

// ---------- chrome ----------
function chrome(content, { back, bar } = {}) {
  clearTimers();
  const top = h('header', { class: 'top' },
    back ? h('button', { class: 'back', 'aria-label': t('back'), onclick: () => (typeof back === 'string' ? (location.hash = back) : history.back()) }, '‹') : null,
    h('div', { class: 'brand' }, h('i', {}, 'V'), h('span', {}, 'VastMyWealth Legal')),
    h('div', { class: 'lang', role: 'group', 'aria-label': 'Language' },
      ['en', 'hi'].map(l => h('button', { 'aria-pressed': String(S.lang === l), onclick: () => { S.lang = l; store.set('vmw.lang', l); document.documentElement.lang = l; route(); } }, l === 'en' ? 'EN' : 'हिं'))));
  rc($app, top, h('div', { class: 'offline hide', id: 'offline' }, t('offline')), h('main', {}, content), bar || '');
  window.scrollTo(0, 0);
  syncOffline();
}
function syncOffline() { const o = document.getElementById('offline'); if (o) o.classList.toggle('hide', navigator.onLine); }
addEventListener('online', syncOffline); addEventListener('offline', syncOffline);

// ---------- config + consent ----------
async function loadConfig() {
  try { S.cfg = await api('/api/config'); store.set('vmw.cfg', S.cfg); }
  catch { S.cfg = store.get('vmw.cfg', null); }
  if (!S.cfg) throw new Error(t('err_network'));
}
const dom = id => S.cfg.domains.find(d => d.id === id);
const subOf = (d, id) => d.subs.find(s => s.id === id);

function consentOk() { const c = store.get('vmw.consent'); return c && c.v === S.cfg.consentVersion; }
function consentScreen(then) {
  let ok = false;
  const btn = h('button', { class: 'btn gold', disabled: true, onclick: () => { store.set('vmw.consent', { v: S.cfg.consentVersion, ts: new Date().toISOString() }); then(); } }, t('consent_btn'));
  const cb = h('input', { type: 'checkbox', id: 'cc', onchange: e => { btn.disabled = !e.target.checked; } });
  chrome(h('div', { class: 'stack' },
    h('div', { class: 'center' }, h('div', { class: 'logo-lg' }, 'V'), h('h1', {}, t('consent_title')), h('p', { class: 'muted' }, t('consent_sub'))),
    h('div', { class: 'card stack' },
      [['⚖️', 'consent_1'], ['🔒', 'consent_2'], ['🗑️', 'consent_3'], ['🤖', 'consent_4']].map(([i, k]) => h('div', { class: 'row', style: 'align-items:flex-start' }, h('span', { style: 'font-size:1.3rem' }, i), h('span', {}, t(k)))),
      h('label', { class: 'check', for: 'cc', style: 'border:0' }, cb, h('span', {}, t('consent_check'))),
      btn)));
}

// ---------- router ----------
async function route() {
  if (!S.cfg) { try { await loadConfig(); } catch (e) { return fatal(e); } }
  const hash = location.hash || '#/';
  const [path, qs] = hash.slice(1).split('?');
  const p = path.split('/').filter(Boolean);
  const q = new URLSearchParams(qs || '');
  if (p[0] === 'resume') return resume(q);
  if (p[0] === 'legal') return legalScreen();
  if (!consentOk()) return consentScreen(route);
  try {
    if (!p.length) return home();
    if (p[0] === 'area') return areaScreen(p[1]);
    if (p[0] === 'describe') return describeScreen(p[1], p[2]);
    if (p[0] === 'results') return resultsScreen(p[1]);
    if (p[0] === 'judgment') return judgmentScreen(p[1], p[2]);
    if (p[0] === 'book') return bookScreen(p[1]);
    if (p[0] === 'consult') return consultScreen(p[1]);
    if (p[0] === 'cases') return casesScreen();
    home();
  } catch (e) { fatal(e); }
}
function fatal(e) {
  chrome(h('div', { class: 'card center stack' }, h('h2', {}, t('err_title')), h('p', { class: 'muted' }, e.message || t('err_generic')), h('button', { class: 'btn', onclick: () => { S.cfg = null; route(); } }, t('retry'))));
}

// ---------- HOME ----------
function home() {
  const q = h('input', { class: 'field', type: 'search', placeholder: t('search_ph'), 'aria-label': t('search_ph'), autocomplete: 'off' });
  const results = h('div', { class: 'stack hide' });
  const grid = h('div', { class: 'grid' }, S.cfg.domains.map(d => h('button', { class: 'tile', onclick: () => (location.hash = d.id === 'general' ? `#/describe/general/describe` : `#/area/${d.id}`) },
    h('div', { class: 'ic', 'aria-hidden': 'true' }, d.icon), h('b', {}, L(d)), h('span', {}, L({ en: d.blurb[0], hi: d.blurb[1] })))));
  q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    results.classList.toggle('hide', !v); grid.classList.toggle('hide', !!v);
    if (!v) return;
    const hits = [];
    for (const d of S.cfg.domains) for (const s of d.subs) if (d.id !== 'general' && (s.en.toLowerCase().includes(v) || s.hi.includes(v))) hits.push([d, s]);
    rc(results, ...(hits.length ? hits.slice(0, 12).map(([d, s]) => h('button', { class: 'item', onclick: () => (location.hash = `#/describe/${d.id}/${s.id}`) }, h('span', {}, d.icon), h('span', {}, L(s), h('small', {}, L(d))), h('span', { class: 'chev' }, '›')))
      : [h('p', { class: 'muted center' }, t('no_match'))]));
  });
  const cases = store.get('vmw.cases', []);
  chrome(h('div', { class: 'stack' },
    h('div', { class: 'card hero stack' },
      h('div', { class: 'eyebrow' }, t('hero_eyebrow')), h('h1', {}, t('hero_title')), h('p', {}, t('hero_sub')),
      h('div', { class: 'row wrap small' }, ['✓ ' + t('hero_b1'), '✓ ' + t('hero_b2', { n: inr(S.cfg.prices.unlock) }), '✓ ' + t('hero_b3')].map(x => h('span', { style: 'opacity:.9' }, x)))),
    h('div', {}, h('label', { class: 'lbl', for: 'sq' }, t('pick_area')), (q.id = 'sq', q)),
    results, grid,
    cases.length ? h('button', { class: 'btn ghost', onclick: () => (location.hash = '#/cases') }, t('my_cases', { n: cases.length })) : null,
    h('p', { class: 'center small muted' }, h('a', { href: '#/legal' }, t('terms_link')))));
}

function areaScreen(id) {
  const d = dom(id); if (!d) return home();
  chrome(h('div', { class: 'stack' },
    h('div', {}, h('div', { class: 'eyebrow' }, t('step_area')), h('h1', {}, d.icon + ' ' + L(d)), h('p', { class: 'muted' }, t('pick_issue'))),
    d.subs.map(s => h('button', { class: 'item', onclick: () => { S.step = 1; location.hash = `#/describe/${d.id}/${s.id}`; } }, h('span', {}, L(s)), h('span', { class: 'chev' }, '›')))), { back: '#/' });
}

// ---------- DESCRIBE (3-step wizard) ----------
function describeScreen(did, sid) {
  const d = dom(did); const s = d && subOf(d, sid); if (!s) return home();
  const F = S.form;
  if (S._sub !== did + '/' + sid) { S._sub = did + '/' + sid; S.step = 1; F.when = ''; F.amount = ''; F.party = ''; F.docs = []; F.text = ''; }
  const back = S.step === 1 ? (did === 'general' ? '#/' : `#/area/${did}`) : null;
  const chips = (list, key, multi) => h('div', { class: 'chips' }, list.map(o => {
    const id = o.id || o;
    const on = multi ? F[key].includes(id) : F[key] === id;
    return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), onclick: e => {
      if (multi) F[key] = on ? F[key].filter(x => x !== id) : [...F[key], id]; else F[key] = on ? '' : id;
      describeScreen(did, sid); } }, L(o) || o);
  }));

  let body;
  if (S.step === 1) {
    const sel = h('select', { class: 'field', id: 'st', 'aria-label': t('f_state'), onchange: e => { F.state = e.target.value; store.set('vmw.state', F.state); } },
      h('option', { value: '' }, t('f_state_ph')), S.cfg.states.map(x => h('option', { value: x.en, selected: F.state === x.en }, L(x))));
    body = h('div', { class: 'stack' },
      h('div', {}, h('label', { class: 'lbl', for: 'st' }, t('f_state')), sel, h('p', { class: 'small muted' }, t('f_state_why'))),
      h('div', {}, h('div', { class: 'lbl' }, t('f_when')), chips(S.cfg.when, 'when')),
      h('div', {}, h('div', { class: 'lbl' }, t('f_amount')), chips(S.cfg.amount, 'amount')));
  } else if (S.step === 2) {
    body = h('div', { class: 'stack' },
      h('div', {}, h('div', { class: 'lbl' }, t('f_party')), chips(S.cfg.party, 'party')),
      h('div', {}, h('div', { class: 'lbl' }, t('f_docs')), chips(d.docs.map(x => ({ id: x.en, en: x.en, hi: x.hi })), 'docs', true)));
  } else {
    const ta = h('textarea', { class: 'field', id: 'tx', maxlength: 1500, placeholder: t('f_text_ph'), 'aria-label': t('f_text') });
    ta.value = F.text;
    const shield = h('div', { class: 'banner info' }, h('span', { class: 'ic' }, '🛡️'), h('div', {}, h('b', {}, t('shield_title')), h('div', { class: 'small' }, t('shield_body'))));
    const count = h('div', { class: 'small muted', 'aria-live': 'polite' });
    const upd = () => { F.text = ta.value; const n = maskCount(ta.value); count.textContent = `${ta.value.length}/1500` + (n ? '  ·  ' + t('shield_found', { n }) : ''); go.disabled = ta.value.trim().length < 15 || !F.state; };
    const go = h('button', { class: 'btn gold', disabled: true, onclick: () => submitCase() }, t('analyze'));
    ta.addEventListener('input', upd);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec = null;
    const mic = SR ? h('button', { class: 'btn ghost sm', type: 'button', onclick: e => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = S.lang === 'hi' ? 'hi-IN' : 'en-IN'; rec.interimResults = false; rec.continuous = true;
      const base = ta.value; let acc = '';
      rec.onresult = ev => { acc = ''; for (const r of ev.results) acc += r[0].transcript + ' '; ta.value = (base + ' ' + acc).trim().slice(0, 1500); upd(); };
      rec.onend = () => { rec = null; e.target.textContent = '🎙️ ' + t('speak'); };
      rec.onerror = () => toast(t('mic_err'));
      e.target.textContent = '⏹ ' + t('stop'); rec.start();
    } }, '🎙️ ' + t('speak')) : null;
    body = h('div', { class: 'stack' }, shield,
      h('div', {}, h('div', { class: 'row between' }, h('label', { class: 'lbl', for: 'tx', style: 'margin:0' }, t('f_text')), mic), ta, count),
      h('div', { class: 'card small muted' }, t('f_tip')),
      S.cfg.turnstileSiteKey ? h('div', { id: 'ts' }) : null, go);
    queueMicrotask(upd);
    if (S.cfg.turnstileSiteKey) loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit').then(() => { try { S._ts = window.turnstile.render('#ts', { sitekey: S.cfg.turnstileSiteKey }); } catch {} }).catch(() => {});
  }
  const nextBtn = S.step < 3 ? h('button', { class: 'btn', disabled: S.step === 1 && !F.state, onclick: () => { S.step++; describeScreen(did, sid); } }, t('next')) : null;
  chrome(h('div', { class: 'stack' },
    h('div', {}, h('div', { class: 'eyebrow' }, `${L(d)} › ${L(s)}`), h('h1', {}, t('step_' + S.step))),
    h('div', { class: 'progress', 'aria-label': `${S.step}/3` }, [1, 2, 3].map(i => h('i', { class: i <= S.step ? 'on' : '' }))),
    body,
    S.step > 1 ? h('button', { class: 'btn ghost', onclick: () => { S.step--; describeScreen(did, sid); } }, t('prev')) : null,
    nextBtn ? h('div', { class: 'bar' }, h('div', { class: 'in' }, nextBtn)) : null), { back });
}

// ---------- SUBMIT / ANALYZING ----------
async function submitCase() {
  const [did, sid] = S._sub.split('/');
  const F = S.form;
  const msgs = ['an_1', 'an_2', 'an_3', 'an_4'];
  let i = 0;
  const msg = h('p', { class: 'pulse', 'aria-live': 'polite' }, t(msgs[0]));
  chrome(h('div', { class: 'card center stack', style: 'margin-top:60px' }, h('div', { class: 'spin', style: 'margin:auto;width:40px;height:40px' }), h('h2', {}, t('an_title')), msg, h('p', { class: 'small muted' }, t('an_wait'))));
  const iv = setInterval(() => { i = Math.min(i + 1, msgs.length - 1); msg.textContent = t(msgs[i]); }, 3500);
  try {
    const consent = store.get('vmw.consent');
    const data = await api('/api/triage', { method: 'POST', body: {
      domain: did, sub: sid, state: F.state, lang: S.lang, consent,
      answers: { when: F.when, amount: F.amount, party: F.party, docs: F.docs }, text: F.text,
      cfToken: S._ts !== undefined && window.turnstile ? window.turnstile.getResponse(S._ts) : undefined } });
    clearInterval(iv);
    const cases = store.get('vmw.cases', []).filter(c => c.caseId !== data.caseId);
    cases.unshift({ caseId: data.caseId, token: data.token, domain: did, sub: sid, ts: Date.now() });
    store.set('vmw.cases', cases.slice(0, 20));
    store.set('vmw.case.' + data.caseId, data);
    F.text = ''; S._sub = null;
    location.hash = '#/results/' + data.caseId;
  } catch (e) {
    clearInterval(iv);
    toast(e.message);
    describeScreen(did, sid);
  }
}

// ---------- RESULTS ----------
const unlockedSet = cid => new Set(store.get('vmw.unl.' + cid, []));
function resultsScreen(cid) {
  const data = store.get('vmw.case.' + cid);
  if (!data) { toast(t('case_gone')); location.hash = '#/'; return; }
  const d = dom(data.title.domain), s = subOf(d, data.title.sub);
  const ov = data.overview, g = data.guidance, unl = unlockedSet(cid);
  const checks = new Set(store.get('vmw.docs.' + cid, []));
  const limitBadge = g.limitStatus ? h('span', { class: 'badge ' + (g.limitStatus === 'ok' ? 'ok' : g.limitStatus === 'late' ? 'bad' : 'warn') }, t('lim_' + g.limitStatus)) : null;
  const consults = store.get('vmw.consults', {});
  const existing = Object.keys(consults).filter(k => consults[k] === cid)[0];

  chrome(h('div', { class: 'stack' },
    h('div', {}, h('div', { class: 'eyebrow' }, `${L(d)} › ${L(s)}`), h('h1', {}, t('res_title')), h('p', { class: 'small muted' }, `${t('case_no')} ${cid}` + (data.redactedCount ? ' · ' + t('shield_hidden', { n: data.redactedCount }) : ''))),
    g.alert ? h('div', { class: 'banner bad', role: 'alert' }, h('span', { class: 'ic' }, '🚨'), h('div', {}, g.alert)) : null,
    ov && ov.urgent && ov.urgentNote ? h('div', { class: 'banner warn' }, h('span', { class: 'ic' }, '⏱️'), h('div', {}, ov.urgentNote)) : null,
    data.suggestedDomain && dom(data.suggestedDomain) ? h('div', { class: 'banner info' }, h('span', { class: 'ic' }, '💡'), h('div', {}, t('suggest_dom', { d: L(dom(data.suggestedDomain)) }))) : null,

    ov ? h('div', { class: 'card stack' },
      h('h2', {}, t('res_overview')), h('p', {}, ov.summary),
      ov.points.length ? h('div', {}, h('h3', {}, t('res_matters')), h('ul', { class: 'pts' }, ov.points.map(x => h('li', {}, x)))) : null,
      ov.laws.length ? h('div', {}, h('h3', {}, t('res_laws')), h('ul', { class: 'pts' }, ov.laws.map(l => h('li', {}, h('b', {}, l.name), ' — ', l.why)))) : null)
      : h('div', { class: 'banner warn' }, h('span', { class: 'ic' }, 'ℹ️'), h('div', {}, t('no_ai'))),

    h('div', { class: 'card stack' },
      h('h2', {}, t('res_where')),
      h('div', {}, h('div', { class: 'eyebrow' }, t('res_forum')), h('p', { class: 'pre', style: 'margin:0' }, g.forum)),
      h('div', {}, h('div', { class: 'row between' }, h('div', { class: 'eyebrow' }, t('res_limit')), limitBadge), h('p', { style: 'margin:0' }, g.limit)),
      h('p', { class: 'small muted', style: 'margin:0' }, '📚 ' + g.law)),

    ov && ov.nextSteps.length ? h('div', { class: 'card' }, h('h2', {}, t('res_steps')), h('ol', { class: 'steps' }, ov.nextSteps.map(x => h('li', {}, x)))) : null,

    h('div', { class: 'card' }, h('h2', {}, t('res_docs')), h('p', { class: 'small muted' }, t('res_docs_sub')),
      g.docs.map((x, i) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: checks.has(i), onchange: e => { e.target.checked ? checks.add(i) : checks.delete(i); store.set('vmw.docs.' + cid, [...checks]); } }), h('span', {}, x)))),

    h('div', { class: 'stack' },
      h('div', {}, h('h2', { style: 'margin-bottom:2px' }, t('res_cases')), h('p', { class: 'small muted' }, t('res_cases_sub', { n: inr(S.cfg.prices.unlock) }))),
      data.results.length ? data.results.map(r => caseCard(cid, r, unl.has(r.tid))) : h('div', { class: 'card muted' }, t('no_cases'))),

    ov && ov.lawyerQuestions.length ? h('div', { class: 'card' }, h('h2', {}, t('res_ask')), h('ul', { class: 'pts' }, ov.lawyerQuestions.map(x => h('li', {}, x)))) : null,
    h('p', { class: 'small muted' }, t('disclaimer')),

    h('div', { class: 'bar' }, h('div', { class: 'in' },
      existing ? h('button', { class: 'btn', onclick: () => (location.hash = '#/consult/' + existing) }, t('open_consult'))
        : h('button', { class: 'btn gold', onclick: () => (location.hash = '#/book/' + cid) }, t('talk_lawyer', { p: inr(S.cfg.prices.consult), m: S.cfg.prices.minutes }))))), { back: '#/' });
}

function caseCard(cid, r, unlocked) {
  return h('div', { class: 'card stack' },
    h('div', { class: 'case-title' }, r.title),
    h('div', { class: 'small muted' }, [r.court, r.year].filter(Boolean).join(' · ')),
    r.snippet ? h('p', { class: 'small clamp', style: 'margin:0' }, r.snippet) : null,
    unlocked ? h('button', { class: 'btn', onclick: () => (location.hash = `#/judgment/${cid}/${r.tid}`) }, '📖 ' + t('read_summary'))
      : h('button', { class: 'btn ghost', onclick: () => unlock(cid, r) }, '🔓 ' + t('unlock', { n: inr(S.cfg.prices.unlock) })));
}

// ---------- PAYMENTS ----------
async function checkout(o) {
  if (S.cfg.demo) {   // local demo server only: no real money
    return new Promise((res, rej) => {
      const ov = h('div', { class: 'overlay' }, h('div', { class: 'sheet stack' },
        h('div', { class: 'banner warn' }, h('span', {}, '🧪'), h('div', {}, 'Demo mode: no real payment')), h('h2', {}, o.desc), h('p', { class: 'price' }, inr(o.amount / 100)),
        h('button', { class: 'btn gold', onclick: async () => { try { const r = await api('/api/demo/pay', { method: 'POST', body: { orderId: o.orderId } }); ov.remove(); res(r); } catch (e) { ov.remove(); rej(e); } } }, 'Pay (simulate UPI success)'),
        h('button', { class: 'btn ghost', onclick: () => { ov.remove(); rej(new Error('cancelled')); } }, t('cancel'))));
      document.body.append(ov);
    });
  }
  await loadScript('https://checkout.razorpay.com/v1/checkout.js');
  return new Promise((res, rej) => {
    const rz = new window.Razorpay({
      key: o.key, amount: o.amount, currency: 'INR', name: 'VastMyWealth Legal', description: o.desc, order_id: o.orderId,
      prefill: { email: o.email || '' }, theme: { color: '#0f2747' },
      config: { display: { blocks: { upi: { name: 'Pay with UPI', instruments: [{ method: 'upi' }] } }, sequence: ['block.upi'], preferences: { show_default_blocks: true } } },
      handler: r => res({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
      modal: { ondismiss: () => rej(new Error('cancelled')) },
    });
    rz.open();
  });
}
async function verifyPayment(p) { return api('/api/pay/verify', { method: 'POST', body: p }); }

async function unlock(cid, r) {
  const token = tokenFor(cid);
  try {
    const o = await api('/api/unlock/order', { method: 'POST', token, body: { tid: r.tid } });
    if (!o.already) {
      const pay = await checkout({ ...o, desc: t('unlock_desc') });
      await verifyPayment(pay);
    }
    const u = unlockedSet(cid); u.add(r.tid); store.set('vmw.unl.' + cid, [...u]);
    location.hash = `#/judgment/${cid}/${r.tid}`;
  } catch (e) { if (e.message !== 'cancelled') toast(e.message); }
}

// ---------- JUDGMENT BRIEF ----------
async function judgmentScreen(cid, tid) {
  const data = store.get('vmw.case.' + cid);
  const r = data && data.results.find(x => x.tid === tid);
  if (!r) { location.hash = '#/'; return; }
  const body = h('div', { class: 'stack' }, h('div', { class: 'card' }, h('div', { class: 'skel' }), h('div', { class: 'skel' }), h('div', { class: 'skel', style: 'width:60%' })), h('p', { class: 'center muted pulse' }, t('brief_loading')));
  chrome(h('div', { class: 'stack' }, h('div', { class: 'eyebrow' }, t('brief_eyebrow')), h('h1', { class: 'case-title', style: 'font-size:1.25rem' }, r.title), body), { back: '#/results/' + cid });
  try {
    const { summary: s, sourceUrl } = await api('/api/brief', { method: 'POST', token: tokenFor(cid), body: { tid, lang: S.lang } });
    const sec = (title, items, ordered) => items && items.length ? h('div', { class: 'card' }, h('h2', {}, title), h(ordered ? 'ol' : 'ul', { class: ordered ? 'steps' : 'pts' }, items.map(x => h('li', {}, x)))) : null;
    const outcomeCls = { allowed: 'ok', partly_allowed: 'warn', dismissed: 'bad', remanded: 'warn', other: '' }[s.outcome] || '';
    rc(body, 
      h('div', { class: 'row wrap' }, h('span', { class: 'badge ' + outcomeCls }, t('out_' + s.outcome)), h('span', { class: 'small muted' }, [r.court, r.year].filter(Boolean).join(' · '))),
      h('div', { class: 'card hero stack' }, h('div', { class: 'eyebrow' }, 'TL;DR'), h('p', { style: 'margin:0;font-size:1.05rem' }, s.tldr)),
      sec(t('b_facts'), s.facts), sec(t('b_issues'), s.issues), sec(t('b_reason'), s.reasoning),
      h('div', { class: 'card' }, h('h2', {}, t('b_order')), h('p', { style: 'margin:0' }, s.court_order)),
      s.principle ? h('div', { class: 'card' }, h('h2', {}, t('b_principle')), h('p', { style: 'margin:0' }, s.principle)) : null,
      s.key_quotes && s.key_quotes.length ? h('div', { class: 'card stack' }, h('h2', {}, t('b_quotes')), s.key_quotes.map(q => h('blockquote', {}, '“' + q + '”'))) : null,
      h('div', { class: 'stack' },
        h('button', { class: 'btn ghost', onclick: () => download(tid, cid) }, '⬇️ ' + t('download')),
        h('a', { class: 'btn ghost', href: sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, '↗ ' + t('view_source'))),
      h('div', { class: 'banner info' }, h('span', {}, 'ℹ️'), h('div', { class: 'small' }, t('brief_warn'))),
      h('button', { class: 'btn gold', onclick: () => (location.hash = '#/book/' + cid) }, t('talk_lawyer', { p: inr(S.cfg.prices.consult), m: S.cfg.prices.minutes })));
  } catch (e) {
    rc(body, h('div', { class: 'card stack center' }, h('p', {}, e.message), h('button', { class: 'btn', onclick: () => judgmentScreen(cid, tid) }, t('retry'))));
  }
}
async function download(tid, cid) {
  try {
    const res = await api('/api/pdf/' + tid, { token: tokenFor(cid), raw: true });
    const blob = await res.blob(); const a = h('a', { href: URL.createObjectURL(blob), download: `judgment-${tid}.${blob.type.includes('pdf') ? 'pdf' : 'html'}` });
    document.body.append(a); a.click(); a.remove();
  } catch (e) { toast(e.message); }
}

// ---------- BOOK A LAWYER ----------
async function bookScreen(cid) {
  const data = store.get('vmw.case.' + cid); if (!data) { location.hash = '#/'; return; }
  const P = S.cfg.prices;
  const B = { mode: 'asap', start: '', email: store.get('vmw.email', ''), agree: false, day: 0 };
  let slots = null;
  const root = h('div', { class: 'stack' });
  const render = () => {
    const pay = h('button', { class: 'btn gold', disabled: !(B.agree && /^\S+@\S+\.\S{2,}$/.test(B.email) && (B.mode === 'asap' || B.start)), onclick: submit }, t('pay_btn', { p: inr(P.consult) }));
    rc(root, 
      h('div', {}, h('div', { class: 'eyebrow' }, t('book_eyebrow')), h('h1', {}, t('book_title')), h('p', { class: 'muted' }, t('book_sub', { m: P.minutes }))),
      h('div', { class: 'card stack' }, [['🔒', 'bk_1'], ['🎥', 'bk_2'], ['🧾', 'bk_3'], ['↩️', 'bk_4']].map(([i, k]) => h('div', { class: 'row', style: 'align-items:flex-start' }, h('span', {}, i), h('span', { class: 'small' }, t(k))))),
      h('div', { class: 'card stack' }, h('h2', {}, t('when')),
        h('div', { class: 'chips' },
          h('button', { class: 'chip', 'aria-pressed': String(B.mode === 'asap'), onclick: () => { B.mode = 'asap'; render(); } }, '⚡ ' + t('asap')),
          h('button', { class: 'chip', 'aria-pressed': String(B.mode === 'scheduled'), onclick: async () => { B.mode = 'scheduled'; if (!slots) { try { slots = await api('/api/slots'); } catch (e) { toast(e.message); B.mode = 'asap'; } } render(); } }, '📅 ' + t('pick_time'))),
        B.mode === 'asap' ? h('p', { class: 'small muted', style: 'margin:0' }, t('asap_note')) : slotPicker()),
      h('div', { class: 'card stack' },
        h('div', {}, h('label', { class: 'lbl', for: 'em' }, t('email')), h('input', { class: 'field', id: 'em', type: 'email', inputmode: 'email', autocomplete: 'email', value: B.email, placeholder: 'you@example.com', oninput: e => { B.email = e.target.value.trim(); store.set('vmw.email', B.email); pay.disabled = !ok(); } }), h('p', { class: 'small muted' }, t('email_why'))),
        h('table', { class: 'bill' }, h('tbody', {},
          h('tr', {}, h('td', {}, t('bill_lawyer')), h('td', {}, inr(P.lawyer))), h('tr', {}, h('td', {}, t('bill_fee')), h('td', {}, inr(P.fee))), h('tr', { class: 'total' }, h('td', {}, t('bill_total')), h('td', {}, inr(P.consult)))))),
      h('label', { class: 'check', style: 'border:0' }, h('input', { type: 'checkbox', checked: B.agree, onchange: e => { B.agree = e.target.checked; pay.disabled = !ok(); } }), h('span', { class: 'small' }, t('book_agree'))),
      pay, h('p', { class: 'small muted center' }, t('pay_note')));
    function ok() { return B.agree && /^\S+@\S+\.\S{2,}$/.test(B.email) && (B.mode === 'asap' || B.start); }
  };
  const fmtDay = d => new Intl.DateTimeFormat(S.lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(d.date + 'T12:00:00+05:30'));
  const fmtTime = iso => new Intl.DateTimeFormat(S.lang === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(iso));
  function slotPicker() {
    if (!slots) return h('div', { class: 'skel' });
    const day = slots.days[B.day] || slots.days[0];
    return h('div', { class: 'stack' },
      h('div', { class: 'chips' }, slots.days.map((d, i) => h('button', { class: 'chip', 'aria-pressed': String(i === B.day), onclick: () => { B.day = i; B.start = ''; render(); } }, fmtDay(d)))),
      h('div', { class: 'chips' }, day.slots.map(s => h('button', { class: 'chip slot', 'aria-pressed': String(B.start === s), onclick: () => { B.start = s; render(); } }, fmtTime(s)))),
      h('p', { class: 'small muted', style: 'margin:0' }, t('ist_note')));
  }
  async function submit() {
    try {
      const o = await api('/api/consult/order', { method: 'POST', token: tokenFor(cid), body: { mode: B.mode, start: B.start || undefined, email: B.email, consent: true } });
      const pay = await checkout({ ...o, desc: t('consult_desc') });
      const r = await verifyPayment(pay);
      const m = store.get('vmw.consults', {}); m[r.consultId] = cid; store.set('vmw.consults', m);
      location.hash = '#/consult/' + r.consultId;
    } catch (e) { if (e.message !== 'cancelled') toast(e.message); }
  }
  chrome(root, { back: '#/results/' + cid });
  render();
}

// ---------- CONSULTATION STATUS ----------
const fmtWhen = iso => iso ? new Intl.DateTimeFormat(S.lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(iso)) + ' IST' : '';
function consultScreen(id) {
  const cid = store.get('vmw.consults', {})[id];
  if (!cid) { toast(t('case_gone')); location.hash = '#/'; return; }
  const token = tokenFor(cid);
  const root = h('div', { class: 'stack' }, h('div', { class: 'card' }, h('div', { class: 'skel' }), h('div', { class: 'skel' })));
  chrome(root, { back: '#/results/' + cid });
  let last = '';
  const tick = async () => {
    if (location.hash !== '#/consult/' + id) return;
    try {
      const c = await api('/api/consult/' + id, { token });
      const files = c.vaultOpen ? (await api('/api/vault/' + id, { token })).files : [];
      const sig = JSON.stringify([c, files]);
      if (sig !== last) { last = sig; paintConsult(root, id, cid, token, c, files, tick); }
      else updateCountdown();
    } catch (e) { if (e.status === 401 || e.status === 403) { rc(root, h('div', { class: 'card' }, e.message)); } }
  };
  tick();
  S.timers.push(setInterval(tick, 8000));
}
let cdTarget = null;
function updateCountdown() { const el = document.getElementById('cd'); if (!el || !cdTarget) return; const ms = cdTarget - Date.now(); el.textContent = ms <= 0 ? t('cd_now') : t('cd_in', { x: ms > 3600000 * 24 ? Math.floor(ms / 86400000) + 'd ' + Math.floor(ms % 86400000 / 3600000) + 'h' : ms > 3600000 ? Math.floor(ms / 3600000) + 'h ' + Math.floor(ms % 3600000 / 60000) + 'm' : Math.max(1, Math.ceil(ms / 60000)) + ' min' }); }

function paintConsult(root, id, cid, token, c, files, refresh) {
  const st = c.status;
  const steps = [['paid', t('tl_paid')], ['match', t('tl_match')], ['docs', t('tl_docs')], ['call', t('tl_call')], ['done', t('tl_done')]];
  const stage = { Open: 1, Claimed: 3, Completed: 4, Released: 5, Disputed: 5, Refunded: 5 }[st] || 1;
  const tl = h('ul', { class: 'tl' }, steps.map((s, i) => h('li', { class: i < stage ? 'done' : i === stage ? 'now' : '' }, h('span', { class: 'dot' }, i < stage ? '✓' : i + 1), h('span', {}, s[1]))));
  cdTarget = c.slotStart ? Date.parse(c.slotStart) : null;

  let main;
  if (st === 'Open') main = h('div', { class: 'card stack center' }, h('div', { class: 'spin', style: 'margin:auto' }), h('h2', {}, t('c_finding')), h('p', { class: 'muted' }, c.mode === 'asap' ? t('c_finding_asap') : t('c_finding_sched', { w: fmtWhen(c.slotStart) })), h('p', { class: 'small muted' }, t('c_refund_note')));
  else if (st === 'Claimed' || st === 'Completed') {
    main = h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('div', { class: 'logo-lg', style: 'width:52px;height:52px;margin:0;font-size:1.3rem' }, (c.lawyer.name || 'A')[0]), h('div', {}, h('b', {}, 'Adv. ' + c.lawyer.name), h('div', { class: 'small muted' }, '✓ ' + t('verified') + (c.lawyer.council ? ' · ' + c.lawyer.council : '')))),
      h('div', {}, h('div', { class: 'eyebrow' }, t('c_when')), h('b', {}, fmtWhen(c.slotStart)), h('div', { id: 'cd', class: 'small muted' })),
      h('button', { class: 'btn gold', disabled: !c.canJoin, onclick: () => joinCall(id, token) }, '🎥 ' + (c.canJoin ? t('join') : t('join_soon'))),
      h('p', { class: 'small muted', style: 'margin:0' }, t('join_note')));
  } else if (st === 'Released') main = h('div', { class: 'banner ok' }, h('span', {}, '✅'), h('div', {}, t('c_released')));
  else if (st === 'Disputed') main = h('div', { class: 'banner warn' }, h('span', {}, '⏳'), h('div', {}, t('c_disputed')));
  else if (st === 'Refunded') main = h('div', { class: 'banner info' }, h('span', {}, '↩️'), h('div', {}, t('c_refunded')));
  else main = h('div', { class: 'banner info' }, h('div', {}, st));

  const fb = (st === 'Claimed' || st === 'Completed') && c.slotStart && Date.now() > Date.parse(c.slotStart) + 5 * 60000 ? feedbackCard(id, token, refresh) : null;
  rc(root, 
    h('div', {}, h('div', { class: 'eyebrow' }, id), h('h1', {}, t('c_title'))),
    main, fb,
    h('div', { class: 'card' }, tl),
    c.vaultOpen ? vaultCard(id, token, files, refresh) : null);
  updateCountdown();
}

function feedbackCard(id, token, refresh) {
  const reason = h('textarea', { class: 'field hide', style: 'min-height:80px', maxlength: 300, placeholder: t('fb_reason_ph') });
  const send = async ok => { try { await api(`/api/consult/${id}/feedback`, { method: 'POST', token, body: { ok, reason: reason.value } }); toast(t('fb_thanks')); refresh(); } catch (e) { toast(e.message); } };
  return h('div', { class: 'card stack' }, h('h2', {}, t('fb_title')), h('p', { class: 'small muted' }, t('fb_sub')),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => send(true) }, '👍 ' + t('fb_yes')), h('button', { class: 'btn ghost', onclick: () => { reason.classList.remove('hide'); sendNo.classList.remove('hide'); } }, '👎 ' + t('fb_no'))),
    reason, (window.sendNo = h('button', { class: 'btn danger hide', onclick: () => send(false) }, t('fb_report'))));
}

function vaultCard(id, token, files, refresh) {
  let label = 'Other';
  const labels = ['FIR', 'Notice', 'Agreement', 'Receipt', 'Court order', 'ID proof', 'Photos', 'Other'];
  const inp = h('input', { type: 'file', accept: 'application/pdf,image/jpeg,image/png', class: 'hide', onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast(t('v_big')); return; }
    try { await api(`/api/vault/${id}/upload?label=${encodeURIComponent(label)}`, { method: 'POST', token, body: await f.arrayBuffer() }); toast(t('v_ok')); refresh(); } catch (err) { toast(err.message); }
  } });
  const labelChips = h('div', { class: 'chips' }, labels.map(l => h('button', { class: 'chip', 'aria-pressed': String(l === label), onclick: ev => { label = l; labelChips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === ev.target))); } }, l)));
  const exp = iso => { const ms = Date.parse(iso) - Date.now(); return ms <= 0 ? '' : t('v_expires', { x: ms > 3600000 ? Math.floor(ms / 3600000) + 'h' : Math.ceil(ms / 60000) + 'm' }); };
  return h('div', { class: 'card stack' }, h('h2', {}, '🗂️ ' + t('v_title')), h('p', { class: 'small muted', style: 'margin:0' }, t('v_sub')),
    files.map(f => h('div', { class: 'row between' }, h('div', {}, h('b', {}, f.label), h('div', { class: 'small muted' }, `${Math.round(f.size / 1024)} KB · ${exp(f.expiresAt)}`)),
      h('button', { class: 'btn ghost sm', 'aria-label': t('delete'), onclick: async () => { try { await api(`/api/vault/${id}/${f.id}`, { method: 'DELETE', token }); refresh(); } catch (e) { toast(e.message); } } }, '🗑️'))),
    h('div', { class: 'lbl small' }, t('v_type')), labelChips, inp,
    h('button', { class: 'btn ghost', disabled: files.length >= 10, onclick: () => inp.click() }, '📎 ' + t('v_add')));
}

async function joinCall(id, token) {
  try {
    const { url } = await api('/api/room/' + id, { token });
    const src = new URL(url, API || location.origin).href;
    const f = h('div', { class: 'callframe' },
      h('div', { class: 'cbar' }, h('b', {}, '🔒 ' + t('call_private')), h('button', { class: 'btn sm ghost', style: 'color:#fff;border-color:#ffffff66', onclick: () => f.remove() }, t('leave'))),
      h('iframe', { src, allow: 'camera; microphone; fullscreen; display-capture; autoplay', title: 'Video consultation' }));
    document.body.append(f);
  } catch (e) { toast(e.message); }
}

// ---------- resume from email link ----------
function resume(q) {
  const tk = q.get('t'), cid = q.get('c');
  try {
    const payload = JSON.parse(atob(tk.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    const cases = store.get('vmw.cases', []);
    const i = cases.findIndex(c => c.caseId === payload.cid);
    if (i >= 0) cases[i].token = tk; else cases.unshift({ caseId: payload.cid, token: tk, domain: '', sub: '', ts: Date.now() });
    store.set('vmw.cases', cases);
    if (cid) { const m = store.get('vmw.consults', {}); m[cid] = payload.cid; store.set('vmw.consults', m); }
    location.replace(cid ? '#/consult/' + cid : '#/cases');
  } catch { location.replace('#/'); }
}

// ---------- my cases / legal ----------
function casesScreen() {
  const cases = store.get('vmw.cases', []);
  chrome(h('div', { class: 'stack' }, h('h1', {}, t('cases_title')),
    cases.length ? cases.map(c => { const d = dom(c.domain), s = d && subOf(d, c.sub), has = store.get('vmw.case.' + c.caseId);
      return h('button', { class: 'item', onclick: () => { if (has) location.hash = '#/results/' + c.caseId; else { const m = store.get('vmw.consults', {}); const cid = Object.keys(m).find(k => m[k] === c.caseId); location.hash = cid ? '#/consult/' + cid : '#/'; } } },
        h('span', {}, d ? d.icon : '📁'), h('span', {}, s ? L(s) : c.caseId, h('small', {}, `${c.caseId} · ${new Date(c.ts).toLocaleDateString(S.lang === 'hi' ? 'hi-IN' : 'en-IN')}`)), h('span', { class: 'chev' }, '›')); })
      : h('p', { class: 'muted' }, t('cases_none')),
    h('button', { class: 'btn ghost', onclick: () => { if (confirm(t('clear_confirm'))) { Object.keys(localStorage).filter(k => k.startsWith('vmw.') && !['vmw.lang', 'vmw.consent'].includes(k)).forEach(k => localStorage.removeItem(k)); location.hash = '#/'; } } }, '🗑️ ' + t('clear_data'))), { back: '#/' });
}
function legalScreen() {
  chrome(h('div', { class: 'stack' }, h('h1', {}, t('legal_title')),
    ['legal_1', 'legal_2', 'legal_3', 'legal_4', 'legal_5'].map(k => h('div', { class: 'card' }, h('p', { style: 'margin:0' }, t(k)))),
    h('button', { class: 'btn', onclick: () => history.back() }, t('back'))), { back: true });
}

// ---------- boot ----------
document.documentElement.lang = S.lang;
addEventListener('hashchange', route);
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
route();
})();
