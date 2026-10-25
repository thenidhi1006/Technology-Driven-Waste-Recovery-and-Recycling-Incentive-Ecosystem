const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../lib/auth');
const { currentRates } = require('../lib/catalog');

router.use(requireAuth, requireRole('admin'));

router.get('/stats', (req, res) => {
  const one = (sql) => db.prepare(sql).get();
  res.json({
    citizens: one("SELECT COUNT(*) n FROM users WHERE role='citizen'").n,
    recyclers: one('SELECT COUNT(*) n FROM recyclers').n,
    pending_recyclers: one('SELECT COUNT(*) n FROM recyclers WHERE verified = 0').n,
    pickups: one('SELECT COUNT(*) n FROM pickups').n,
    open_problems: one("SELECT COUNT(*) n FROM pickups WHERE status IN ('disputed','unassigned')").n,
    kg: one("SELECT COALESCE(SUM(i.actual_weight_kg),0) n FROM pickup_items i JOIN pickups p ON p.id=i.pickup_id WHERE p.status='completed'").n,
    rupees: one("SELECT COALESCE(SUM(i.actual_weight_kg*i.rate_applied),0) n FROM pickup_items i JOIN pickups p ON p.id=i.pickup_id WHERE p.status='completed'").n,
    co2_kg: one("SELECT COALESCE(SUM(i.actual_weight_kg*c.co2_factor),0) n FROM pickup_items i JOIN pickups p ON p.id=i.pickup_id JOIN categories c ON c.id=i.category_id WHERE p.status='completed'").n,
  });
});

router.get('/rates', (req, res) => res.json({ categories: currentRates() }));

router.put('/rates/:categoryId', (req, res) => {
  const rate = Number(req.body.rate_per_kg);
  if (!(rate >= 0) || rate > 100000) return res.status(400).json({ error: 'Enter a valid rate.' });
  const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(req.params.categoryId);
  if (!cat) return res.status(404).json({ error: 'Category not found.' });
  // New row instead of overwrite -> keeps a full rate history.
  db.prepare('INSERT INTO rates (category_id, rate_per_kg) VALUES (?,?)').run(cat.id, rate);
  res.json({ categories: currentRates() });
});

router.post('/categories', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 50);
  const rate = Number(req.body.rate_per_kg);
  if (name.length < 2 || !(rate >= 0)) return res.status(400).json({ error: 'Enter a name and a valid rate.' });
  if (db.prepare('SELECT id FROM categories WHERE name = ?').get(name))
    return res.status(409).json({ error: 'That category already exists.' });
  db.transaction(() => {
    const id = db
      .prepare('INSERT INTO categories (name, icon, co2_factor) VALUES (?,?,?)')
      .run(name, String(req.body.icon || '♻️').slice(0, 4), Math.max(0, Number(req.body.co2_factor) || 0)).lastInsertRowid;
    db.prepare('INSERT INTO rates (category_id, rate_per_kg) VALUES (?,?)').run(id, rate);
  })();
  res.status(201).json({ categories: currentRates() });
});

router.get('/recyclers', (req, res) => {
  res.json({
    recyclers: db
      .prepare(
        `SELECT r.id, r.business_name, r.service_areas, r.verified, r.rating, u.name, u.phone, u.email
         FROM recyclers r JOIN users u ON u.id = r.user_id ORDER BY r.verified, r.id`
      )
      .all(),
  });
});

router.patch('/recyclers/:id/verify', (req, res) => {
  const verified = req.body.verified === false ? 0 : 1;
  const info = db.prepare('UPDATE recyclers SET verified = ? WHERE id = ?').run(verified, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Recycler not found.' });
  res.json({ ok: true });
});

module.exports = router;
