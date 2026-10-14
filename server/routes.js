/* Alle routes: landingspagina, auth, dashboard, Stripe, webhook, licentie-API */
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('./db');
const { sign, requireAuth, requireAuthApi } = require('./auth');

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK = process.env.STRIPE_WEBHOOK_SECRET || '';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const stripe = require('stripe')(STRIPE_KEY);

/* Prijzen — zet hier je echte Stripe Price IDs in via env */
const PRICES = {
  '6m':       process.env.STRIPE_PRICE_6M       || 'price_6m_placeholder',
  '1y':       process.env.STRIPE_PRICE_1Y       || 'price_1y_placeholder',
  'unlimited': process.env.STRIPE_PRICE_UNLIMITED || 'price_unlimited_placeholder'
};

/* ======================================================
   LANDINGSPAGINA
   ====================================================== */
router.get('/', (req, res) => {
  const user = req.userId ? db.getUserById.get(req.userId) : null;
  res.render('index', { user });
});

/* Privacybeleid (vereist door Samsung TV Seller Office) */
router.get('/privacy', (req, res) => res.render('privacy'));

/* ======================================================
   TAAL WISSELEN
   ====================================================== */
router.get('/lang/:code', (req, res) => {
  res.cookie('lang', req.params.code, { maxAge: 365 * 24 * 3600 * 1000, httpOnly: false });
  res.redirect(req.headers.referer || '/');
});

/* ======================================================
   REGISTREREN
   ====================================================== */
router.get('/register', (req, res) => {
  if (req.userId) return res.redirect('/dashboard');
  res.render('register', { error: null });
});

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.render('register', { error: 'Vul alle velden in' });
  if (password.length < 8) return res.render('register', { error: res.locals.t('register_weak') });
  if (db.getUser.get(email)) return res.render('register', { error: res.locals.t('register_exists') });
  const hash = await bcrypt.hash(password, 10);
  const id = db.newId();
  db.createUser.run(id, email.toLowerCase().trim(), hash, name.trim(), res.locals.lang);
  const token = sign({ sub: id });
  res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000 });
  res.redirect('/dashboard');
});

/* ======================================================
   INLOGGEN
   ====================================================== */
router.get('/login', (req, res) => {
  if (req.userId) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.getUser.get((email || '').toLowerCase().trim());
  if (!user || !(await bcrypt.compare(password || '', user.password))) {
    return res.render('login', { error: res.locals.t('login_wrong') });
  }
  const token = sign({ sub: user.id });
  res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000 });
  res.redirect('/dashboard');
});

/* ======================================================
   UITLOGGEN
   ====================================================== */
router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
});

/* ======================================================
   DASHBOARD
   ====================================================== */
router.get('/dashboard', requireAuth, (req, res) => {
  const user = db.getUserById.get(req.userId);
  if (!user) return res.redirect('/login');
  let sub = db.getActiveSub.get(req.userId) || null;
  // Controleer verloopdatum
  if (sub && sub.expires_at && sub.expires_at < Math.floor(Date.now() / 1000)) {
    db.db.prepare("UPDATE subscriptions SET status='expired' WHERE id=?").run(sub.id);
    sub = null;
  }
  const t = res.locals.t;
  const planName = sub ? t('plan_' + sub.plan + '_name') : '';
  const locale = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', tr: 'tr-TR', ar: 'ar' }[res.locals.lang] || 'en-GB';
  res.render('dashboard', {
    user,
    sub,
    userName: user.name,
    hasSub: !!sub,
    canManage: !!(sub && sub.stripe_sub_id),
    noSub: !sub,
    licenseKey: sub ? sub.license_key : '',
    subPlanLabel: planName,
    subPlanFull: sub ? 'AM IPTV — ' + planName : '',
    subExpires: sub
      ? (sub.expires_at ? new Date(sub.expires_at * 1000).toLocaleDateString(locale) : '∞')
      : ''
  });
});

/* ======================================================
   CHECKOUT (Stripe)
   ====================================================== */
router.post('/checkout', requireAuthApi, async (req, res) => {
  const { plan } = req.body;
  if (!PRICES[plan]) return res.status(400).json({ error: 'Ongeldig plan' });
  const user = db.getUserById.get(req.userId);
  if (!user) return res.status(401).json({ error: 'Niet ingelogd' });

  try {
    const isRecurring = plan !== 'unlimited';
    const session = await stripe.checkout.sessions.create({
      mode: isRecurring ? 'subscription' : 'payment',
      customer_email: user.email,
      line_items: [{ price: PRICES[plan], quantity: 1 }],
      metadata: { user_id: user.id, plan },
      success_url: BASE_URL + '/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: BASE_URL + '/dashboard',
      allow_promotion_codes: true,
      billing_address_collection: 'auto'
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Betaling aanmaken mislukt: ' + err.message });
  }
});

/* Stripe Customer Portal — opzeggen, betaalmethode wijzigen, facturen */
router.post('/billing/portal', requireAuthApi, async (req, res) => {
  try {
    const sub = db.getActiveSub.get(req.userId);
    if (!sub || !sub.stripe_sub_id) {
      return res.status(400).json({ error: res.locals.t('dashboard_manage_none') });
    }
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_sub_id);
    const portal = await stripe.billingPortal.sessions.create({
      customer: stripeSub.customer,
      return_url: BASE_URL + '/dashboard'
    });
    res.json({ url: portal.url });
  } catch (err) {
    console.error('Stripe portal error:', err.message);
    res.status(500).json({ error: 'Portal openen mislukt' });
  }
});

router.get('/checkout/success', requireAuth, async (req, res) => {
  // Stripe webhook verwerkt de betaling; hier tonen we een bevestiging
  res.render('success');
});

/* ======================================================
   STRIPE WEBHOOK
   ====================================================== */
router.post('/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK);
  } catch (err) {
    console.error('Webhook fout:', err.message);
    return res.status(400).send('Webhook fout: ' + err.message);
  }

  // Idempotentie
  if (db.eventSeen.get(event.id)) return res.json({ ok: true });
  db.markEvent.run(event.id);

  const handlePaid = (meta, stripeSubId) => {
    if (!meta || !meta.user_id || !meta.plan) return;
    const licenseKey = db.newLicense();
    db.createSub.run(
      db.newId(), meta.user_id, meta.plan, licenseKey,
      stripeSubId || null, db.expiresAt(meta.plan)
    );
    console.log('Nieuw abonnement aangemaakt voor user', meta.user_id, 'plan', meta.plan);
  };

  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object;
      if (s.payment_status === 'paid') handlePaid(s.metadata, s.subscription);
      break;
    }
    case 'invoice.paid': {
      // Verlenging bij recurring abonnement
      const inv = event.data.object;
      // Nieuwe Stripe API-versies: subscription staat onder parent.subscription_details
      const sub = inv.subscription
        || (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription);
      if (sub) {
        const existing = db.db.prepare(
          "SELECT * FROM subscriptions WHERE stripe_sub_id=? AND status='active'"
        ).get(sub);
        if (existing) {
          // Automatische verlenging: vervaldatum doorschuiven naar einde nieuwe periode (+3 dagen marge)
          const line = inv.lines && inv.lines.data && inv.lines.data[0];
          const periodEnd = line && line.period && line.period.end;
          const newExpiry = periodEnd ? periodEnd + 3 * 86400 : db.expiresAt(existing.plan);
          if (newExpiry && (!existing.expires_at || newExpiry > existing.expires_at)) {
            db.db.prepare('UPDATE subscriptions SET expires_at=? WHERE id=?').run(newExpiry, existing.id);
            console.log('Abonnement verlengd', existing.id, 'tot', new Date(newExpiry * 1000).toISOString());
          }
        } else if (inv.metadata) {
          handlePaid(inv.metadata, sub);
        }
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      db.updateSubStatus.run('cancelled', sub.id);
      break;
    }
  }

  res.json({ ok: true });
});

/* ======================================================
   LICENTIE API — voor de TVPlayer-app zelf
   GET /api/license/:key → { valid, plan, expires_at }
   ====================================================== */
router.get('/api/license/:key', (req, res) => {
  // TV-app draait niet op dit domein: publieke, alleen-lezen controle toestaan
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'no-store');
  const key = String(req.params.key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Vaste testcodes voor Samsung-keuring (Railway-variabele REVIEW_LICENSES, komma-gescheiden)
  const review = String(process.env.REVIEW_LICENSES || '').toUpperCase().split(',')
    .map(k => k.replace(/[^A-Z0-9]/g, '')).filter(k => k.length >= 8);
  if (review.includes(key)) return res.json({ valid: true, plan: 'unlimited', expires_at: null });
  const sub = db.getSubByLicense.get(key);
  if (!sub) return res.json({ valid: false });
  // Controleer verloopdatum
  if (sub.expires_at && sub.expires_at < Math.floor(Date.now() / 1000)) {
    db.db.prepare("UPDATE subscriptions SET status='expired' WHERE id=?").run(sub.id);
    return res.json({ valid: false, reason: 'expired' });
  }
  res.json({
    valid: true,
    plan: sub.plan,
    expires_at: sub.expires_at
  });
});

/* ======================================================
   QR PAIRING — TV-app koppelen via telefoon
   ====================================================== */

const crypto = require('crypto');
const TRIAL_DAYS = 3;

// TV-app draait niet op dit domein: CORS voor de TV-routes
function tvCors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}
router.use(['/api/pair', '/api/trial'], tvCors);

/* Proefperiode: 3 dagen per TV, start bij eerste aanroep */
router.get('/api/trial/:device', (req, res) => {
  const device = String(req.params.device || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 128);
  if (device.length < 8) return res.status(400).json({ error: 'device' });
  db.startTrial.run(device);
  const t = db.getTrial.get(device);
  const expires = t.started_at + TRIAL_DAYS * 86400;
  const now = Math.floor(Date.now() / 1000);
  res.json({ active: now < expires, started_at: t.started_at, expires_at: expires, now });
});

// TV vraagt een koppelcode aan; krijgt ook een geheime sleutel om het resultaat op te halen
router.post('/api/pair', (req, res) => {
  db.cleanPairs.run();
  const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // zonder verwarrende tekens
  let code = '';
  for (const b of crypto.randomBytes(6)) code += ABC[b % ABC.length];
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minuten geldig
  db.createPair.run(code, expiresAt, token);
  res.json({ code, token, url: `${BASE_URL}/pair/${code}`, expires_at: expiresAt });
});

// TV pollt dit elke 2 seconden (met geheime sleutel); gegevens worden na ophalen gewist
router.get('/api/pair/:code/result', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const session = db.getPair.get(code);
  if (!session || !session.token || session.token !== String(req.query.token || '')) {
    return res.status(404).json({ status: 'unknown' });
  }
  if (session.expires_at < Math.floor(Date.now() / 1000)) {
    db.deletePair.run(code);
    return res.json({ status: 'expired' });
  }
  if (!session.used) return res.json({ status: 'pending' });
  db.deletePair.run(code);
  res.json({
    status: 'done',
    type: session.type,
    m3u_url: session.m3u_url,
    xtream_host: session.xtream_host,
    xtream_user: session.xtream_user,
    xtream_pass: session.xtream_pass
  });
});

// Telefoon stuurt dit in (via pair.html formulier)
router.post('/api/pair/:code/submit', (req, res) => {
  const code = req.params.code.toUpperCase();
  const { type, m3u_url, xtream_host, xtream_user, xtream_pass } = req.body;
  if (!type || !['m3u', 'xtream'].includes(type)) {
    return res.status(400).json({ error: 'Ongeldig type' });
  }
  if (type === 'm3u' && !m3u_url) {
    return res.status(400).json({ error: 'M3U URL vereist' });
  }
  if (type === 'xtream' && (!xtream_host || !xtream_user || !xtream_pass)) {
    return res.status(400).json({ error: 'Alle Xtream-velden vereist' });
  }
  const changes = db.submitPair.run(
    type,
    m3u_url || null,
    xtream_host || null,
    xtream_user || null,
    xtream_pass || null,
    code
  );
  if (changes.changes === 0) {
    return res.status(410).json({ error: 'Code verlopen of al gebruikt' });
  }
  res.json({ ok: true });
});

// Mobiele pagina — GET /pair/:code
router.get('/pair/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const session = db.getPair.get(code);
  if (!session || session.expires_at < Math.floor(Date.now() / 1000)) {
    return res.send(`<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>❌ Code verlopen</h2>
      <p>Ga terug naar je TV en scan de nieuwe QR-code.</p>
    </body></html>`);
  }
  res.render('pair', { code });
});

module.exports = router;
