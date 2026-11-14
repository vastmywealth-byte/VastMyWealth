/* VastMyWealth Partner: lawyer PWA. Vanilla JS. Server text goes in via textContent only. */
(() => {
'use strict';
const API = (window.VMW && window.VMW.API) || '';
const $app = document.getElementById('app');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const S = { cfg: null, token: store.get('vmw.l.token', ''), timers: [], seen: new Set() };
const inr = n => '₹' + Number(n).toLocaleString('en-IN');
const ist = iso => iso ? new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(iso)) + ' IST' : 'ASAP';

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const k in (props || {})) {
    const v = props[k]; if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'disabled' || k === 'value') el[k] = v; else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) { if (c === null || c === undefined || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
const toast = m => { const e = h('div', { class: 'toast' }, m); document.body.append(e); setTimeout(() => e.remove(), 3800); };
const rc = (el, ...k) => el.replaceChildren(...k.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false));
const clearTimers = () => { S.timers.forEach(clearInterval); S.timers = []; };

async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (S.token) opts.headers.Authorization = 'Bearer ' + S.token;
  if (form) opts.body = form; else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res; try { res = await fetch(API + path, opts); } catch { throw new Error('No internet connection.'); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { if (res.status === 401 && S.token) { S.token = ''; store.del('vmw.l.token'); } const e = new Error(j.error || 'Something went wrong.'); e.status = res.status; throw e; }
  return j;
}
function chrome(content, { nav } = {}) {
  clearTimers();
  rc($app, 
    h('header', { class: 'top' }, h('div', { class: 'brand' }, h('i', {}, 'P'), h('span', {}, 'VastMyWealth Partner')),
      S.token ? h('button', { class: 'btn sm ghost', style: 'color:#fff;border-color:#ffffff66', onclick: () => { S.token = ''; store.del('vmw.l.token'); location.hash = '#/login'; } }, 'Log out') : null),
    h('main', {}, content), nav || '');
  window.scrollTo(0, 0);
}
const dom = id => S.cfg.domains.find(d => d.id === id);
const subName = (d, s) => { const x = dom(d); const y = x && x.subs.find(z => z.id === s); return (y && y.en) || s; };

async function route() {
  if (!S.cfg) { try { S.cfg = await api('/api/config'); } catch (e) { return chrome(h('div', { class: 'card' }, e.message)); } }
  const p = (location.hash || '#/').slice(2).split('/');
  if (p[0] === 'register') return register();
  if (!S.token) return login();
  if (p[0] === 'calls') return tab('calls');
  if (p[0] === 'money') return tab('money');
  if (p[0] === 'me') return tab('me');
  return tab('leads');
}
addEventListener('hashchange', route);

// ---------- login ----------
function login(stage = 'email', email = '') {
  const em = h('input', { class: 'field', type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'you@example.com', value: email });
  const code = h('input', { class: 'field', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '6-digit code', style: 'letter-spacing:6px;font-size:1.3rem;text-align:center' });
  const send = async () => { try { await api('/api/lawyer/login-request', { method: 'POST', body: { email: em.value } }); toast('If this email is approved, a code was sent.'); login('code', em.value.trim().toLowerCase()); } catch (e) { toast(e.message); } };
  const verify = async () => { try { const r = await api('/api/lawyer/login-verify', { method: 'POST', body: { email, code: code.value } }); S.token = r.token; store.set('vmw.l.token', r.token); location.hash = '#/leads'; route(); } catch (e) { toast(e.message); } };
  chrome(h('div', { class: 'stack', style: 'margin-top:24px' },
    h('div', { class: 'center' }, h('div', { class: 'logo-lg' }, 'P'), h('h1', {}, 'Advocate login'), h('p', { class: 'muted' }, 'For verified advocates only. We email you a one-time code.')),
    h('div', { class: 'card stack' },
      stage === 'email' ? [h('label', { class: 'lbl' }, 'Registered email'), em, h('button', { class: 'btn', onclick: send }, 'Send login code')]
        : [h('p', { class: 'muted', style: 'margin:0' }, 'Code sent to ' + email), code, h('button', { class: 'btn', onclick: verify }, 'Log in'), h('button', { class: 'btn ghost', onclick: () => login('email', email) }, 'Use a different email')]),
    h('a', { class: 'btn ghost', href: '#/register' }, 'New here? Apply to join')));
}

// ---------- registration ----------
function register() {
  const f = {}; const inp = (k, label, props = {}) => h('div', {}, h('label', { class: 'lbl' }, label), (f[k] = h('input', { class: 'field', ...props })));
  const file = (k, label, req) => h('div', {}, h('label', { class: 'lbl' }, label + (req ? ' *' : ' (optional)')), (f[k] = h('input', { class: 'field', type: 'file', accept: 'application/pdf,image/jpeg,image/png' })));
  const areas = new Set(), states = new Set();
  const chipSet = (list, set, label) => h('div', { class: 'chips' }, list.map(([id, text]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: e => { set.has(id) ? set.delete(id) : set.add(id); e.target.setAttribute('aria-pressed', String(set.has(id))); } }, text)));
  const allStates = h('label', { class: 'check', style: 'border:0' }, (f.allStates = h('input', { type: 'checkbox' })), h('span', {}, 'I can take cases from any state (online)'));
  const consent = h('input', { type: 'checkbox' });
  const submit = async () => {
    const fd = new FormData();
    for (const k of ['name', 'email', 'phone', 'barCouncilId', 'stateCouncil', 'enrolYear', 'copNo', 'pan', 'bankAccount', 'ifsc', 'upi', 'languages']) fd.append(k, f[k].value.trim());
    fd.append('practiceAreas', [...areas].join(',')); fd.append('states', f.allStates.checked ? 'ALL' : [...states].join(','));
    for (const k of ['barCert', 'cop', 'panCard', 'photo']) if (f[k].files[0]) fd.append(k, f[k].files[0]);
    if (consent.checked) fd.append('consent', '1');
    try { await api('/api/lawyer/register', { method: 'POST', form: fd }); chrome(h('div', { class: 'card center stack', style: 'margin-top:40px' }, h('h2', {}, '✅ Application received'), h('p', {}, 'We verify every advocate manually (usually within 2 working days) and will email you.'), h('a', { class: 'btn', href: '#/login' }, 'Back to login'))); }
    catch (e) { toast(e.message); }
  };
  chrome(h('div', { class: 'stack' },
    h('div', {}, h('div', { class: 'eyebrow' }, 'Partner onboarding'), h('h1', {}, 'Apply to join as an advocate')),
    h('div', { class: 'banner info' }, h('span', {}, 'ℹ️'), h('div', { class: 'small' }, 'VastMyWealth is a technology platform. You remain an independent advocate. Lawyers are not ranked or advertised. The first eligible advocate to accept a request gets it.')),
    h('div', { class: 'card stack' }, h('h2', {}, 'Your details'), inp('name', 'Full name *'), inp('email', 'Email *', { type: 'email' }), inp('phone', 'Mobile *', { type: 'tel', inputmode: 'tel' }), inp('languages', 'Languages you consult in *', { placeholder: 'English, Hindi' })),
    h('div', { class: 'card stack' }, h('h2', {}, 'Bar registration'), inp('barCouncilId', 'Bar Council enrolment ID *'), inp('stateCouncil', 'State Bar Council *', { placeholder: 'Bar Council of Maharashtra & Goa' }), inp('enrolYear', 'Year of enrolment *', { type: 'number', inputmode: 'numeric' }), inp('copNo', 'Certificate of Practice no. *')),
    h('div', { class: 'card stack' }, h('h2', {}, 'Practice areas *'), chipSet(S.cfg.domains.filter(d => d.id !== 'general').map(d => [d.id, d.icon + ' ' + d.en]), areas)),
    h('div', { class: 'card stack' }, h('h2', {}, 'States you can serve *'), allStates, chipSet(S.cfg.states.map(s => [s.en, s.en]), states)),
    h('div', { class: 'card stack' }, h('h2', {}, 'Payout details'), h('p', { class: 'small muted', style: 'margin:0' }, 'Encrypted at rest. Used only to create your Razorpay payout account.'), inp('pan', 'PAN *', { maxlength: 10, style: 'text-transform:uppercase' }), inp('bankAccount', 'Bank account number'), inp('ifsc', 'IFSC', { style: 'text-transform:uppercase' }), inp('upi', 'or UPI ID')),
    h('div', { class: 'card stack' }, h('h2', {}, 'Documents (PDF / JPG / PNG, max 5 MB)'), file('barCert', 'Bar Council certificate', true), file('cop', 'Certificate of Practice', true), file('panCard', 'PAN card', true), file('photo', 'Photo', false)),
    h('label', { class: 'check', style: 'border:0' }, consent, h('span', { class: 'small' }, 'I confirm the details are true, I hold a valid Certificate of Practice, and I accept the partner terms and the 48-hour document deletion policy.')),
    h('button', { class: 'btn gold', onclick: submit }, 'Submit application'), h('a', { class: 'btn ghost', href: '#/login' }, 'Back to login')));
}

// ---------- tabs ----------
function tab(name) {
  const body = h('div', { class: 'stack' }, h('div', { class: 'card' }, h('div', { class: 'skel' }), h('div', { class: 'skel' })));
  const items = [['leads', '📥', 'Leads'], ['calls', '🎥', 'My calls'], ['money', '💰', 'Earnings'], ['me', '👤', 'Profile']];
  const nav = h('nav', { class: 'bar' }, h('div', { class: 'in' }, items.map(([k, i, l]) => h('a', { class: 'btn sm ' + (k === name ? '' : 'ghost'), style: 'flex:1;flex-direction:column;gap:0;min-height:52px', href: '#/' + k }, h('span', {}, i), h('span', { class: 'small' }, l)))));
  chrome(body, { nav });
  const load = { leads: loadLeads, calls: loadCalls, money: loadMoney, me: loadMe }[name];
  const run = () => load(body).catch(e => { if (e.status === 401 || e.status === 403) { toast(e.message); login(); } });
  run();
  if (name === 'leads' || name === 'calls') S.timers.push(setInterval(run, 15000));
}

async function loadLeads(body) {
  const { leads, payoutReady } = await api('/api/lawyer/leads');
  const fresh = leads.filter(l => !S.seen.has(l.id));
  if (S.seen.size && fresh.length && 'Notification' in window && Notification.permission === 'granted') new Notification('New case', { body: `${fresh[0].state} · ${subName(fresh[0].domain, fresh[0].sub)}` });
  leads.forEach(l => S.seen.add(l.id));
  rc(body, 
    h('div', {}, h('h1', {}, 'Open leads'), h('p', { class: 'muted small' }, 'First to accept gets the case. No client details are shown until you accept.')),
    !payoutReady ? h('div', { class: 'banner warn' }, h('span', {}, '⚠️'), h('div', { class: 'small' }, 'Your payout account is not activated yet, so you cannot accept cases. We will email you once it is ready.')) : null,
    'Notification' in window && Notification.permission === 'default' ? h('button', { class: 'btn ghost sm', onclick: () => Notification.requestPermission().then(() => loadLeads(body)) }, '🔔 Turn on alerts while the app is open') : null,
    leads.length ? leads.map(l => h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('span', { class: 'badge' }, (dom(l.domain) || {}).icon + ' ' + ((dom(l.domain) || {}).en || l.domain)), h('b', { class: 'price' }, inr(l.payout))),
      h('div', { class: 'case-title' }, subName(l.domain, l.sub)),
      h('div', { class: 'small muted' }, `${l.state} · ${l.lang === 'hi' ? 'Hindi' : 'English'} · ${l.mode === 'asap' ? 'Call within ~10 min of accepting' : ist(l.slotStart)}`),
      h('button', { class: 'btn gold', disabled: !payoutReady, onclick: async e => { e.target.disabled = true; try { await api('/api/lawyer/claim/' + l.id, { method: 'POST' }); toast('Case claimed. See My calls.'); location.hash = '#/calls'; } catch (err) { toast(err.message); loadLeads(body); } } }, 'Accept this case')))
      : h('div', { class: 'card center muted' }, 'No open leads for your areas right now. We will email you when one arrives.'));
}

async function loadCalls(body) {
  const { calls } = await api('/api/lawyer/calls');
  const order = { Claimed: 0, Completed: 1, Disputed: 2, Released: 3 };
  calls.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || Date.parse(a.slotStart) - Date.parse(b.slotStart));
  rc(body, h('h1', {}, 'My calls'),
    calls.length ? calls.map(c => h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('span', { class: 'badge ' + ({ Released: 'ok', Disputed: 'bad' }[c.status] || 'warn') }, c.status), h('b', {}, inr(c.payout))),
      h('div', { class: 'case-title' }, subName(c.domain, c.sub)), h('div', { class: 'small muted' }, `${c.state} · ${ist(c.slotStart)} · ${c.id}`),
      ['Claimed', 'Completed'].includes(c.status) ? [
        h('button', { class: 'btn gold', disabled: !c.canJoin, onclick: () => join(c.id) }, c.canJoin ? '🎥 Join call' : 'Join opens 10 min before'),
        h('button', { class: 'btn ghost', onclick: () => docs(c.id) }, '🗂️ Client documents'),
        c.status === 'Claimed' ? h('button', { class: 'btn ghost', onclick: async () => { try { await api(`/api/consult/${c.id}/done`, { method: 'POST' }); toast('Marked complete. Client asked for feedback.'); loadCalls(body); } catch (e) { toast(e.message); } } }, '✔ Mark call complete') : null] : null))
      : h('div', { class: 'card center muted' }, 'You have no calls yet. Accept a lead to get started.'));
}
async function join(id) {
  try {
    const { url } = await api('/api/room/' + id);
    const f = h('div', { class: 'callframe' }, h('div', { class: 'cbar' }, h('b', {}, '🔒 Private consultation'), h('button', { class: 'btn sm ghost', style: 'color:#fff;border-color:#ffffff66', onclick: () => f.remove() }, 'Leave')),
      h('iframe', { src: new URL(url, API || location.origin).href, allow: 'camera; microphone; fullscreen; display-capture; autoplay', title: 'Video consultation' }));
    document.body.append(f);
  } catch (e) { toast(e.message); }
}
async function docs(id) {
  try {
    const { files } = await api('/api/vault/' + id);
    const ov = h('div', { class: 'overlay', onclick: e => { if (e.target === ov) ov.remove(); } }, h('div', { class: 'sheet stack' }, h('h2', {}, 'Client documents'), h('p', { class: 'small muted' }, 'Deleted automatically 48 hours after upload. Do not download to shared devices.'),
      files.length ? files.map(f => h('div', { class: 'row between' }, h('div', {}, h('b', {}, f.label), h('div', { class: 'small muted' }, Math.round(f.size / 1024) + ' KB')),
        h('button', { class: 'btn sm ghost', onclick: async () => { try { const r = await fetch(API + `/api/vault/${id}/${f.id}`, { headers: { Authorization: 'Bearer ' + S.token } }); if (!r.ok) throw new Error('Not available'); const b = await r.blob(); window.open(URL.createObjectURL(b), '_blank'); } catch (e) { toast(e.message); } } }, 'Open')))
        : h('p', { class: 'muted' }, 'No documents uploaded yet.'), h('button', { class: 'btn', onclick: () => ov.remove() }, 'Close')));
    document.body.append(ov);
  } catch (e) { toast(e.message); }
}

async function loadMoney(body) {
  const m = await api('/api/lawyer/payouts');
  const stat = (l, v, cls) => h('div', { class: 'card center' }, h('div', { class: 'small muted' }, l), h('div', { class: 'price serif', style: 'font-size:1.4rem' }, inr(v)), cls ? h('span', { class: 'badge ' + cls }, '') : null);
  rc(body, h('h1', {}, 'Earnings'),
    h('div', { class: 'grid' }, stat('On hold (after call)', m.pending), stat('Released', m.released), stat('In dispute', m.disputed)),
    h('div', { class: 'banner info' }, h('span', {}, 'ℹ️'), h('div', { class: 'small' }, 'Payouts are held until the client confirms the call went well, or automatically 24 hours after the call unless a problem is reported. Money then reaches your account in the next settlement cycle.')),
    h('div', { class: 'card' }, h('h2', {}, 'History'), m.items.length ? m.items.map(i => h('div', { class: 'check' }, h('div', { style: 'flex:1' }, h('b', {}, i.id), h('div', { class: 'small muted' }, ist(i.slotEnd))), h('div', {}, inr(i.payout), h('div', { class: 'small muted' }, i.status)))) : h('p', { class: 'muted' }, 'Nothing yet.')));
}
async function loadMe(body) {
  const p = await api('/api/lawyer/me');
  rc(body, h('h1', {}, 'Profile'), h('div', { class: 'card stack' },
    h('div', {}, h('b', {}, 'Adv. ' + p.name), h('div', { class: 'small muted' }, p.email)), h('div', { class: 'small' }, `${p.council} · ${p.councilId}`),
    h('div', { class: 'small' }, 'Areas: ' + p.areas.map(a => (dom(a) || {}).en || a).join(', ')), h('div', { class: 'small' }, 'States: ' + p.states.join(', ')),
    h('div', {}, p.payoutReady ? h('span', { class: 'badge ok' }, '✓ Payout account active') : h('span', { class: 'badge warn' }, 'Payout account pending')),
    h('label', { class: 'check', style: 'border:0' }, h('input', { type: 'checkbox', checked: p.notifyEmail, onchange: async e => { try { await api('/api/lawyer/notify', { method: 'POST', body: { email: e.target.checked } }); toast('Saved'); } catch (err) { toast(err.message); } } }), h('span', {}, 'Email me new leads in my areas'))));
}

if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
route();
})();
