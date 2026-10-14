/* Meertaligheid — voeg talen toe in locales/ */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const cache = {};

function load(lang) {
  if (cache[lang]) return cache[lang];
  const file = path.join(LOCALES_DIR, lang + '.json');
  if (!fs.existsSync(file)) return load('en');
  try { cache[lang] = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { cache[lang] = {}; }
  return cache[lang];
}

function detect(req) {
  // 1. cookie
  if (req.cookies && req.cookies.lang) return req.cookies.lang;
  // 2. Accept-Language header
  const al = req.headers['accept-language'] || '';
  const lang = al.split(',')[0].split('-')[0].toLowerCase();
  const supported = fs.readdirSync(LOCALES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
  return supported.includes(lang) ? lang : 'en';
}

function middleware(req, res, next) {
  const lang = detect(req);
  const strings = load(lang);
  res.locals.lang = lang;
  res.locals.t = (key, vars) => {
    let s = strings[key] || key;
    if (vars) Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  };
  next();
}

module.exports = { middleware, load, detect };
