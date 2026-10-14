/* AM IPTV — Express server */
try { require('dotenv').config(); } catch (_) { /* dotenv optioneel; Railway levert env vars */ }
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { verify } = require('./auth');
const i18n = require('./i18n');

const app = express();
const PORT = process.env.PORT || 3000;

/* ======================================================
   TRUST PROXY (Railway, Render etc. zitten achter een proxy)
   ====================================================== */
app.set('trust proxy', 1);

/* ======================================================
   VIEW ENGINE (ingebouwde template-engine)
   ====================================================== */
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view engine', 'html');
app.engine('html', require('fs').readFileSync
  ? (filePath, options, callback) => {
      const fs = require('fs');
      let tmpl = fs.readFileSync(filePath, 'utf8');
      // Simpele {{ var }} en {{# if }} templates
      tmpl = render(tmpl, options);
      callback(null, tmpl);
    }
  : null
);

/* Simpele template-renderer */
function render(tmpl, data) {
  // {{# each items }}...{{/ each }}
  tmpl = tmpl.replace(/\{\{#\s*each\s+(\w+)\s*\}\}([\s\S]*?)\{\{\/\s*each\s*\}\}/g, (_, key, block) => {
    const arr = data[key];
    if (!Array.isArray(arr)) return '';
    return arr.map(item => render(block, { ...data, ...item, item })).join('');
  });
  // {{# if expr }}...{{/ if }}
  tmpl = tmpl.replace(/\{\{#\s*if\s+(!?)(\w+)\s*\}\}([\s\S]*?)\{\{\/\s*if\s*\}\}/g, (_, neg, key, block) => {
    const val = data[key];
    const show = neg ? !val : !!val;
    return show ? render(block, data) : '';
  });
  // {{ key | escape }} en {{ key }}
  tmpl = tmpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    const esc = expr.endsWith('| raw');
    const key = expr.replace('| raw', '').trim();
    const val = key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : ''), data);
    if (esc) return String(val);
    return String(val).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  });
  return tmpl;
}

/* Overschrijf de standaard render zodat we onze functies doorgeven */
app.use((req, res, next) => {
  const origRender = res.render.bind(res);
  res.render = (view, opts) => {
    opts = opts || {};
    opts.t = res.locals.t || (k => k);
    opts.lang = res.locals.lang || 'en';
    opts.render = render;
    origRender(view, opts, (err, html) => {
      if (err) return next(err);
      res.send(html);
    });
  };
  next();
});

/* ======================================================
   MIDDLEWARE
   ====================================================== */
// Stripe webhook vóór body-parser (heeft raw body nodig)
app.use('/webhook/stripe', express.raw({ type: 'application/json' }));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// i18n
app.use(i18n.middleware);

// JWT uit cookie → req.userId
app.use((req, res, next) => {
  const token = req.cookies && req.cookies.token;
  if (token) {
    const payload = verify(token);
    if (payload) req.userId = payload.sub;
  }
  next();
});

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Te veel pogingen, probeer later opnieuw' });
app.use(limiter);
app.use('/login', authLimiter);
app.use('/register', authLimiter);

/* ======================================================
   ROUTES
   ====================================================== */
app.use('/', require('./routes'));

/* ======================================================
   HEALTH CHECK (Railway)
   ====================================================== */
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'AM IPTV' }));

/* ======================================================
   START
   ====================================================== */
app.listen(PORT, () => console.log('AM IPTV draait op poort ' + PORT));
