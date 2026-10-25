const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

const db = new Database(process.env.DB_FILE || path.join(dataDir, 'wtw.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('citizen','recycler','admin')),
  group_name TEXT DEFAULT '',
  locality TEXT DEFAULT '',
  streak_weeks INTEGER NOT NULL DEFAULT 0,
  last_week INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  icon TEXT DEFAULT '♻️',
  co2_factor REAL NOT NULL DEFAULT 0,
  quoted INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  rate_per_kg REAL NOT NULL,
  locality TEXT NOT NULL DEFAULT 'all',
  effective_from TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS recyclers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  business_name TEXT NOT NULL,
  service_areas TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 4.0
);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  image_path TEXT,
  predicted_category TEXT,
  confidence REAL,
  final_category_id INTEGER REFERENCES categories(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pickups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  recycler_id INTEGER REFERENCES recyclers(id),
  address TEXT NOT NULL,
  locality TEXT NOT NULL,
  slot_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  declined_ids TEXT NOT NULL DEFAULT '',
  total_amount REAL NOT NULL DEFAULT 0,
  dispute_reason TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS pickup_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pickup_id INTEGER NOT NULL REFERENCES pickups(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  est_weight_kg REAL NOT NULL,
  actual_weight_kg REAL,
  rate_applied REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  pickup_id INTEGER REFERENCES pickups(id),
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_name TEXT NOT NULL,
  description TEXT NOT NULL,
  points_cost INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reward_id INTEGER NOT NULL REFERENCES rewards(id),
  code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pickups_user ON pickups(user_id);
CREATE INDEX IF NOT EXISTS idx_pickups_recycler ON pickups(recycler_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON points_ledger(user_id);
`);

function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM categories').get().c > 0) return;

  // Sample prototype rates (Rs/kg) from the Functional Requirements. CO2 factors are rough estimates.
  const cats = [
    ['Newspaper & Paper', '📰', 0.9, 0, 12],
    ['Cardboard', '📦', 0.9, 0, 8],
    ['Plastic Bottles', '🧴', 1.5, 0, 10],
    ['Hard Plastic', '🪣', 1.5, 0, 15],
    ['Iron & Steel', '🔩', 1.5, 0, 30],
    ['Aluminium', '🥫', 9.0, 0, 90],
    ['Copper & Brass', '🔌', 3.0, 0, 400],
    ['E-waste', '💻', 2.0, 1, 0],
  ];
  const insCat = db.prepare('INSERT INTO categories (name, icon, co2_factor, quoted) VALUES (?,?,?,?)');
  const insRate = db.prepare('INSERT INTO rates (category_id, rate_per_kg) VALUES (?,?)');
  const insUser = db.prepare(
    'INSERT INTO users (name, email, phone, password_hash, role, group_name, locality) VALUES (?,?,?,?,?,?,?)'
  );
  const insRec = db.prepare(
    'INSERT INTO recyclers (user_id, business_name, service_areas, verified, rating) VALUES (?,?,?,?,?)'
  );
  const insReward = db.prepare('INSERT INTO rewards (partner_name, description, points_cost) VALUES (?,?,?)');
  const insLedger = db.prepare('INSERT INTO points_ledger (user_id, points, reason) VALUES (?,?,?)');

  db.transaction(() => {
    for (const [name, icon, co2, quoted, rate] of cats) {
      const id = insCat.run(name, icon, co2, quoted).lastInsertRowid;
      insRate.run(id, rate);
    }
    const h = (p) => bcrypt.hashSync(p, 10);
    insUser.run('Platform Admin', 'admin@wtw.in', null, h('Admin@123'), 'admin', '', '');

    const r1 = insUser.run('Ravi Kumar', 'ravi@wtw.in', '9000000001', h('Recycler@123'), 'recycler', '', 'Kukatpally').lastInsertRowid;
    insRec.run(r1, 'Ravi Scrap Traders', 'Kukatpally,Miyapur,Campus', 1, 4.6);
    const r2 = insUser.run('Lakshmi Devi', 'lakshmi@wtw.in', '9000000002', h('Recycler@123'), 'recycler', '', 'Madhapur').lastInsertRowid;
    insRec.run(r2, 'Lakshmi Recyclers', 'Madhapur,Gachibowli,Hitech City', 1, 4.4);

    const demo = insUser.run('Demo Citizen', 'demo@wtw.in', '9000000010', h('Demo@123'), 'citizen', 'Green Colony', 'Kukatpally').lastInsertRowid;
    const others = [
      ['Anita Sharma', 'anita@wtw.in', 'Green Colony', 'Kukatpally', 340],
      ['Karthik Reddy', 'karthik@wtw.in', 'Sunrise Hostel', 'Miyapur', 280],
      ['Meera Nair', 'meera@wtw.in', 'Sunrise Hostel', 'Miyapur', 190],
      ['Imran Khan', 'imran@wtw.in', 'Lake View Apartments', 'Madhapur', 120],
    ];
    for (const [n, e, g, l, pts] of others) {
      const id = insUser.run(n, e, null, h('Demo@123'), 'citizen', g, l).lastInsertRowid;
      insLedger.run(id, pts, 'Welcome sample points');
    }
    insLedger.run(demo, 60, 'Welcome sample points');

    insReward.run('Local Kirana Store', 'Rs 10 off on groceries', 100);
    insReward.run('Campus Canteen', 'Free tea or coffee', 60);
    insReward.run('Plant Nursery', 'Rs 50 off on a sapling or plant pot', 500);
  })();
}
seed();

module.exports = db;
