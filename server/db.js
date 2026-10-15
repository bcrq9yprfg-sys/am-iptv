/* SQLite database — geen externe database nodig */
const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tvplayer.db');

// Zorg dat de data-map bestaat
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    name        TEXT NOT NULL,
    lang        TEXT NOT NULL DEFAULT 'nl',
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id),
    plan          TEXT NOT NULL CHECK(plan IN ('6m','1y','unlimited')),
    status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','cancelled')),
    license_key   TEXT UNIQUE NOT NULL,
    stripe_sub_id TEXT,
    starts_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at    INTEGER,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS stripe_events (
    id          TEXT PRIMARY KEY,
    processed   INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS license_devices (
    license_key TEXT NOT NULL,
    device      TEXT NOT NULL,
    first_seen  INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen   INTEGER NOT NULL DEFAULT (unixepoch()),
    checks      INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (license_key, device)
  );

  CREATE TABLE IF NOT EXISTS watch_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL DEFAULT (unixepoch()),
    device      TEXT NOT NULL,
    license_key TEXT,
    kind        TEXT NOT NULL CHECK(kind IN ('live','movie','series')),
    title       TEXT NOT NULL,
    folder      TEXT,
    season      TEXT,
    episode     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_watch_ts ON watch_events(ts);
  CREATE INDEX IF NOT EXISTS idx_watch_lic ON watch_events(license_key);

  CREATE TABLE IF NOT EXISTS trials (
    device      TEXT PRIMARY KEY,
    started_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS pair_sessions (
    code        TEXT PRIMARY KEY,
    type        TEXT,
    m3u_url     TEXT,
    xtream_host TEXT,
    xtream_user TEXT,
    xtream_pass TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at  INTEGER NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0
  );
`);

// Migratie: geheime sleutel per koppelsessie (bestaande databases)
try { db.exec('ALTER TABLE pair_sessions ADD COLUMN token TEXT'); } catch (_) { /* bestaat al */ }

/* ---------- Proefperiode (per TV) ---------- */
const startTrial = db.prepare('INSERT OR IGNORE INTO trials (device) VALUES (?)');
const getTrial = db.prepare('SELECT * FROM trials WHERE device = ?');

/* ---------- Licentiegebruik per TV ---------- */
const seenLicense = db.prepare(
  `INSERT INTO license_devices (license_key, device) VALUES (?, ?)
   ON CONFLICT(license_key, device) DO UPDATE SET last_seen = unixepoch(), checks = checks + 1`
);

/* ---------- Kijkactiviteit (alleen met toestemming in de app) ---------- */
const addWatch = db.prepare(
  'INSERT INTO watch_events (device, license_key, kind, title, folder, season, episode) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const pruneWatch = db.prepare('DELETE FROM watch_events WHERE ts < unixepoch() - 365 * 86400');

/* ---------- Users ---------- */
const getUser = db.prepare('SELECT * FROM users WHERE email = ?');
const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const createUser = db.prepare(
  'INSERT INTO users (id, email, password, name, lang) VALUES (?, ?, ?, ?, ?)'
);

/* ---------- Subscriptions ---------- */
const getActiveSub = db.prepare(
  `SELECT * FROM subscriptions
   WHERE user_id = ? AND status = 'active'
   ORDER BY created_at DESC LIMIT 1`
);
const getSubByLicense = db.prepare(
  `SELECT s.*, u.email FROM subscriptions s
   JOIN users u ON u.id = s.user_id
   WHERE s.license_key = ? AND s.status = 'active'`
);
const createSub = db.prepare(
  `INSERT INTO subscriptions (id, user_id, plan, license_key, stripe_sub_id, expires_at)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const updateSubStatus = db.prepare(
  'UPDATE subscriptions SET status = ? WHERE stripe_sub_id = ?'
);
const eventSeen = db.prepare('SELECT 1 FROM stripe_events WHERE id = ?');
const markEvent = db.prepare('INSERT OR IGNORE INTO stripe_events (id) VALUES (?)');

function expiresAt(plan) {
  const now = Math.floor(Date.now() / 1000);
  if (plan === '6m')  return now + 60 * 60 * 24 * 183;
  if (plan === '1y')  return now + 60 * 60 * 24 * 366;
  return null; // unlimited = geen verloopdatum
}

/* ---------- Pair sessions ---------- */
const createPair = db.prepare(
  `INSERT INTO pair_sessions (code, expires_at, token) VALUES (?, ?, ?)`
);
const getPair = db.prepare('SELECT * FROM pair_sessions WHERE code = ?');
const deletePair = db.prepare('DELETE FROM pair_sessions WHERE code = ?');
const cleanPairs = db.prepare('DELETE FROM pair_sessions WHERE expires_at < unixepoch() - 3600');
const submitPair = db.prepare(
  `UPDATE pair_sessions SET type=?, m3u_url=?, xtream_host=?, xtream_user=?, xtream_pass=?, used=1
   WHERE code=? AND used=0 AND expires_at > unixepoch()`
);

module.exports = {
  db,
  getUser, getUserById, createUser,
  getActiveSub, getSubByLicense, createSub, updateSubStatus,
  eventSeen, markEvent, expiresAt,
  createPair, getPair, submitPair, deletePair, cleanPairs,
  startTrial, getTrial, seenLicense, addWatch, pruneWatch,
  newId: uuidv4,
  newLicense: () => uuidv4().replace(/-/g, '').toUpperCase().slice(0, 20)
};
