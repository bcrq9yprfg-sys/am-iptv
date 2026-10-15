/* AM IPTV — beheerpagina (/admin)
   Toegang: inloggen met een account waarvan het e-mailadres in de Railway-variabele
   ADMIN_EMAILS staat (komma-gescheiden). */
const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();
const D = db.db;

function admins() {
  return String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
}

router.use(requireAuth, (req, res, next) => {
  const user = db.getUserById.get(req.userId);
  if (!admins().length) return res.status(403).send(page('Geen toegang', '<p>Zet de Railway-variabele <code>ADMIN_EMAILS</code> op jouw e-mailadres om de beheerpagina te gebruiken.</p>'));
  if (!user || !admins().includes(String(user.email).toLowerCase())) return res.status(403).send(page('Geen toegang', '<p>Dit account heeft geen beheerrechten.</p>'));
  req.admin = user;
  next();
});

const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = ts => ts ? new Date(ts * 1000).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const day = ts => ts ? new Date(ts * 1000).toLocaleDateString('nl-NL', { timeZone: 'Europe/Amsterdam' }) : '∞';
const shortDev = d => esc(String(d || '').replace(/^(duid-|dev-)/, '').slice(0, 10)) + '…';
const PLAN = { '1m': '1 maand', '6m': '6 maanden', '1y': '1 jaar', unlimited: 'Levenslang' };
const KIND = { live: 'Live', movie: 'Film', series: 'Serie' };

function page(title, body) {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — AM IPTV beheer</title>
<style>
:root{--bg:#0b0d14;--card:#141824;--line:#242a3a;--fg:#e8eaf1;--mut:#8b93a7;--acc:#7c5cff;--ok:#3ecf8e;--warn:#f5a524;--bad:#ff5c7a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1280px;margin:0 auto;padding:24px 16px 60px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:20px}
h1{font-size:22px;margin:0}h2{font-size:17px;margin:0 0 12px}
a{color:#a99bff;text-decoration:none}a:hover{text-decoration:underline}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.kpi b{display:block;font-size:26px;font-variant-numeric:tabular-nums}.kpi span{color:var(--mut);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:20px}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
td.tw{white-space:normal;min-width:180px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;background:#222838;color:var(--mut)}
.pill.ok{background:rgba(62,207,142,.15);color:var(--ok)}.pill.warn{background:rgba(245,165,36,.15);color:var(--warn)}.pill.bad{background:rgba(255,92,122,.15);color:var(--bad)}
form.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
select,input{background:#0f121b;color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font:inherit}
button{background:var(--acc);color:#fff;border:0;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
.muted{color:var(--mut)}.empty{color:var(--mut);padding:12px 0}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

router.get('/', (req, res) => {
  const days = [1, 7, 30, 90, 365].includes(+req.query.days) ? +req.query.days : 7;
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const now = Math.floor(Date.now() / 1000);
  const lic = String(req.query.lic || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const kind = ['live', 'movie', 'series'].includes(req.query.kind) ? req.query.kind : '';

  /* ---- Kerncijfers ---- */
  const k = {
    users: D.prepare('SELECT COUNT(*) n FROM users').get().n,
    active: D.prepare("SELECT COUNT(*) n FROM subscriptions WHERE status='active' AND (expires_at IS NULL OR expires_at > unixepoch())").get().n,
    trials: D.prepare('SELECT COUNT(*) n FROM trials').get().n,
    trialsActive: D.prepare('SELECT COUNT(*) n FROM trials WHERE started_at > unixepoch() - 3*86400').get().n,
    tvs: D.prepare('SELECT COUNT(DISTINCT device) n FROM license_devices WHERE last_seen > ?').get(since).n,
    views: D.prepare('SELECT COUNT(*) n FROM watch_events WHERE ts > ?').get(since).n
  };
  const byPlan = D.prepare("SELECT plan, COUNT(*) n FROM subscriptions WHERE status='active' AND (expires_at IS NULL OR expires_at > unixepoch()) GROUP BY plan").all()
    .map(r => `${PLAN[r.plan] || r.plan}: ${r.n}`).join(' · ') || 'nog geen';

  /* ---- Licenties ---- */
  const licenses = D.prepare(`
    SELECT s.license_key, s.plan, s.status, s.expires_at, s.created_at, u.email, u.name,
           COUNT(ld.device) devices, MAX(ld.last_seen) last_seen, COALESCE(SUM(ld.checks),0) checks,
           (SELECT COUNT(*) FROM watch_events w WHERE w.license_key = s.license_key AND w.ts > ?) views
    FROM subscriptions s JOIN users u ON u.id = s.user_id
    LEFT JOIN license_devices ld ON ld.license_key = s.license_key
    GROUP BY s.id ORDER BY (s.status='active') DESC, last_seen DESC, s.created_at DESC LIMIT 300`).all(since);
  const extra = D.prepare(`
    SELECT ld.license_key, COUNT(*) devices, MAX(last_seen) last_seen, SUM(checks) checks
    FROM license_devices ld WHERE ld.license_key NOT IN (SELECT license_key FROM subscriptions)
    GROUP BY ld.license_key`).all();

  const licRows = licenses.map(l => {
    const expired = l.expires_at && l.expires_at < now;
    const st = l.status === 'active' && !expired ? '<span class="pill ok">actief</span>'
      : l.status === 'cancelled' ? '<span class="pill bad">opgezegd</span>' : '<span class="pill warn">verlopen</span>';
    return `<tr><td><a href="?lic=${esc(l.license_key)}&days=${days}"><code>${esc(l.license_key)}</code></a></td>
      <td>${esc(l.email)}</td><td>${esc(PLAN[l.plan] || l.plan)}</td><td>${st}</td><td>${day(l.expires_at)}</td>
      <td class="num">${l.devices}</td><td>${fmt(l.last_seen)}</td><td class="num">${l.views}</td></tr>`;
  }).join('') + extra.map(l => `<tr><td><a href="?lic=${esc(l.license_key)}&days=${days}"><code>${esc(l.license_key)}</code></a></td>
      <td class="muted">testcode (Samsung)</td><td>Levenslang</td><td><span class="pill ok">actief</span></td><td>∞</td>
      <td class="num">${l.devices}</td><td>${fmt(l.last_seen)}</td><td class="num">—</td></tr>`).join('');

  /* ---- Kijkcijfers ---- */
  const where = ['ts > ?'], args = [since];
  if (lic) { where.push('license_key = ?'); args.push(lic); }
  const top = kd => D.prepare(`SELECT title, COUNT(*) n, COUNT(DISTINCT device) tvs FROM watch_events
     WHERE ${where.join(' AND ')} AND kind = ? GROUP BY title ORDER BY n DESC LIMIT 15`).all(...args, kd);
  const topTable = (rows, label) => rows.length
    ? `<table><tr><th>${label}</th><th class="num">Keer</th><th class="num">TV's</th></tr>${rows.map(r =>
        `<tr><td class="tw">${esc(r.title)}</td><td class="num">${r.n}</td><td class="num">${r.tvs}</td></tr>`).join('')}</table>`
    : '<div class="empty">Nog geen gegevens</div>';

  const rWhere = where.slice(), rArgs = args.slice();
  if (kind) { rWhere.push('kind = ?'); rArgs.push(kind); }
  const recent = D.prepare(`
    SELECT w.*, u.email FROM watch_events w
    LEFT JOIN subscriptions s ON s.license_key = w.license_key
    LEFT JOIN users u ON u.id = s.user_id
    WHERE ${rWhere.map(c => 'w.' + c).join(' AND ')} ORDER BY w.ts DESC LIMIT 200`).all(...rArgs);
  const recentRows = recent.map(w => `<tr><td>${fmt(w.ts)}</td>
      <td>${w.license_key ? `<a href="?lic=${esc(w.license_key)}&days=${days}"><code>${esc(w.license_key)}</code></a>` : '<span class="pill">proef</span>'}</td>
      <td>${esc(w.email || '')}</td><td><code class="muted">${shortDev(w.device)}</code></td>
      <td>${KIND[w.kind]}</td><td class="tw">${esc(w.title)}${w.season ? ` <span class="muted">S${esc(w.season)}·A${esc(w.episode || '')}</span>` : ''}</td>
      <td class="muted">${esc(w.folder || '')}</td></tr>`).join('');

  /* ---- Proefperiodes ---- */
  const trials = D.prepare(`
    SELECT t.device, t.started_at, (SELECT MIN(first_seen) FROM license_devices ld WHERE ld.device = t.device) bought
    FROM trials t ORDER BY t.started_at DESC LIMIT 100`).all();
  const converted = D.prepare('SELECT COUNT(*) n FROM trials t WHERE EXISTS (SELECT 1 FROM license_devices ld WHERE ld.device = t.device)').get().n;
  const trialRows = trials.map(t => {
    const active = t.started_at + 3 * 86400 > now;
    return `<tr><td><code class="muted">${shortDev(t.device)}</code></td><td>${fmt(t.started_at)}</td>
      <td>${active ? '<span class="pill ok">loopt</span>' : '<span class="pill warn">voorbij</span>'}</td>
      <td>${t.bought ? '<span class="pill ok">gekocht ' + day(t.bought) + '</span>' : '<span class="muted">nee</span>'}</td></tr>`;
  }).join('');

  const opt = (v, cur, l) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`;
  const body = `
  <header><h1>AM IPTV beheer</h1>
    <form class="filters" method="get">
      <select name="days">${[1, 7, 30, 90, 365].map(d => opt(d, days, d === 1 ? 'Laatste 24 uur' : 'Laatste ' + d + ' dagen')).join('')}</select>
      <input name="lic" placeholder="Licentiecode" value="${esc(lic)}">
      <select name="kind">${opt('', kind, 'Alles')}${opt('series', kind, 'Series')}${opt('movie', kind, 'Films')}${opt('live', kind, 'Live')}</select>
      <button>Toon</button>${lic || kind ? ' <a href="?days=' + days + '">wis filter</a>' : ''}
    </form></header>

  <div class="kpis">
    <div class="kpi"><b>${k.active}</b><span>actieve licenties<br>${esc(byPlan)}</span></div>
    <div class="kpi"><b>${k.users}</b><span>accounts</span></div>
    <div class="kpi"><b>${k.tvs}</b><span>TV's met licentie actief (periode)</span></div>
    <div class="kpi"><b>${k.trialsActive}</b><span>proefperiodes lopend<br>${k.trials} totaal · ${converted} gekocht</span></div>
    <div class="kpi"><b>${k.views}</b><span>keer iets gekeken (periode)</span></div>
  </div>

  ${lic ? `<div class="card"><b>Filter:</b> licentie <code>${esc(lic)}</code></div>` : ''}

  <div class="grid3">
    <div class="card"><h2>Top series</h2>${topTable(top('series'), 'Serie')}</div>
    <div class="card"><h2>Top films</h2>${topTable(top('movie'), 'Film')}</div>
    <div class="card"><h2>Top zenders</h2>${topTable(top('live'), 'Zender')}</div>
  </div>

  <div class="card"><h2>Licenties</h2><div class="scroll">${licRows ? `<table>
    <tr><th>Code</th><th>E-mail</th><th>Plan</th><th>Status</th><th>Geldig tot</th><th class="num">TV's</th><th>Laatst gezien</th><th class="num">Gekeken</th></tr>${licRows}</table>`
    : '<div class="empty">Nog geen licenties</div>'}</div></div>

  <div class="card"><h2>Recent gekeken</h2><p class="muted" style="margin:-6px 0 10px">Alleen van kijkers die in de app toestemming gaven. Maximaal 200 regels.</p>
    <div class="scroll">${recentRows ? `<table><tr><th>Tijd</th><th>Code</th><th>E-mail</th><th>TV</th><th>Soort</th><th>Titel</th><th>Map</th></tr>${recentRows}</table>`
    : '<div class="empty">Nog geen kijkactiviteit in deze periode</div>'}</div></div>

  <div class="card"><h2>Proefperiodes</h2><div class="scroll">${trialRows ? `<table>
    <tr><th>TV</th><th>Gestart</th><th>Status</th><th>Licentie gekocht</th></tr>${trialRows}</table>` : '<div class="empty">Nog geen proefperiodes</div>'}</div></div>
  <p class="muted">Ingelogd als ${esc(req.admin.email)} · <a href="/logout">uitloggen</a></p>`;
  res.send(page('Overzicht', body));
});

module.exports = router;
