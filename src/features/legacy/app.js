import { createIcons, Eye, Upload, X } from 'lucide';

/* SriLead CRM — single-page app; data persisted in PostgreSQL via store.js (/api/state).
 * Implements the "Redesigned Flow":
 * Lead → Dedupe/Validate → Contact/Account → Assignment (call) → Opportunity
 * → Assigned → RFP/Qualify → Quotation → Sales Order (Customer)
 */
'use strict';

/* ════════════════ Constants ════════════════ */
const STORE_KEY = 'srilead.v1';
const SOURCES = ['Web form', 'Ad', 'Call', 'Import', 'Manual'];
const REGIONS = ['North', 'South', 'East', 'West'];
const SLA_MIN = { 'Web form': 30, Ad: 60, Call: 120, Import: 1440, Manual: 240 };
const LEAD_CLOSE_REASONS = ['Not interested', 'Not a fit', 'Junk', 'Wrong number'];
const DISQ_REASONS = { 'No budget': 'DISQUALIFIED', 'No need': 'DISQUALIFIED', 'Wrong fit': 'DISQUALIFIED', 'Chose a competitor': 'LOST', 'No response': 'LOST' };
const LOST_REASONS = ['Price', 'Competitor', 'Requirement changed', 'No budget', 'No response'];
const CALL_OUTCOMES = ['Connected', 'No answer', 'Busy', 'Switched off', 'Wrong number'];
const OPP_STAGES = ['ASSIGNED', 'QUALIFYING', 'QUALIFIED', 'QUOTED', 'WON'];
const STAGE_LABEL = { ASSIGNED: 'Assigned', QUALIFYING: 'RFP / Qualify', QUALIFIED: 'Qualified', QUOTED: 'Quotation', WON: 'Won' };
const MAX_ATTEMPTS = 5;
const GST = 18;

const STATUS_COLOR = {
  NEW: 'var(--info)', VALIDATED: 'var(--accent-2)', REJECTED: 'var(--bad)', DUPLICATE: 'var(--faint)',
  PENDING_REVIEW: 'var(--warn)', CONTACTED: 'var(--info)', INTERESTED: 'var(--accent)', NURTURE: 'var(--warn)',
  CLOSED: 'var(--faint)', CLOSED_UNREACHABLE: 'var(--faint)', CONVERTED: 'var(--ok)',
  ASSIGNED: 'var(--info)', QUALIFYING: 'var(--accent-2)', QUALIFIED: 'var(--accent)', QUOTED: 'var(--warn)',
  WON: 'var(--ok)', LOST: 'var(--bad)', DISQUALIFIED: 'var(--bad)',
  DRAFT: 'var(--faint)', PENDING_APPROVAL: 'var(--warn)', APPROVED: 'var(--accent-2)', SENT: 'var(--info)',
  ACCEPTED: 'var(--ok)', EXPIRED: 'var(--bad)', REVISED: 'var(--faint)',
  CONFIRMED: 'var(--ok)', CANCELLED: 'var(--bad)', PROSPECT: 'var(--info)', CUSTOMER: 'var(--ok)',
};

/* ════════════════ State ════════════════ */
let db;
let ui = { view: 'dashboard', leadFilter: 'ALL', quoteFilter: 'ALL', oppFilter: 'OPEN', oppOrigin: 'ALL', oppSort: 'new', oppQ: '', auditQ: '', drawer: null, seeding: false };

function blank() {
  return {
    me: null,
    settings: { handoff: false, roundRobin: true, companyName: 'SriLead' },
    users: [], leads: [], accounts: [], contacts: [], opps: [], quotes: [], orders: [], tasks: [], audit: [], products: [], notifications: [],
  };
}
/** Persist to PostgreSQL through store.js (debounced PUT /api/state). */
function save() { if (window.SriStore) window.SriStore.save(db); }

/* ════════════════ Utils ════════════════ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const now = () => Date.now();
/* Record numbers (L-1027, OP-1004, QT-2043 …) come from the server in small blocks, so two people
   never create the same id. Internal ids (audit, tasks, notifications…) are unique per browser. */
const ID_POOL = {}, ID_PENDING = {};
const PUBLIC_IDS = ['L', 'OP', 'SO', 'AC', 'U', 'QT'];
let uniq = 0;
async function reserveIds(req) {
  const need = Object.fromEntries(Object.entries(req).filter(([p]) => !ID_PENDING[p]));
  if (!Object.keys(need).length) return;
  Object.keys(need).forEach((p) => { ID_PENDING[p] = true; });
  try {
    const r = await SriStore.api('/api/ids', { method: 'POST', body: need, quiet: true });
    Object.entries(r).forEach(([p, start]) => { const pool = (ID_POOL[p] ||= []); for (let i = 0; i < need[p]; i++) pool.push(start + i); });
  } catch (e) { /* fall back to browser-unique ids below */ } finally { Object.keys(need).forEach((p) => { delete ID_PENDING[p]; }); }
}
const nid = (p) => {
  if (PUBLIC_IDS.includes(p)) {
    const pool = ID_POOL[p];
    if (!pool || pool.length < 10) reserveIds({ [p]: 30 });
    if (pool?.length) return `${p}-${pool.shift()}`;
  }
  uniq = (uniq + 1) % 1296;
  return `${p}-${Date.now().toString(36).toUpperCase()}${uniq.toString(36).toUpperCase().padStart(2, '0')}`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
const inrShort = (n) => { n = n || 0; if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr'; if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1) + ' L'; if (n >= 1e3) return '₹' + (n / 1e3).toFixed(0) + 'K'; return '₹' + n; };
const day = 864e5;
const isoDate = (t) => new Date(t).toISOString().slice(0, 10);
const fmtDate = (t) => t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtTime = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function ago(t) {
  const s = Math.round((now() - t) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago';
}
function dur(ms) {
  const neg = ms < 0; ms = Math.abs(ms); const m = Math.round(ms / 6e4);
  const txt = m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d`;
  return neg ? `${txt} overdue` : `${txt} left`;
}
function addBusinessDays(t, n) { const d = new Date(t); while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6 !== 0) n--; } return d.getTime(); }
function lev(a, b) {
  const m = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) { let p = m[0]; m[0] = i; for (let j = 1; j <= b.length; j++) { const t = m[j]; m[j] = Math.min(m[j] + 1, m[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } }
  return m[b.length];
}
const initials = (n) => (n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const user = (id) => db.users.find((u) => u.id === id);
const me = () => user(db.me);
let session = null; // the signed-in user, from /api/auth/me
const role = () => me()?.role || session?.role || 'rep';
const isAdmin = () => role() === 'admin';
const isMgr = () => role() === 'admin' || role() === 'manager';
const isManagerRole = (u) => !!u && (u.role === 'manager' || u.role === 'admin');
const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', rep: 'Rep' };
const byId = (col, id) => db[col].find((x) => x.id === id);
const pill = (s, label) => `<span class="pill" style="--c:${STATUS_COLOR[s] || 'var(--muted)'}">${esc(label || s.replace(/_/g, ' '))}</span>`;
const av = (uid, sm = true) => { const u = user(uid); return u ? `<span class="avatar ${sm ? 'sm' : ''}" title="${esc(u.name)}" style="background:${u.color}">${initials(u.name)}</span>` : `<span class="avatar ${sm ? 'sm' : ''}" style="background:var(--panel-2);color:var(--faint)" title="Unassigned">?</span>`; };
const uname = (id) => user(id)?.name || 'Unassigned';

/* ════════════════ Audit / notify / tasks ════════════════ */
function audit(entity, id, action, detail = '') {
  db.audit.unshift({ id: nid('A'), ts: now(), actor: db.me, entity, entityId: id, action, detail });
}
function toast(title, msg = '', c = 'var(--accent)') {
  if (ui.seeding) return;
  const el = document.createElement('div');
  el.className = 'toast'; el.style.setProperty('--c', c);
  el.innerHTML = `<div><b>${esc(title)}</b>${esc(msg)}</div>`;
  $('#toasts').appendChild(el);
  while ($('#toasts').children.length > 4) $('#toasts').firstElementChild.remove();
  setTimeout(() => { el.style.transition = '.3s'; el.style.opacity = 0; setTimeout(() => el.remove(), 300); }, 4200);
}
function notify(uid, text, ref) {
  audit('User', uid || '-', 'Notified', `${uname(uid)}: ${text}`);
  if (uid) { db.notifications = db.notifications || []; db.notifications.unshift({ id: nid('N'), to: uid, text, ref: ref || null, ts: now(), read: false }); db.notifications.splice(300); }
  if (uid && uid !== db.me) toast(`Notified ${uname(uid)}`, text, 'var(--info)');
}
function addTask(title, ref, ownerId, due) {
  const t = { id: nid('T'), title, ref, ownerId, due, done: false, createdAt: now() };
  db.tasks.unshift(t); return t;
}
function closeTasks(refId, match) {
  db.tasks.filter((t) => !t.done && t.ref?.id === refId && (!match || t.title.startsWith(match))).forEach((t) => { t.done = true; t.doneAt = now(); });
}

/* ════════════════ Assignment engine ════════════════ */
function workload(uid) {
  return db.leads.filter((l) => l.ownerId === uid && ['VALIDATED', 'CONTACTED', 'INTERESTED'].includes(l.status)).length
    + db.opps.filter((o) => o.ownerId === uid && OPP_STAGES.slice(0, 4).includes(o.stage)).length;
}
function leastLoaded(list) { return [...list].sort((a, b) => workload(a.id) - workload(b.id) || a.name.localeCompare(b.name))[0].id; }
function eligibleReps() { return db.users.filter((u) => u.role === 'rep' && u.active && !u.onLeave); }

/** Runs rules in priority order. kind: 'lead' | 'opp' */
function runRules({ accountId, region, product, kind }) {
  const reps = eligibleReps();
  if (!reps.length) return { owner: null, rule: 'No eligible users' };
  const acc = accountId && byId('accounts', accountId);
  const accOk = acc && acc.ownerId && reps.some((r) => r.id === acc.ownerId);
  if (accOk && (kind === 'opp' || acc.status === 'CUSTOMER')) return { owner: acc.ownerId, rule: 'Existing account owner' };
  if (region) { const m = reps.filter((r) => r.region === region); if (m.length) return { owner: leastLoaded(m), rule: `Territory · ${region}` }; }
  if (kind === 'opp' && product) { const m = reps.filter((r) => (r.products || []).includes(product)); if (m.length) return { owner: leastLoaded(m), rule: `Product · ${product}` }; }
  if (db.settings.roundRobin) return { owner: leastLoaded(reps), rule: 'Round-robin / workload' };
  return { owner: null, rule: 'No rule matched' };
}
function setOwner(rec, entity, to, reason) {
  const from = rec.ownerId || null;
  if (from === to) return;
  rec.ownerId = to;
  rec.history = rec.history || [];
  rec.history.push({ from, to, by: db.me, reason, ts: now() });
  audit(entity, rec.id, to ? 'Owner changed' : 'Moved to unassigned pool', `${uname(from)} → ${uname(to)} · ${reason}`);
}

/* ════════════════ Step 1–2: Intake, validate, dedupe ════════════════ */
function normalize(p) {
  const o = {};
  for (const k of Object.keys(p)) o[k] = typeof p[k] === 'string' ? p[k].trim().replace(/\s+/g, ' ') : p[k];
  let ph = (o.phone || '').replace(/\D/g, '');
  if (ph.length === 12 && ph.startsWith('91')) ph = ph.slice(2);
  if (ph.length === 11 && ph.startsWith('0')) ph = ph.slice(1);
  o.phoneDigits = ph;
  o.phone = ph.length === 10 ? '+91' + ph : (o.phone || '');
  o.email = (o.email || '').toLowerCase();
  return o;
}
function validateFields(o) {
  const e = [];
  if (!o.name) e.push('Name is required');
  if (o.phoneDigits && !/^[6-9]\d{9}$/.test(o.phoneDigits)) e.push('Mobile must be a valid 10-digit number');
  if (o.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(o.email)) e.push('Email format is invalid');
  if (!SOURCES.includes(o.source)) e.push('Source is missing');
  return e;
}
const liveLead = (l) => !['REJECTED', 'DUPLICATE'].includes(l.status);
function findExact(lead) {
  return db.leads.find((l) => l.id !== lead.id && liveLead(l) && ((lead.phone && l.phone === lead.phone) || (lead.email && l.email === lead.email)));
}
function findProbable(lead) {
  if (!lead.company) return null;
  return db.leads.find((l) => {
    if (l.id === lead.id || !liveLead(l)) return false;
    if ((l.name || '').toLowerCase() !== lead.name.toLowerCase()) return false;
    if ((l.company || '').toLowerCase() !== lead.company.toLowerCase()) return false;
    if (!l.email || !lead.email) return true;
    const [la, ld] = l.email.split('@'); const [na, nd] = lead.email.split('@');
    return ld === nd || la === na || lev(l.email, lead.email) <= 3;
  });
}

function rejectLead(lead, reason) {
  lead.status = 'REJECTED'; lead.reason = reason;
  audit('Lead', lead.id, 'Rejected', reason);
  toast('Lead rejected', reason, 'var(--bad)');
  return lead;
}

/** Entry point: raw payload → lead record. Runs steps 1–4. */
function ingest(payload, existing) {
  let lead = existing;
  payload = { ...payload }; delete payload.raw_text;
  const raw = JSON.parse(JSON.stringify(payload));
  if (!lead) {
    lead = { id: nid('L'), status: 'NEW', createdAt: now(), calls: [], activities: [], history: [], attempts: 0 };
    db.leads.unshift(lead);
    audit('Lead', lead.id, 'Created', `Status NEW · source ${payload.source || '—'}`);
  } else {
    lead.status = 'NEW'; lead.reason = '';
    audit('Lead', lead.id, 'Resubmitted', 'Corrected and re-validated');
  }
  lead.raw = raw;
  lead.source = payload.source || 'Manual';
  const hasAny = Object.values(payload).some((v) => String(v ?? '').trim());
  if (!hasAny) return rejectLead(lead, 'Empty payload');
  if (!String(payload.phone || '').trim() && !String(payload.email || '').trim()) {
    Object.assign(lead, { name: payload.name || '(no name)', company: payload.company || '' });
    return rejectLead(lead, 'No phone or email');
  }
  // Step 2 — clean & validate
  const o = normalize(payload);
  Object.assign(lead, { name: o.name, phone: o.phone, email: o.email, company: o.company || '', designation: o.designation || '', region: o.region || '', requirement: o.requirement || '', product: o.product || '' });
  const errs = validateFields(o);
  if (errs.length) return rejectLead(lead, errs.join('; '));

  const dup = findExact(lead);
  if (dup) {
    lead.status = 'DUPLICATE'; lead.dupOf = dup.id;
    dup.activities.push({ ts: now(), text: `Enquired again via ${lead.source}` });
    audit('Lead', lead.id, 'Duplicate', `Exact match with ${dup.id} — activity added there`);
    audit('Lead', dup.id, 'Activity', `Enquired again via ${lead.source}`);
    notify(dup.ownerId, `${dup.name} enquired again via ${lead.source}`);
    toast('Exact duplicate', `Logged on ${dup.id} instead of creating a new record`, 'var(--warn)');
    return lead;
  }
  const prob = findProbable(lead);
  if (prob) {
    lead.status = 'PENDING_REVIEW'; lead.reviewOf = prob.id; lead.reviewType = 'duplicate';
    audit('Lead', lead.id, 'Pending review', `Probable duplicate of ${prob.id}`);
    toast('Needs review', `Probable duplicate of ${prob.name}`, 'var(--warn)');
    return lead;
  }
  return proceedValidated(lead);
}

function proceedValidated(lead) {
  lead.status = 'VALIDATED';
  audit('Lead', lead.id, 'Validated', 'Formats OK, no duplicate found');
  if (!linkContactAccount(lead)) return lead;
  assignLead(lead);
  return lead;
}

/* ════════════════ Step 3: Contact & Account ════════════════ */
function linkContactAccount(lead, forcedAccountId) {
  let acc = null;
  if (lead.company) {
    if (forcedAccountId) acc = byId('accounts', forcedAccountId);
    else {
      const key = lead.company.toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|inc)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
      const matches = db.accounts.filter((a) => a.key === key || (key.length > 3 && (a.key.startsWith(key) || key.startsWith(a.key))));
      const exact = matches.filter((a) => a.key === key);
      if (exact.length === 1) acc = exact[0];
      else if (matches.length > 1 || (matches.length === 1 && !exact.length && matches[0].key !== key)) {
        lead.status = 'PENDING_REVIEW'; lead.reviewType = 'account'; lead.candidates = matches.map((a) => a.id);
        audit('Lead', lead.id, 'Pending review', `Account match ambiguous: ${matches.map((a) => a.name).join(', ')}`);
        toast('Account match needs review', lead.company, 'var(--warn)');
        return false;
      }
      if (!acc) {
        acc = { id: nid('AC'), name: lead.company, key, status: 'PROSPECT', ownerId: null, region: lead.region, createdAt: now() };
        db.accounts.unshift(acc);
        audit('Account', acc.id, 'Created', acc.name);
      } else audit('Account', acc.id, 'Linked', `Lead ${lead.id}`);
    }
  }
  let c = db.contacts.find((x) => (lead.phone && x.phone === lead.phone) || (lead.email && x.email === lead.email));
  if (!c) {
    c = { id: nid('C'), name: lead.name, phone: lead.phone, email: lead.email, designation: lead.designation, accountId: acc?.id || null, createdAt: now() };
    db.contacts.unshift(c);
    audit('Contact', c.id, 'Created', `${c.name}${acc ? ' @ ' + acc.name : ''}`);
  }
  lead.contactId = c.id; lead.accountId = acc?.id || null;
  return true;
}

/* ════════════════ Step 4: Lead assignment & calls ════════════════ */
function assignLead(lead) {
  const r = runRules({ accountId: lead.accountId, region: lead.region, kind: 'lead' });
  setOwner(lead, 'Lead', r.owner, r.rule);
  if (r.owner) {
    const mins = SLA_MIN[lead.source] || 240;
    lead.slaDue = now() + mins * 6e4;
    addTask(`First contact: ${lead.name}`, { type: 'lead', id: lead.id }, r.owner, lead.slaDue);
    notify(r.owner, `New lead ${lead.name} — call within ${mins < 60 ? mins + ' min' : mins / 60 + ' h'}`, { type: 'lead', id: lead.id });
    const acc = lead.accountId && byId('accounts', lead.accountId);
    if (acc && !acc.ownerId) acc.ownerId = r.owner;
  } else {
    lead.slaDue = null;
    toast('Unassigned pool', `${lead.name} is waiting for a manager or a claim`, 'var(--warn)');
  }
}
const hasConnected = (lead) => lead.calls.some((c) => c.outcome === 'Connected');

function slaState(lead) {
  if (!lead.slaDue || !['VALIDATED'].includes(lead.status)) return null;
  const left = lead.slaDue - now();
  return { left, cls: left < 0 ? 'over' : left < 15 * 6e4 ? 'soon' : 'okk' };
}
/** SLA sweep: escalate overdue first-contact leads to manager once. */
function sweep() {
  let changed = false;
  db.leads.forEach((l) => {
    const s = slaState(l);
    if (s && s.left < 0 && !l.escalated) {
      l.escalated = true; changed = true;
      const mgr = db.users.find((u) => isManagerRole(u) && u.active);
      audit('Lead', l.id, 'SLA missed', `Escalated to ${mgr?.name || 'manager'}`);
      if (mgr) addTask(`SLA missed — reassign ${l.name}`, { type: 'lead', id: l.id }, mgr.id, now());
    }
  });
  const today = new Date(isoDate(now())).getTime();
  db.quotes.forEach((q) => {
    if (q.status === 'SENT' && new Date(q.validUntil).getTime() < today) {
      q.status = 'EXPIRED'; changed = true;
      audit('Quotation', q.id, 'Expired', `Validity ${q.validUntil} passed`);
      const o = byId('opps', q.oppId);
      if (o && o.stage === 'QUOTED') { o.stage = 'LOST'; o.reason = 'No response (quotation expired)'; audit('Opportunity', o.id, 'Lost', o.reason); }
    }
  });
  if (changed) save();
}

/* ════════════════ Step 5–6: Opportunity ════════════════ */
/** Opportunities linked to a lead (a lead can produce several). */
const leadOpps = (leadId) => db.opps.filter((o) => o.leadId === leadId || (o.leadIds || []).includes(leadId));
const OPEN_STAGES = OPP_STAGES.slice(0, 4);

/**
 * Creates an opportunity from a lead (after a connected call) or straight from an
 * existing account/customer (opts.accountId + opts.contactId, no lead needed).
 * A lead may create any number of opportunities; only an *open* one for the same
 * account + product is treated as a duplicate and linked instead.
 */
function createOpportunity(lead, d, opts = {}) {
  const accountId = lead ? lead.accountId : opts.accountId;
  const contactId = lead ? lead.contactId : opts.contactId;
  const acc = byId('accounts', accountId);
  if (lead && !hasConnected(lead)) return { err: 'Log at least one connected call before creating an opportunity.' };
  if (!contactId || !accountId) return { err: lead ? 'Lead needs a contact and an account (add a company name and resubmit).' : 'Pick a contact on this account.' };
  const existing = db.opps.find((o) => o.accountId === accountId && o.product === d.product && OPEN_STAGES.includes(o.stage));
  if (lead) { lead.status = 'CONVERTED'; closeTasks(lead.id); }
  const origin = lead ? `lead ${lead.id}` : `${acc.status === 'CUSTOMER' ? 'customer' : 'account'} ${acc.name}`;
  if (existing) {
    existing.activities.push({ ts: now(), text: `New info from ${origin}: ${d.summary || d.title}` });
    if (lead) existing.leadIds = [...new Set([...(existing.leadIds || []), lead.id])];
    audit('Opportunity', existing.id, 'Linked', `An open ${d.product} opportunity already exists for ${acc.name} — merged info from ${origin}`);
    toast('Linked to existing open opportunity', `${existing.title} (same product). Pick another product for a separate deal.`, 'var(--warn)');
    return { opp: existing, linked: true };
  }
  const o = {
    id: nid('OP'), title: d.title, summary: d.summary, value: +d.value || 0, closeDate: d.closeDate, product: d.product,
    stage: 'ASSIGNED', leadId: lead?.id || null, contactId, accountId, source: lead ? lead.source : (d.source || 'Existing customer'),
    campaign: lead?.campaign || '', ownerId: null, history: [], activities: [], bant: { budget: false, authority: false, need: false, timeline: false },
    rfp: { received: false }, createdAt: now(),
  };
  db.opps.unshift(o);
  audit('Opportunity', o.id, 'OpportunityCreated', `${o.title} · ${inr(o.value)} · from ${origin}`);
  if (lead) audit('Lead', lead.id, 'Opportunity created', `${o.id} · ${o.title}`);
  // Step 6 — owner
  const region = lead?.region || acc.region;
  if (db.settings.handoff || !lead) {
    const keep = !lead && acc.ownerId && eligibleReps().some((r) => r.id === acc.ownerId);
    if (keep) setOwner(o, 'Opportunity', acc.ownerId, 'Existing account owner');
    else { const r = runRules({ accountId, region, product: o.product, kind: 'opp' }); setOwner(o, 'Opportunity', r.owner, `${lead ? 'Handoff' : 'Account opportunity'} · ${r.rule}`); }
  } else setOwner(o, 'Opportunity', lead.ownerId, 'Same rep keeps it');
  if (o.ownerId) {
    addTask(`Start qualification: ${o.title}`, { type: 'opp', id: o.id }, o.ownerId, addBusinessDays(now(), 1));
    notify(o.ownerId, `Opportunity ${o.title} is yours — qualify within 1 business day`, { type: 'opp', id: o.id });
  }
  return { opp: o };
}

/* ════════════════ Step 8–9: Quotes & orders ════════════════ */
function quoteTotals(q) {
  const sub = q.items.reduce((s, i) => s + i.qty * i.price * (1 - (i.disc || 0) / 100), 0);
  const gst = (sub * GST) / 100;
  return { sub, gst, total: sub + gst, maxDisc: Math.max(0, ...q.items.map((i) => +i.disc || 0)) };
}
const latestQuote = (oppId) => db.quotes.filter((q) => q.oppId === oppId && q.status !== 'REVISED').sort((a, b) => b.createdAt - a.createdAt)[0];

/* ════════════════ Seed data ════════════════ */
function seed() {
  const team = db?.users || [];
  db = blank();
  ui.seeding = true;
  db.users = [
    { id: 'U1', name: 'Priya Sharma', role: 'manager', region: 'All', active: true, onLeave: false, discLimit: 30, color: '#b42318' },
    { id: 'U2', name: 'Arjun Mehta', role: 'rep', region: 'South', active: true, onLeave: false, discLimit: 10, products: ['ERP Suite'], color: '#1e3a6e' },
    { id: 'U3', name: 'Kavya Iyer', role: 'rep', region: 'North', active: true, onLeave: false, discLimit: 10, products: ['CRM Cloud'], color: '#2f7d6d' },
    { id: 'U4', name: 'Rahul Verma', role: 'rep', region: 'West', active: true, onLeave: false, discLimit: 12, products: ['Analytics'], color: '#a5620b' },
    { id: 'U5', name: 'Neha Kapoor', role: 'rep', region: 'East', active: true, onLeave: true, discLimit: 10, products: [], color: '#5b4b8a' },
  ];
  db.users = [...team, ...db.users.filter((d) => !team.some((t) => t.id === d.id))];
  db.products = [
    { id: 'P1', name: 'ERP Suite — annual licence', group: 'ERP Suite', price: 480000 },
    { id: 'P2', name: 'ERP implementation (per module)', group: 'ERP Suite', price: 150000 },
    { id: 'P3', name: 'CRM Cloud — 25 seats / yr', group: 'CRM Cloud', price: 225000 },
    { id: 'P4', name: 'Analytics dashboard pack', group: 'Analytics', price: 95000 },
    { id: 'P5', name: 'Premium support (12 months)', group: 'Support', price: 60000 },
    { id: 'P6', name: 'On-site training (per day)', group: 'Services', price: 18000 },
  ];
  db.me = 'U1';
  const h = 36e5;
  const L = (p, agoH) => {
    const l = ingest(p); l.createdAt = now() - agoH * h;
    if (l.slaDue) { l.slaDue = l.createdAt + (SLA_MIN[l.source] || 240) * 6e4; db.tasks.filter((t) => t.ref.id === l.id).forEach((t) => (t.due = l.slaDue)); }
    db.audit.filter((a) => a.entityId === l.id).forEach((a) => (a.ts = l.createdAt));
    return l;
  };

  const a = L({ name: 'Vikram Rao', phone: '98450 12345', email: 'Vikram.Rao@Tatvasoft.in ', company: 'Tatva Soft Pvt Ltd', designation: 'CTO', source: 'Web form', region: 'South', requirement: 'ERP for 3 plants', product: 'ERP Suite' }, 72);
  const b = L({ name: 'Ananya Gupta', phone: '+91 99100 55667', email: 'ananya@brightpath.co', company: 'BrightPath Logistics', designation: 'Ops Head', source: 'Ad', region: 'North', requirement: 'CRM for 25 sales reps', product: 'CRM Cloud' }, 60);
  const c = L({ name: 'Imran Shaikh', phone: '9820098200', email: 'imran@kalpana.com', company: 'Kalpana Textiles', designation: 'Director', source: 'Call', region: 'West', requirement: 'Sales analytics', product: 'Analytics' }, 50);
  const d = L({ name: 'Sneha Pillai', phone: '9447001122', email: 'sneha@greenleaf.org', company: 'GreenLeaf Foods', designation: 'CFO', source: 'Import', region: 'South', requirement: 'Finance module', product: 'ERP Suite' }, 40);
  const e = L({ name: 'Rohit Bansal', phone: '9811122334', email: 'rohit@zentro.io', company: 'Zentro Labs', designation: 'Founder', source: 'Web form', region: 'North', product: 'CRM Cloud' }, 2);
  L({ name: 'Meera Joshi', phone: '9123456780', email: 'meera.j@urbancraft.in', company: 'UrbanCraft', source: 'Web form', region: 'West', product: 'Analytics' }, 0.2);
  L({ name: 'test', phone: '12345', email: 'asdf', source: 'Web form' }, 30);
  L({ name: 'Unknown visitor', source: 'Ad' }, 20);
  L({ name: 'Vikram Rao', phone: '9845012345', email: 'vikram.rao@tatvasoft.in', company: 'Tatva Soft Pvt Ltd', source: 'Web form', region: 'South' }, 8);
  L({ name: 'Ananya Gupta', phone: '9876501234', email: 'ananya.g@brightpath.co', company: 'BrightPath Logistics', source: 'Import', region: 'North' }, 6);
  const f = L({ name: 'Debashish Sen', phone: '9830011223', email: 'deb@hooghly.in', company: 'Hooghly Exports', source: 'Manual', region: 'East', product: 'ERP Suite' }, 4);

  // Progress a few through the funnel
  const call = (l, outcome, notes, hoursAgo) => { l.calls.push({ ts: now() - hoursAgo * h, outcome, duration: outcome === 'Connected' ? 9 : 0, notes, next: '', by: l.ownerId }); if (outcome === 'Connected') { if (l.status === 'VALIDATED') l.status = 'CONTACTED'; closeTasks(l.id, 'First contact'); } else l.attempts++; };
  call(a, 'Connected', 'Needs ERP across 3 plants, budget approved, go-live Q1', 70); a.status = 'INTERESTED';
  call(b, 'No answer', '', 58); call(b, 'Connected', 'Wants CRM for 25 reps, evaluating 2 vendors', 50); b.status = 'INTERESTED';
  call(c, 'Connected', 'Interested, needs dashboards for sales', 48); c.status = 'INTERESTED';
  call(d, 'Connected', 'Revisit after budget cycle in Feb', 38);
  call(f, 'No answer', '', 3); call(f, 'Busy', '', 2);

  db.me = a.ownerId; const o1 = createOpportunity(a, { title: 'Tatva Soft — ERP rollout (3 plants)', summary: 'ERP licence + 3 modules implementation', value: 1020000, closeDate: isoDate(now() + 30 * day), product: 'ERP Suite' }).opp;
  db.me = b.ownerId; const o2 = createOpportunity(b, { title: 'BrightPath — CRM Cloud 25 seats', summary: 'CRM for field sales team', value: 285000, closeDate: isoDate(now() + 20 * day), product: 'CRM Cloud' }).opp;
  db.me = c.ownerId; const o3 = createOpportunity(c, { title: 'Kalpana — Sales analytics', summary: 'Analytics pack + training', value: 131000, closeDate: isoDate(now() + 15 * day), product: 'Analytics' }).opp;
  db.me = 'U1';
  d.status = 'NURTURE'; d.reason = 'Budget cycle'; d.nurtureDate = isoDate(now() + 90 * day);
  addTask(`Nurture follow-up: ${d.name}`, { type: 'lead', id: d.id }, d.ownerId, now() + 90 * day);
  audit('Lead', d.id, 'Nurture', 'Budget cycle · revisit ' + d.nurtureDate);

  o1.stage = 'QUALIFIED'; o1.bant = { budget: true, authority: true, need: true, timeline: true };
  o1.rfp = { received: true, date: isoDate(now() - 5 * day), deadline: isoDate(now() + 3 * day), file: 'Tatva_RFP_ERP.pdf', decision: 'Bid' };
  o2.stage = 'QUALIFYING'; o2.bant = { budget: true, authority: false, need: true, timeline: true };
  o3.stage = 'QUALIFIED'; o3.bant = { budget: true, authority: true, need: true, timeline: true };

  // Quotation that is accepted & ordered (o3) and one sent (o1)
  db.me = o1.ownerId;
  const q1 = { id: nid('Q'), number: 'QT-2041', version: 1, oppId: o1.id, items: [
    { pid: 'P1', name: db.products[0].name, qty: 1, price: 480000, disc: 5 }, { pid: 'P2', name: db.products[1].name, qty: 3, price: 150000, disc: 8 },
  ], validUntil: isoDate(now() + 14 * day), terms: '50% advance, 50% on go-live. Prices exclusive of GST.', status: 'SENT', createdAt: now() - 20 * h, sentAt: now() - 18 * h };
  db.quotes.push(q1); o1.stage = 'QUOTED';
  audit('Quotation', q1.id, 'Sent', `${q1.number} v1 emailed to ${byId('contacts', o1.contactId).email}`);
  db.me = o3.ownerId;
  const q3 = { id: nid('Q'), number: 'QT-2042', version: 1, oppId: o3.id, items: [
    { pid: 'P4', name: db.products[3].name, qty: 1, price: 95000, disc: 0 }, { pid: 'P6', name: db.products[5].name, qty: 2, price: 18000, disc: 0 },
  ], validUntil: isoDate(now() + 10 * day), terms: '100% on delivery.', status: 'ACCEPTED', proof: 'Customer PO', proofRef: 'KT/PO/7781', createdAt: now() - 30 * h };
  db.quotes.push(q3);
  const t3 = quoteTotals(q3);
  const ord = { id: nid('SO'), quoteId: q3.id, oppId: o3.id, accountId: o3.accountId, poNumber: 'KT/PO/7781', poDate: isoDate(now() - day), deliveryDate: isoDate(now() + 7 * day), deliveryAddr: 'Plot 22, MIDC, Bhiwandi', billingAddr: 'Kalpana Textiles, Lower Parel, Mumbai', paymentTerms: 'Net 30', total: t3.total, status: 'CONFIRMED', createdAt: now() - 10 * h };
  db.orders.push(ord);
  o3.stage = 'WON'; o3.finalValue = t3.total; o3.closedAt = now() - 10 * h;
  const acc3 = byId('accounts', o3.accountId); acc3.status = 'CUSTOMER'; acc3.gstin = '27AAACK1234F1Z5'; acc3.pan = 'AAACK1234F';
  audit('SalesOrder', ord.id, 'Confirmed', `${inr(ord.total)} · PO ${ord.poNumber}`);
  o1.createdAt = now() - 66 * h; o2.createdAt = now() - 49 * h; o3.createdAt = now() - 46 * h;

  // Two weeks of history so trends are visible
  const HIST = [
    ['Aditya Nair', 'Orbit Pharma', 'South', 'ERP Suite'], ['Lakshmi Reddy', 'Saffron Hotels', 'South', 'CRM Cloud'], ['Farhan Khan', 'Monsoon Retail', 'West', 'Analytics'],
    ['Pooja Desai', 'Kaveri Steel', 'West', 'ERP Suite'], ['Siddharth Malhotra', 'Pixelnest Studios', 'North', 'CRM Cloud'], ['Divya Bose', 'Indus Agro', 'East', 'Analytics'],
    ['Karthik Menon', 'Northstar Clinics', 'South', 'CRM Cloud'], ['Ritu Chopra', 'Bluewave Marine', 'West', 'ERP Suite'], ['Manoj Jain', 'Lotus Textiles', 'North', 'Analytics'],
    ['Nisha Patil', 'Coastal Foods', 'West', 'CRM Cloud'], ['Gaurav Sethi', 'Aravali Cement', 'North', 'ERP Suite'], ['Swati Rao', 'Deccan Motors', 'South', 'Analytics'],
    ['Harish Iyer', 'Ganga Polymers', 'North', 'ERP Suite'], ['Tanvi Shah', 'Sapphire Labs', 'West', 'CRM Cloud'],
  ];
  HIST.forEach(([name, company, region, product], i) => {
    const daysAgo = 13 - (i % 11) - (i > 10 ? 0.5 : 0);
    const [f, l] = name.toLowerCase().split(' ');
    const ld = L({ name, phone: `90000${String(10100 + i * 37).padStart(5, '0')}`, email: `${f}.${l}@${company.split(' ')[0].toLowerCase()}.in`, company, source: ['Web form', 'Ad', 'Call', 'Import'][i % 4], region, product, requirement: 'Enquiry' }, daysAgo * 24);
    if (ld.status !== 'VALIDATED') return;
    db.me = ld.ownerId || 'U1';
    if (i % 4 === 3) { call(ld, 'No answer', '', daysAgo * 24 - 2); ld.status = 'CLOSED'; ld.reason = 'Not interested'; closeTasks(ld.id); return; }
    call(ld, 'Connected', 'Discussed requirement', daysAgo * 24 - 3);
    if (i % 3 === 2) { ld.status = 'NURTURE'; ld.reason = 'Next quarter'; ld.nurtureDate = isoDate(now() + 60 * day); closeTasks(ld.id); return; }
    const op = createOpportunity(ld, { title: `${company} — ${product}`, summary: 'From discovery call', value: [180000, 320000, 95000, 450000][i % 4], closeDate: isoDate(now() + 25 * day), product }).opp;
    if (!op) return;
    op.createdAt = ld.createdAt + 20 * h;
    op.stage = ['QUALIFYING', 'LOST', 'QUALIFIED', 'DISQUALIFIED'][i % 4];
    if (['LOST', 'DISQUALIFIED'].includes(op.stage)) { op.reason = op.stage === 'LOST' ? 'Chose a competitor' : 'No budget'; closeTasks(op.id); }
    if (op.stage === 'QUALIFIED') { op.bant = { budget: true, authority: true, need: true, timeline: true }; closeTasks(op.id); }
  });
  // An existing customer with a second, separate opportunity (upsell)
  db.me = o3.ownerId;
  const up = createOpportunity(null, { title: 'Kalpana — CRM Cloud upsell', summary: 'Sales team wants CRM after the analytics rollout', value: 240000, closeDate: isoDate(now() + 40 * day), product: 'CRM Cloud', source: 'Upsell' }, { accountId: o3.accountId, contactId: o3.contactId }).opp;
  up.createdAt = now() - 6 * h;

  db.me = session?.id || 'U1';
  db.audit.sort((x, y) => y.ts - x.ts);
  ui.seeding = false;
  save();
}

/* ════════════════ Router & shell ════════════════ */
const VIEWS = {
  dashboard: { t: 'Command center', ic: '◎' },
  leads: { t: 'Leads', ic: '✦' },
  inbox: { t: 'Review & pool', ic: '⚑' },
  pipeline: { t: 'Pipeline', ic: '▤' },
  opps: { t: 'Opportunities', ic: '◆' },
  quotes: { t: 'Quotations', ic: '₹' },
  orders: { t: 'Sales orders', ic: '✓' },
  accounts: { t: 'Accounts', ic: '⌂' },
  tasks: { t: 'My tasks', ic: '◷' },
  audit: { t: 'Audit trail', ic: '≡' },
  settings: { t: 'Team & rules', ic: '⚙' },
};
function go(v) { ui.view = v; location.hash = v; $('#side').classList.remove('on'); render(); window.scrollTo(0, 0); }

function inboxCount() { return db.leads.filter((l) => l.status === 'PENDING_REVIEW' || (liveLead(l) && ['VALIDATED', 'CONTACTED', 'INTERESTED'].includes(l.status) && !l.ownerId)).length + db.opps.filter((o) => !o.ownerId && OPP_STAGES.slice(0, 4).includes(o.stage)).length; }
function myOpenTasks() { return db.tasks.filter((t) => !t.done && t.ownerId === db.me); }

function myAlerts() {
  const soon = now() + 30 * 6e4;
  const tasks = db.tasks.filter((t) => !t.done && t.ownerId === db.me && t.due <= soon).sort((a, b) => a.due - b.due);
  const notes = (db.notifications || []).filter((n) => n.to === db.me);
  return { tasks, notes, unread: notes.filter((n) => !n.read).length };
}
function renderBell() {
  const { tasks, unread } = myAlerts();
  const n = tasks.length + unread;
  const c = $('#bellCount'); if (c) { c.textContent = n > 99 ? '99+' : n; c.style.display = n ? '' : 'none'; c.classList.toggle('hot', tasks.some((t) => t.due < now())); }
  if ($('#bellPanel')?.classList.contains('on')) drawBellPanel();
}
function drawBellPanel() {
  const { tasks, notes } = myAlerts();
  const refAct = (r) => r ? `data-act="openRef" data-id="${r.type === 'opp' ? 'Opportunity' : 'Lead'}:${r.id}"` : '';
  $('#bellPanel').innerHTML = `<div class="bell-h"><b>Reminders</b><span class="sub">${esc(me().name)}</span></div>
    <div class="bell-sec">Follow-ups due${tasks.length ? ` · ${tasks.length}` : ''}</div>
    ${tasks.length ? tasks.slice(0, 8).map((t) => `<a class="bell-i" ${refAct(t.ref)}><span class="dotc" style="--c:${t.due < now() ? 'var(--bad)' : 'var(--warn)'}"></span><div><b>${esc(t.title)}</b><small class="${t.due < now() ? 'sla over' : 'sla soon'}">${dur(t.due - now())}</small></div></a>`).join('') : '<div class="bell-empty">Nothing due in the next 30 minutes.</div>'}
    <div class="bell-sec">Notifications ${notes.some((n) => !n.read) ? '<button class="linkbtn" data-act="bellRead">Mark all read</button>' : ''}</div>
    ${notes.length ? notes.slice(0, 12).map((n) => `<a class="bell-i ${n.read ? '' : 'unread'}" ${refAct(n.ref)}><span class="dotc" style="--c:${n.read ? 'var(--border-2)' : 'var(--accent)'}"></span><div><span>${esc(n.text)}</span><small>${ago(n.ts)}</small></div></a>`).join('') : '<div class="bell-empty">No notifications.</div>'}
    <a class="bell-foot" data-act="nav" data-id="tasks">All my tasks →</a>`;
}

function renderNav() {
  const counts = {
    leads: db.leads.filter((l) => ['VALIDATED', 'CONTACTED', 'INTERESTED'].includes(l.status)).length,
    inbox: inboxCount(),
    pipeline: db.opps.filter((o) => OPP_STAGES.slice(0, 4).includes(o.stage)).length,
    opps: db.opps.length,
    quotes: db.quotes.filter((q) => ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT'].includes(q.status)).length,
    orders: db.orders.filter((o) => o.status === 'CONFIRMED').length,
    tasks: myOpenTasks().length,
  };
  const hot = { inbox: counts.inbox > 0, tasks: myOpenTasks().some((t) => t.due < now()) };
  const item = (k) => `<button class="nav-item ${ui.view === k ? 'active' : ''}" data-act="nav" data-id="${k}" title="${VIEWS[k].t}${counts[k] ? ' · ' + counts[k] : ''}"><span class="ni">${VIEWS[k].ic}</span><span class="nl">${VIEWS[k].t}</span>${counts[k] ? `<span class="count ${hot[k] ? 'hot' : ''}">${counts[k]}</span>` : ''}</button>`;
  $('#nav').innerHTML = `
    ${item('dashboard')}${item('tasks')}
    <div class="nav-label">Flow</div>${item('leads')}${item('inbox')}${item('pipeline')}${item('opps')}${item('quotes')}${item('orders')}
    <div class="nav-label">Records</div>${item('accounts')}${item('audit')}${isMgr() ? item('settings') : ''}`;
  const m = me() || session || {};
  $('#meAvatar').textContent = initials(m.name); $('#meAvatar').style.background = m.color || 'var(--accent)';
  $('#meName').textContent = m.name || '';
  $('#meRole').textContent = ROLE_LABEL[m.role] || '';
  $('#crumbs').textContent = VIEWS[ui.view]?.t || '';
  renderBell();
}

function render() {
  if (ui.view === 'settings' && !isMgr()) ui.view = 'dashboard';
  sweep();
  renderNav();
  const fn = { dashboard: vDashboard, leads: vLeads, inbox: vInbox, pipeline: vPipeline, opps: vOpps, quotes: vQuotes, orders: vOrders, accounts: vAccounts, tasks: vTasks, audit: vAudit, settings: vSettings }[ui.view] || vDashboard;
  $('#view').innerHTML = fn();
  if (ui.view === 'dashboard') drawCharts();
  if (ui.view === 'settings') { loadReminderStatus(); if (isAdmin() && !ui.loginsLoaded) { ui.loginsLoaded = true; loadLogins(); } }
  $('#view').style.animation = 'none'; void $('#view').offsetWidth; $('#view').style.animation = '';
  if (ui.drawer) renderDrawer();
}
function commit() { save(); render(); }

/* ════════════════ View: Dashboard ════════════════ */
function flowStats() {
  const L = db.leads, O = db.opps, Q = db.quotes;
  const passedValidation = L.filter((l) => !['NEW', 'REJECTED', 'DUPLICATE', 'PENDING_REVIEW'].includes(l.status));
  const opQualifiedPlus = O.filter((o) => ['QUALIFIED', 'QUOTED', 'WON'].includes(o.stage));
  return [
    { n: 1, t: 'Lead', v: L.length, f: L.filter((l) => l.status === 'REJECTED').length, fl: 'rejected', go: 'leads', filter: 'ALL' },
    { n: 2, t: 'Dedupe / Validate', v: passedValidation.length, f: L.filter((l) => ['DUPLICATE', 'PENDING_REVIEW'].includes(l.status)).length, fl: 'dup / review', go: 'leads', filter: 'DUPLICATE' },
    { n: 3, t: 'Contact & Account', v: L.filter((l) => l.contactId).length, f: L.filter((l) => l.reviewType === 'account' && l.status === 'PENDING_REVIEW').length, fl: 'ambiguous', go: 'accounts' },
    { n: 4, t: 'Assignment · call', v: L.filter((l) => l.ownerId).length, f: L.filter((l) => ['NURTURE', 'CLOSED', 'CLOSED_UNREACHABLE'].includes(l.status)).length, fl: 'nurture / closed', go: 'leads', filter: 'VALIDATED' },
    { n: 5, t: 'Opportunity', v: O.length, f: 0, fl: '', go: 'pipeline' },
    { n: 6, t: 'Assigned', v: O.filter((o) => o.ownerId).length, f: O.filter((o) => !o.ownerId).length, fl: 'unassigned', go: 'pipeline' },
    { n: 7, t: 'RFP / Qualify', v: opQualifiedPlus.length, f: O.filter((o) => ['LOST', 'DISQUALIFIED', 'NURTURE'].includes(o.stage) && !db.quotes.some((q) => q.oppId === o.id)).length, fl: 'lost / nurture', go: 'pipeline' },
    { n: 8, t: 'Quotation', v: new Set(Q.map((q) => q.oppId)).size, f: Q.filter((q) => ['REJECTED', 'EXPIRED'].includes(q.status)).length, fl: 'rejected / expired', go: 'quotes' },
    { n: 9, t: 'Sales order', v: db.orders.filter((o) => o.status === 'CONFIRMED').length, f: db.orders.filter((o) => o.status === 'CANCELLED').length, fl: 'cancelled', go: 'orders' },
  ];
}
function vDashboard() {
  const steps = flowStats();
  const max = Math.max(1, steps[0].v);
  const tasks = myOpenTasks().sort((a, b) => a.due - b.due).slice(0, 6);
  const stageVals = OPP_STAGES.map((s) => ({ s, v: db.opps.filter((o) => o.stage === s).reduce((a, o) => a + (o.finalValue || o.value || 0), 0), n: db.opps.filter((o) => o.stage === s).length }));
  const stageMax = Math.max(1, ...stageVals.map((x) => x.v));
  const hr = new Date().getHours();
  return `
  <div class="page-h"><div><h1>Good ${hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening'}, ${esc(me().name.split(' ')[0])}</h1><p>Every record moves through the same nine checkpoints. Failures are recorded and audited, never lost.</p></div>
    <div class="btn-row"><button class="btn" data-act="simulate">⚡ Simulate lead</button><button class="btn primary" data-act="newLead">+ New lead</button></div></div>
  <div class="charts">
    <div class="card">
      <div class="card-h"><div><h2>Leads vs opportunities</h2><div class="sub">Created per day · last 14 days</div></div>
        <div class="legend"><span><i style="--c:var(--s1)"></i>Leads captured</span><span><i style="--c:var(--s2)"></i>Opportunities created</span></div></div>
      <div class="chart" id="lineChart" role="img" aria-label="Line chart of leads captured and opportunities created per day over the last 14 days"></div>
    </div>
    <div class="card">
      <div class="card-h"><div><h2>Conversion funnel</h2><div class="sub">Lead to won order · % kept from the previous stage</div></div></div>
      <div class="chart" id="funnelChart"></div>
    </div>
  </div>
  <div class="card" style="margin-bottom:18px">
    <div class="card-h"><div><h2>The flow, live</h2><div class="sub">Passed each checkpoint · <span style="color:var(--bad)">fallout</span> recorded underneath</div></div></div>
    <div class="flow">${steps.map((s) => `
      <div class="step" data-act="nav" data-id="${s.go}" ${s.filter ? `data-filter="${s.filter}"` : ''}>
        <div class="n">STEP ${s.n}</div><div class="t" title="${s.t}">${s.t}</div>
        <div class="v">${s.v}</div><div class="bar"><i style="width:${Math.round((s.v / max) * 100)}%"></i></div>
        <div class="f ${s.f ? '' : 'zero'}">${s.f ? `↘ ${s.f} ${s.fl}` : s.fl ? '✓ no fallout' : ''}</div>
      </div>`).join('')}</div>
  </div>
  <div class="cols">
    <div class="stack">
      <div class="card"><div class="card-h"><h2>Pipeline by stage</h2><a data-act="nav" data-id="pipeline">Open board →</a></div>
        <div class="funnel">${stageVals.map((x) => `<div class="row"><span>${STAGE_LABEL[x.s]} <span class="faint">· ${x.n}</span></span><div class="track"><i style="width:${(x.v / stageMax) * 100}%"></i></div><span class="right mono">${inrShort(x.v)}</span></div>`).join('')}</div>
      </div>
      <div class="card"><div class="card-h"><h2>Recent activity</h2><a data-act="nav" data-id="audit">Full audit →</a></div>
        ${timeline(db.audit.slice(0, 8))}
      </div>
    </div>
    <div class="stack">
      <div class="card"><div class="card-h"><h2>Your next actions</h2><a data-act="nav" data-id="tasks">All →</a></div>
        ${tasks.length ? taskList(tasks) : `<div class="empty"><div class="big">☼</div>Nothing due. Nice.</div>`}
      </div>
      <div class="card"><div class="card-h"><h2>Needs attention</h2></div>
        ${attention()}
      </div>
    </div>
  </div>`;
}
/* ════════════════ Charts ════════════════ */
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
function dailySeries(days = 14) {
  const start = startOfDay(now()) - (days - 1) * day;
  const rows = [...Array(days)].map((_, i) => ({ t: start + i * day, leads: 0, opps: 0 }));
  const put = (t, k) => { const i = Math.floor((t - start) / day); if (i >= 0 && i < days) rows[i][k]++; };
  db.leads.forEach((l) => put(l.createdAt, 'leads'));
  db.opps.forEach((o) => put(o.createdAt, 'opps'));
  return rows;
}
function funnelData() {
  const hasQuote = (o) => db.quotes.some((q) => q.oppId === o.id);
  return [
    ['Leads captured', db.leads.length],
    ['Validated', db.leads.filter((l) => l.contactId).length],
    ['Reached on call', db.leads.filter((l) => l.calls?.some((c) => c.outcome === 'Connected')).length],
    ['Opportunities', db.opps.length],
    ['Qualified', db.opps.filter((o) => ['QUALIFIED', 'QUOTED', 'WON'].includes(o.stage) || hasQuote(o)).length],
    ['Quoted', db.opps.filter(hasQuote).length],
    ['Won', db.opps.filter((o) => o.stage === 'WON').length],
  ];
}
function tip(el, html, x, y) {
  let t = $('.tip', el); if (!t) { t = document.createElement('div'); t.className = 'tip'; el.appendChild(t); }
  if (html == null) { t.classList.remove('on'); return; }
  t.innerHTML = html; t.classList.add('on');
  const w = t.offsetWidth, W = el.clientWidth;
  t.style.left = Math.min(Math.max(0, x + 14), W - w) + 'px'; t.style.top = Math.max(0, y - 10) + 'px';
}
function drawLineChart() {
  const el = $('#lineChart'); if (!el) return;
  const data = dailySeries();
  const W = Math.max(280, el.clientWidth), H = 230, m = { l: 34, r: 92, t: 14, b: 28 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, n = data.length;
  const peak = Math.max(1, ...data.map((d) => Math.max(d.leads, d.opps)));
  const step = Math.max(1, Math.ceil(peak / 4)), maxY = step * 4;
  const x = (i) => m.l + (i * iw) / (n - 1), y = (v) => m.t + ih - (v / maxY) * ih;
  const path = (k) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join('');
  const fmtD = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const grid = [0, 1, 2, 3, 4].map((g) => `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(g * step)}" y2="${y(g * step)}" class="gl"/><text x="${m.l - 8}" y="${y(g * step) + 4}" text-anchor="end" class="ax">${g * step}</text>`).join('');
  const xl = data.map((d, i) => (i % 3 === 0 || i === n - 1) ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ax">${i === n - 1 ? 'Today' : fmtD(d.t)}</text>` : '').join('');
  const last = data[n - 1];
  const labels = [['leads', 'Leads', 'var(--s1)'], ['opps', 'Opps', 'var(--s2)']];
  let ly = labels.map(([k]) => y(last[k]));
  if (Math.abs(ly[0] - ly[1]) < 16) { const mid = (ly[0] + ly[1]) / 2; const up = last.leads >= last.opps ? 0 : 1; ly[up] = mid - 8; ly[1 - up] = mid + 8; }
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${grid}${xl}
    ${labels.map(([k, , c]) => `<path d="${path(k)}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    ${labels.map(([k, , c]) => `<circle cx="${x(n - 1)}" cy="${y(last[k])}" r="4.5" fill="${c}" stroke="var(--panel)" stroke-width="2"/>`).join('')}
    ${labels.map(([k, name], j) => `<text x="${x(n - 1) + 10}" y="${ly[j] + 4}" class="dl">${name} <tspan class="dv">${last[k]}</tspan></text>`).join('')}
    <g class="hover" style="display:none"><line class="xh" y1="${m.t}" y2="${m.t + ih}"/>${labels.map(([, , c]) => `<circle r="5" fill="${c}" stroke="var(--panel)" stroke-width="2"/>`).join('')}</g>
    <rect x="${m.l - 10}" y="0" width="${iw + 20}" height="${H}" fill="transparent" class="hit"/>
  </svg>`;
  const svg = $('svg', el), hv = $('.hover', svg), dots = $$('circle', hv);
  $('.hit', svg).addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect(); const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - m.l) / iw) * (n - 1))));
    const d = data[i]; hv.style.display = '';
    $('.xh', hv).setAttribute('x1', x(i)); $('.xh', hv).setAttribute('x2', x(i));
    dots[0].setAttribute('cx', x(i)); dots[0].setAttribute('cy', y(d.leads)); dots[1].setAttribute('cx', x(i)); dots[1].setAttribute('cy', y(d.opps));
    tip(el, `<b>${fmtDate(d.t)}</b><div><i style="--c:var(--s1)"></i>Leads captured <b>${d.leads}</b></div><div><i style="--c:var(--s2)"></i>Opportunities <b>${d.opps}</b></div>`, x(i), Math.min(y(d.leads), y(d.opps)));
  });
  $('.hit', svg).addEventListener('mouseleave', () => { hv.style.display = 'none'; tip(el, null); });
}
function drawFunnel() {
  const el = $('#funnelChart'); if (!el) return;
  const f = funnelData(); const top = Math.max(1, f[0][1]);
  el.innerHTML = `<div class="fn">${f.map(([name, v], i) => {
    const prev = i ? f[i - 1][1] : v; const pct = i ? (prev ? Math.round((v / prev) * 100) : 0) : 100;
    const w = Math.max(v ? 4 : 0, (v / top) * 100);
    return `<div class="fn-row" data-i="${i}"><span class="fn-l">${name}</span><div class="fn-track"><i style="width:${w}%"></i></div><span class="fn-v"><b>${v}</b> ${i ? `<span class="faint">${pct}%</span>` : ''}</span></div>`;
  }).join('')}</div>`;
  $$('.fn-row', el).forEach((row) => {
    row.addEventListener('mousemove', (e) => {
      const i = +row.dataset.i, [name, v] = f[i], r = el.getBoundingClientRect();
      tip(el, `<b>${name}</b><div>${v} record${v === 1 ? '' : 's'}</div>${i ? `<div class="faint">${f[i - 1][1] ? Math.round((v / f[i - 1][1]) * 100) : 0}% of ${f[i - 1][0].toLowerCase()} · ${Math.round((v / top) * 100)}% of all leads</div>` : ''}`, e.clientX - r.left, e.clientY - r.top);
    });
    row.addEventListener('mouseleave', () => tip(el, null));
  });
}
function drawCharts() { drawLineChart(); drawFunnel(); }
window.addEventListener('resize', () => { if (ui.view === 'dashboard' && db) drawLineChart(); });

function attention() {
  const items = [];
  db.leads.filter((l) => l.status === 'PENDING_REVIEW').forEach((l) => items.push([`⚑ Review ${esc(l.name)}`, l.reviewType === 'account' ? 'Ambiguous account match' : 'Probable duplicate', 'openLead', l.id, 'var(--warn)']));
  db.leads.filter((l) => slaState(l)?.cls === 'over').forEach((l) => items.push([`⏱ ${esc(l.name)}`, `First-contact SLA missed · ${esc(uname(l.ownerId))}`, 'openLead', l.id, 'var(--bad)']));
  db.quotes.filter((q) => q.status === 'PENDING_APPROVAL').forEach((q) => items.push([`₹ ${q.number} v${q.version}`, 'Discount awaiting approval', 'openQuote', q.id, 'var(--warn)']));
  db.opps.filter((o) => o.rfp?.received && o.rfp.deadline && OPP_STAGES.slice(0, 3).includes(o.stage) && new Date(o.rfp.deadline) - now() < 5 * day).forEach((o) => items.push([`📄 RFP due ${fmtDate(o.rfp.deadline)}`, esc(o.title), 'openOpp', o.id, 'var(--info)']));
  if (!items.length) return `<div class="empty"><div class="big">✓</div>All clear.</div>`;
  return `<div class="tl">${items.slice(0, 8).map(([t, s, act, id, c]) => `<div class="tl-i" style="--c:${c}"><div class="what"><a data-act="${act}" data-id="${id}"><b>${t}</b></a></div><div class="when">${s}</div></div>`).join('')}</div>`;
}
function timeline(list) {
  if (!list.length) return `<div class="empty">No activity yet.</div>`;
  const col = (a) => /reject|lost|cancel|missed|disqual/i.test(a) ? 'var(--bad)' : /dup|review|nurture|expired|pool/i.test(a) ? 'var(--warn)' : /won|confirm|accept|approved|created/i.test(a) ? 'var(--ok)' : 'var(--accent)';
  return `<div class="tl">${list.map((a) => `<div class="tl-i" style="--c:${col(a.action)}"><div class="what"><b>${esc(a.action)}</b> · <a data-act="openRef" data-id="${a.entity}:${a.entityId}">${esc(a.entityId)}</a> <span class="sub">${esc(a.detail)}</span></div><div class="when">${ago(a.ts)} · ${esc(uname(a.actor))}</div></div>`).join('')}</div>`;
}
function taskList(tasks) {
  return `<div class="stack" style="gap:8px">${tasks.map((t) => {
    const over = !t.done && t.due < now();
    return `<div class="check ${t.done ? 'on' : ''}" style="cursor:default">
      <input type="checkbox" ${t.done ? 'checked' : ''} data-act="toggleTask" data-id="${t.id}" />
      <div style="flex:1;min-width:0"><a data-act="openRef" data-id="${t.ref.type === 'lead' ? 'Lead' : 'Opportunity'}:${t.ref.id}" style="color:var(--text)">${esc(t.title)}</a>
      <small class="${over ? 'sla over' : ''}">${t.done ? 'Done ' + ago(t.doneAt) : (over ? dur(t.due - now()) : 'Due ' + fmtTime(t.due))} · ${esc(uname(t.ownerId))}</small></div></div>`;
  }).join('')}</div>`;
}

/* ════════════════ View: Leads ════════════════ */
function vLeads() {
  const groups = { ALL: () => true, VALIDATED: (l) => l.status === 'VALIDATED', CONTACTED: (l) => l.status === 'CONTACTED', INTERESTED: (l) => l.status === 'INTERESTED', NURTURE: (l) => l.status === 'NURTURE', CONVERTED: (l) => l.status === 'CONVERTED', CLOSED: (l) => l.status.startsWith('CLOSED'), REJECTED: (l) => l.status === 'REJECTED', DUPLICATE: (l) => ['DUPLICATE', 'PENDING_REVIEW'].includes(l.status) };
  const label = { ALL: 'All', VALIDATED: 'To call', CONTACTED: 'Contacted', INTERESTED: 'Interested', NURTURE: 'Nurture', CONVERTED: 'Converted', CLOSED: 'Closed', REJECTED: 'Rejected · error report', DUPLICATE: 'Duplicates & review' };
  const rows = db.leads.filter(groups[ui.leadFilter] || groups.ALL);
  return `
  <div class="page-h"><div><h1>Leads</h1><p>Steps 1–4 · Intake, dedupe, contact &amp; account, assignment and the discovery call.</p></div>
    <div class="btn-row"><button class="btn" data-act="simulate">⚡ Simulate</button><button class="btn primary" data-act="newLead">+ New lead</button></div></div>
  <div class="chips">${Object.keys(groups).map((k) => `<button class="chip ${ui.leadFilter === k ? 'on' : ''}" data-act="leadFilter" data-id="${k}">${label[k]}<span class="c">${db.leads.filter(groups[k]).length}</span></button>`).join('')}</div>
  ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Lead</th><th>Company</th><th>Source</th><th>Status</th><th>Owner</th><th>First-contact SLA</th><th>Calls</th><th>Created</th></tr></thead><tbody>
  ${rows.map((l) => { const s = slaState(l); return `<tr class="click" data-act="openLead" data-id="${l.id}">
    <td><div class="who"><div><b>${esc(l.name || '(no name)')}</b><small>${esc(l.phone || l.raw?.phone || '—')} · ${esc(l.email || l.raw?.email || '—')}</small></div></div></td>
    <td>${esc(l.company || '—')}</td><td><span class="tag">${esc(l.source)}</span></td>
    <td>${pill(l.status)}${l.status === 'REJECTED' ? `<div class="faint" style="font-size:11.5px;margin-top:4px;max-width:220px">${esc(l.reason)}</div>` : ''}</td>
    <td><div class="who">${av(l.ownerId)}<span>${esc(uname(l.ownerId))}</span></div></td>
    <td>${s ? `<span class="sla ${s.cls}">${dur(s.left)}</span>` : '<span class="faint">—</span>'}</td>
    <td class="mono">${l.calls?.length || 0}${l.attempts ? `<span class="faint"> · ${l.attempts} missed</span>` : ''}</td>
    <td class="faint">${ago(l.createdAt)}</td></tr>`; }).join('')}
  </tbody></table></div>` : `<div class="card empty"><div class="big">✦</div>No leads here.</div>`}`;
}

/* ════════════════ View: Inbox (review & pool) ════════════════ */
function vInbox() {
  const review = db.leads.filter((l) => l.status === 'PENDING_REVIEW');
  const poolL = db.leads.filter((l) => ['VALIDATED', 'CONTACTED', 'INTERESTED'].includes(l.status) && !l.ownerId);
  const poolO = db.opps.filter((o) => !o.ownerId && OPP_STAGES.slice(0, 4).includes(o.stage));
  const card = (title, sub, body) => `<div class="card"><div class="card-h"><div><h2>${title}</h2><div class="sub">${sub}</div></div></div>${body}</div>`;
  const reviewBody = review.length ? review.map((l) => {
    const other = l.reviewType === 'duplicate' ? byId('leads', l.reviewOf) : null;
    return `<div class="callout" style="--c:var(--warn);margin-bottom:10px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
      <div><b>${esc(l.name)}</b> · ${esc(l.company)} · ${esc(l.email)}<br><span class="sub">${other ? `Looks like <a data-act="openLead" data-id="${other.id}">${esc(other.name)} (${other.id})</a> · ${esc(other.email)}` : `Matches several accounts: ${(l.candidates || []).map((id) => esc(byId('accounts', id)?.name)).join(', ')}`}</span></div>
      <button class="btn sm" data-act="openLead" data-id="${l.id}">Review →</button></div>`;
  }).join('') : `<div class="empty">Queue is empty.</div>`;
  const poolBody = (poolL.length || poolO.length) ? `<div class="table-wrap"><table><tbody>
    ${poolL.map((l) => `<tr><td><b>${esc(l.name)}</b><div class="faint">Lead · ${esc(l.company || '')} · ${esc(l.region || 'no region')}</div></td><td class="right"><div class="btn-row" style="justify-content:flex-end">${isMgr() ? `<button class="btn sm" data-act="assignLead" data-id="${l.id}">Assign</button>` : ''}<button class="btn sm primary" data-act="claimLead" data-id="${l.id}">Claim</button></div></td></tr>`).join('')}
    ${poolO.map((o) => `<tr><td><b>${esc(o.title)}</b><div class="faint">Opportunity · ${inr(o.value)}</div></td><td class="right"><div class="btn-row" style="justify-content:flex-end">${isMgr() ? `<button class="btn sm" data-act="assignOpp" data-id="${o.id}">Assign</button>` : ''}<button class="btn sm primary" data-act="claimOpp" data-id="${o.id}">Claim</button></div></td></tr>`).join('')}
  </tbody></table></div>` : `<div class="empty">No unassigned records.</div>`;
  return `<div class="page-h"><div><h1>Review &amp; pool</h1><p>Non-terminal holds: probable duplicates, ambiguous matches and records no rule could assign.</p></div></div>
  <div class="cols">${card('Manual review queue', 'Manager or sales-ops decides: merge or keep separate', reviewBody)}${card('Unassigned pool', 'A manager assigns, or a rep claims', poolBody)}</div>`;
}

/* ════════════════ View: Pipeline ════════════════ */
function vOpps() {
  const groups = { ALL: () => true, OPEN: (o) => OPEN_STAGES.includes(o.stage), WON: (o) => o.stage === 'WON', LOST: (o) => ['LOST', 'DISQUALIFIED'].includes(o.stage), NURTURE: (o) => o.stage === 'NURTURE' };
  const glabel = { ALL: 'All', OPEN: 'Open', WON: 'Won', LOST: 'Lost / disqualified', NURTURE: 'Nurture' };
  const origins = { ALL: () => true, LEAD: (o) => !!o.leadId, ACCOUNT: (o) => !o.leadId };
  const q = ui.oppQ.toLowerCase();
  const sorters = { new: (a, b) => b.createdAt - a.createdAt, value: (a, b) => (b.finalValue || b.value) - (a.finalValue || a.value), close: (a, b) => String(a.closeDate).localeCompare(String(b.closeDate)) };
  const rows = db.opps.filter(groups[ui.oppFilter] || groups.ALL).filter(origins[ui.oppOrigin] || origins.ALL)
    .filter((o) => !q || `${o.title} ${o.product} ${byId('accounts', o.accountId)?.name} ${uname(o.ownerId)} ${o.id}`.toLowerCase().includes(q))
    .sort(sorters[ui.oppSort] || sorters.new);
  const sum = rows.reduce((a, o) => a + (o.finalValue || o.value || 0), 0);
  return `<div class="page-h"><div><h1>Opportunities</h1><p>Every deal in one list. A lead can raise several, and existing customers can start new ones from their account.</p></div>
    <div class="btn-row"><button class="btn" data-act="nav" data-id="pipeline">▤ Board view</button><button class="btn primary" data-act="pickAccountOpp">+ New opportunity</button></div></div>
  <div class="chips">${Object.keys(groups).map((k) => `<button class="chip ${ui.oppFilter === k ? 'on' : ''}" data-act="oppFilter" data-id="${k}">${glabel[k]}<span class="c">${db.opps.filter(groups[k]).length}</span></button>`).join('')}</div>
  <div class="toolbar">
    <input id="oppQ" placeholder="Search title, account, product, owner…" value="${esc(ui.oppQ)}" />
    <select id="oppOrigin"><option value="ALL" ${ui.oppOrigin === 'ALL' ? 'selected' : ''}>All origins</option><option value="LEAD" ${ui.oppOrigin === 'LEAD' ? 'selected' : ''}>From a lead</option><option value="ACCOUNT" ${ui.oppOrigin === 'ACCOUNT' ? 'selected' : ''}>From an existing account</option></select>
    <select id="oppSort"><option value="new" ${ui.oppSort === 'new' ? 'selected' : ''}>Newest first</option><option value="value" ${ui.oppSort === 'value' ? 'selected' : ''}>Highest value</option><option value="close" ${ui.oppSort === 'close' ? 'selected' : ''}>Closing soonest</option></select>
    <span class="sub" style="margin-left:auto">${rows.length} shown · <b style="color:var(--text)">${inr(sum)}</b></span>
  </div>
  ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Opportunity</th><th>Account</th><th>Stage</th><th>Owner</th><th>Origin</th><th>Expected close</th><th class="right">Value</th></tr></thead><tbody>
  ${rows.map((o) => { const a = byId('accounts', o.accountId); return `<tr class="click" data-act="openOpp" data-id="${o.id}">
    <td><b>${esc(o.title)}</b><div class="faint">${esc(o.product)} · ${o.id}</div></td>
    <td>${esc(a?.name || '—')}${a?.status === 'CUSTOMER' ? ' <span class="tag">Customer</span>' : ''}</td>
    <td>${pill(o.stage, STAGE_LABEL[o.stage] || o.stage)}</td>
    <td><div class="who">${av(o.ownerId)}${esc(uname(o.ownerId))}</div></td>
    <td>${o.leadId ? `<span class="tag">Lead ${o.leadId}</span>` : `<span class="tag">${esc(o.source)}</span>`}</td>
    <td>${fmtDate(o.closedAt || o.closeDate)}</td>
    <td class="right mono"><b>${inr(o.finalValue || o.value)}</b></td></tr>`; }).join('')}
  </tbody></table></div>` : `<div class="card empty"><div class="big">◆</div>No opportunities match.</div>`}`;
}

function vPipeline() {
  const lanes = OPP_STAGES.map((s) => {
    const list = db.opps.filter((o) => o.stage === s);
    const sum = list.reduce((a, o) => a + (o.finalValue || o.value || 0), 0);
    return `<div class="lane"><div class="lane-h"><h3><span class="dot" style="--c:${STATUS_COLOR[s]}"></span>${STAGE_LABEL[s]}</h3><span class="lane-sum">${list.length} · ${inrShort(sum)}</span></div>
      ${list.map(dealCard).join('') || `<div class="empty faint" style="padding:20px 0">—</div>`}</div>`;
  }).join('');
  const closed = db.opps.filter((o) => ['LOST', 'DISQUALIFIED', 'NURTURE'].includes(o.stage));
  return `<div class="page-h"><div><h1>Pipeline</h1><p>Steps 5–9 · Opportunities move from owner assignment through qualification and quotation to a won order.</p></div></div>
  <div class="board">${lanes}</div>
  <div class="card" style="margin-top:18px"><div class="card-h"><h2>Parked &amp; closed</h2><span class="sub">${closed.length}</span></div>
  ${closed.length ? `<div class="table-wrap"><table><tbody>${closed.map((o) => `<tr class="click" data-act="openOpp" data-id="${o.id}"><td><b>${esc(o.title)}</b></td><td>${pill(o.stage)}</td><td class="sub">${esc(o.reason || '')}${o.nurtureDate ? ' · revisit ' + fmtDate(o.nurtureDate) : ''}</td><td class="right mono">${inr(o.value)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">Nothing parked.</div>`}</div>`;
}
function dealCard(o) {
  const acc = byId('accounts', o.accountId);
  const b = o.bant || {};
  return `<div class="deal" data-act="openOpp" data-id="${o.id}">
    <div style="font-weight:600">${esc(o.title)}</div>
    <div class="faint" style="font-size:12px">${esc(acc?.name || '')} · ${esc(o.product || '')}</div>
    <div class="val">${inr(o.finalValue || o.value)}</div>
    <div class="meta"><span class="bant" title="Budget · Authority · Need · Timeline">${['budget', 'authority', 'need', 'timeline'].map((k) => `<i class="${b[k] ? 'on' : ''}"></i>`).join('')}</span>
    <span style="display:flex;gap:6px;align-items:center">${o.rfp?.received ? '<span class="tag">RFP</span>' : ''}${av(o.ownerId)}</span></div></div>`;
}

/* ════════════════ View: Quotes / Orders / Accounts / Tasks / Audit / Settings ════════════════ */
function vQuotes() {
  const f = ui.quoteFilter;
  const statuses = ['ALL', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVISED'];
  const rows = db.quotes.filter((q) => f === 'ALL' || q.status === f).sort((a, b) => b.createdAt - a.createdAt);
  return `<div class="page-h"><div><h1>Quotations</h1><p>Step 8 · DRAFT → PENDING_APPROVAL → APPROVED → SENT → ACCEPTED, with versioned revisions.</p></div></div>
  <div class="chips">${statuses.map((s) => `<button class="chip ${f === s ? 'on' : ''}" data-act="quoteFilter" data-id="${s}">${s === 'ALL' ? 'All' : s.replace('_', ' ').toLowerCase()}<span class="c">${s === 'ALL' ? db.quotes.length : db.quotes.filter((q) => q.status === s).length}</span></button>`).join('')}</div>
  ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Quote</th><th>Opportunity</th><th>Status</th><th>Valid until</th><th>Max disc.</th><th class="right">Total</th></tr></thead><tbody>
  ${rows.map((q) => { const t = quoteTotals(q); const o = byId('opps', q.oppId); return `<tr class="click" data-act="openQuote" data-id="${q.id}"><td><b>${q.number}</b> <span class="tag">v${q.version}</span></td><td>${esc(o?.title)}</td><td>${pill(q.status)}</td><td>${fmtDate(q.validUntil)}</td><td class="mono">${t.maxDisc}%</td><td class="right mono"><b>${inr(t.total)}</b></td></tr>`; }).join('')}
  </tbody></table></div>` : `<div class="card empty"><div class="big">₹</div>No quotations. Create one from a qualified opportunity.</div>`}`;
}
function vOrders() {
  const rows = [...db.orders].sort((a, b) => b.createdAt - a.createdAt);
  return `<div class="page-h"><div><h1>Sales orders</h1><p>Step 9 · Confirmed orders created from accepted quotations. Won revenue counts confirmed orders only.</p></div></div>
  ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Account</th><th>PO</th><th>Delivery</th><th>Status</th><th class="right">Value</th></tr></thead><tbody>
  ${rows.map((o) => `<tr class="click" data-act="openOrder" data-id="${o.id}"><td><b>${o.id}</b><div class="faint">${fmtDate(o.createdAt)}</div></td><td>${esc(byId('accounts', o.accountId)?.name)}</td><td>${esc(o.poNumber)}</td><td>${fmtDate(o.deliveryDate)}</td><td>${pill(o.status)}</td><td class="right mono"><b>${inr(o.total)}</b></td></tr>`).join('')}
  </tbody></table></div>` : `<div class="card empty"><div class="big">✓</div>No orders yet.</div>`}`;
}
function vAccounts() {
  const f = ui.accFilter || 'ALL', q = (ui.accQ || '').toLowerCase();
  const groups = { ALL: () => true, CUSTOMER: (a) => a.status === 'CUSTOMER', PROSPECT: (a) => a.status === 'PROSPECT' };
  const rows = db.accounts.filter(groups[f]).filter((a) => !q || `${a.name} ${a.gstin || ''} ${a.region || ''} ${db.contacts.filter((c) => c.accountId === a.id).map((c) => `${c.name} ${c.email} ${c.phone}`).join(' ')}`.toLowerCase().includes(q));
  return `<div class="page-h"><div><h1>Accounts</h1><p>Companies behind your contacts. Add existing customers directly, or import your customer list.</p></div>
    <div class="btn-row"><button class="btn" data-act="importCustomers">⇪ Import CSV</button><button class="btn primary" data-act="addCustomer">+ Add customer</button></div></div>
  <div class="chips">${[['ALL', 'All'], ['CUSTOMER', 'Customers'], ['PROSPECT', 'Prospects']].map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-act="accFilter" data-id="${k}">${t}<span class="c">${db.accounts.filter(groups[k]).length}</span></button>`).join('')}</div>
  <div class="toolbar"><input id="accQ" placeholder="Search company, contact, phone, email, GSTIN…" value="${esc(ui.accQ || '')}" /></div>
  ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Account</th><th>Status</th><th>Owner</th><th>Contacts</th><th>Open deals</th><th class="right">Won</th></tr></thead><tbody>
  ${rows.map((a) => { const won = db.orders.filter((o) => o.accountId === a.id && o.status === 'CONFIRMED').reduce((s, o) => s + o.total, 0); return `<tr class="click" data-act="openAccount" data-id="${a.id}"><td><b>${esc(a.name)}</b><div class="faint">${esc(a.region || '')}${a.existing ? ' · existing customer' : ''}${a.gstin ? ' · ' + esc(a.gstin) : ''}</div></td><td>${pill(a.status)}</td><td><div class="who">${av(a.ownerId)}${esc(uname(a.ownerId))}</div></td><td>${db.contacts.filter((c) => c.accountId === a.id).length}</td><td>${db.opps.filter((o) => o.accountId === a.id && OPP_STAGES.slice(0, 4).includes(o.stage)).length}</td><td class="right mono">${won ? inr(won) : '—'}</td></tr>`; }).join('')}
  </tbody></table></div>` : `<div class="card empty"><div class="big">⌂</div>No accounts match.<div style="margin-top:12px"><button class="btn primary" data-act="addCustomer">+ Add customer</button></div></div>`}`;
}
function vTasks() {
  const mine = db.tasks.filter((t) => t.ownerId === db.me);
  const open = mine.filter((t) => !t.done).sort((a, b) => a.due - b.due);
  const done = mine.filter((t) => t.done).slice(0, 10);
  return `<div class="page-h"><div><h1>My tasks</h1><p>Created automatically by assignment, SLAs, nurture and RFP deadlines.</p></div></div>
  <div class="cols"><div class="card"><div class="card-h"><h2>Open</h2><span class="sub">${open.length}</span></div>${open.length ? taskList(open) : '<div class="empty">Nothing open.</div>'}</div>
  <div class="card"><div class="card-h"><h2>Recently done</h2></div>${done.length ? taskList(done) : '<div class="empty">—</div>'}</div></div>`;
}
function vAudit() {
  const q = ui.auditQ.toLowerCase();
  const rows = db.audit.filter((a) => !q || `${a.entity} ${a.entityId} ${a.action} ${a.detail} ${uname(a.actor)}`.toLowerCase().includes(q)).slice(0, 300);
  return `<div class="page-h"><div><h1>Audit trail</h1><p>Every pass, failure, decision and owner change — who, what, when.</p></div>
    <input id="auditQ" placeholder="Filter audit…" value="${esc(ui.auditQ)}" style="max-width:280px" /></div>
  <div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Record</th><th>Action</th><th>Detail</th></tr></thead><tbody>
  ${rows.map((a) => `<tr><td class="faint" style="white-space:nowrap">${fmtTime(a.ts)}</td><td><div class="who">${av(a.actor)}${esc(uname(a.actor))}</div></td><td><a data-act="openRef" data-id="${a.entity}:${a.entityId}">${esc(a.entity)} ${esc(a.entityId)}</a></td><td><b>${esc(a.action)}</b></td><td class="sub">${esc(a.detail)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function vSettings() {
  const s = db.settings, admin = isAdmin();
  const logins = ui.logins || {};
  const signIn = (u) => {
    const l = logins[u.id];
    if (!admin) return '';
    const status = !l ? '<span class="faint">No sign-in</span>'
      : l.locked ? '<span class="sla over">Locked (too many attempts)</span>'
      : l.mustChange ? '<span class="sla soon">Temporary password</span>'
      : `<span class="sla okk">Active</span><small class="faint" style="display:block">${l.lastLogin ? 'last sign-in ' + ago(l.lastLogin) : 'never signed in'}</small>`;
    const btns = !l ? `<button class="btn sm" data-act="issueLogin" data-id="${u.id}">Set up sign-in</button>`
      : `<button class="btn sm ghost" data-act="issueLogin" data-id="${u.id}">Reset password</button>${u.id === db.me ? '' : `<button class="btn sm ghost" data-act="revokeLogin" data-id="${u.id}" title="Remove sign-in">✕</button>`}`;
    return `<td>${status}</td><td><div class="btn-row" style="flex-wrap:nowrap">${btns}</div></td>`;
  };
  const roleCell = (u) => admin && u.id !== db.me
    ? `<select class="urole" data-uid="${u.id}" style="padding:5px 8px;width:auto">${['admin', 'manager', 'rep'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select>`
    : `<span class="tag">${ROLE_LABEL[u.role] || u.role}</span>`;
  const canToggle = (u) => admin ? u.id !== db.me : (isMgr() && u.role === 'rep');
  return `<div class="page-h"><div><h1>Team &amp; rules</h1><p>${admin ? 'Add people, give them a sign-in and choose their role.' : 'You can set reps on leave or inactive. An admin manages roles and sign-ins.'}</p></div>
    <div class="btn-row">${admin ? '<button class="btn primary" data-act="addUser">+ Add user</button><button class="btn bad" data-act="reset">Reset demo data</button>' : ''}</div></div>
  <div class="card"><div class="card-h"><div><h2>Team</h2><div class="sub">${roleHelp()}</div></div></div><div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Region</th><th>Disc. limit</th><th>Load</th>${admin ? '<th>Sign-in</th><th></th>' : ''}<th>Active</th><th>On leave</th></tr></thead><tbody>
  ${db.users.map((u) => `<tr><td><div class="who">${av(u.id)}<div><b>${esc(u.name)}</b>${u.id === db.me ? ' <span class="tag">You</span>' : ''}<small>${esc(u.email || 'no email')}</small></div></div></td>
    <td>${roleCell(u)}</td><td>${admin ? `<select class="uregion" data-uid="${u.id}" style="padding:5px 8px;width:auto">${['All', ...REGIONS].map((r) => `<option ${u.region === r ? 'selected' : ''}>${r}</option>`).join('')}</select>` : esc(u.region)}</td>
    <td>${admin ? `<input class="udisc" type="number" min="0" max="100" data-uid="${u.id}" value="${u.discLimit ?? 10}" style="width:70px;padding:5px 8px" />%` : `${u.discLimit ?? 10}%`}</td><td class="mono">${workload(u.id)}</td>
    ${signIn(u)}
    <td><input type="checkbox" data-act="toggleUser" data-id="${u.id}:active" ${u.active ? 'checked' : ''} ${canToggle(u) ? '' : 'disabled'} /></td>
    <td><input type="checkbox" data-act="toggleUser" data-id="${u.id}:onLeave" ${u.onLeave ? 'checked' : ''} ${canToggle(u) ? '' : 'disabled'} /></td></tr>`).join('')}
  </tbody></table></div></div>
  <div class="cols" style="margin-top:18px"><div class="card"><div class="card-h"><h2>Rules</h2>${admin ? '' : '<span class="tag">Admin only</span>'}</div><div class="stack" style="gap:10px">
    <label class="check ${s.handoff ? 'on' : ''}"><input type="checkbox" data-act="toggleSetting" data-id="handoff" ${s.handoff ? 'checked' : ''} ${admin ? '' : 'disabled'} /><div><b>Hand off opportunities</b><small>Separate callers from owners: account owner → territory → product → workload</small></div></label>
    <label class="check ${s.roundRobin ? 'on' : ''}"><input type="checkbox" data-act="toggleSetting" data-id="roundRobin" ${s.roundRobin ? 'checked' : ''} ${admin ? '' : 'disabled'} /><div><b>Round-robin fallback</b><small>When off, records with no territory match go to the unassigned pool</small></div></label>
    <div class="callout" style="--c:var(--info)"><b>Lead rule order</b><br>Existing account owner (if customer) → region / territory → round-robin by workload.<br><b>First-contact SLA</b><br>${Object.entries(SLA_MIN).map(([k, v]) => `${k}: ${v < 60 ? v + 'm' : v / 60 + 'h'}`).join(' · ')}</div>
    <label class="field"><span>Company name (used in proposals and emails)</span><input id="companyName" value="${esc(s.companyName || '')}" ${admin ? '' : 'disabled'} /></label>
  </div></div>
  <div class="card"><div class="card-h"><h2>What each role can do</h2></div>${roleMatrix()}</div></div>
  <div class="card" style="margin-top:18px"><div class="card-h"><div><h2>Follow-up reminders</h2><div class="sub">Makes sure every assigned lead and deal is followed up</div></div>${isMgr() ? '<button class="btn" data-act="runReminders">Send due reminders now</button>' : ''}</div>
    <div id="remStatus" class="sub">Loading…</div></div>`;
}
function roleHelp() {
  const n = (r) => db.users.filter((u) => u.role === r && u.active).length;
  return `${n('admin')} admin · ${n('manager')} manager${n('manager') === 1 ? '' : 's'} · ${n('rep')} rep${n('rep') === 1 ? '' : 's'}`;
}
function roleMatrix() {
  const rows = [
    ['See all leads, deals and accounts', '✓', '✓', 'Own + unassigned'],
    ['Work own leads, calls, deals, quotes', '✓', '✓', '✓'],
    ['Claim from the unassigned pool', '✓', '✓', '✓'],
    ['Assign / reassign to others', '✓', '✓', '—'],
    ['Approve discounts above the limit', '✓', '✓', 'Within own limit'],
    ['Merge duplicates, reopen lost deals', '✓', '✓', '—'],
    ['Nudge owners, run reminders', '✓', '✓', '—'],
    ['Set reps on leave / inactive', '✓', '✓', '—'],
    ['Users, roles, sign-ins, rules, reset', '✓', '—', '—'],
  ];
  return `<div class="table-wrap"><table class="matrix"><thead><tr><th></th><th>Admin</th><th>Manager</th><th>Rep</th></tr></thead><tbody>${rows.map(([t, ...c]) => `<tr><td>${t}</td>${c.map((x) => `<td class="${x === '✓' ? 'yes' : x === '—' ? 'no' : 'part'}">${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
async function loadLogins() {
  if (!isAdmin()) return;
  try {
    const rows = await SriStore.api('/api/admin/logins', { quiet: true });
    ui.logins = Object.fromEntries(rows.map((r) => [r.userId, r]));
    if (ui.view === 'settings') { $('#view').innerHTML = vSettings(); loadReminderStatus(); }
  } catch (e) { /* not admin or offline */ }
}
function showTempPassword(r, name) {
  modal({
    title: `Sign-in for ${esc(name)}`, sub: 'Share this privately. It is shown only once — they must change it when they first sign in.', submit: 'Done',
    body: `<div class="temp-pass"><div><span class="sub">Email</span><b>${esc(r.email)}</b></div><div><span class="sub">Temporary password</span><code id="tmpPw">${esc(r.tempPassword)}</code></div>
      <button type="button" class="btn sm" id="copyPw">⧉ Copy both</button></div>
      <div class="sub">Sign in at <b>${esc(location.origin)}</b></div>`,
    onMount: (f) => { $('#copyPw', f).onclick = async () => { try { await navigator.clipboard.writeText(`SriLead sign-in\n${location.origin}\nEmail: ${r.email}\nTemporary password: ${r.tempPassword}`); toast('Copied', 'Paste it into a private message', 'var(--ok)'); } catch (e) { toast('Copy blocked', 'Select and copy the password manually', 'var(--warn)'); } }; },
    onSubmit: () => { loadLogins(); },
  });
}
async function loadReminderStatus() {
  const el = $('#remStatus'); if (!el) return;
  try {
    const r = await fetch('/api/reminders/status').then((x) => x.json());
    const missing = db.users.filter((u) => u.active && !u.email).map((u) => u.name);
    el.innerHTML = `<div class="rem-grid">
      <div class="rem"><b>🔔 In-app</b><span>Always on. Each person's bell shows their overdue and due-soon follow-ups plus new assignments.</span></div>
      <div class="rem"><b>⏰ Before due</b><span>Email to the owner ${r.beforeMin} min before a follow-up is due.</span></div>
      <div class="rem"><b>⚠ Overdue</b><span>Email to the owner once it is past due.</span></div>
      <div class="rem"><b>🚩 Escalation</b><span>Email to managers ${r.escalateAfterMin >= 60 ? r.escalateAfterMin / 60 + ' h' : r.escalateAfterMin + ' min'} after the due time — straight away if the owner is on leave.</span></div>
      <div class="rem"><b>☀ Daily digest</b><span>Each person's overdue and due-today list at ${String(r.digestHour).padStart(2, '0')}:00.</span></div></div>
      <div class="callout" style="--c:${r.emailEnabled ? 'var(--ok)' : 'var(--warn)'};margin-top:12px">${r.emailEnabled
        ? `<b>Email reminders are on.</b> Checked every ${r.intervalMin} min.${r.lastRun ? ` Last run ${ago(r.lastRun.at)} · ${r.lastRun.sent} sent.` : ''}`
        : '<b>Email reminders are off</b> — add the SMTP settings to <code>.env</code> (see <code>.env.example</code>) and restart the server. In-app reminders still work.'}
        ${missing.length ? `<br>No email address yet for: ${missing.map(esc).join(', ')}.` : ''}</div>`;
  } catch (e) { el.textContent = 'Could not load reminder status.'; }
}

/* ════════════════ Drawer ════════════════ */
function openDrawer(type, id) { ui.drawer = { type, id }; renderDrawer(); $('#drawer').classList.add('on'); $('#scrim').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false'); }
function closeDrawer() { ui.drawer = null; $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); }
function renderDrawer() {
  const { type, id } = ui.drawer;
  const fn = { lead: dLead, opp: dOpp, quote: dQuote, order: dOrder, account: dAccount }[type];
  const rec = byId({ lead: 'leads', opp: 'opps', quote: 'quotes', order: 'orders', account: 'accounts' }[type], id);
  if (!rec) return closeDrawer();
  const scroll = $('.d-body')?.scrollTop || 0;
  $('#drawer').innerHTML = fn(rec);
  if ($('.d-body')) $('.d-body').scrollTop = scroll;
}
const head = (kicker, title, right, extra = '') => `<div class="d-head"><div class="d-top"><div><div class="d-kicker">${kicker}</div><h2 style="font-size:21px">${title}</h2></div><div style="display:flex;gap:8px;align-items:center">${right}<button class="x" data-act="closeDrawer" aria-label="Close">×</button></div></div>${extra}</div>`;
const kv = (pairs) => `<div class="kv">${pairs.map(([k, v]) => `<div><span>${k}</span><b>${v || '—'}</b></div>`).join('')}</div>`;
const sec = (t, body) => `<div class="d-sec"><h4>${t}</h4>${body}</div>`;
function remindersSec(rec, type) {
  const open = db.tasks.filter((t) => !t.done && t.ref?.id === rec.id).sort((a, b) => a.due - b.due);
  const canNudge = isMgr() && rec.ownerId && rec.ownerId !== db.me;
  if (!open.length && !canNudge) return '';
  const label = { due_soon: 'Due-soon email', overdue: 'Overdue email', escalated: 'Escalation email', digest: 'Daily digest' };
  const log = ui.remLog?.[rec.id];
  if (!log) setTimeout(() => fetch('/api/reminders/log?ref=' + encodeURIComponent(rec.id)).then((r) => r.json()).then((rows) => { ui.remLog = { ...(ui.remLog || {}), [rec.id]: rows }; if (ui.drawer?.id === rec.id) renderDrawer(); }).catch(() => {}), 0);
  return sec('Follow-ups & reminders', `${open.length ? `<div class="tl">${open.map((t) => `<div class="tl-i" style="--c:${t.due < now() ? 'var(--bad)' : 'var(--warn)'}"><div class="what"><b>${esc(t.title)}</b></div><div class="when">${esc(uname(t.ownerId))} · <span class="${t.due < now() ? 'sla over' : ''}">${t.due < now() ? dur(t.due - now()) : 'due ' + fmtTime(t.due)}</span></div></div>`).join('')}</div>` : '<div class="faint">No open follow-ups.</div>'}
    ${log?.length ? `<div class="sub" style="margin-top:10px">Reminders sent: ${log.slice(0, 6).map((x) => `${label[x.kind] || x.kind} → ${esc(x.recipient)} (${fmtTime(new Date(x.sent_at).getTime())})`).join(' · ')}</div>` : ''}
    ${canNudge ? `<div class="btn-row" style="margin-top:10px"><button class="btn sm" data-act="nudge" data-id="${type}:${rec.id}">🔔 Nudge ${esc(uname(rec.ownerId).split(' ')[0])}</button></div>` : ''}`);
}
const recAudit = (id) => timeline(db.audit.filter((a) => a.entityId === id || a.detail.includes(id)).slice(0, 25));
const historyList = (h) => h?.length ? `<div class="tl">${h.map((x) => `<div class="tl-i"><div class="what">${esc(uname(x.from))} → <b>${esc(uname(x.to))}</b></div><div class="when">${esc(x.reason)} · by ${esc(uname(x.by))} · ${fmtTime(x.ts)}</div></div>`).join('')}</div>` : '<div class="faint">No owner changes.</div>';

function leadStep(l) {
  if (['REJECTED', 'NEW'].includes(l.status)) return 1;
  if (['DUPLICATE', 'PENDING_REVIEW'].includes(l.status)) return l.reviewType === 'account' ? 3 : 2;
  if (l.status === 'CONVERTED') return 5;
  return 4;
}
function dLead(l) {
  const s = slaState(l);
  const contact = byId('contacts', l.contactId), acc = byId('accounts', l.accountId);
  const step = leadStep(l);
  const prog = `<div class="prog">${['Lead', 'Validate', 'Contact', 'Call', 'Opportunity'].map((t, i) => `<div class="${i + 1 < step ? 'done' : i + 1 === step ? 'cur' : ''}"><i></i><span>${t}</span></div>`).join('')}</div>`;
  const working = ['VALIDATED', 'CONTACTED', 'INTERESTED'].includes(l.status);
  const mineOrMgr = l.ownerId === db.me || isMgr();
  let actions = '';
  if (working && l.ownerId) {
    actions = `<div class="actions-bar">
      <button class="btn primary" data-act="logCall" data-id="${l.id}" ${mineOrMgr ? '' : 'disabled'}>☎ Log call</button>
      ${l.status === 'CONTACTED' ? `<button class="btn" data-act="markInterested" data-id="${l.id}">★ Mark interested</button>` : ''}
      <button class="btn ok" data-act="createOpp" data-id="${l.id}" ${hasConnected(l) ? '' : 'disabled title="Needs a connected call first"'}>→ Create opportunity</button>
      <button class="btn warn" data-act="nurtureLead" data-id="${l.id}">⏸ Nurture</button>
      <button class="btn bad" data-act="closeLead" data-id="${l.id}">✕ Close</button>
      ${isMgr() ? `<button class="btn ghost" data-act="assignLead" data-id="${l.id}">⇄ Reassign</button>` : ''}
    </div>${!hasConnected(l) ? `<div class="sub">An opportunity can only be created after at least one <b>connected</b> call.</div>` : ''}`;
  } else if (working && !l.ownerId) {
    actions = `<div class="actions-bar"><button class="btn primary" data-act="claimLead" data-id="${l.id}">Claim</button>${isMgr() ? `<button class="btn" data-act="assignLead" data-id="${l.id}">Assign</button>` : ''}</div>`;
  } else if (l.status === 'REJECTED') {
    actions = `<div class="callout" style="--c:var(--bad)"><b>Rejected:</b> ${esc(l.reason)}</div><div class="actions-bar"><button class="btn primary" data-act="editLead" data-id="${l.id}">✎ Correct &amp; resubmit</button></div>`;
  } else if (l.status === 'DUPLICATE') {
    const d = byId('leads', l.dupOf);
    actions = `<div class="callout" style="--c:var(--warn)"><b>Duplicate.</b> No new record was created — the enquiry was logged on <a data-act="openLead" data-id="${d?.id}">${esc(d?.name)} (${d?.id})</a> and its owner was notified.</div>`;
  } else if (l.status === 'PENDING_REVIEW') {
    if (l.reviewType === 'duplicate') {
      const d = byId('leads', l.reviewOf);
      actions = `<div class="callout" style="--c:var(--warn)"><b>Probable duplicate</b> — same name &amp; company, similar email.<br>Existing: <a data-act="openLead" data-id="${d.id}">${esc(d.name)}</a> · ${esc(d.email)} · ${esc(d.phone)}<br>This one: ${esc(l.email)} · ${esc(l.phone)}</div>
      ${l.aiDedupe ? `<div class="ai-card"><div class="ai-card-h"><b>✨ AI comparison</b><span class="pill" style="--c:${l.aiDedupe.verdict === 'same_person' ? 'var(--warn)' : l.aiDedupe.verdict === 'different_people' ? 'var(--ok)' : 'var(--info)'}">${esc(l.aiDedupe.verdict.replace(/_/g, ' '))}</span><span class="faint">${esc(l.aiDedupe.confidence)} confidence</span></div><ul class="ai-q">${l.aiDedupe.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><div class="faint" style="font-size:11.5px">Advice only — a manager makes the call.</div></div>` : ''}
      <div class="actions-bar">${isMgr() ? `<button class="btn primary" data-act="reviewMerge" data-id="${l.id}">Merge into ${d.id}</button><button class="btn" data-act="reviewKeep" data-id="${l.id}">Keep separate</button>${aiAct('Compare with AI', 'aiDedupe', l.id)}` : '<span class="sub">Waiting for a manager / sales-ops decision.</span>'}</div>`;
    } else {
      actions = `<div class="callout" style="--c:var(--warn)"><b>Ambiguous account match</b> for “${esc(l.company)}”. Pick the right one.</div>
      <div class="actions-bar">${(l.candidates || []).map((id) => `<button class="btn" data-act="reviewAccount" data-id="${l.id}:${id}">${esc(byId('accounts', id)?.name)}</button>`).join('')}<button class="btn primary" data-act="reviewAccount" data-id="${l.id}:new">+ New account</button></div>`;
    }
  } else if (l.status === 'NURTURE') {
    actions = `<div class="callout" style="--c:var(--warn)"><b>Nurture:</b> ${esc(l.reason)} · revisit ${fmtDate(l.nurtureDate)}</div><div class="actions-bar"><button class="btn" data-act="reviveLead" data-id="${l.id}">↻ Re-engage now</button></div>`;
  } else if (l.status.startsWith('CLOSED')) {
    actions = `<div class="callout" style="--c:var(--faint)"><b>${l.status === 'CLOSED_UNREACHABLE' ? 'Closed (unreachable)' : 'Closed'}:</b> ${esc(l.reason)}</div>`;
  } else if (l.status === 'CONVERTED') {
    const n = leadOpps(l.id).length;
    actions = `<div class="callout" style="--c:var(--ok)"><b>Converted</b> into ${n} opportunit${n === 1 ? 'y' : 'ies'}. The same lead can raise more deals (for example a different product).</div>
      <div class="actions-bar"><button class="btn primary" data-act="createOpp" data-id="${l.id}">+ Another opportunity</button><button class="btn" data-act="logCall" data-id="${l.id}" ${mineOrMgr ? '' : 'disabled'}>☎ Log call</button></div>`;
  }
  const lo = leadOpps(l.id);
  const oppSec = lo.length ? sec(`Opportunities · ${lo.length}`, `<div class="table-wrap"><table><tbody>${lo.map((o) => `<tr class="click" data-act="openOpp" data-id="${o.id}"><td><b>${esc(o.title)}</b><div class="faint">${esc(o.product)}</div></td><td>${pill(o.stage, STAGE_LABEL[o.stage] || o.stage)}</td><td class="right mono">${inr(o.finalValue || o.value)}</td></tr>`).join('')}</tbody></table></div>`) : '';
  return head(`Lead · ${l.id} · ${esc(l.source)}`, esc(l.name || '(no name)'), pill(l.status), prog) + `<div class="d-body">
    ${actions}
    ${oppSec}
    ${sec('Details', kv([['Phone', esc(l.phone || l.raw?.phone)], ['Email', esc(l.email || l.raw?.email)], ['Company', esc(l.company)], ['Designation', esc(l.designation)], ['Region', esc(l.region)], ['Product interest', esc(l.product)], ['Owner', `${esc(uname(l.ownerId))}`], ['First-contact SLA', s ? `<span class="sla ${s.cls}">${dur(s.left)}</span>` : '—'], ['Requirement', esc(l.requirement)], ['Created', fmtTime(l.createdAt)]]))}
    ${contact || acc ? sec('Linked records', kv([['Contact', contact ? `${esc(contact.name)} <span class="faint">${contact.id}</span>` : '—'], ['Account', acc ? `<a data-act="openAccount" data-id="${acc.id}">${esc(acc.name)}</a> ${pill(acc.status)}` : '—']])) : ''}
    ${l.calls?.length ? sec(`Calls · ${l.calls.length} (${l.attempts} not connected, max ${MAX_ATTEMPTS})`, `<div class="tl">${[...l.calls].reverse().map((c) => `<div class="tl-i" style="--c:${c.outcome === 'Connected' ? 'var(--ok)' : 'var(--warn)'}"><div class="what"><b>${esc(c.outcome)}</b>${c.duration ? ` · ${c.duration} min` : ''} ${c.notes ? `<span class="sub">— ${esc(c.notes)}</span>` : ''}</div>${c.ai ? `<div class="ai-line">✨ ${esc(c.ai.interest)} interest · ${esc(c.ai.summary)}</div>` : ''}<div class="when">${fmtTime(c.ts)} · ${esc(uname(c.by))}${c.next ? ' · next: ' + esc(c.next) : ''}</div></div>`).join('')}</div>`) : ''}
    ${l.activities?.length ? sec('Activities', `<div class="tl">${l.activities.map((a) => `<div class="tl-i"><div class="what">${esc(a.text)}</div><div class="when">${fmtTime(a.ts)}</div></div>`).join('')}</div>`) : ''}
    ${remindersSec(l, 'lead')}
    ${sec('Assignment history', historyList(l.history))}
    ${sec('Raw intake payload', `<pre style="margin:0;padding:12px;border-radius:10px;background:var(--panel);border:1px solid var(--border);font-size:12px;overflow:auto;color:var(--muted)">${esc(JSON.stringify(l.raw, null, 2))}</pre>`)}
    ${sec('Audit', recAudit(l.id))}
  </div>`;
}

function dOpp(o) {
  const acc = byId('accounts', o.accountId), c = byId('contacts', o.contactId);
  const idx = OPP_STAGES.indexOf(o.stage);
  const prog = `<div class="prog">${OPP_STAGES.map((s, i) => `<div class="${idx > i ? 'done' : idx === i ? 'cur' : ''}"><i></i><span>${STAGE_LABEL[s]}</span></div>`).join('')}</div>`;
  const b = o.bant || {};
  const allB = ['budget', 'authority', 'need', 'timeline'].every((k) => b[k]);
  const open = OPP_STAGES.slice(0, 4).includes(o.stage);
  const quotes = db.quotes.filter((q) => q.oppId === o.id).sort((a, b2) => b2.createdAt - a.createdAt);
  let actions = '';
  if (!o.ownerId && open) actions = `<div class="actions-bar"><button class="btn primary" data-act="claimOpp" data-id="${o.id}">Claim</button>${isMgr() ? `<button class="btn" data-act="assignOpp" data-id="${o.id}">Assign</button>` : ''}</div>`;
  else if (o.stage === 'ASSIGNED') actions = `<div class="actions-bar"><button class="btn primary" data-act="startQualify" data-id="${o.id}">▶ Accept &amp; start qualification</button>${isMgr() ? `<button class="btn ghost" data-act="assignOpp" data-id="${o.id}">⇄ Reassign</button>` : ''}</div>`;
  else if (o.stage === 'QUALIFYING') actions = `<div class="actions-bar"><button class="btn ok" data-act="qualify" data-id="${o.id}" ${allB ? '' : 'disabled title="Complete the BANT checklist"'}>✓ Mark qualified</button><button class="btn warn" data-act="nurtureOpp" data-id="${o.id}">⏸ Not ready yet</button><button class="btn bad" data-act="disqualify" data-id="${o.id}">✕ Disqualify</button>${isMgr() ? `<button class="btn ghost" data-act="assignOpp" data-id="${o.id}">⇄ Reassign</button>` : ''}</div>`;
  else if (o.stage === 'QUALIFIED') actions = `<div class="actions-bar"><button class="btn primary" data-act="newQuote" data-id="${o.id}">₹ Build quotation</button><button class="btn bad" data-act="disqualify" data-id="${o.id}">✕ Lost</button></div>`;
  else if (o.stage === 'QUOTED') { const lq = latestQuote(o.id); actions = `<div class="actions-bar"><button class="btn primary" data-act="openQuote" data-id="${lq?.id}">Open ${lq?.number} v${lq?.version} →</button></div>`; }
  else if (['LOST', 'DISQUALIFIED'].includes(o.stage)) actions = `<div class="callout" style="--c:var(--bad)"><b>${o.stage}:</b> ${esc(o.reason)}${o.competitor ? ' · competitor: ' + esc(o.competitor) : ''}</div>${isMgr() ? `<div class="actions-bar"><button class="btn" data-act="reopenOpp" data-id="${o.id}">↻ Reopen (manager)</button></div>` : '<div class="sub">Only a manager can reopen.</div>'}`;
  else if (o.stage === 'NURTURE') actions = `<div class="callout" style="--c:var(--warn)"><b>Nurture:</b> ${esc(o.reason)} · revisit ${fmtDate(o.nurtureDate)}</div><div class="actions-bar"><button class="btn" data-act="resumeOpp" data-id="${o.id}">↻ Resume qualification</button></div>`;
  else if (o.stage === 'WON') { const ord = db.orders.find((x) => x.oppId === o.id); actions = `<div class="callout" style="--c:var(--ok)"><b>Won</b> · ${inr(o.finalValue)} · closed ${fmtDate(o.closedAt)}${ord ? ` · <a data-act="openOrder" data-id="${ord.id}">${ord.id}</a>` : ''}</div>`; }

  const canEditQ = ['QUALIFYING', 'ASSIGNED'].includes(o.stage) && o.ownerId;
  const bantHead = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px"><span class="sub">Tick only what the customer has confirmed.</span>${['ASSIGNED', 'QUALIFYING', 'QUALIFIED'].includes(o.stage) ? aiAct('AI qualification check', 'aiQualify', o.id) : ''}</div>`;
  const bant = sec('Qualification checklist (BANT)', bantHead + aiQualifyCard(o, canEditQ) + `<div class="checks">${[['budget', 'Budget', 'Funds are available'], ['authority', 'Authority', 'We know who decides'], ['need', 'Need', 'Clear, documented requirement'], ['timeline', 'Timeline', 'A date to decide / go live']].map(([k, t, d]) => `<label class="check ${b[k] ? 'on' : ''}"><input type="checkbox" data-act="toggleBant" data-id="${o.id}:${k}" ${b[k] ? 'checked' : ''} ${canEditQ ? '' : 'disabled'} /><div><b>${t}</b><small>${d}</small></div></label>`).join('')}</div>`);
  const r = o.rfp || {};
  const rfp = sec('RFP', r.received
    ? kv([['Received', fmtDate(r.date)], ['Submission deadline', `${fmtDate(r.deadline)} ${r.deadline && OPP_STAGES.slice(0, 3).includes(o.stage) ? `<span class="sla ${new Date(r.deadline) < now() ? 'over' : 'soon'}">(${dur(new Date(r.deadline) - now())})</span>` : ''}`], ['Attachment', esc(r.file)], ['Bid decision', esc(r.decision || 'Pending')]]) + (canEditQ || o.stage === 'QUALIFIED' ? `<div style="margin-top:10px"><button class="btn sm" data-act="editRfp" data-id="${o.id}">Edit RFP</button></div>` : '')
    : `<div class="sub" style="display:flex;justify-content:space-between;align-items:center;gap:10px">No RFP recorded.${canEditQ ? `<button class="btn sm" data-act="editRfp" data-id="${o.id}">+ Record RFP</button>` : ''}</div>`);
  const docOpen = ['ASSIGNED', 'QUALIFYING', 'QUALIFIED', 'QUOTED'].includes(o.stage);
  const docLabel = r.received ? 'RFP response' : 'Proposal';
  const rd = o.rfpDoc;
  const rfpDocSec = (docOpen || rd) ? sec(docLabel, rd
    ? `<div class="doc-card"><span class="ic">📄</span><div style="flex:1;min-width:0"><b>${esc(rd.title)}</b><small>v${rd.version} · ${rd.sections.length} sections${rd.aiDrafted ? ' · AI-assisted' : ''} · ${rd.status === 'SENT' ? `sent ${fmtTime(rd.sentAt)}` : `draft saved ${ago(rd.updatedAt)}`}</small></div>${pill(rd.status === 'SENT' ? 'SENT' : 'DRAFT')}</div>
       <div class="btn-row" style="margin-top:10px">${docOpen ? `<button class="btn sm" data-act="rfpEdit" data-id="${o.id}">✎ ${rd.status === 'SENT' ? 'Revise' : 'Edit'}</button>` : ''}<button class="btn sm ghost" data-act="rfpPreview" data-id="${o.id}">⎙ Preview / PDF</button>${docOpen ? `<button class="btn sm primary" data-act="rfpSend" data-id="${o.id}">✉ ${rd.status === 'SENT' ? 'Resend' : 'Send to customer'}</button>` : ''}</div>`
    : `<div class="sub" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">${r.received ? `Customer RFP received — draft your response${r.deadline ? ` before ${fmtDate(r.deadline)}` : ''}.` : 'Draft a written proposal for this deal.'}<button class="btn sm primary" data-act="rfpEdit" data-id="${o.id}">✍ Draft ${docLabel.toLowerCase()}</button></div>`) : '';
  return head(`Opportunity · ${o.id}`, esc(o.title), pill(o.stage, STAGE_LABEL[o.stage] || o.stage), prog) + `<div class="d-body">
    ${actions}
    ${sec('Deal', kv([['Estimated value', `<span class="num" style="font-size:18px">${inr(o.value)}</span>`], ['Expected close', fmtDate(o.closeDate)], ['Account', acc ? `<a data-act="openAccount" data-id="${acc.id}">${esc(acc.name)}</a>` : '—'], ['Contact', c ? `${esc(c.name)} · ${esc(c.phone)}` : '—'], ['Product', esc(o.product)], ['Owner', `${esc(uname(o.ownerId))}`], ['Source', esc(o.source)], ['Origin', o.leadId ? `Lead <a data-act="openLead" data-id="${o.leadId}">${o.leadId}</a>` : `${esc(o.source)} · from account`], ['Summary', esc(o.summary)]]))}
    ${bant}${rfp}${rfpDocSec}
    ${quotes.length ? sec('Quotations', `<div class="table-wrap"><table><tbody>${quotes.map((q) => `<tr class="click" data-act="openQuote" data-id="${q.id}"><td><b>${q.number}</b> v${q.version}</td><td>${pill(q.status)}</td><td class="right mono">${inr(quoteTotals(q).total)}</td></tr>`).join('')}</tbody></table></div>`) : ''}
    ${o.activities?.length ? sec('Activities', `<div class="tl">${o.activities.map((a) => `<div class="tl-i"><div class="what">${esc(a.text)}</div><div class="when">${fmtTime(a.ts)}</div></div>`).join('')}</div>`) : ''}
    ${(() => { const ld = byId('leads', o.leadId); return ld?.calls?.length ? sec('Call notes carried over', `<div class="tl">${ld.calls.filter((x) => x.notes).map((x) => `<div class="tl-i"><div class="what">${esc(x.notes)}</div><div class="when">${fmtTime(x.ts)} · ${esc(uname(x.by))}</div></div>`).join('') || '<span class="faint">—</span>'}</div>`) : ''; })()}
    ${o.emails?.length ? sec(`Emails sent · ${o.emails.length}`, emailList(o.emails)) : ''}
    ${remindersSec(o, 'opp')}
    ${sec('Assignment history', historyList(o.history))}
    ${sec('Audit', recAudit(o.id))}
  </div>`;
}

function quoteTable(q) {
  const t = quoteTotals(q);
  return `<div class="table-wrap"><table><thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Disc.</th><th class="right">Amount</th></tr></thead><tbody>
  ${q.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="right mono">${i.qty}</td><td class="right mono">${inr(i.price)}</td><td class="right mono">${i.disc || 0}%</td><td class="right mono">${inr(i.qty * i.price * (1 - (i.disc || 0) / 100))}</td></tr>`).join('')}
  </tbody></table></div><div class="totals" style="margin-top:12px"><div><span class="sub">Subtotal</span><span class="mono">${inr(t.sub)}</span></div><div><span class="sub">GST ${GST}%</span><span class="mono">${inr(t.gst)}</span></div><div class="grand"><span>Total</span><span>${inr(t.total)}</span></div></div>`;
}
function dQuote(q) {
  const o = byId('opps', q.oppId);
  const t = quoteTotals(q);
  const limit = user(o?.ownerId)?.discLimit ?? 10;
  const versions = db.quotes.filter((x) => x.number === q.number).sort((a, b) => a.version - b.version);
  const flow = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED'];
  const fi = flow.indexOf(q.status);
  const prog = fi >= 0 ? `<div class="prog">${flow.map((s, i) => `<div class="${fi > i ? 'done' : fi === i ? 'cur' : ''}"><i></i><span>${s.replace('_', ' ').toLowerCase()}</span></div>`).join('')}</div>` : '';
  let actions = '';
  const order = db.orders.find((x) => x.quoteId === q.id);
  if (q.status === 'DRAFT') actions = `<button class="btn" data-act="editQuote" data-id="${q.id}">✎ Edit</button><button class="btn primary" data-act="submitQuote" data-id="${q.id}">${t.maxDisc > limit ? 'Submit for approval' : 'Approve (within limit)'}</button>`;
  else if (q.status === 'PENDING_APPROVAL') actions = isMgr() ? `<button class="btn ok" data-act="approveQuote" data-id="${q.id}">✓ Approve discount</button><button class="btn bad" data-act="rejectApproval" data-id="${q.id}">Send back to draft</button>` : `<span class="sub">Waiting for manager approval — max discount ${t.maxDisc}% exceeds the ${limit}% limit.</span>`;
  else if (q.status === 'APPROVED') actions = `<button class="btn primary" data-act="sendQuote" data-id="${q.id}">✉ Email to customer</button><button class="btn ghost" data-act="previewQuote" data-id="${q.id}">⎙ Preview / PDF</button>`;
  else if (q.status === 'SENT') actions = `<button class="btn ok" data-act="acceptQuote" data-id="${q.id}">✓ Customer accepted</button><button class="btn" data-act="reviseQuote" data-id="${q.id}">↻ Revise (v${q.version + 1})</button><button class="btn bad" data-act="declineQuote" data-id="${q.id}">✕ Declined / no response</button><button class="btn" data-act="followQuote" data-id="${q.id}">✉ Follow up</button><button class="btn ghost" data-act="previewQuote" data-id="${q.id}">⎙ View PDF</button>`;
  else if (q.status === 'ACCEPTED') actions = order ? `<a data-act="openOrder" data-id="${order.id}">Sales order ${order.id} →</a>` : `<button class="btn primary" data-act="convertQuote" data-id="${q.id}">→ Convert to sales order</button>`;
  return head(`Quotation · ${q.number} · version ${q.version}`, esc(o?.title || ''), pill(q.status), prog) + `<div class="d-body">
    ${q.status === 'REVISED' ? `<div class="callout" style="--c:var(--faint)"><b>Read-only.</b> Superseded by a newer version.</div>` : ''}
    ${['REJECTED', 'EXPIRED'].includes(q.status) ? `<div class="callout" style="--c:var(--bad)"><b>${q.status}.</b> ${esc(q.reason || '')} — opportunity marked lost.</div>` : ''}
    ${actions ? `<div class="actions-bar">${actions}</div>` : ''}
    ${t.maxDisc > limit && q.status !== 'DRAFT' && q.approvedBy ? `<div class="callout" style="--c:var(--ok)"><b>Discount approved</b> by ${esc(uname(q.approvedBy))} (${t.maxDisc}% &gt; ${limit}% rep limit)</div>` : ''}
    ${(() => { const m = (o?.emails || []).filter((e) => e.quoteId === q.id); return m.length ? sec('Emails', emailList(m)) : ''; })()}
    ${sec('Line items', quoteTable(q))}
    ${sec('Terms', kv([['Valid until', fmtDate(q.validUntil)], ['Rep discount limit', limit + '%'], ['Terms', esc(q.terms)], ['Acceptance proof', q.proof ? `${esc(q.proof)} · ${esc(q.proofRef)}` : '—']]))}
    ${versions.length > 1 ? sec('Versions', `<div class="table-wrap"><table><tbody>${versions.map((v) => `<tr class="click" data-act="openQuote" data-id="${v.id}"><td><b>v${v.version}</b>${v.id === q.id ? ' <span class="faint">(viewing)</span>' : ''}</td><td>${pill(v.status)}</td><td class="right mono">${inr(quoteTotals(v).total)}</td></tr>`).join('')}</tbody></table></div>`) : ''}
    ${sec('Audit', recAudit(q.id))}
  </div>`;
}
function dOrder(o) {
  const acc = byId('accounts', o.accountId); const q = byId('quotes', o.quoteId);
  return head(`Sales order · ${o.id}`, esc(acc?.name), pill(o.status)) + `<div class="d-body">
    ${o.status === 'CANCELLED' ? `<div class="callout" style="--c:var(--bad)"><b>Cancelled:</b> ${esc(o.reason)} — revenue adjusted. A new order is needed if the customer returns.</div>` : `<div class="actions-bar"><button class="btn bad" data-act="cancelOrder" data-id="${o.id}">Cancel order</button></div>`}
    ${sec('Order', kv([['Total', `<span class="num" style="font-size:18px">${inr(o.total)}</span>`], ['From quotation', q ? `<a data-act="openQuote" data-id="${q.id}">${q.number} v${q.version}</a>` : '—'], ['Customer PO', esc(o.poNumber)], ['PO date', fmtDate(o.poDate)], ['Delivery date', fmtDate(o.deliveryDate)], ['Payment terms', esc(o.paymentTerms)], ['Delivery address', esc(o.deliveryAddr)], ['Billing address', esc(o.billingAddr)]]))}
    ${q ? sec('Items (copied from quotation)', quoteTable(q)) : ''}
    ${sec('Audit', recAudit(o.id))}
  </div>`;
}
function dAccount(a) {
  const contacts = db.contacts.filter((c) => c.accountId === a.id);
  const opps = db.opps.filter((o) => o.accountId === a.id);
  const won = db.orders.filter((o) => o.accountId === a.id && o.status === 'CONFIRMED');
  return head(`Account · ${a.id}`, esc(a.name), pill(a.status)) + `<div class="d-body">
    <div class="actions-bar"><button class="btn primary" data-act="newAccountOpp" data-id="${a.id}">+ New opportunity</button>${isMgr() || !a.ownerId || a.ownerId === db.me ? `<button class="btn" data-act="editAccount" data-id="${a.id}">✎ Edit</button>` : ''}<button class="btn" data-act="addContact" data-id="${a.id}">+ Contact</button>
      <span class="sub" style="align-self:center;flex-basis:100%">${a.status === 'CUSTOMER' ? `Existing customer · ${won.length} won order${won.length === 1 ? '' : 's'} — upsell or repeat business goes straight to the pipeline.` : 'Start a deal for a known contact without a new lead.'}</span></div>
    ${sec('Details', kv([['Owner', esc(uname(a.ownerId))], ['Region', esc(a.region)], ['GSTIN', esc(a.gstin)], ['PAN', esc(a.pan)], ['Customer since', a.since ? fmtDate(a.since) : '—'], ['Industry', esc(a.industry)], ['Billing address', esc(a.billingAddr)], ['Added', a.existing ? `Existing customer · ${esc(a.addedVia || 'manual')}` : 'From a lead'], ...(a.notes ? [['Notes', esc(a.notes)]] : [])]))}
    ${sec(`Contacts · ${contacts.length}`, contacts.map((c) => `<div class="who" style="margin-bottom:8px"><span class="avatar sm">${initials(c.name)}</span><div><b>${esc(c.name)}</b>${c.primary ? ' <span class="tag">Primary</span>' : ''}<small>${[c.designation, c.phone, c.email].filter(Boolean).map(esc).join(' · ')}</small></div></div>`).join('') || '<span class="faint">No contacts yet — add one to start opportunities.</span>')}
    ${sec(`Opportunities · ${opps.length}`, opps.length ? `<div class="table-wrap"><table><tbody>${opps.map((o) => `<tr class="click" data-act="openOpp" data-id="${o.id}"><td>${esc(o.title)}</td><td>${pill(o.stage)}</td><td class="right mono">${inr(o.finalValue || o.value)}</td></tr>`).join('')}</tbody></table></div>` : '—')}
    ${sec('Audit', recAudit(a.id))}
  </div>`;
}

/* ════════════════ Modal ════════════════ */
function modal({ title, sub = '', body, submit = 'Save', kind = 'primary', wide = false, onSubmit, onMount }) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay"><form class="modal ${wide ? 'wide' : ''}" novalidate><header><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button type="button" class="x" data-close>×</button></header>
    <div class="mbody">${body}</div><footer><button type="button" class="btn ghost" data-close>Cancel</button>${submit ? `<button class="btn ${kind}" type="submit">${submit}</button>` : ''}</footer></form></div>`;
  const form = $('form', root);
  $$('[data-close]', root).forEach((b) => (b.onclick = closeModal));
  $('.overlay', root).addEventListener('mousedown', (e) => { if (e.target.classList.contains('overlay')) closeModal(); });
  form.onsubmit = (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    $$('[required]', form).forEach((el) => (el.style.borderColor = ''));
    const missing = $$('[required]', form).filter((el) => !String(el.value).trim());
    if (missing.length) { missing.forEach((el) => (el.style.borderColor = 'var(--bad)')); missing[0].focus(); return; }
    const r = onSubmit?.(data, form);
    if (r !== false) closeModal();
  };
  onMount?.(form);
  setTimeout(() => $('input:not([type=hidden]),select,textarea', form)?.focus(), 30);
  return form;
}
function closeModal() { $('#modal-root').innerHTML = ''; }
const F = (label, name, val = '', type = 'text', extra = '') => `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(val)}" ${extra} /></label>`;
const S = (label, name, opts, val = '', extra = '') => `<label class="field"><span>${label}</span><select name="${name}" ${extra}>${opts.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select></label>`;
const T = (label, name, val = '', extra = '') => `<label class="field"><span>${label}</span><textarea name="${name}" ${extra}>${esc(val)}</textarea></label>`;
const productGroups = () => [...new Set(db.products.map((p) => p.group))];

/* ════════════════ Actions ════════════════ */
function leadForm(l = {}) {
  const r = l.raw || {};
  return `<div class="grid2">${F('Full name', 'name', r.name ?? l.name ?? '')}${S('Source', 'source', SOURCES, r.source || l.source || 'Manual')}
    ${F('Mobile', 'phone', r.phone ?? '', 'tel', 'placeholder="98450 12345"')}${F('Email', 'email', r.email ?? '', 'email', 'placeholder="name@company.com"')}
    ${F('Company', 'company', r.company ?? '')}${F('Designation', 'designation', r.designation ?? '')}
    ${S('Region', 'region', [['', '—'], ...REGIONS], r.region || '')}${S('Product interest', 'product', [['', '—'], ...productGroups()], r.product || '')}
    <div class="span2">${T('Requirement', 'requirement', r.requirement ?? '', 'placeholder="What did they ask for?"')}</div></div>
    <input type="hidden" name="raw_text" value="" />
    <div class="sub">Needs a phone or an email. Phone is normalised to +91, email lower-cased, then checked for duplicates.</div>`;
}
function openRef(ref) {
  const [entity, id] = ref.split(':');
  const map = { Lead: 'lead', Opportunity: 'opp', Quotation: 'quote', SalesOrder: 'order', Account: 'account' };
  if (map[entity] && byId({ lead: 'leads', opp: 'opps', quote: 'quotes', order: 'orders', account: 'accounts' }[map[entity]], id)) openDrawer(map[entity], id);
}

const SAMPLE = {
  first: ['Aditya', 'Lakshmi', 'Farhan', 'Pooja', 'Siddharth', 'Divya', 'Karthik', 'Ritu', 'Manoj', 'Nisha', 'Gaurav', 'Swati'],
  last: ['Nair', 'Reddy', 'Khan', 'Desai', 'Malhotra', 'Bose', 'Chopra', 'Menon', 'Jain', 'Patil'],
  co: ['Orbit Pharma', 'Saffron Hotels', 'Monsoon Retail', 'Kaveri Steel', 'Pixelnest Studios', 'Indus Agro', 'Northstar Clinics', 'Bluewave Marine'],
};
function simulate() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const roll = Math.random();
  let p;
  if (roll < 0.12) p = { name: 'web visitor', source: 'Web form' };
  else if (roll < 0.2) p = { name: pick(SAMPLE.first), phone: '55512', email: 'not-an-email', source: 'Ad' };
  else if (roll < 0.32 && db.leads.some((l) => l.status === 'CONVERTED' || l.status === 'INTERESTED')) {
    const ex = pick(db.leads.filter((l) => l.status === 'CONVERTED' || l.status === 'INTERESTED'));
    p = { name: ex.name, phone: ex.phone, email: ex.email, company: ex.company, source: pick(SOURCES) };
  } else {
    const f = pick(SAMPLE.first), l = pick(SAMPLE.last), co = pick(SAMPLE.co);
    p = { name: `${f} ${l}`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, email: `${f}.${l}@${co.split(' ')[0]}.in`.toLowerCase(), company: co, designation: pick(['Head of Ops', 'CTO', 'Procurement', 'Founder', 'GM Sales']), source: pick(['Web form', 'Ad', 'Call']), region: pick(REGIONS), product: pick(productGroups().slice(0, 3)), requirement: pick(['Looking for a quote', 'Need a demo', 'Replacing legacy system']) };
  }
  const lead = ingest(p);
  if (lead.status === 'VALIDATED') toast('Lead captured', `${lead.name} → ${uname(lead.ownerId)}`, 'var(--ok)');
  commit();
}

function quoteEditor(o, base) {
  const items = base ? JSON.parse(JSON.stringify(base.items)) : [];
  const limit = user(o.ownerId)?.discLimit ?? 10;
  const opts = db.products.map((p) => `<option value="${p.id}">${esc(p.name)} — ${inr(p.price)}</option>`).join('');
  const form = modal({
    title: base ? `${base.status === 'DRAFT' ? 'Edit' : 'Revise'} ${base.number}` : 'New quotation', wide: true,
    sub: `${esc(o.title)} · rep discount limit ${limit}% — above that goes to a manager`,
    submit: base?.status === 'DRAFT' ? 'Save draft' : base ? `Save as v${base.version + 1}` : 'Create draft',
    body: `<div class="qi h"><span>Item</span><span>Qty</span><span>Unit price</span><span>Disc %</span><span class="right">Amount</span><span></span></div>
      <div id="qItems" class="stack" style="gap:8px"></div>
      <div style="display:flex;gap:8px"><select id="qAdd"><option value="">+ Add item from catalogue…</option>${opts}</select></div>
      <div id="qTotals"></div>
      <div class="grid2">${F('Valid until', 'validUntil', base?.validUntil && base.status === 'DRAFT' ? base.validUntil : isoDate(now() + 15 * day), 'date', 'required')}${F('Payment terms', 'terms', base?.terms || '50% advance, balance on delivery. Prices exclusive of GST.', 'text', 'required')}</div>`,
    onSubmit: (d) => {
      if (!items.length) { toast('Add at least one item', '', 'var(--bad)'); return false; }
      if (base && base.status === 'DRAFT') { Object.assign(base, { items, validUntil: d.validUntil, terms: d.terms }); audit('Quotation', base.id, 'Edited', 'Draft updated'); }
      else {
        const q = { id: nid('Q'), number: base?.number || nid('QT'), version: base ? base.version + 1 : 1, oppId: o.id, items, validUntil: d.validUntil, terms: d.terms, status: 'DRAFT', createdAt: now() };
        if (base) { base.status = 'REVISED'; audit('Quotation', base.id, 'Revised', `Superseded by v${q.version}`); }
        db.quotes.push(q);
        audit('Quotation', q.id, base ? 'New version' : 'Created', `${q.number} v${q.version} · ${inr(quoteTotals(q).total)}`);
        if (o.stage === 'QUALIFIED') { o.stage = 'QUOTED'; audit('Opportunity', o.id, 'Stage → Quotation', q.number); }
        ui.drawer = { type: 'quote', id: q.id };
      }
      commit(); openDrawer(ui.drawer.type, ui.drawer.id);
    },
  });
  const draw = () => {
    $('#qItems', form).innerHTML = items.map((i, k) => `<div class="qi"><span>${esc(i.name)}</span><input type="number" min="1" value="${i.qty}" data-k="${k}" data-f="qty" /><input type="number" min="0" value="${i.price}" data-k="${k}" data-f="price" /><input type="number" min="0" max="100" value="${i.disc}" data-k="${k}" data-f="disc" style="${i.disc > limit ? 'border-color:var(--warn)' : ''}" /><span class="right mono">${inr(i.qty * i.price * (1 - i.disc / 100))}</span><button type="button" class="x" data-rm="${k}" style="font-size:18px">×</button></div>`).join('') || '<div class="faint">No items yet.</div>';
    const t = quoteTotals({ items });
    $('#qTotals', form).innerHTML = `<div class="totals"><div><span class="sub">Subtotal</span><span class="mono">${inr(t.sub)}</span></div><div><span class="sub">GST ${GST}%</span><span class="mono">${inr(t.gst)}</span></div><div class="grand"><span>Total</span><span>${inr(t.total)}</span></div>${t.maxDisc > limit ? `<div class="sla soon" style="justify-content:flex-end">⚠ ${t.maxDisc}% discount needs manager approval</div>` : ''}</div>`;
  };
  $('#qAdd', form).onchange = (e) => { const p = db.products.find((x) => x.id === e.target.value); if (p) items.push({ pid: p.id, name: p.name, qty: 1, price: p.price, disc: 0 }); e.target.value = ''; draw(); };
  $('#qItems', form).addEventListener('change', (e) => { const k = e.target.dataset.k; if (k == null) return; items[k][e.target.dataset.f] = Math.max(0, +e.target.value || 0); if (e.target.dataset.f === 'qty' && !items[k].qty) items[k].qty = 1; draw(); });
  $('#qItems', form).addEventListener('click', (e) => { const k = e.target.dataset.rm; if (k != null) { items.splice(+k, 1); draw(); } });
  if (!items.length) { const p = db.products.find((x) => x.group === o.product); if (p) items.push({ pid: p.id, name: p.name, qty: 1, price: p.price, disc: 0 }); }
  draw();
}

function quotePreview(q) {
  const o = byId('opps', q.oppId), acc = byId('accounts', o.accountId), c = byId('contacts', o.contactId);
  modal({
    title: `${q.number} · v${q.version}`, sub: 'Generated PDF preview', wide: true, submit: '⎙ Print / Save as PDF',
    body: `<div class="doc print-area"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div><div class="logo" style="margin-bottom:10px">S</div><h2>Quotation</h2><div class="muted">${q.number} · version ${q.version}</div></div>
      <div style="text-align:right"><b>To:</b> ${esc(acc?.name)}<br>${esc(c?.name)} · ${esc(c?.email)}<br><span class="muted">Date ${fmtDate(q.sentAt || now())} · Valid until ${fmtDate(q.validUntil)}</span></div></div>
      <div style="margin:22px 0">${quoteTable(q)}</div><div class="muted"><b>Terms:</b> ${esc(q.terms)}</div></div>`,
    onSubmit: () => { window.print(); return false; },
  });
}

/* ════════════════ Existing customers: add, edit, import ════════════════ */
const accountKey = (n) => String(n || '').toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|inc)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
function accountMatches(name, exceptId) {
  const k = accountKey(name); if (!k) return [];
  return db.accounts.filter((a) => a.id !== exceptId && (a.key === k || (k.length > 3 && a.key && (a.key.startsWith(k) || k.startsWith(a.key)))));
}
/** Normalises and checks one contact. Returns { contact } or { err }. */
function checkContact(c) {
  if (!String(c.name || '').trim() && !c.phone && !c.email) return { empty: true };
  const o = normalize({ name: c.name, phone: c.phone || '', email: c.email || '', designation: c.designation || '' });
  if (!o.name) return { err: 'Contact name is required' };
  if (!o.phone && !o.email) return { err: `${o.name}: needs a phone or an email` };
  const errs = validateFields({ ...o, source: 'Manual' });
  if (errs.length) return { err: `${o.name}: ${errs.join('; ')}` };
  return { contact: { name: o.name, phone: o.phone, email: o.email, designation: o.designation } };
}
function checkStatutory(d) {
  const e = [];
  const gstin = String(d.gstin || '').trim().toUpperCase(), pan = String(d.pan || '').trim().toUpperCase();
  if (gstin && !GSTIN_RE.test(gstin)) e.push('GSTIN must be 15 characters, e.g. 27AAACK1234F1Z5');
  if (pan && !PAN_RE.test(pan)) e.push('PAN must look like ABCDE1234F');
  if (gstin && pan && gstin.slice(2, 12) !== pan) e.push('PAN does not match characters 3–12 of the GSTIN');
  return { e, gstin, pan: pan || (gstin ? gstin.slice(2, 12) : '') };
}
/** Adds contacts to an account, reusing any that already exist by phone/email. */
function attachContacts(acc, list) {
  const out = { added: 0, linked: 0, skipped: [] };
  list.forEach((c, i) => {
    const dup = db.contacts.find((x) => (c.phone && x.phone === c.phone) || (c.email && x.email === c.email));
    if (dup && dup.accountId && dup.accountId !== acc.id) { out.skipped.push(`${c.name} already belongs to ${byId('accounts', dup.accountId)?.name}`); return; }
    if (dup) { if (!dup.accountId) { dup.accountId = acc.id; out.linked++; audit('Contact', dup.id, 'Linked', acc.name); } else out.skipped.push(`${c.name} is already a contact here`); return; }
    const hasPrimary = db.contacts.some((x) => x.accountId === acc.id && x.primary);
    const nc = { id: nid('C'), ...c, accountId: acc.id, primary: !hasPrimary && i === 0, createdAt: now() };
    db.contacts.unshift(nc); out.added++;
    audit('Contact', nc.id, 'Created', `${nc.name} @ ${acc.name}`);
  });
  return out;
}
function createAccountRecord(d, via) {
  const st = checkStatutory(d);
  let owner = d.ownerId;
  let rule = 'Chosen when added';
  if (!owner || owner === 'auto') { const r = runRules({ region: d.region, kind: 'opp' }); owner = r.owner; rule = r.rule; }
  const acc = {
    id: nid('AC'), name: d.name.trim(), key: accountKey(d.name), status: d.status === 'PROSPECT' ? 'PROSPECT' : 'CUSTOMER', ownerId: owner || null,
    region: d.region || '', gstin: st.gstin, pan: st.pan, billingAddr: (d.billingAddr || '').trim(), industry: (d.industry || '').trim(),
    since: d.since || '', notes: (d.notes || '').trim(), existing: true, addedVia: via, createdAt: now(),
  };
  db.accounts.unshift(acc);
  audit('Account', acc.id, acc.status === 'CUSTOMER' ? 'Existing customer added' : 'Prospect added', `${acc.name} · ${via} · owner ${uname(acc.ownerId)} (${rule})`);
  return acc;
}
const ownerOptions = () => [['auto', 'Auto — territory / workload rules'], ...db.users.filter((u) => u.active).map((u) => [u.id, `${u.name} · ${u.region}${u.onLeave ? ' (on leave)' : ''}`])];
const contactRow = (c = {}, i = 0) => `<div class="crow" data-i="${i}"><input name="c_name" placeholder="Name" value="${esc(c.name || '')}" /><input name="c_designation" placeholder="Designation" value="${esc(c.designation || '')}" /><input name="c_phone" placeholder="Mobile" value="${esc(c.phone || '')}" /><input name="c_email" placeholder="Email" value="${esc(c.email || '')}" /><button type="button" class="x" data-rmc title="Remove">×</button></div>`;
function readContactRows(f) {
  return $$('.crow:not(.h)', f).map((r) => ({ name: $('[name=c_name]', r).value, designation: $('[name=c_designation]', r).value, phone: $('[name=c_phone]', r).value, email: $('[name=c_email]', r).value }));
}

function customerForm(a) {
  const edit = !!a;
  a = a || { status: 'CUSTOMER' };
  const form = modal({
    title: edit ? `Edit ${esc(a.name)}` : 'Add existing customer', wide: true, submit: edit ? 'Save changes' : 'Add customer',
    sub: edit ? 'Changes are audited.' : 'For customers you already work with. They skip the lead steps and can get opportunities straight away.',
    body: `<div class="grid2">
        <div>${F('Company name', 'name', a.name || '', 'text', 'required autocomplete="off"')}<div id="accDup"></div></div>
        ${S('Status', 'status', [['CUSTOMER', 'Customer — already buys from us'], ['PROSPECT', 'Prospect — not yet a customer']], a.status)}
        ${S('Region', 'region', [['', '—'], ...REGIONS], a.region || '')}
        ${S('Account owner', 'ownerId', ownerOptions(), a.ownerId || 'auto')}
        ${F('GSTIN', 'gstin', a.gstin || '', 'text', 'placeholder="27AAACK1234F1Z5" style="text-transform:uppercase"')}
        ${F('PAN', 'pan', a.pan || '', 'text', 'placeholder="Filled from GSTIN if left blank" style="text-transform:uppercase"')}
        ${F('Industry', 'industry', a.industry || '', 'text', 'placeholder="e.g. Textiles"')}
        ${F('Customer since', 'since', a.since || '', 'date')}
        <div class="span2">${T('Billing address', 'billingAddr', a.billingAddr || '')}</div>
        <div class="span2">${T('Notes', 'notes', a.notes || '', 'placeholder="Products they already use, renewal dates, key history…"')}</div></div>
      ${edit ? '' : `<div class="d-sec"><h4>Contacts</h4><div class="crow h"><span>Name</span><span>Designation</span><span>Mobile</span><span>Email</span><span></span></div><div id="cRows">${contactRow({}, 0)}</div>
        <button type="button" class="btn sm ghost" id="cAdd" style="margin-top:8px">+ Another contact</button><div class="sub" style="margin-top:6px">The first contact becomes the primary contact. Existing contacts are matched by phone or email.</div></div>`}`,
    onMount: (f) => {
      const dupBox = $('#accDup', f);
      const check = () => {
        const m = accountMatches(f.elements.name.value, a.id);
        dupBox.innerHTML = m.length ? `<div class="dup-warn">⚠ ${m.some((x) => x.key === accountKey(f.elements.name.value)) ? 'Already exists' : 'Similar to'}: ${m.slice(0, 3).map((x) => `<a data-open-acc="${x.id}">${esc(x.name)}</a> (${x.status.toLowerCase()})`).join(', ')}</div>` : '';
      };
      f.elements.name.addEventListener('input', check); check();
      dupBox.addEventListener('click', (e) => { const id = e.target.dataset.openAcc; if (id) { closeModal(); openDrawer('account', id); } });
      const box = $('#cRows', f);
      if (box) {
        $('#cAdd', f).onclick = () => { box.insertAdjacentHTML('beforeend', contactRow({}, box.children.length)); $$('[name=c_name]', box).at(-1).focus(); };
        box.addEventListener('click', (e) => { if (e.target.hasAttribute('data-rmc') && box.children.length > 1) e.target.closest('.crow').remove(); });
      }
    },
    onSubmit: (d, f) => {
      const st = checkStatutory(d);
      if (st.e.length) { toast('Check the tax details', st.e.join('. '), 'var(--bad)'); return false; }
      const m = accountMatches(d.name, a.id);
      if (m.some((x) => x.key === accountKey(d.name))) { toast('Account already exists', `${m[0].name} — open it from the warning under the name`, 'var(--bad)'); return false; }
      if (edit) {
        const before = { name: a.name, status: a.status, region: a.region, ownerId: a.ownerId, gstin: a.gstin, pan: a.pan };
        Object.assign(a, { name: d.name.trim(), key: accountKey(d.name), status: d.status, region: d.region, gstin: st.gstin, pan: st.pan, billingAddr: d.billingAddr.trim(), industry: d.industry.trim(), since: d.since, notes: d.notes.trim() });
        if (d.ownerId !== 'auto' && d.ownerId !== a.ownerId) setOwner(a, 'Account', d.ownerId, 'Changed on account');
        const changed = Object.keys(before).filter((k) => before[k] !== a[k]).map((k) => k === 'ownerId' ? `owner → ${uname(a.ownerId)}` : `${k} → ${a[k] || '—'}`);
        audit('Account', a.id, 'Edited', changed.join(', ') || 'Details updated');
        commit(); return;
      }
      const rows = readContactRows(f).map(checkContact);
      const bad = rows.filter((r) => r.err);
      if (bad.length) { toast('Check the contacts', bad.map((r) => r.err).join('. '), 'var(--bad)'); return false; }
      const contacts = rows.filter((r) => r.contact).map((r) => r.contact);
      if (!contacts.length) { toast('Add at least one contact', 'Opportunities need a contact person', 'var(--bad)'); return false; }
      if (m.length && !confirm(`“${d.name}” looks similar to ${m.map((x) => x.name).join(', ')}. Add it as a separate account?`)) return false;
      const acc = createAccountRecord(d, 'added manually');
      const r = attachContacts(acc, contacts);
      if (acc.ownerId) notify(acc.ownerId, `${acc.name} (${acc.status === 'CUSTOMER' ? 'existing customer' : 'prospect'}) assigned to you`);
      commit(); go('accounts'); openDrawer('account', acc.id);
      toast(acc.status === 'CUSTOMER' ? 'Customer added' : 'Prospect added', `${acc.name} · ${r.added + r.linked} contact(s) · owner ${uname(acc.ownerId)}${r.skipped.length ? ' · skipped: ' + r.skipped.join('; ') : ''}`, r.skipped.length ? 'var(--warn)' : 'var(--ok)');
    },
  });
  return form;
}

function contactForm(acc) {
  modal({
    title: `Add contact · ${esc(acc.name)}`, submit: 'Add contact',
    body: `<div class="grid2">${F('Name', 'name', '', 'text', 'required')}${F('Designation', 'designation')}${F('Mobile', 'phone', '', 'tel')}${F('Email', 'email', '', 'email')}</div>
      <label class="check"><input type="checkbox" name="primary" /><div><b>Primary contact</b><small>Used by default on new opportunities and emails</small></div></label>`,
    onSubmit: (d) => {
      const r = checkContact(d);
      if (r.err || r.empty) { toast('Check the contact', r.err || 'Name and a phone or email are required', 'var(--bad)'); return false; }
      const res = attachContacts(acc, [r.contact]);
      if (res.skipped.length) { toast('Not added', res.skipped.join('; '), 'var(--bad)'); return false; }
      if (d.primary) { const mine = db.contacts.filter((c) => c.accountId === acc.id); mine.forEach((c) => { c.primary = false; }); mine.find((c) => (r.contact.phone && c.phone === r.contact.phone) || (r.contact.email && c.email === r.contact.email)).primary = true; }
      commit(); toast('Contact added', `${r.contact.name} @ ${acc.name}`, 'var(--ok)');
    },
  });
}

/* CSV import */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
const CSV_COLS = {
  name: ['company', 'company name', 'account', 'account name', 'customer', 'customer name', 'organisation', 'organization'],
  contact: ['contact', 'contact name', 'contact person', 'name', 'person'],
  designation: ['designation', 'title', 'role', 'job title'],
  phone: ['phone', 'mobile', 'mobile number', 'phone number', 'contact number', 'whatsapp'],
  email: ['email', 'email address', 'e-mail', 'mail'],
  region: ['region', 'zone', 'territory'],
  gstin: ['gstin', 'gst', 'gst number', 'gst no'],
  pan: ['pan', 'pan number', 'pan no'],
  owner: ['owner', 'account owner', 'sales rep', 'rep', 'assigned to'],
  status: ['status', 'type'],
  industry: ['industry', 'sector'],
  since: ['customer since', 'since', 'start date'],
  billingAddr: ['billing address', 'address', 'billing'],
  notes: ['notes', 'remarks', 'comments'],
};
const CSV_TEMPLATE = 'Company,Contact name,Designation,Mobile,Email,Region,GSTIN,PAN,Owner,Status,Industry,Customer since,Billing address,Notes\n' +
  'Kaveri Steel Pvt Ltd,Anil Kumar,Purchase Head,9845011122,anil@kaveristeel.in,South,29AABCK1234L1Z2,,Arjun Mehta,Customer,Steel,2023-04-01,"Peenya, Bengaluru",Uses ERP Suite\n' +
  'Kaveri Steel Pvt Ltd,Meena Rao,Accounts,9845033344,meena@kaveristeel.in,South,,,,,,,,\n';
function buildImportPlan(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: 'Need a header row and at least one data row.' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = {}; Object.entries(CSV_COLS).forEach(([k, names]) => { const i = header.findIndex((h) => names.includes(h)); if (i >= 0) col[k] = i; });
  if (col.name == null) return { error: 'No company column found. Use a header such as “Company”.' };
  const get = (r, k) => (col[k] == null ? '' : String(r[col[k]] ?? '').trim());
  const byKey = new Map();
  rows.slice(1).forEach((r, idx) => {
    const name = get(r, 'name'); const line = idx + 2;
    const key = accountKey(name);
    if (!key) { byKey.set('__bad' + line, { line, name: '(blank)', errors: ['Company name is empty'], contacts: [] }); return; }
    if (!byKey.has(key)) byKey.set(key, { line, name, key, fields: {}, contacts: [], errors: [], warnings: [] });
    const g = byKey.get(key);
    for (const k of ['region', 'gstin', 'pan', 'owner', 'status', 'industry', 'since', 'billingAddr', 'notes']) { const v = get(r, k); if (v && !g.fields[k]) g.fields[k] = v; }
    const c = checkContact({ name: get(r, 'contact'), designation: get(r, 'designation'), phone: get(r, 'phone'), email: get(r, 'email') });
    if (c.err) g.warnings.push(`Row ${line}: ${c.err} — contact skipped`); else if (c.contact) g.contacts.push(c.contact);
  });
  const plan = [...byKey.values()].map((g) => {
    if (g.errors.length) return { ...g, action: 'error' };
    const f = g.fields;
    const region = REGIONS.find((x) => x.toLowerCase() === String(f.region || '').toLowerCase()) || '';
    if (f.region && !region) g.warnings.push(`Region “${f.region}” not recognised — left blank`);
    const owner = f.owner ? db.users.find((u) => [u.name.toLowerCase(), (u.email || '').toLowerCase(), u.name.split(' ')[0].toLowerCase()].includes(f.owner.toLowerCase())) : null;
    if (f.owner && !owner) g.warnings.push(`Owner “${f.owner}” not found — rules will assign`);
    const status = /prospect/i.test(f.status || '') ? 'PROSPECT' : 'CUSTOMER';
    const st = checkStatutory(f);
    if (st.e.length) return { ...g, action: 'error', errors: st.e };
    let since = '';
    if (f.since) { const t = Date.parse(f.since); if (Number.isNaN(t)) g.warnings.push(`Date “${f.since}” not understood — left blank`); else since = isoDate(t); }
    const existing = db.accounts.find((a) => a.key === g.key);
    const data = { name: g.name, status, region, ownerId: owner?.id || 'auto', gstin: st.gstin, pan: st.pan, industry: f.industry || '', since, billingAddr: f.billingAddr || '', notes: f.notes || '' };
    if (!existing && !g.contacts.length) g.warnings.push('No valid contact — add one later to create opportunities');
    return { ...g, data, existing, action: existing ? 'merge' : 'create' };
  });
  return { plan, cols: Object.keys(col) };
}
function importCustomers() {
  let plan = null;
  const form = modal({
    title: 'Import existing customers', wide: true, submit: 'Import',
    sub: 'Upload or paste a CSV. One row per contact; rows with the same company become one account.',
    body: `<div class="import-src"><label class="drop" id="csvDrop"><input type="file" accept=".csv,text/csv" id="csvFile" hidden /><span class="ic">⇪</span><div><b>Choose a CSV file</b><small>or drop it here · the file stays in your browser</small></div></label>
        <a class="btn sm ghost" download="srilead-customers-template.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}">⤓ Template</a></div>
      <label class="field"><span>…or paste CSV text</span><textarea id="csvText" style="min-height:110px;font-family:ui-monospace,monospace;font-size:12.5px" placeholder="${esc(CSV_TEMPLATE.split('\n')[0])}"></textarea></label>
      <div id="csvPlan"></div>`,
    onMount: (f) => {
      const draw = () => {
        const text = $('#csvText', f).value;
        const out = $('#csvPlan', f); const btn = $('button[type=submit]', f);
        if (!text.trim()) { out.innerHTML = ''; plan = null; btn.disabled = true; return; }
        const r = buildImportPlan(text);
        if (r.error) { out.innerHTML = `<div class="callout" style="--c:var(--bad)">${esc(r.error)}</div>`; plan = null; btn.disabled = true; return; }
        plan = r.plan;
        const n = (a) => plan.filter((p) => p.action === a).length;
        const contacts = plan.filter((p) => p.action !== 'error').reduce((s, p) => s + p.contacts.length, 0);
        out.innerHTML = `<div class="import-sum"><span class="pill" style="--c:var(--ok)">${n('create')} new</span><span class="pill" style="--c:var(--info)">${n('merge')} existing (contacts added)</span><span class="pill" style="--c:var(--bad)">${n('error')} with errors</span><span class="sub">${contacts} contacts · columns found: ${r.cols.join(', ')}</span></div>
          <div class="table-wrap" style="max-height:300px;overflow:auto"><table><thead><tr><th>Company</th><th>Result</th><th>Status</th><th>Contacts</th><th>Notes</th></tr></thead><tbody>
          ${plan.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="faint">row ${p.line}${p.data?.gstin ? ' · ' + esc(p.data.gstin) : ''}</div></td>
            <td>${p.action === 'create' ? pill('CONFIRMED', 'new account') : p.action === 'merge' ? pill('SENT', 'add to ' + p.existing.name) : pill('REJECTED', 'skipped')}</td>
            <td>${p.data ? esc(p.data.status === 'CUSTOMER' ? 'Customer' : 'Prospect') : '—'}</td><td class="mono">${p.contacts.length}</td>
            <td class="sub" style="font-size:12px">${[...(p.errors || []), ...(p.warnings || [])].map(esc).join('<br>') || '✓'}</td></tr>`).join('')}
          </tbody></table></div>`;
        btn.disabled = !plan.some((p) => p.action !== 'error');
        btn.textContent = `Import ${plan.filter((p) => p.action !== 'error').length} account(s)`;
      };
      $('button[type=submit]', f).disabled = true;
      $('#csvText', f).addEventListener('input', draw);
      const load = (file) => { if (!file) return; if (file.size > 5e6) { toast('File too large', 'Keep it under 5 MB', 'var(--bad)'); return; } const rd = new FileReader(); rd.onload = () => { $('#csvText', f).value = rd.result; draw(); }; rd.readAsText(file); };
      $('#csvFile', f).addEventListener('change', (e) => load(e.target.files[0]));
      const drop = $('#csvDrop', f);
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); load(e.dataTransfer.files[0]); });
    },
    onSubmit: () => {
      if (!plan) return false;
      let created = 0, merged = 0, contacts = 0; const skipped = [];
      plan.filter((p) => p.action !== 'error').forEach((p) => {
        const acc = p.action === 'merge' ? p.existing : createAccountRecord(p.data, 'CSV import');
        if (p.action === 'merge') merged++; else created++;
        const r = attachContacts(acc, p.contacts); contacts += r.added + r.linked; skipped.push(...r.skipped);
      });
      audit('Account', '-', 'CSV import', `${created} new, ${merged} existing updated, ${contacts} contacts`);
      commit(); go('accounts');
      toast('Import complete', `${created} new account(s), ${merged} updated, ${contacts} contact(s)${skipped.length ? ` · ${skipped.length} contact(s) skipped (already elsewhere)` : ''}`, 'var(--ok)');
    },
  });
  return form;
}

/* ════════════════ AI assist (Claude Haiku 5.5) & email ════════════════ */
const svc = { ai: false, aiModel: '', mail: false, mailFrom: '' };
async function loadServices() {
  try { const a = await fetch('/api/ai/status').then((r) => r.json()); svc.ai = !!a.enabled; svc.aiModel = a.model || ''; } catch (e) { /* server offline */ }
  try { const m = await fetch('/api/mail/status').then((r) => r.json()); svc.mail = !!m.enabled; svc.mailFrom = m.from || ''; } catch (e) { /* server offline */ }
}
async function ai(task, payload) {
  const r = await fetch('/api/ai/' + task, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j.result;
}
const AI_OFF = 'AI is off — add ANTHROPIC_API_KEY to .env and restart the server';
const aiBtn = (label, attrs = '') => `<button type="button" class="btn ai sm" ${attrs} ${svc.ai ? '' : `disabled title="${AI_OFF}"`}>✨ ${label}</button>`;
const aiAct = (label, act, id) => aiBtn(label, `data-act="${act}" data-id="${id}"`);
async function spin(btn, fn) {
  if (!btn || btn.disabled) return;
  const html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Thinking…';
  try { await fn(); } catch (e) { toast('AI assist failed', e.message, 'var(--bad)'); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = html; } }
}
const sellerName = () => db.settings.companyName || 'SriLead';
const signOff = () => `${me().name}, ${sellerName()}`;
const callNotes = (lead) => (lead?.calls || []).map((c) => ({ date: isoDate(c.ts), outcome: c.outcome, notes: c.notes || '', ai_summary: c.ai?.summary || '' }));
const quoteFacts = (q) => { if (!q) return null; const t = quoteTotals(q); return { number: q.number, version: q.version, items: q.items.map((i) => ({ item: i.name, qty: i.qty, unit_price: i.price, discount_pct: i.disc || 0 })), subtotal: Math.round(t.sub), gst: Math.round(t.gst), total_incl_gst: Math.round(t.total), valid_until: q.validUntil, terms: q.terms }; };

/* Email-safe (inline-styled) renderings of the quotation and the RFP response */
const textToHtml = (t) => esc(t).split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`).join('');
function quoteEmailHtml(q) {
  const t = quoteTotals(q), o = byId('opps', q.oppId), acc = byId('accounts', o.accountId);
  const td = 'padding:8px 10px;border-bottom:1px solid #e3e6eb;font-size:13px', th = td + ';text-align:left;color:#535c6e;font-size:11px;text-transform:uppercase;letter-spacing:.06em;background:#f6f7f9';
  return `<div style="font-family:Arial,sans-serif;color:#1c2333;max-width:680px">
    <div style="font-size:18px;font-weight:700;margin-bottom:2px">Quotation ${esc(q.number)} · v${q.version}</div>
    <div style="color:#535c6e;font-size:13px;margin-bottom:14px">${esc(sellerName())} → ${esc(acc?.name)} · Valid until ${fmtDate(q.validUntil)}</div>
    <table style="border-collapse:collapse;width:100%;border:1px solid #e3e6eb"><tr><th style="${th}">Item</th><th style="${th};text-align:right">Qty</th><th style="${th};text-align:right">Unit price</th><th style="${th};text-align:right">Disc.</th><th style="${th};text-align:right">Amount</th></tr>
    ${q.items.map((i) => `<tr><td style="${td}">${esc(i.name)}</td><td style="${td};text-align:right">${i.qty}</td><td style="${td};text-align:right">${inr(i.price)}</td><td style="${td};text-align:right">${i.disc || 0}%</td><td style="${td};text-align:right">${inr(i.qty * i.price * (1 - (i.disc || 0) / 100))}</td></tr>`).join('')}
    <tr><td colspan="4" style="${td};text-align:right;color:#535c6e">Subtotal</td><td style="${td};text-align:right">${inr(t.sub)}</td></tr>
    <tr><td colspan="4" style="${td};text-align:right;color:#535c6e">GST ${GST}%</td><td style="${td};text-align:right">${inr(t.gst)}</td></tr>
    <tr><td colspan="4" style="${td};text-align:right;font-weight:700">Total</td><td style="${td};text-align:right;font-weight:700;color:#b42318">${inr(t.total)}</td></tr></table>
    <p style="font-size:12.5px;color:#535c6e;margin-top:12px"><b>Terms:</b> ${esc(q.terms)}</p></div>`;
}
function quoteText(q) {
  const t = quoteTotals(q);
  return [`QUOTATION ${q.number} v${q.version} — valid until ${fmtDate(q.validUntil)}`, ...q.items.map((i) => `- ${i.name} × ${i.qty} @ ${inr(i.price)}${i.disc ? ` less ${i.disc}%` : ''} = ${inr(i.qty * i.price * (1 - (i.disc || 0) / 100))}`),
    `Subtotal ${inr(t.sub)} · GST ${GST}% ${inr(t.gst)} · TOTAL ${inr(t.total)}`, `Terms: ${q.terms}`].join('\n');
}
function rfpDocHtml(o, doc) {
  const acc = byId('accounts', o.accountId), c = byId('contacts', o.contactId);
  const body = (t) => esc(t).split(/\n{2,}/).map((p) => /^\s*- /m.test(p)
    ? `<ul style="margin:0 0 12px;padding-left:20px">${p.split('\n').filter((x) => x.trim()).map((x) => `<li style="margin:3px 0">${x.replace(/^\s*-\s*/, '')}</li>`).join('')}</ul>`
    : `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`).join('');
  return `<div style="font-family:Arial,sans-serif;color:#1c2333;max-width:720px;font-size:14px;line-height:1.55">
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#b42318;font-weight:700">${esc(sellerName())} · ${o.rfp?.received ? 'RFP response' : 'Proposal'} v${doc.version}</div>
    <div style="font-size:22px;font-weight:700;margin:4px 0 2px">${esc(doc.title)}</div>
    <div style="color:#535c6e;font-size:13px;margin-bottom:18px">Prepared for ${esc(acc?.name)}${c ? ` · Attn. ${esc(c.name)}` : ''} · ${fmtDate(doc.updatedAt)}</div>
    ${doc.sections.map((s) => `<div style="font-size:15px;font-weight:700;margin:18px 0 6px;padding-bottom:4px;border-bottom:2px solid #f0d9d6">${esc(s.heading)}</div>${body(s.body)}`).join('')}</div>`;
}
const rfpText = (doc) => [doc.title.toUpperCase(), ...doc.sections.map((s) => `\n${s.heading.toUpperCase()}\n${s.body}`)].join('\n');

function logEmail(o, entry) {
  o.emails = o.emails || [];
  o.emails.unshift({ id: nid('E'), ts: now(), by: db.me, ...entry });
  audit('Opportunity', o.id, `${entry.kind} emailed`, `“${entry.subject}” to ${entry.to}${entry.cc ? ' cc ' + entry.cc : ''} · via ${entry.via}`);
}
/** Reusable email composer. attachment: { label, note, previewHtml, emailHtml, text } */
function composer({ title, sub, to = '', cc = '', subject = '', body = '', attachment, aiDraft, onSent }) {
  const form = modal({
    title, sub, wide: true, submit: svc.mail ? '✉ Send email' : '✉ Open in mail app & log',
    body: `<div class="mail-head">${aiDraft ? aiBtn('Draft email', 'id="cmpAi"') : ''}<span class="sub">${svc.mail ? `From <b>${esc(svc.mailFrom)}</b>` : 'No email server set up — Send opens your mail app with this message (also copied to the clipboard) and logs it here.'}</span></div>
      <div class="grid2">${F('To', 'to', to, 'text', 'required placeholder="name@company.com, …"')}${F('Cc', 'cc', cc)}</div>
      ${F('Subject', 'subject', subject, 'text', 'required')}
      <label class="field"><span>Message</span><textarea name="body" required style="min-height:200px">${esc(body)}</textarea></label>
      ${attachment ? `<div class="attach"><span class="ic">📄</span><div style="flex:1;min-width:0"><b>${esc(attachment.label)}</b><small>${esc(attachment.note || 'Included in the email, below your message')}</small></div><button type="button" class="btn sm ghost" id="cmpPrev">Preview</button></div>
        <div id="cmpPrevBox" class="doc" style="display:none">${attachment.previewHtml || attachment.emailHtml}</div>` : ''}`,
    onSubmit: (d) => { send(d); return false; },
    onMount: (f) => {
      $('#cmpPrev', f)?.addEventListener('click', () => { const b = $('#cmpPrevBox', f); b.style.display = b.style.display === 'none' ? '' : 'none'; });
      const ab = $('#cmpAi', f);
      ab?.addEventListener('click', () => spin(ab, async () => { const r = await aiDraft(); f.elements.subject.value = r.subject; f.elements.body.value = r.body; f.elements.body.classList.add('ai-filled'); }));
    },
  });
  async function send(d) {
    const btn = $('button[type=submit]', form); btn.disabled = true;
    const text = d.body + (attachment ? `\n\n────────\n${attachment.text}` : '');
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c2333">${textToHtml(d.body)}${attachment ? `<hr style="border:0;border-top:1px solid #e3e6eb;margin:22px 0">${attachment.emailHtml}` : ''}</div>`;
    try {
      let via = 'mail app', messageId = '';
      if (svc.mail) {
        const r = await fetch('/api/mail/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: d.to, cc: d.cc, subject: d.subject, text, html }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || r.statusText);
        via = 'email server'; messageId = j.messageId || '';
      } else {
        try { await navigator.clipboard.writeText(text); } catch (e) { /* clipboard blocked */ }
        const qs = new URLSearchParams({ ...(d.cc ? { cc: d.cc } : {}), subject: d.subject, body: text }).toString().replace(/\+/g, '%20');
        window.open(`mailto:${encodeURIComponent(d.to)}?${qs}`, '_self');
      }
      closeModal();
      onSent({ to: d.to, cc: d.cc, subject: d.subject, body: d.body, via, messageId });
      toast(svc.mail ? 'Email sent' : 'Opened in your mail app', svc.mail ? `To ${d.to}` : 'Full text is also on your clipboard. Logged as sent.', 'var(--ok)');
    } catch (e) { toast('Email not sent', e.message, 'var(--bad)'); btn.disabled = false; }
  }
}

/* RFP response / proposal document */
const RFP_SECTIONS = ['Executive summary', 'Our understanding of your requirement', 'Proposed solution', 'Scope and deliverables', 'Implementation timeline', 'Commercials', 'Terms and assumptions', 'Next steps'];
function rfpPayload(o) {
  const acc = byId('accounts', o.accountId), c = byId('contacts', o.contactId), ld = byId('leads', o.leadId);
  return {
    hasRfp: !!o.rfp?.received, seller: sellerName(),
    account: { name: acc?.name, status: acc?.status, region: acc?.region }, contact: { name: c?.name, designation: c?.designation },
    opp: { title: o.title, summary: o.summary, product: o.product, estimated_value: o.value, expected_close: o.closeDate },
    rfp: o.rfp?.received ? { received: o.rfp.date, deadline: o.rfp.deadline, file: o.rfp.file } : null,
    notes: [...callNotes(ld), ...(o.activities || []).map((a) => ({ date: isoDate(a.ts), note: a.text }))],
    quote: quoteFacts(latestQuote(o.id)), products: db.products.map((p) => ({ name: p.name, group: p.group, price: p.price })),
  };
}
function rfpEditor(o) {
  const doc = o.rfpDoc ? JSON.parse(JSON.stringify(o.rfpDoc)) : { title: `${o.rfp?.received ? 'Response to RFP' : 'Proposal'}: ${o.title}`, sections: RFP_SECTIONS.map((h) => ({ heading: h, body: '' })), version: 0 };
  const label = o.rfp?.received ? 'RFP response' : 'Proposal';
  const form = modal({
    title: `${o.rfpDoc ? 'Edit' : 'Draft'} ${label}`, wide: true, sub: `${esc(o.title)}${o.rfp?.deadline ? ` · submission deadline ${fmtDate(o.rfp.deadline)}` : ''}`, submit: 'Save draft',
    body: `<div class="mail-head">${aiBtn(`Draft full ${label.toLowerCase()} with AI`, 'id="rfpAi"')}<span class="sub">Uses the call notes, RFP details and latest quotation. Missing facts come back as [placeholders] for you to fill.</span></div>
      ${F('Document title', 'title', doc.title, 'text', 'required')}
      <div id="rfpSecs" class="stack" style="gap:12px"></div>
      <button type="button" class="btn sm ghost" id="rfpAdd">+ Add section</button>`,
    onSubmit: (d) => {
      collect();
      const sections = doc.sections.filter((s) => s.heading.trim() || s.body.trim());
      if (!sections.some((s) => s.body.trim())) { toast('The document is empty', 'Write or draft at least one section', 'var(--bad)'); return false; }
      const sent = o.rfpDoc?.status === 'SENT';
      o.rfpDoc = { title: d.title, sections, version: sent || !o.rfpDoc ? (o.rfpDoc?.version || 0) + 1 : o.rfpDoc.version, status: 'DRAFT', updatedAt: now(), aiDrafted: doc.aiDrafted || o.rfpDoc?.aiDrafted || false, sentAt: o.rfpDoc?.sentAt };
      audit('Opportunity', o.id, `${label} saved`, `v${o.rfpDoc.version} · ${sections.length} sections${doc.aiDrafted ? ' · AI-drafted' : ''}`);
      commit();
    },
  });
  const box = $('#rfpSecs', form);
  const collect = () => $$('.rfp-sec', box).forEach((el, i) => { doc.sections[i] = { heading: $('input', el).value, body: $('textarea', el).value }; });
  const draw = () => {
    box.innerHTML = doc.sections.map((s, i) => `<div class="rfp-sec"><div class="rfp-sec-h"><span class="n">${i + 1}</span><input value="${esc(s.heading)}" placeholder="Section heading" /><button type="button" class="x" data-rm="${i}" title="Remove section">×</button></div>
      <textarea placeholder="Write this section, or use “Draft with AI”…">${esc(s.body)}</textarea></div>`).join('');
  };
  box.addEventListener('click', (e) => { const k = e.target.dataset.rm; if (k != null) { collect(); doc.sections.splice(+k, 1); draw(); } });
  $('#rfpAdd', form).onclick = () => { collect(); doc.sections.push({ heading: '', body: '' }); draw(); };
  const ab = $('#rfpAi', form);
  ab.onclick = () => {
    collect();
    if (doc.sections.some((s) => s.body.trim()) && !confirm('Replace the current text with an AI draft?')) return;
    spin(ab, async () => {
      const r = await ai('rfpResponse', rfpPayload(o));
      doc.title = r.title; doc.sections = r.sections; doc.aiDrafted = true;
      form.elements.title.value = r.title; draw(); $$('textarea', box).forEach((t) => t.classList.add('ai-filled'));
      toast('Draft ready', 'Review every section — fill any [placeholders] before sending', 'var(--ok)');
    });
  };
  draw();
}
function rfpPreview(o) {
  modal({ title: o.rfpDoc.title, sub: `v${o.rfpDoc.version} · ${o.rfpDoc.status === 'SENT' ? 'sent ' + fmtDate(o.rfpDoc.sentAt) : 'draft'}`, wide: true, submit: '⎙ Print / Save as PDF',
    body: `<div class="doc print-area">${rfpDocHtml(o, o.rfpDoc)}</div>`, onSubmit: () => { window.print(); return false; } });
}
function sendRfp(o) {
  const doc = o.rfpDoc, c = byId('contacts', o.contactId), acc = byId('accounts', o.accountId);
  const placeholders = (rfpText(doc).match(/\[[^\]]{2,60}\]/g) || []);
  if (placeholders.length && !confirm(`The document still has ${placeholders.length} placeholder(s), e.g. ${placeholders[0]}. Send anyway?`)) return;
  const first = (c?.name || '').split(' ')[0];
  composer({
    title: `Send ${o.rfp?.received ? 'RFP response' : 'proposal'}`, sub: esc(doc.title), to: c?.email || '',
    subject: `${doc.title} — ${sellerName()}`,
    body: `Dear ${first || 'Sir/Madam'},\n\nPlease find our ${o.rfp?.received ? 'response to your RFP' : 'proposal'} for ${acc?.name} below.\n\nWe would be glad to walk you through it on a short call this week.\n\nRegards,\n${signOff()}`,
    attachment: { label: `${doc.title} (v${doc.version})`, note: `${doc.sections.length} sections · included in the email below your message`, previewHtml: rfpDocHtml(o, doc), emailHtml: rfpDocHtml(o, doc), text: rfpText(doc) },
    aiDraft: () => ai('rfpEmail', { title: doc.title, hasRfp: !!o.rfp?.received, deadline: o.rfp?.deadline, contact: { name: c?.name, designation: c?.designation }, account: acc?.name, sender: signOff() }),
    onSent: (m) => {
      doc.status = 'SENT'; doc.sentAt = now();
      logEmail(o, { kind: o.rfp?.received ? 'RFP response' : 'Proposal', ref: `v${doc.version}`, ...m });
      if (o.rfp?.received && (!o.rfp.decision || o.rfp.decision === 'Pending')) { o.rfp.decision = 'Bid'; audit('Opportunity', o.id, 'Bid decision', 'Bid (response submitted)'); }
      closeTasks(o.id, 'RFP deadline');
      commit();
    },
  });
}
function sendQuoteEmail(q, followUp = false) {
  const o = byId('opps', q.oppId), c = byId('contacts', o.contactId), acc = byId('accounts', o.accountId), t = quoteTotals(q);
  const prev = db.quotes.find((x) => x.number === q.number && x.version === q.version - 1);
  const changes = prev ? `Total changed from ${inr(quoteTotals(prev).total)} to ${inr(t.total)}` : '';
  const first = (c?.name || '').split(' ')[0];
  composer({
    title: followUp ? `Follow up on ${q.number}` : `Send quotation ${q.number} v${q.version}`, sub: esc(o.title), to: c?.email || '',
    subject: followUp ? `Following up: quotation ${q.number} — ${acc?.name}` : `Quotation ${q.number}${q.version > 1 ? ` (revised, v${q.version})` : ''} — ${acc?.name}`,
    body: followUp
      ? `Dear ${first || 'Sir/Madam'},\n\nFollowing up on our quotation ${q.number} for ${inr(t.total)} (incl. GST), valid until ${fmtDate(q.validUntil)}. Do let us know if you have any questions or would like us to revise anything.\n\nRegards,\n${signOff()}`
      : `Dear ${first || 'Sir/Madam'},\n\nThank you for the opportunity. Please find our quotation ${q.number}${q.version > 1 ? ` (revised, v${q.version})` : ''} below — ${inr(t.total)} including GST, valid until ${fmtDate(q.validUntil)}.\n\nTo proceed, please share your purchase order or reply to confirm.\n\nRegards,\n${signOff()}`,
    attachment: { label: `Quotation ${q.number} v${q.version} · ${inr(t.total)}`, emailHtml: quoteEmailHtml(q), text: quoteText(q) },
    aiDraft: () => ai('quoteEmail', { quote: quoteFacts(q), version: q.version, changes: followUp ? 'This is a follow-up; the quote was already sent' : changes, opp: { title: o.title, summary: o.summary }, contact: { name: c?.name, designation: c?.designation }, sender: signOff() }),
    onSent: (m) => {
      if (q.status === 'APPROVED') { q.status = 'SENT'; q.sentAt = now(); audit('Quotation', q.id, 'Sent', `${q.number} v${q.version} emailed to ${m.to} via ${m.via}`); }
      else audit('Quotation', q.id, 'Follow-up sent', `to ${m.to} via ${m.via}`);
      logEmail(o, { kind: followUp ? 'Quotation follow-up' : 'Quotation', ref: `${q.number} v${q.version}`, quoteId: q.id, ...m });
      if (!followUp) addTask(`Chase ${q.number} with ${c?.name || 'customer'}`, { type: 'opp', id: o.id }, o.ownerId, now() + 3 * day);
      commit();
    },
  });
}
const emailList = (list) => list?.length ? `<div class="tl">${list.map((m) => `<div class="tl-i" style="--c:var(--info)"><div class="what"><b>${esc(m.kind)}</b> · ${esc(m.subject)}</div><div class="when">to ${esc(m.to)}${m.cc ? ' · cc ' + esc(m.cc) : ''} · ${fmtTime(m.ts)} · ${esc(uname(m.by))} · via ${esc(m.via)}</div></div>`).join('')}</div>` : '';

function aiQualifyCard(o, canEdit) {
  const r = o.aiQualify; if (!r) return '';
  const recC = { qualify: 'var(--ok)', nurture: 'var(--warn)', disqualify: 'var(--bad)', need_more_info: 'var(--info)' }[r.recommendation];
  return `<div class="ai-card"><div class="ai-card-h"><b>✨ AI qualification check</b><span class="pill" style="--c:${recC}">${esc(r.recommendation.replace(/_/g, ' '))}</span><span class="faint" style="margin-left:auto;font-size:11.5px">${ago(r.ts)}</span></div>
    <div class="sub" style="margin-bottom:8px">${esc(r.reason)}</div>
    <div class="ai-bant">${['budget', 'authority', 'need', 'timeline'].map((k) => `<div class="${r[k].met ? 'met' : ''}"><b>${r[k].met ? '✓' : '○'} ${k[0].toUpperCase() + k.slice(1)}</b><span>${esc(r[k].evidence)}</span></div>`).join('')}</div>
    ${r.questions_to_ask?.length ? `<div style="margin-top:8px"><span class="sub">Ask next:</span><ul class="ai-q">${r.questions_to_ask.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
    ${canEdit ? `<div class="btn-row" style="margin-top:8px"><button class="btn sm" data-act="aiApplyBant" data-id="${o.id}">Apply to checklist</button></div>` : ''}</div>`;
}

function previewRfpAttachment(a) {
  if (!a.dataUrl) {
    toast('Preview unavailable', 'This attachment has a name only. Upload the document to preview it.', 'var(--warn)');
    return;
  }
  const name = a.name.toLowerCase();
  const isImage = a.type?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name);
  const isPdf = a.type === 'application/pdf' || /\.pdf$/i.test(name);
  const isText = a.type?.startsWith('text/') || /\.(txt|csv|log)$/i.test(name);
  const preview = isImage
    ? `<div class="rfp-file-preview"><img src="${esc(a.dataUrl)}" alt="${esc(a.name)}" /></div>`
    : isPdf || isText
      ? `<iframe class="rfp-file-preview" src="${esc(a.dataUrl)}" title="${esc(a.name)}"></iframe>`
      : `<div class="callout" style="--c:var(--info)"><b>Preview is not supported for this file type.</b><br><span class="sub">Download the document to view it.</span></div>`;
  modal({
    title: 'Document preview',
    sub: a.name,
    wide: true,
    submit: '',
    body: `${preview}<div class="btn-row" style="margin-top:12px"><a class="btn sm primary" href="${esc(a.dataUrl)}" download="${esc(a.name)}">↓ Download</a></div>`,
  });
}

const A = {
  nav: (v, el) => { if (el?.dataset.filter) ui.leadFilter = el.dataset.filter; closeDrawer(); go(v); },
  toggleSide: () => $('#side').classList.toggle('on'),
  collapseSide: () => setCollapsed(!$('#shell').classList.contains('collapsed')),
  theme: () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('srilead.theme', t); } catch (e) { /* ignore */ } },
  palette: () => openPalette(),
  closeDrawer,
  simulate,
  reset: () => modal({ title: 'Reset demo data?', sub: 'All leads, deals, quotes, orders, accounts and the audit trail are replaced with sample data. Your team and their sign-ins are kept.', body: '', submit: 'Reset', kind: 'bad', onSubmit: () => { window.SriStore.reset().then(() => reserveIds({ L: 80, OP: 40, AC: 60, SO: 5, QT: 5 })).then(() => { seed(); closeDrawer(); go('dashboard'); toast('Demo data restored', 'Your team and sign-ins were kept'); }).catch((e) => toast('Reset failed', e.message, 'var(--bad)')); } }),
  leadFilter: (k) => { ui.leadFilter = k; render(); },
  quoteFilter: (k) => { ui.quoteFilter = k; render(); },
  oppFilter: (k) => { ui.oppFilter = k; render(); },
  pickAccountOpp: () => modal({ title: 'New opportunity', sub: 'For an existing account or customer. New prospects start as a lead instead.', submit: 'Next',
    body: S('Account', 'acc', db.accounts.map((a) => [a.id, `${a.name} · ${a.status === 'CUSTOMER' ? 'Customer' : 'Prospect'}`])),
    onSubmit: (d) => { setTimeout(() => A.newAccountOpp(d.acc), 30); } }),
  openLead: (id) => openDrawer('lead', id),
  openOpp: (id) => openDrawer('opp', id),
  openQuote: (id) => openDrawer('quote', id),
  openOrder: (id) => openDrawer('order', id),
  openAccount: (id) => openDrawer('account', id),
  openRef,
  toggleTask: (id) => { const t = byId('tasks', id); t.done = !t.done; t.doneAt = now(); audit('Task', id, t.done ? 'Completed' : 'Reopened', t.title); commit(); },
  bell: () => { const p = $('#bellPanel'); const on = !p.classList.contains('on'); if (on) closeDrawer(); p.classList.toggle('on', on); if (on) drawBellPanel(); },
  bellRead: () => { (db.notifications || []).forEach((n) => { if (n.to === db.me) n.read = true; }); save(); renderBell(); drawBellPanel(); },
  runReminders: (_, el) => { el.disabled = true; fetch('/api/reminders/run', { method: 'POST' }).then((r) => r.json()).then((r) => { toast(r.note ? 'Reminders not sent' : `Reminders run · ${r.sent} sent`, r.note || '', r.note ? 'var(--warn)' : 'var(--ok)'); loadReminderStatus(); }).catch((e) => toast('Reminder run failed', e.message, 'var(--bad)')).finally(() => { el.disabled = false; }); },
  nudge: (ref) => {
    const [type, id] = ref.split(':'); const rec = byId(type === 'opp' ? 'opps' : 'leads', id); const owner = user(rec.ownerId);
    const name = type === 'opp' ? rec.title : rec.name;
    modal({ title: `Nudge ${esc(owner.name)}`, sub: `About ${esc(name)} · goes to their bell${svc.mail && owner.email ? ' and by email to ' + esc(owner.email) : ''}`, submit: 'Send nudge',
      body: `${T('Message', 'msg', `Please follow up on ${name} today and log the outcome in SriLead.`, 'required')}${F('Follow up by', 'due', isoDate(now() + day), 'date', 'required')}`,
      onSubmit: (d) => {
        addTask(`Follow up (from ${me().name.split(' ')[0]}): ${name}`, { type, id }, owner.id, new Date(d.due + 'T10:00').getTime());
        notify(owner.id, `${me().name}: ${d.msg}`, { type, id });
        audit(type === 'opp' ? 'Opportunity' : 'Lead', id, 'Owner nudged', `${owner.name} · due ${d.due}`);
        if (svc.mail && owner.email) fetch('/api/mail/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: owner.email, subject: `Follow up: ${name}`, text: `${d.msg}\n\nDue: ${d.due}\nOpen: ${location.origin}/#open=${type === 'opp' ? 'Opportunity' : 'Lead'}:${id}\n\n— ${me().name}` }) }).catch(() => {});
        commit();
      } });
  },
  addUser: () => modal({
    title: 'Add user', sub: 'Creates the team member and a temporary password for their first sign-in.', submit: 'Add & create sign-in',
    body: `<div class="grid2">${F('Full name', 'name', '', 'text', 'required')}${F('Work email (sign-in)', 'email', '', 'email', 'required')}
      ${S('Role', 'role', [['rep', 'Rep — works own leads and deals'], ['manager', 'Manager — approvals, assignment, review'], ['admin', 'Admin — everything incl. team & rules']], 'rep')}
      ${S('Region', 'region', ['All', ...REGIONS], 'All')}${F('Discount limit %', 'discLimit', '10', 'number', 'min="0" max="100"')}</div>`,
    onSubmit: (d) => {
      const email = d.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) { toast('Invalid email', email, 'var(--bad)'); return false; }
      if (db.users.some((u) => (u.email || '').toLowerCase() === email)) { toast('Email already used', email, 'var(--bad)'); return false; }
      const palette = ['#b42318', '#1e3a6e', '#2f7d6d', '#a5620b', '#5b4b8a', '#1f6f8b', '#8a3b12'];
      const u = { id: nid('U'), name: d.name.trim(), email, role: d.role, region: d.region, discLimit: Math.max(0, Math.min(100, +d.discLimit || 0)), active: true, onLeave: false, products: [], color: palette[db.users.length % palette.length] };
      db.users.push(u); audit('User', u.id, 'Added', `${u.name} · ${ROLE_LABEL[u.role]}`); commit();
      SriStore.flush().then(() => SriStore.api('/api/admin/users/' + encodeURIComponent(u.id) + '/login', { method: 'POST', body: { email } }))
        .then((r) => { audit('User', u.id, 'Sign-in created', email); save(); showTempPassword(r, u.name); })
        .catch((e) => toast('User added, sign-in not created', e.message, 'var(--bad)'));
    },
  }),
  issueLogin: (id) => {
    const u = user(id), has = !!ui.logins?.[id];
    modal({ title: has ? `Reset password · ${esc(u.name)}` : `Set up sign-in · ${esc(u.name)}`, sub: has ? 'Issues a new temporary password. Their current password stops working.' : 'Creates a temporary password for their first sign-in.', submit: has ? 'Reset password' : 'Create sign-in', kind: has ? 'warn' : 'primary',
      body: F('Sign-in email', 'email', u.email || '', 'email', 'required'),
      onSubmit: (d) => {
        SriStore.flush().then(() => SriStore.api('/api/admin/users/' + encodeURIComponent(id) + '/login', { method: 'POST', body: { email: d.email } }))
          .then((r) => { u.email = r.email; audit('User', id, has ? 'Password reset' : 'Sign-in created', r.email); save(); showTempPassword(r, u.name); })
          .catch((e) => toast('Could not set sign-in', e.message, 'var(--bad)'));
      } });
  },
  revokeLogin: (id) => {
    const u = user(id);
    modal({ title: `Remove sign-in · ${esc(u.name)}`, sub: 'They are signed out at once and can no longer sign in. Their records stay.', submit: 'Remove sign-in', kind: 'bad', body: '',
      onSubmit: () => { SriStore.api('/api/admin/users/' + encodeURIComponent(id) + '/login', { method: 'DELETE' }).then(() => { audit('User', id, 'Sign-in removed', u.name); save(); loadLogins(); toast('Sign-in removed', u.name, 'var(--ok)'); }).catch((e) => toast('Could not remove', e.message, 'var(--bad)')); } });
  },
  userMenu: () => $('#userMenu').classList.toggle('on'),
  changePassword: () => showChangePassword(false),
  signOut: async () => { try { await SriStore.flush(); await SriStore.api('/api/auth/logout', { method: 'POST', quiet: true }); } catch (e) { /* ignore */ } location.hash = ''; location.reload(); },
  toggleUser: (ref) => { const [id, k] = ref.split(':'); const u = user(id); u[k] = !u[k]; audit('User', id, 'Updated', `${u.name}: ${k} = ${u[k]}`); commit(); },
  toggleSetting: (k) => { db.settings[k] = !db.settings[k]; audit('Settings', k, 'Changed', `${k} = ${db.settings[k]}`); commit(); },

  newLead: () => modal({
    title: 'New lead', sub: 'Step 1 · Raw capture. Validation, dedupe, account linking and assignment run automatically.', submit: 'Capture lead',
    body: `<div class="ai-box"><div class="ai-box-h"><b>✨ Paste an enquiry</b><span class="sub">Email, WhatsApp message or call note — AI fills the form below for you to check.</span></div>
      <textarea id="aiPaste" placeholder="e.g. Hi, Ravi Kulkarni here, purchase head at Sunrise Foods, Pune. We need a CRM for about 40 sales people by March. Call me on 98200 11223 or mail ravi@sunrisefoods.in"></textarea>
      <div class="btn-row">${aiBtn('Fill the form', 'id="aiParse"')}</div></div>${leadForm()}`,
    onMount: (f) => {
      const b = $('#aiParse', f);
      b.onclick = () => {
        const text = $('#aiPaste', f).value.trim();
        if (!text) { toast('Paste the enquiry first', '', 'var(--warn)'); $('#aiPaste', f).focus(); return; }
        spin(b, async () => {
          const r = await ai('parseLead', { text, products: productGroups(), sources: SOURCES });
          const ok = { region: REGIONS, product: productGroups(), source: SOURCES };
          let n = 0;
          for (const k of ['name', 'phone', 'email', 'company', 'designation', 'region', 'product', 'source', 'requirement']) {
            const v = String(r[k] || '').trim(); const el = f.elements[k];
            if (!v || !el || (ok[k] && !ok[k].includes(v))) continue;
            el.value = v; el.classList.add('ai-filled'); n++;
          }
          f.elements.raw_text.value = text;
          toast(n ? `Filled ${n} fields` : 'Nothing to extract', n ? 'Check them before capturing — highlighted fields came from AI' : 'Fill the form manually', n ? 'var(--ok)' : 'var(--warn)');
        });
      };
    },
    onSubmit: (d) => { const raw = d.raw_text; const l = ingest(raw ? { ...d, enquiry: raw } : d); if (l.status === 'VALIDATED') toast('Lead validated & assigned', `${l.name} → ${uname(l.ownerId)}`, 'var(--ok)'); commit(); openDrawer('lead', l.id); },
  }),
  editLead: (id) => { const l = byId('leads', id); modal({ title: 'Correct & resubmit', sub: esc(l.reason), body: leadForm(l), submit: 'Resubmit', onSubmit: (d) => { ingest(d, l); commit(); } }); },

  reviewMerge: (id) => { const l = byId('leads', id), d = byId('leads', l.reviewOf); l.status = 'DUPLICATE'; l.dupOf = d.id; d.activities.push({ ts: now(), text: `Merged probable duplicate ${l.id} (${l.email})` }); audit('Lead', l.id, 'Review: merged', `Merged into ${d.id}`); notify(d.ownerId, `${l.name} merged into your lead`); commit(); },
  reviewKeep: (id) => { const l = byId('leads', id); audit('Lead', l.id, 'Review: kept separate', `Not a duplicate of ${l.reviewOf}`); l.reviewType = null; proceedValidated(l); commit(); },
  reviewAccount: (ref) => {
    const [id, accId] = ref.split(':'); const l = byId('leads', id);
    if (accId === 'new') { const key = l.company.toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + Date.now().toString(36).slice(-3); const acc = { id: nid('AC'), name: l.company, key, status: 'PROSPECT', ownerId: null, region: l.region, createdAt: now() }; db.accounts.unshift(acc); audit('Account', acc.id, 'Created', `${acc.name} (manual review)`); linkContactAccount(l, acc.id); }
    else linkContactAccount(l, accId);
    audit('Lead', l.id, 'Review: account chosen', byId('accounts', l.accountId)?.name || ''); l.status = 'VALIDATED'; l.reviewType = null; assignLead(l); commit();
  },

  logCall: (id) => {
    const l = byId('leads', id);
    let insights = null;
    modal({
      title: `Log call · ${esc(l.name)}`, sub: `${esc(l.phone)} · attempt ${l.calls.length + 1}`,
      body: `<div class="grid2">${S('Outcome', 'outcome', CALL_OUTCOMES)}${F('Duration (min)', 'duration', '5', 'number', 'min="0"')}</div>
        ${T('Discovery notes', 'notes', '', 'placeholder="Requirement · quantity/scale · timeline · rough budget · who decides · current supplier · preferred channel"')}
        <div class="btn-row">${aiBtn('Analyse notes', 'id="aiCall"')}</div><div id="aiCallOut"></div>
        <div class="grid2">${F('Next action', 'next', '', 'text', 'placeholder="e.g. Send brochure on WhatsApp"')}${F('Follow up on', 'followUp', '', 'date')}</div>
        <div class="sub" style="margin-top:-6px">A follow-up date creates a task for the owner, with reminders.</div>
        <label class="check"><input type="checkbox" name="interested" /><div><b>Real interest confirmed</b><small>Moves the lead to INTERESTED</small></div></label>`,
      submit: 'Save call',
      onMount: (f) => {
        const b = $('#aiCall', f);
        b.onclick = () => {
          const notes = f.elements.notes.value.trim();
          if (!notes) { toast('Write the call notes first', '', 'var(--warn)'); f.elements.notes.focus(); return; }
          spin(b, async () => {
            insights = await ai('callInsights', { lead: { name: l.name, company: l.company, designation: l.designation, requirement: l.requirement, product: l.product }, outcome: f.elements.outcome.value, notes, history: callNotes(l) });
            const r = insights, ic = { high: 'var(--ok)', medium: 'var(--info)', low: 'var(--warn)', none: 'var(--faint)' }[r.interest];
            $('#aiCallOut', f).innerHTML = `<div class="ai-card"><div class="ai-card-h"><b>✨ Call insights</b><span class="pill" style="--c:${ic}">${r.interest} interest</span>${r.real_requirement ? '<span class="pill" style="--c:var(--ok)">real requirement</span>' : ''}</div>
              <div style="margin-bottom:6px">${esc(r.summary)}</div>
              <div class="ai-chips">${['budget', 'authority', 'need', 'timeline'].map((k) => `<span class="${r.bant[k] ? 'on' : ''}">${r.bant[k] ? '✓' : '○'} ${k}</span>`).join('')}</div>
              ${r.signals?.length ? `<ul class="ai-q">${r.signals.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`;
            if (!f.elements.next.value) { f.elements.next.value = r.next_action; f.elements.next.classList.add('ai-filled'); }
            if (!f.elements.followUp.value && r.follow_up_days >= 0) { f.elements.followUp.value = isoDate(now() + Math.max(1, r.follow_up_days) * day); f.elements.followUp.classList.add('ai-filled'); }
            if (r.real_requirement) f.elements.interested.checked = true;
          });
        };
      },
      onSubmit: (d) => {
        const ok = d.outcome === 'Connected';
        l.calls.push({ ts: now(), outcome: d.outcome, duration: ok ? +d.duration || 0 : 0, notes: d.notes, next: d.next, by: db.me, ...(insights ? { ai: { summary: insights.summary, interest: insights.interest, bant: insights.bant, real_requirement: insights.real_requirement } } : {}) });
        if (d.followUp) { closeTasks(l.id, 'Follow up'); addTask(`Follow up: ${l.name}${d.next ? ' — ' + d.next : ''}`, { type: 'lead', id: l.id }, l.ownerId || db.me, new Date(d.followUp + 'T10:00').getTime()); }
        audit('Lead', l.id, 'Call logged', `${d.outcome}${d.notes ? ' — ' + d.notes : ''}`);
        if (ok) {
          if (l.status === 'VALIDATED') { l.status = 'CONTACTED'; audit('Lead', l.id, 'Status → CONTACTED', ''); }
          closeTasks(l.id, 'First contact'); closeTasks(l.id, 'SLA missed'); closeTasks(l.id, 'Retry');
          if (d.interested && l.status !== 'INTERESTED') { l.status = 'INTERESTED'; audit('Lead', l.id, 'Status → INTERESTED', ''); }
        } else {
          l.attempts++;
          if (d.outcome === 'Wrong number') { l.status = 'CLOSED'; l.reason = 'Wrong number'; audit('Lead', l.id, 'Closed', 'Wrong number'); closeTasks(l.id); }
          else if (l.attempts >= MAX_ATTEMPTS) { l.status = 'CLOSED_UNREACHABLE'; l.reason = `All ${MAX_ATTEMPTS} attempts used`; audit('Lead', l.id, 'Closed (unreachable)', l.reason); closeTasks(l.id); toast('Closed — unreachable', `${MAX_ATTEMPTS} attempts used`, 'var(--bad)'); }
          else { const gap = [1, 2, 3, 4][l.attempts - 1] || 3; addTask(`Retry ${l.attempts + 1}/${MAX_ATTEMPTS}: ${l.name} (send WhatsApp/email meanwhile)`, { type: 'lead', id: l.id }, l.ownerId, now() + gap * day); toast('Retry scheduled', `Attempt ${l.attempts + 1} of ${MAX_ATTEMPTS} in ${gap} day(s)`, 'var(--warn)'); }
        }
        commit();
      },
    });
  },
  markInterested: (id) => { const l = byId('leads', id); l.status = 'INTERESTED'; audit('Lead', id, 'Status → INTERESTED', ''); commit(); },
  nurtureLead: (id) => {
    const l = byId('leads', id);
    modal({ title: 'Nurture', sub: 'Real interest, wrong timing. A follow-up task is created automatically.', body: `${T('Reason (required)', 'reason', '', 'required')}${F('Revisit on', 'date', isoDate(now() + 90 * day), 'date', 'required')}`, submit: 'Park for later', kind: 'warn',
      onSubmit: (d) => { l.status = 'NURTURE'; l.reason = d.reason; l.nurtureDate = d.date; closeTasks(l.id); addTask(`Nurture follow-up: ${l.name}`, { type: 'lead', id }, l.ownerId, new Date(d.date).getTime()); audit('Lead', id, 'Nurture', `${d.reason} · revisit ${d.date}`); commit(); } });
  },
  closeLead: (id) => {
    const l = byId('leads', id);
    modal({ title: 'Close lead', sub: 'No opportunity will be created. A reason is mandatory.', body: `${S('Reason', 'reason', l.attempts ? [...LEAD_CLOSE_REASONS, 'Unreachable'] : LEAD_CLOSE_REASONS)}${T('Notes', 'notes')}`, submit: 'Close lead', kind: 'bad',
      onSubmit: (d) => { l.status = d.reason === 'Unreachable' ? 'CLOSED_UNREACHABLE' : 'CLOSED'; l.reason = d.reason + (d.notes ? ' — ' + d.notes : ''); closeTasks(l.id); audit('Lead', id, 'Closed', l.reason); commit(); } });
  },
  reviveLead: (id) => { const l = byId('leads', id); l.status = hasConnected(l) ? 'CONTACTED' : 'VALIDATED'; closeTasks(id); addTask(`Re-engage: ${l.name}`, { type: 'lead', id }, l.ownerId, now() + day); audit('Lead', id, 'Re-engaged', 'Back from nurture'); commit(); },
  claimLead: (id) => { const l = byId('leads', id); setOwner(l, 'Lead', db.me, 'Claimed from pool'); l.slaDue = now() + (SLA_MIN[l.source] || 240) * 6e4; addTask(`First contact: ${l.name}`, { type: 'lead', id }, db.me, l.slaDue); commit(); },
  assignLead: (id) => {
    const l = byId('leads', id);
    modal({ title: `Assign ${esc(l.name)}`, body: `${S('Owner', 'owner', db.users.filter((u) => u.active).map((u) => [u.id, `${u.name} · ${u.region}${u.onLeave ? ' (on leave)' : ''} · load ${workload(u.id)}`]), l.ownerId || '')}${F('Reason', 'reason', l.escalated ? 'SLA missed — reassigned' : 'Manager assignment')}`, submit: 'Assign',
      onSubmit: (d) => { setOwner(l, 'Lead', d.owner, d.reason); closeTasks(l.id, 'First contact'); closeTasks(l.id, 'SLA missed'); l.escalated = false; if (['VALIDATED'].includes(l.status)) { l.slaDue = now() + (SLA_MIN[l.source] || 240) * 6e4; addTask(`First contact: ${l.name}`, { type: 'lead', id }, d.owner, l.slaDue); } notify(d.owner, `Lead ${l.name} assigned to you`); commit(); } });
  },
  addCustomer: () => customerForm(),
  importCustomers: () => importCustomers(),
  editAccount: (id) => customerForm(byId('accounts', id)),
  addContact: (id) => contactForm(byId('accounts', id)),
  accFilter: (k) => { ui.accFilter = k; render(); },
  newAccountOpp: (accId) => {
    const a = byId('accounts', accId);
    const contacts = db.contacts.filter((c) => c.accountId === accId);
    const cust = a.status === 'CUSTOMER';
    modal({
      title: `New opportunity · ${esc(a.name)}`, sub: cust ? 'Existing customer — no new lead or dedupe needed. Goes straight to Step 6 (owner) and Step 7 (qualify).' : 'Known account — goes straight to owner assignment and qualification.',
      body: `<div class="grid2">${S('Contact', 'contactId', [...contacts.map((c) => [c.id, `${c.name}${c.designation ? ' · ' + c.designation : ''}`]), ['__new', '+ Add a new contact']], (contacts.find((c) => c.primary) || contacts[0])?.id || '__new')}
        ${S('Type', 'source', cust ? ['Upsell', 'Repeat order', 'Renewal', 'Referral'] : ['Existing account', 'Referral', 'Manual'], cust ? 'Upsell' : 'Existing account')}</div>
        <div class="grid3" id="newContact" style="${contacts.length ? 'display:none' : ''}">${F('New contact name', 'cName')}${F('Mobile', 'cPhone', '', 'tel')}${F('Email', 'cEmail', '', 'email')}</div>
        ${F('Title', 'title', `${a.name} — `, 'text', 'required')}${T('Requirement summary', 'summary')}
        <div class="grid3">${F('Estimated value (₹)', 'value', '', 'number', 'required min="0"')}${F('Expected close', 'closeDate', isoDate(now() + 30 * day), 'date', 'required')}${S('Product', 'product', productGroups())}</div>
        <div class="sub">${a.ownerId ? `Owner: <b>${esc(uname(a.ownerId))}</b> (account owner) unless unavailable — then the rules decide.` : 'Owner is picked by the assignment rules.'}</div>`,
      submit: 'Create opportunity',
      onMount: (f) => { f.elements.contactId.onchange = (e) => { $('#newContact', f).style.display = e.target.value === '__new' ? '' : 'none'; }; },
      onSubmit: (d) => {
        let contactId = d.contactId;
        if (contactId === '__new') {
          const o = normalize({ phone: d.cPhone, email: d.cEmail, name: d.cName });
          if (!o.name || (!o.phone && !o.email)) { toast('New contact needs a name and a phone or email', '', 'var(--bad)'); return false; }
          const errs = validateFields({ ...o, source: 'Manual' }); if (errs.length) { toast('Contact details invalid', errs.join('; '), 'var(--bad)'); return false; }
          const dup = db.contacts.find((c) => (o.phone && c.phone === o.phone) || (o.email && c.email === o.email));
          if (dup) { contactId = dup.id; toast('Existing contact reused', dup.name, 'var(--warn)'); }
          else { const c = { id: nid('C'), name: o.name, phone: o.phone, email: o.email, designation: '', accountId: accId, createdAt: now() }; db.contacts.unshift(c); contactId = c.id; audit('Contact', c.id, 'Created', `${c.name} @ ${a.name}`); }
        }
        const r = createOpportunity(null, d, { accountId: accId, contactId });
        if (r.err) { toast('Blocked', r.err, 'var(--bad)'); return false; }
        commit(); openDrawer('opp', r.opp.id); if (!r.linked) toast('Opportunity created', `${r.opp.title} → ${uname(r.opp.ownerId)}`, 'var(--ok)');
      },
    });
  },
  createOpp: (id) => {
    const l = byId('leads', id);
    if (!hasConnected(l)) return toast('Not yet', 'Log a connected call first', 'var(--bad)');
    if (!l.contactId || !l.accountId) return toast('Missing prerequisite', 'This lead has no account — add a company name first', 'var(--bad)');
    const notes = l.calls.filter((c) => c.notes).map((c) => c.notes).join('. ');
    const prior = leadOpps(l.id);
    modal({ title: prior.length ? 'Create another opportunity' : 'Create opportunity', sub: prior.length ? `This lead already has ${prior.length} opportunit${prior.length > 1 ? 'ies' : 'y'}. A different product creates a separate deal.` : 'Step 5 · Pre-filled from the lead and your call notes.',
      onMount: (f) => {
        const b = $('#aiOpp', f);
        b.onclick = () => spin(b, async () => {
          const r = await ai('draftOpportunity', { lead: { name: l.name, company: l.company, designation: l.designation, requirement: l.requirement, product: l.product, region: l.region }, calls: callNotes(l), products: db.products.map((p) => ({ name: p.name, group: p.group, price: p.price })) });
          const set = (k, v) => { if (v === '' || v == null) return; f.elements[k].value = v; f.elements[k].classList.add('ai-filled'); };
          set('title', r.title); set('summary', r.summary); if (r.estimated_value > 0) set('value', Math.round(r.estimated_value));
          set('closeDate', isoDate(now() + Math.max(7, r.close_in_days || 30) * day)); if (productGroups().includes(r.product)) set('product', r.product);
          $('#aiOppWhy', f).innerHTML = `<div class="ai-line">✨ ${esc(r.rationale)}</div>`;
        });
      },
      body: `<div class="mail-head">${aiBtn('Draft from call notes', 'id="aiOpp"')}<span class="sub">Suggests title, summary, value and close date from the calls.</span></div><div id="aiOppWhy"></div>${F('Title', 'title', `${l.company} — ${l.product || 'Requirement'}`, 'text', 'required')}${T('Requirement summary', 'summary', notes || l.requirement)}
      <div class="grid3">${F('Estimated value (₹)', 'value', '', 'number', 'required min="0"')}${F('Expected close', 'closeDate', isoDate(now() + 30 * day), 'date', 'required')}${S('Product', 'product', productGroups(), l.product || productGroups()[0])}</div>
      <div class="sub">Source <b>${esc(l.source)}</b> is copied for reporting. ${db.settings.handoff ? 'Handoff rules will pick the owner.' : `${esc(uname(l.ownerId))} keeps ownership.`}</div>`, submit: 'Create opportunity',
      onSubmit: (d) => { const r = createOpportunity(l, d); if (r.err) { toast('Blocked', r.err, 'var(--bad)'); return false; } commit(); openDrawer('opp', r.opp.id); if (!r.linked) toast('Opportunity created', `${r.opp.title} → ${uname(r.opp.ownerId)}`, 'var(--ok)'); } });
  },

  claimOpp: (id) => { const o = byId('opps', id); setOwner(o, 'Opportunity', db.me, 'Claimed from pool'); addTask(`Start qualification: ${o.title}`, { type: 'opp', id }, db.me, addBusinessDays(now(), 1)); commit(); },
  assignOpp: (id) => {
    const o = byId('opps', id);
    modal({ title: 'Assign opportunity', sub: 'Call notes and history carry over to the new owner.', body: `${S('Owner', 'owner', db.users.filter((u) => u.active).map((u) => [u.id, `${u.name} · ${u.region}${u.onLeave ? ' (on leave)' : ''} · load ${workload(u.id)}`]), o.ownerId || '')}${F('Reason', 'reason', 'Manager assignment')}`, submit: 'Assign',
      onSubmit: (d) => { setOwner(o, 'Opportunity', d.owner, d.reason); closeTasks(o.id, 'Start qualification'); addTask(`Start qualification: ${o.title}`, { type: 'opp', id }, d.owner, addBusinessDays(now(), 1)); notify(d.owner, `Opportunity ${o.title} handed to you`); commit(); } });
  },
  startQualify: (id) => { const o = byId('opps', id); o.stage = 'QUALIFYING'; closeTasks(id, 'Start qualification'); audit('Opportunity', id, 'Handoff accepted', `Stage → RFP / Qualify by ${uname(db.me)}`); commit(); },
  toggleBant: (ref) => { const [id, k] = ref.split(':'); const o = byId('opps', id); o.bant[k] = !o.bant[k]; audit('Opportunity', id, 'BANT updated', `${k}: ${o.bant[k] ? '✓' : '✗'}`); commit(); },
  editRfp: (id) => {
    const o = byId('opps', id), r = o.rfp || {};
    let attachments = r.attachments?.length ? r.attachments.map((a) => ({ ...a })) : (r.file ? r.file.split(',').map((name) => ({ name: name.trim(), size: 0, type: '' })).filter((a) => a.name) : []);
    modal({ title: 'RFP details', sub: 'Reminders are created before the submission deadline.', body: `<div class="grid2">${F('Received on', 'date', r.date || isoDate(now()), 'date', 'required')}${F('Submission deadline', 'deadline', r.deadline || isoDate(now() + 10 * day), 'date', 'required')}
      <label class="field span2"><span>Attachment name</span><input type="hidden" name="file" id="rfpAttachmentName" /><div class="rfp-document-row"><div id="rfpAttachmentList"></div><button type="button" class="btn sm primary rfp-file-upload" id="rfpAttachmentAdd" title="Upload documents" aria-label="Upload documents"><i data-lucide="upload" aria-hidden="true"></i></button><input type="file" id="rfpAttachmentFile" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.zip" /></div></label>${S('Bid decision', 'decision', ['Pending', 'Bid', 'No-bid'], r.decision || 'Pending')}</div>`, submit: 'Save RFP',
      onSubmit: (d) => {
        const names = new Set(d.file.split(',').map((name) => name.trim()).filter(Boolean));
        o.rfp = { received: true, ...d, attachments: attachments.filter((a) => names.has(a.name)) }; closeTasks(id, 'RFP');
        const dl = new Date(d.deadline).getTime(); addTask(`RFP deadline reminder: ${o.title}`, { type: 'opp', id }, o.ownerId, Math.max(now(), dl - 2 * day));
        audit('Opportunity', id, 'RFP recorded', `Deadline ${d.deadline} · ${d.decision}`);
        if (d.decision === 'No-bid') { o.stage = 'DISQUALIFIED'; o.reason = 'No-bid decision on RFP'; audit('Opportunity', id, 'Disqualified', o.reason); }
        commit();
      },
      onMount: (form) => {
        const nameInput = $('#rfpAttachmentName', form);
        const fileInput = $('#rfpAttachmentFile', form);
        const addButton = $('#rfpAttachmentAdd', form);
        const saveButton = $('button[type=submit]', form);
        const list = $('#rfpAttachmentList', form);
        const formatSize = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${bytes} B`;
        const draw = () => {
          nameInput.value = attachments.map((a) => a.name).join(', ');
          list.innerHTML = attachments.length
            ? `<div class="rfp-document-list">${attachments.map((a, i) => `<div class="attach"><span class="ic">📄</span><div style="flex:1;min-width:0"><b>${esc(a.name)}</b><small>${a.size ? formatSize(a.size) : 'Name only'}</small></div><div class="rfp-document-actions"><button type="button" class="icon-btn rfp-preview-eye" data-preview-index="${i}" title="Preview ${esc(a.name)}" aria-label="Preview ${esc(a.name)}"><i data-lucide="eye" aria-hidden="true"></i></button><button type="button" class="icon-btn rfp-remove-attachment" data-remove-index="${i}" title="Remove ${esc(a.name)}" aria-label="Remove ${esc(a.name)}"><i data-lucide="x" aria-hidden="true"></i></button></div></div>`).join('')}</div>`
            : '<div class="rfp-document-empty">No document uploaded</div>';
          createIcons({ icons: { Upload, Eye, X } });
          $$('.rfp-preview-eye', list).forEach((button) => {
            button.onclick = () => previewRfpAttachment(attachments[Number(button.dataset.previewIndex)]);
          });
          $$('.rfp-remove-attachment', list).forEach((button) => {
            button.onclick = () => {
              attachments.splice(Number(button.dataset.removeIndex), 1);
              draw();
            };
          });
        };
        addButton.onclick = () => fileInput.click();
        fileInput.onchange = async () => {
          const files = [...(fileInput.files || [])];
          if (!files.length) return;
          saveButton.disabled = true;
          try {
            for (const file of files) {
              const duplicate = attachments.some((a) => a.name === file.name && a.size === file.size && a.type === file.type);
              const totalSize = attachments.reduce((total, a) => total + (a.size || 0), 0);
              if (!duplicate && (file.size > 10 * 1048576 || totalSize + file.size > 10 * 1048576)) {
                toast('Attachment limit reached', 'Keep RFP documents under 10 MB total', 'var(--bad)');
                continue;
              }
              if (duplicate) {
                continue;
              }
              const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
              });
              attachments.push({ name: file.name, size: file.size, type: file.type, dataUrl });
            }
            draw();
          } catch (e) {
            toast('Attachment not added', e.message || 'Could not read the document', 'var(--bad)');
          } finally {
            saveButton.disabled = false;
            fileInput.value = '';
          }
        };
        draw();
      } });
  },
  qualify: (id) => { const o = byId('opps', id); o.stage = 'QUALIFIED'; audit('Opportunity', id, 'Qualified', 'BANT complete, requirement documented'); toast('Qualified', 'Ready for a quotation', 'var(--ok)'); commit(); },
  disqualify: (id) => {
    const o = byId('opps', id);
    modal({ title: 'Close opportunity', sub: 'A reason is mandatory. Only a manager can reopen.', body: `${S('Reason', 'reason', Object.keys(DISQ_REASONS))}${F('Competitor (optional)', 'competitor')}${T('Notes', 'notes')}`, submit: 'Close', kind: 'bad',
      onSubmit: (d) => { o.stage = DISQ_REASONS[d.reason]; o.reason = d.reason + (d.notes ? ' — ' + d.notes : ''); o.competitor = d.competitor; closeTasks(id); audit('Opportunity', id, o.stage === 'LOST' ? 'Lost' : 'Disqualified', o.reason); commit(); } });
  },
  nurtureOpp: (id) => {
    const o = byId('opps', id);
    modal({ title: 'Not ready yet', sub: 'Parked as NURTURE — not counted as lost.', body: `${T('Reason', 'reason', '', 'required')}${F('Revisit on', 'date', isoDate(now() + 90 * day), 'date', 'required')}`, submit: 'Park', kind: 'warn',
      onSubmit: (d) => { o.stage = 'NURTURE'; o.reason = d.reason; o.nurtureDate = d.date; closeTasks(id); addTask(`Revisit: ${o.title}`, { type: 'opp', id }, o.ownerId, new Date(d.date).getTime()); audit('Opportunity', id, 'Nurture', `${d.reason} · revisit ${d.date}`); commit(); } });
  },
  resumeOpp: (id) => { const o = byId('opps', id); o.stage = 'QUALIFYING'; closeTasks(id); audit('Opportunity', id, 'Resumed', 'Back to qualification'); commit(); },
  reopenOpp: (id) => { const o = byId('opps', id); o.stage = 'QUALIFYING'; audit('Opportunity', id, 'Reopened', `By manager · was ${o.reason}`); o.reason = ''; commit(); },

  newQuote: (id) => quoteEditor(byId('opps', id)),
  editQuote: (id) => { const q = byId('quotes', id); quoteEditor(byId('opps', q.oppId), q); },
  reviseQuote: (id) => { const q = byId('quotes', id); quoteEditor(byId('opps', q.oppId), q); },
  submitQuote: (id) => {
    const q = byId('quotes', id), o = byId('opps', q.oppId), t = quoteTotals(q), limit = user(o.ownerId)?.discLimit ?? 10;
    if (t.maxDisc > limit) { q.status = 'PENDING_APPROVAL'; audit('Quotation', id, 'Pending approval', `Discount ${t.maxDisc}% > ${limit}% limit`); const mgr = db.users.find((u) => isManagerRole(u) && u.active && !u.onLeave); notify(mgr?.id, `${q.number} needs discount approval`); }
    else { q.status = 'APPROVED'; audit('Quotation', id, 'Approved', `Within ${limit}% limit`); }
    commit();
  },
  approveQuote: (id) => { const q = byId('quotes', id); q.status = 'APPROVED'; q.approvedBy = db.me; audit('Quotation', id, 'Approved', `Discount approved by ${uname(db.me)}`); notify(byId('opps', q.oppId).ownerId, `${q.number} approved`); commit(); },
  rejectApproval: (id) => { const q = byId('quotes', id); q.status = 'DRAFT'; audit('Quotation', id, 'Approval declined', 'Back to draft'); commit(); },
  sendQuote: (id) => sendQuoteEmail(byId('quotes', id)),
  followQuote: (id) => sendQuoteEmail(byId('quotes', id), true),
  rfpEdit: (id) => rfpEditor(byId('opps', id)),
  rfpPreview: (id) => rfpPreview(byId('opps', id)),
  rfpSend: (id) => sendRfp(byId('opps', id)),
  aiQualify: (id, el) => spin(el, async () => {
    const o = byId('opps', id), ld = byId('leads', o.leadId);
    const r = await ai('qualify', { opp: { title: o.title, summary: o.summary, value: o.value, product: o.product, expected_close: o.closeDate, stage: o.stage, current_checklist: o.bant }, rfp: o.rfp?.received ? o.rfp : null, notes: [...callNotes(ld), ...(o.activities || []).map((a) => ({ date: isoDate(a.ts), note: a.text }))] });
    o.aiQualify = { ...r, ts: now() }; audit('Opportunity', id, 'AI qualification check', `Recommends ${r.recommendation.replace(/_/g, ' ')}`); commit();
  }),
  aiApplyBant: (id) => { const o = byId('opps', id), r = o.aiQualify; ['budget', 'authority', 'need', 'timeline'].forEach((k) => { o.bant[k] = !!r[k].met; }); audit('Opportunity', id, 'BANT updated from AI check', ['budget', 'authority', 'need', 'timeline'].map((k) => `${k}: ${o.bant[k] ? '✓' : '✗'}`).join(', ')); commit(); },
  aiDedupe: (id, el) => spin(el, async () => {
    const l = byId('leads', id), d = byId('leads', l.reviewOf);
    const pick = (x) => ({ name: x.name, phone: x.phone, email: x.email, company: x.company, designation: x.designation, source: x.source, created: isoDate(x.createdAt), requirement: x.requirement });
    l.aiDedupe = await ai('dedupeReview', { existing: pick(d), incoming: pick(l) }); audit('Lead', id, 'AI duplicate check', l.aiDedupe.verdict.replace(/_/g, ' ')); commit();
  }),
  previewQuote: (id) => quotePreview(byId('quotes', id)),
  acceptQuote: (id) => {
    const q = byId('quotes', id);
    if (new Date(q.validUntil).getTime() + day < now()) return toast('Expired', 'Validity date has passed — revise instead', 'var(--bad)');
    modal({ title: 'Customer accepted', sub: 'Acceptance needs proof.', body: `${S('Proof', 'proof', ['Customer PO', 'Signed copy', 'Email confirmation'])}${F('Reference (PO no. / file / email subject)', 'ref', '', 'text', 'required')}`, submit: 'Mark accepted', kind: 'ok',
      onSubmit: (d) => { q.status = 'ACCEPTED'; q.proof = d.proof; q.proofRef = d.ref; audit('Quotation', id, 'Accepted', `${d.proof}: ${d.ref}`); commit(); setTimeout(() => A.convertQuote(id), 50); } });
  },
  declineQuote: (id) => {
    const q = byId('quotes', id), o = byId('opps', q.oppId);
    modal({ title: 'Declined or no response', sub: 'The quotation is closed and the opportunity becomes LOST.', body: `${S('Outcome', 'status', [['REJECTED', 'Declined'], ['EXPIRED', 'Expired / no response']])}${S('Lost reason', 'reason', LOST_REASONS)}${F("Competitor's name (optional)", 'competitor')}`, submit: 'Close as lost', kind: 'bad',
      onSubmit: (d) => { q.status = d.status; q.reason = d.reason; o.stage = 'LOST'; o.reason = d.reason; o.competitor = d.competitor; closeTasks(o.id); audit('Quotation', id, d.status === 'REJECTED' ? 'Rejected' : 'Expired', d.reason); audit('Opportunity', o.id, 'Lost', `${d.reason}${d.competitor ? ' · ' + d.competitor : ''}`); commit(); } });
  },
  convertQuote: (id) => {
    const q = byId('quotes', id), o = byId('opps', q.oppId), acc = byId('accounts', o.accountId), c = byId('contacts', o.contactId);
    const prospect = acc.status === 'PROSPECT';
    modal({ title: 'Create sales order', sub: `Step 9 · Items, prices and terms are copied from ${q.number} v${q.version}.`, wide: true, submit: 'Confirm order', kind: 'ok',
      body: `<div class="grid3">${F('Customer PO number', 'poNumber', q.proof === 'Customer PO' ? q.proofRef : '', 'text', 'required')}${F('PO date', 'poDate', isoDate(now()), 'date', 'required')}${F('Delivery date', 'deliveryDate', isoDate(now() + 14 * day), 'date', 'required')}</div>
      <div class="grid2">${T('Delivery address', 'deliveryAddr', '', 'required')}${T('Billing address', 'billingAddr', '', 'required')}</div>
      ${S('Payment terms', 'paymentTerms', ['Advance', 'Net 15', 'Net 30', 'Net 45', '50% advance / 50% on delivery'], 'Net 30')}
      ${prospect ? `<div class="callout" style="--c:var(--info)"><b>${esc(acc.name)} becomes a Customer.</b> Collect the missing statutory details.</div><div class="grid2">${F('GSTIN', 'gstin', acc.gstin || '', 'text', 'required placeholder="15-character GSTIN"')}${F('PAN', 'pan', acc.pan || '', 'text', 'required placeholder="ABCDE1234F"')}</div>` : ''}
      <div class="sub">Order value <b>${inr(quoteTotals(q).total)}</b> · contact ${esc(c?.name)}</div>`,
      onSubmit: (d) => {
        if (prospect && !/^[0-9A-Z]{15}$/i.test(d.gstin)) { toast('Invalid GSTIN', 'Must be 15 characters', 'var(--bad)'); return false; }
        if (prospect && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(d.pan)) { toast('Invalid PAN', 'Format ABCDE1234F', 'var(--bad)'); return false; }
        const t = quoteTotals(q);
        const ord = { id: nid('SO'), quoteId: q.id, oppId: o.id, accountId: acc.id, poNumber: d.poNumber, poDate: d.poDate, deliveryDate: d.deliveryDate, deliveryAddr: d.deliveryAddr, billingAddr: d.billingAddr, paymentTerms: d.paymentTerms, total: t.total, status: 'CONFIRMED', createdAt: now() };
        db.orders.unshift(ord);
        audit('SalesOrder', ord.id, 'Confirmed', `${inr(t.total)} · PO ${d.poNumber}`);
        o.stage = 'WON'; o.finalValue = t.total; o.closedAt = now(); closeTasks(o.id);
        audit('Opportunity', o.id, 'Won', inr(t.total));
        if (prospect) { acc.status = 'CUSTOMER'; acc.gstin = d.gstin.toUpperCase(); acc.pan = d.pan.toUpperCase(); audit('Account', acc.id, 'Promoted to CUSTOMER', 'GSTIN & PAN collected'); }
        audit('SalesOrder', ord.id, 'Handover', 'Notified operations & finance');
        toast('🎉 Order confirmed', `${acc.name} · ${inr(t.total)} — ops & finance notified`, 'var(--ok)');
        commit(); openDrawer('order', ord.id);
      } });
  },
  cancelOrder: (id) => {
    const o = byId('orders', id);
    modal({ title: 'Cancel sales order', sub: 'Reported revenue will be adjusted. A reason is mandatory.', body: T('Reason', 'reason', '', 'required'), submit: 'Cancel order', kind: 'bad',
      onSubmit: (d) => { o.status = 'CANCELLED'; o.reason = d.reason; audit('SalesOrder', id, 'Cancelled', d.reason); commit(); } });
  },
};

/* ════════════════ Command palette ════════════════ */
function openPalette() {
  const root = $('#palette-root');
  root.innerHTML = `<div class="pal"><div class="pal-box"><input id="palQ" placeholder="Search records or type a command…" autocomplete="off" /><div class="pal-list" id="palList"></div></div></div>`;
  let sel = 0, items = [];
  const cmds = [
    ['+', 'New lead', () => A.newLead()], ['⌂', 'Add existing customer', () => A.addCustomer()], ['⇪', 'Import customers from CSV', () => A.importCustomers()], ['⚡', 'Simulate inbound lead', () => simulate()],
    ...Object.entries(VIEWS).map(([k, v]) => [v.ic, `Go to ${v.t}`, () => go(k)]),
    ['◐', 'Toggle theme', () => A.theme()],
    ['🔑', 'Change my password', () => showChangePassword(false)], ['⎋', 'Sign out', () => A.signOut()],
  ];
  const draw = () => {
    const q = $('#palQ').value.toLowerCase().trim();
    const m = (s) => !q || s.toLowerCase().includes(q);
    const rec = [
      ...db.leads.filter((l) => m(`${l.name} ${l.company} ${l.email} ${l.phone} ${l.id}`)).slice(0, 5).map((l) => ['✦', `${l.name || '(no name)'}`, () => openDrawer('lead', l.id), `Lead · ${l.status}`]),
      ...db.opps.filter((o) => m(`${o.title} ${o.id}`)).slice(0, 4).map((o) => ['▤', o.title, () => openDrawer('opp', o.id), `Deal · ${inrShort(o.value)}`]),
      ...db.quotes.filter((x) => m(`${x.number} ${x.id}`)).slice(0, 3).map((x) => ['₹', `${x.number} v${x.version}`, () => openDrawer('quote', x.id), x.status]),
      ...db.accounts.filter((a) => m(a.name)).slice(0, 3).map((a) => ['⌂', a.name, () => openDrawer('account', a.id), a.status]),
    ];
    const c = cmds.filter((x) => m(x[1])).map((x) => [...x, 'Command']);
    items = q ? [...rec, ...c] : [...c.slice(0, 6), ...rec.slice(0, 5)];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    $('#palList').innerHTML = items.length ? items.map((it, i) => `<div class="pal-i ${i === sel ? 'sel' : ''}" data-i="${i}"><span class="ic">${it[0]}</span>${esc(it[1])}<small>${esc(it[3])}</small></div>`).join('') : '<div class="empty">No matches</div>';
  };
  const run = (i) => { const it = items[i]; closePalette(); it?.[2](); };
  $('#palQ').oninput = () => { sel = 0; draw(); };
  $('#palQ').onkeydown = (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') run(sel);
  };
  $('#palList').onclick = (e) => { const el = e.target.closest('.pal-i'); if (el) run(+el.dataset.i); };
  $('.pal').addEventListener('mousedown', (e) => { if (e.target.classList.contains('pal')) closePalette(); });
  draw(); $('#palQ').focus();
}
function closePalette() { $('#palette-root').innerHTML = ''; }

/* ════════════════ Boot ════════════════ */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('#modal-root')) return;
  if (el.tagName === 'A') e.preventDefault();
  const fn = A[el.dataset.act];
  if (fn) { if (el.tagName === 'TR' || el.classList.contains('deal') || el.classList.contains('step')) e.stopPropagation(); fn(el.dataset.id, el); }
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b' && !e.target.closest?.('input,textarea')) { e.preventDefault(); A.collapseSide(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#palette-root').innerHTML ? closePalette() : openPalette(); }
  if (e.key === 'Escape') { if ($('#palette-root').innerHTML) closePalette(); else if ($('#modal-root').innerHTML) closeModal(); else closeDrawer(); }
});
document.addEventListener('input', (e) => { const id = e.target.id; if (id === 'auditQ' || id === 'oppQ' || id === 'accQ') { ui[id] = e.target.value; const pos = e.target.selectionStart; render(); const i = $('#' + id); i.focus(); i.setSelectionRange(pos, pos); } });
document.addEventListener('change', (e) => {
  if (e.target.id === 'oppOrigin' || e.target.id === 'oppSort') { ui[e.target.id] = e.target.value; render(); }
  if (e.target.classList.contains('urole')) { const u = user(e.target.dataset.uid); const was = u.role; u.role = e.target.value; audit('User', u.id, 'Role changed', `${u.name}: ${ROLE_LABEL[was]} → ${ROLE_LABEL[u.role]}`); commit(); }
  if (e.target.classList.contains('uregion')) { const u = user(e.target.dataset.uid); u.region = e.target.value; audit('User', u.id, 'Region changed', `${u.name}: ${u.region}`); commit(); }
  if (e.target.classList.contains('udisc')) { const u = user(e.target.dataset.uid); u.discLimit = Math.max(0, Math.min(100, +e.target.value || 0)); audit('User', u.id, 'Discount limit changed', `${u.name}: ${u.discLimit}%`); commit(); }
  if (e.target.id === 'companyName') { db.settings.companyName = e.target.value.trim() || 'SriLead'; audit('Settings', 'companyName', 'Changed', db.settings.companyName); save(); }
});
document.addEventListener('click', (e) => { const p = $('#bellPanel'); if (!p?.classList.contains('on')) return; const inside = e.target.closest('#bellPanel, #bellBtn'); const act = e.target.closest('#bellPanel [data-act]'); if (!inside || (act && act.dataset.act !== 'bellRead')) p.classList.remove('on'); });

function setCollapsed(on) {
  $('#shell').classList.toggle('collapsed', on);
  const b = $('#collapseBtn'); b.textContent = on ? '»' : '«';
  b.setAttribute('aria-label', on ? 'Expand sidebar' : 'Collapse sidebar'); b.title = (on ? 'Expand' : 'Collapse') + ' sidebar (⌘B)';
  try { localStorage.setItem('srilead.sidebar', on ? 'collapsed' : 'open'); } catch (e) { /* ignore */ }
  setTimeout(() => { if (db && ui.view === 'dashboard') drawLineChart(); }, 260);
}
try { if (localStorage.getItem('srilead.sidebar') === 'collapsed') setCollapsed(true); } catch (e) { /* ignore */ }
try { const t = localStorage.getItem('srilead.theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
window.addEventListener('sristore', (e) => {
  const el = $('#saveState'); if (!el) return;
  const map = { saving: ['Saving…', 'var(--warn)'], saved: ['Saved', 'var(--ok)'], error: ['Not saved', 'var(--bad)'] };
  const [t, c] = map[e.detail] || ['', 'var(--faint)'];
  el.textContent = t; el.style.setProperty('--c', c); el.dataset.state = e.detail;
});

/* ════════════════ Sign-in, first-run setup, passwords ════════════════ */
function authScreen(title, sub, body, onSubmit, onMount) {
  const root = $('#auth');
  root.innerHTML = `<div class="auth-card"><div class="brand auth-brand"><div class="logo">S</div><div><div class="brand-name">SriLead</div><div class="brand-sub">Lead → Order engine</div></div></div>
    <h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}<form class="stack" style="gap:12px" novalidate>${body}<div class="auth-err" id="authErr" role="alert"></div></form></div>`;
  root.classList.add('on');
  const f = $('form', root);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', f), err = $('#authErr', f);
    err.textContent = ''; btn.disabled = true;
    try { await onSubmit(Object.fromEntries(new FormData(f)), f); } catch (x) { err.textContent = x.message; } finally { if (btn.isConnected) btn.disabled = false; }
  };
  onMount?.(f);
  setTimeout(() => $('input:not([type=hidden]),select', f)?.focus(), 30);
}
function hideAuth() { const r = $('#auth'); r.classList.remove('on'); r.innerHTML = ''; }
const pwHint = '<small class="faint">At least 10 characters. A short sentence works well.</small>';

function showLogin(note) {
  authScreen('Sign in', note ? esc(note) : 'Use the email and password your admin gave you.',
    `${F('Email', 'email', '', 'email', 'autocomplete="username" required')}${F('Password', 'password', '', 'password', 'autocomplete="current-password" required')}
     <button class="btn primary full" type="submit">Sign in</button><small class="faint">Forgot your password? Ask an admin to reset it.</small>`,
    async (d) => {
      const r = await SriStore.api('/api/auth/login', { method: 'POST', body: { email: d.email, password: d.password }, quiet: true });
      session = r.user;
      if (r.mustChange) showChangePassword(true); else await startApp();
    });
}
function showChangePassword(forced) {
  const body = `${F(forced ? 'Temporary password' : 'Current password', 'current', '', 'password', 'autocomplete="current-password" required')}
    ${F('New password', 'next', '', 'password', 'autocomplete="new-password" required')}${pwHint}
    ${F('Confirm new password', 'confirm', '', 'password', 'autocomplete="new-password" required')}`;
  const submit = async (d) => {
    if (d.next !== d.confirm) throw new Error('The new passwords don’t match');
    await SriStore.api('/api/auth/password', { method: 'POST', body: { current: d.current, next: d.next }, quiet: true });
  };
  if (forced) {
    authScreen('Choose your password', `Welcome, ${esc(session?.name || '')}. Replace the temporary password before you start.`,
      `${body}<button class="btn primary full" type="submit">Save & continue</button><button class="btn ghost full" type="button" id="authOut">Sign out</button>`,
      async (d) => { await submit(d); await startApp(); toast('Password changed', '', 'var(--ok)'); },
      (f) => { $('#authOut', f).onclick = () => A.signOut(); });
  } else {
    modal({ title: 'Change password', body, submit: 'Change password',
      onSubmit: (d) => { submit(d).then(() => { closeModal(); toast('Password changed', '', 'var(--ok)'); }).catch((x) => toast('Not changed', x.message, 'var(--bad)')); return false; } });
  }
}

/* ════════════════ Boot ════════════════ */
function dbUnreachable(e) {
  $('#view').innerHTML = `<div class="card empty"><div class="big" style="color:var(--bad)">⚠</div><h2>Can’t reach the server</h2>
    <p class="sub">${esc(e.message)}</p>
    <p class="sub">Keep <b>two terminals</b> running: (1) <code>docker compose up -d db</code> and <code>cd backend &amp;&amp; ./gradlew bootRun -PjavaVersion=21</code> → API on <code>:8589</code>; (2) <code>cd frontend &amp;&amp; npm run dev</code> → UI (this tab). Then click Retry.</p>
    <button class="btn primary" onclick="location.reload()">Retry</button></div>`;
}
async function boot(note) {
  $('#view').innerHTML = '<div class="card empty"><div class="big">◌</div>Loading…</div>';
  let auth;
  try {
    if (!window.SriStore) throw new Error('store.js is not loaded');
    auth = await SriStore.api('/api/auth/me', { quiet: true });
  } catch (e) { dbUnreachable(e); return; }
  if (!auth.user) return showLogin(note);
  session = auth.user;
  if (auth.mustChange) return showChangePassword(true);
  await startApp();
}
function applyState(res) {
  const keepView = db ? ui.view : null;
  db = Object.assign(blank(), res.state);
  db.settings = Object.assign(blank().settings, res.state.settings || {});
  db.me = session.id;
  if (keepView) ui.view = keepView;
}
let started = false;
async function startApp() {
  hideAuth();
  document.body.classList.toggle('role-rep', session.role === 'rep');
  $('#view').innerHTML = '<div class="card empty"><div class="big">◌</div>Loading your data…</div>';
  let res;
  try { res = await SriStore.load(); } catch (e) { if (e.status === 401) return showLogin(); dbUnreachable(e); return; }
  await Promise.all([loadServices(), reserveIds({ L: 30, OP: 20, SO: 10, AC: 20, QT: 10, U: 5 })]);
  if (res.empty && session.role === 'admin') { db = { users: [] }; await reserveIds({ L: 80, OP: 40, AC: 60 }); seed(); }
  else applyState(res);
  if (!started) {
    started = true;
    const deep = location.hash.startsWith('#open=') ? decodeURIComponent(location.hash.slice(6)) : null;
    ui.view = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard';
    if (deep) { history.replaceState(null, '', '#' + ui.view); setTimeout(() => openRef(deep), 50); }
    window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS[v] && v !== ui.view) { ui.view = v; render(); } });
  }
  render();
}
/** After the server refuses a save (role rules) or the session ends. */
window.addEventListener('sristore-denied', async (e) => {
  const { status, error } = e.detail;
  SriStore.discard();
  if (status === 401) { session = null; closeModal(); closeDrawer(); boot('Your session ended — please sign in again.'); return; }
  toast('Not allowed for your role', error, 'var(--bad)');
  try { applyState(await SriStore.load()); render(); const el = $('#saveState'); if (el) { el.textContent = ''; } } catch (x) { /* handled above */ }
});
document.addEventListener('click', (e) => { const m = $('#userMenu'); if (m?.classList.contains('on') && !e.target.closest('#userMenu, #userBtn')) m.classList.remove('on'); });
boot();
setInterval(() => { if (db && !$('#modal-root').innerHTML && !$('#palette-root').innerHTML && !['auditQ', 'oppQ', 'accQ'].includes(document.activeElement?.id)) { sweep(); renderNav(); if (['dashboard', 'leads'].includes(ui.view)) { $('#view').innerHTML = ({ dashboard: vDashboard, leads: vLeads })[ui.view](); if (ui.view === 'dashboard') drawCharts(); } } }, 30000);
