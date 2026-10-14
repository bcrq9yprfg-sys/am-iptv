/* JWT-authenticatie middleware */
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'change-me-in-production';

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' });
}

function verify(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.redirect('/login');
  const payload = verify(token);
  if (!payload) return res.redirect('/login');
  req.userId = payload.sub;
  next();
}

function requireAuthApi(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Niet ingelogd' });
  const payload = verify(token);
  if (!payload) return res.status(401).json({ error: 'Sessie verlopen' });
  req.userId = payload.sub;
  next();
}

module.exports = { sign, verify, requireAuth, requireAuthApi };
