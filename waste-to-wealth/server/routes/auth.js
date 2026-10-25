const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../lib/auth');
const { activeStreak } = require('../lib/points');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const clean = (s, max = 80) => String(s || '').trim().slice(0, max);

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    group_name: u.group_name,
    locality: u.locality,
    streak: activeStreak(u),
  };
}

router.post('/register', (req, res) => {
  const name = clean(req.body.name);
  const identifier = clean(req.body.identifier, 120).toLowerCase();
  const password = String(req.body.password || '');
  const role = req.body.role === 'recycler' ? 'recycler' : 'citizen';
  const locality = clean(req.body.locality);
  const group = clean(req.body.group_name);

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  const isEmail = EMAIL_RE.test(identifier);
  const isPhone = PHONE_RE.test(identifier);
  if (!isEmail && !isPhone)
    return res.status(400).json({ error: 'Enter a valid email or a 10-digit mobile number.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!locality) return res.status(400).json({ error: 'Please enter your locality or area.' });

  const exists = db
    .prepare('SELECT id FROM users WHERE email = ? OR phone = ?')
    .get(isEmail ? identifier : null, isPhone ? identifier : null);
  if (exists) return res.status(409).json({ error: 'An account with this email or phone already exists.' });

  const hash = bcrypt.hashSync(password, 10);
  const create = db.transaction(() => {
    const id = db
      .prepare(
        'INSERT INTO users (name, email, phone, password_hash, role, group_name, locality) VALUES (?,?,?,?,?,?,?)'
      )
      .run(name, isEmail ? identifier : null, isPhone ? identifier : null, hash, role, group, locality)
      .lastInsertRowid;
    if (role === 'recycler') {
      const business = clean(req.body.business_name) || `${name} Recyclers`;
      const areas = clean(req.body.service_areas, 200) || locality;
      db.prepare('INSERT INTO recyclers (user_id, business_name, service_areas, verified) VALUES (?,?,?,0)').run(
        id,
        business,
        areas
      );
    }
    return id;
  });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(create());
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const identifier = clean(req.body.identifier, 120).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ? OR phone = ?').get(identifier, identifier);
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash))
    return res.status(401).json({ error: 'Wrong email/phone or password.' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Account not found.' });
  const out = publicUser(user);
  if (user.role === 'recycler') {
    out.recycler = db.prepare('SELECT id, business_name, service_areas, verified, rating FROM recyclers WHERE user_id = ?').get(user.id);
  }
  res.json({ user: out });
});

module.exports = router;
