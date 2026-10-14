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
`);

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

module.exports = {
  db,
  getUser, getUserById, createUser,
  getActiveSub, getSubByLicense, createSub, updateSubStatus,
  eventSeen, markEvent, expiresAt,
  newId: uuidv4,
  newLicense: () => uuidv4().replace(/-/g, '').toUpperCase().slice(0, 20)
};
