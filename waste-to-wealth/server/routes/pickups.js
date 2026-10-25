const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../lib/auth');
const { currentRates } = require('../lib/catalog');
const { updateStreak, computePoints } = require('../lib/points');

router.use(requireAuth);

const SLOTS = ['9 AM - 12 PM', '12 PM - 3 PM', '3 PM - 6 PM'];
const round2 = (n) => Math.round(n * 100) / 100;

function getRecyclerRow(userId) {
  return db.prepare('SELECT * FROM recyclers WHERE user_id = ?').get(userId);
}

function loadPickup(id) {
  const p = db
    .prepare(
      `SELECT p.*, u.name AS citizen_name, u.phone AS citizen_phone, r.business_name AS recycler_name
       FROM pickups p JOIN users u ON u.id = p.user_id
       LEFT JOIN recyclers r ON r.id = p.recycler_id WHERE p.id = ?`
    )
    .get(id);
  if (!p) return null;
  p.items = db
    .prepare(
      `SELECT i.*, c.name AS category_name, c.icon, c.quoted FROM pickup_items i
       JOIN categories c ON c.id = i.category_id WHERE i.pickup_id = ?`
    )
    .all(id);
  p.est_total = round2(p.items.reduce((s, i) => s + i.est_weight_kg * i.rate_applied, 0));
  return p;
}

// Privacy rule: address and phone are shared with the recycler only after they accept.
function viewFor(user, p) {
  const out = { ...p };
  delete out.declined_ids;
  if (user.role === 'recycler' && p.status === 'requested') {
    out.address = null;
    out.citizen_phone = null;
    out.citizen_name = (p.citizen_name || '').split(' ')[0];
  }
  if (user.role === 'citizen') delete out.citizen_phone;
  return out;
}

function assignRecycler(pickupId) {
  const p = db.prepare('SELECT * FROM pickups WHERE id = ?').get(pickupId);
  const declined = p.declined_ids.split(',').filter(Boolean).map(Number);
  const loc = p.locality.trim().toLowerCase();
  const candidates = db
    .prepare('SELECT * FROM recyclers WHERE verified = 1')
    .all()
    .filter(
      (r) =>
        !declined.includes(r.id) &&
        r.service_areas.split(',').map((s) => s.trim().toLowerCase()).includes(loc)
    )
    .sort((a, b) => b.rating - a.rating);
  if (candidates.length) {
    db.prepare("UPDATE pickups SET recycler_id = ?, status = 'requested' WHERE id = ?").run(candidates[0].id, pickupId);
  } else {
    db.prepare("UPDATE pickups SET recycler_id = NULL, status = 'unassigned' WHERE id = ?").run(pickupId);
  }
}

router.get('/', (req, res) => {
  let rows;
  if (req.user.role === 'citizen') {
    rows = db.prepare('SELECT id FROM pickups WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  } else if (req.user.role === 'recycler') {
    const rec = getRecyclerRow(req.user.id);
    rows = rec ? db.prepare('SELECT id FROM pickups WHERE recycler_id = ? ORDER BY id DESC').all(rec.id) : [];
  } else {
    rows = db.prepare('SELECT id FROM pickups ORDER BY id DESC LIMIT 200').all();
  }
  res.json({ pickups: rows.map((r) => viewFor(req.user, loadPickup(r.id))) });
});

router.post('/', requireRole('citizen'), (req, res) => {
  const address = String(req.body.address || '').trim().slice(0, 250);
  const locality = String(req.body.locality || '').trim().slice(0, 80);
  const slot_date = String(req.body.slot_date || '');
  const slot_time = String(req.body.slot_time || '');
  const items = Array.isArray(req.body.items) ? req.body.items : [];

  if (address.length < 6) return res.status(400).json({ error: 'Please enter your full address.' });
  if (!locality) return res.status(400).json({ error: 'Please choose your area.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slot_date)) return res.status(400).json({ error: 'Please choose a pickup date.' });
  const today = new Date().toISOString().slice(0, 10);
  if (slot_date < today) return res.status(400).json({ error: 'Pickup date cannot be in the past.' });
  if (!SLOTS.includes(slot_time)) return res.status(400).json({ error: 'Please choose a time slot.' });

  const rates = new Map(currentRates().map((c) => [c.id, c]));
  const valid = [];
  for (const it of items) {
    const cat = rates.get(Number(it.category_id));
    const kg = Number(it.weight_kg);
    if (cat && kg > 0 && kg <= 1000) valid.push({ cat, kg });
  }
  if (!valid.length) return res.status(400).json({ error: 'Add at least one item with its weight.' });

  const create = db.transaction(() => {
    const id = db
      .prepare('INSERT INTO pickups (user_id, address, locality, slot_date, slot_time) VALUES (?,?,?,?,?)')
      .run(req.user.id, address, locality, slot_date, slot_time).lastInsertRowid;
    const ins = db.prepare(
      'INSERT INTO pickup_items (pickup_id, category_id, est_weight_kg, rate_applied) VALUES (?,?,?,?)'
    );
    // The indicative rate is locked at booking time so the price does not change under the user.
    for (const v of valid) ins.run(id, v.cat.id, v.kg, v.cat.quoted ? 0 : v.cat.rate_per_kg);
    assignRecycler(id);
    return id;
  });
  res.status(201).json({ pickup: viewFor(req.user, loadPickup(create())), slots: SLOTS });
});

router.get('/slots', (req, res) => res.json({ slots: SLOTS }));

function ownPickupForRecycler(req, res) {
  const rec = getRecyclerRow(req.user.id);
  const p = db.prepare('SELECT * FROM pickups WHERE id = ?').get(req.params.id);
  if (!rec || !p || p.recycler_id !== rec.id) {
    res.status(404).json({ error: 'Pickup not found.' });
    return null;
  }
  return p;
}

router.patch('/:id/accept', requireRole('recycler'), (req, res) => {
  const p = ownPickupForRecycler(req, res);
  if (!p) return;
  if (p.status !== 'requested') return res.status(409).json({ error: 'This request was already handled.' });
  if (req.body.accept === false) {
    const next = [p.declined_ids, p.recycler_id].filter(Boolean).join(',');
    db.prepare('UPDATE pickups SET declined_ids = ? WHERE id = ?').run(next, p.id);
    assignRecycler(p.id); // declined requests are reassigned
  } else {
    db.prepare("UPDATE pickups SET status = 'accepted' WHERE id = ?").run(p.id);
  }
  res.json({ pickup: viewFor(req.user, loadPickup(p.id)) });
});

// Recycler enters actual weights after weighing at the address.
router.patch('/:id/complete', requireRole('recycler'), (req, res) => {
  const p = ownPickupForRecycler(req, res);
  if (!p) return;
  if (!['accepted', 'disputed'].includes(p.status))
    return res.status(409).json({ error: 'Accept the request before entering weights.' });

  const entries = Array.isArray(req.body.items) ? req.body.items : [];
  const items = db
    .prepare('SELECT i.*, c.quoted FROM pickup_items i JOIN categories c ON c.id = i.category_id WHERE i.pickup_id = ?')
    .all(p.id);
  const byId = new Map(entries.map((e) => [Number(e.item_id), e]));
  const upd = db.prepare('UPDATE pickup_items SET actual_weight_kg = ?, rate_applied = ? WHERE id = ?');
  let total = 0;
  const run = db.transaction(() => {
    for (const it of items) {
      const e = byId.get(it.id);
      const kg = e ? Number(e.actual_weight) : NaN;
      if (!(kg >= 0) || kg > 1000) throw new Error('Enter a valid weight for every item.');
      let rate = it.rate_applied;
      if (it.quoted) {
        rate = Number(e.rate_applied);
        if (!(rate >= 0) || rate > 100000) throw new Error('Enter the quoted price per kg for e-waste.');
      }
      upd.run(kg, rate, it.id);
      total += kg * rate;
    }
    db.prepare("UPDATE pickups SET status = 'awaiting_approval', total_amount = ?, dispute_reason = '' WHERE id = ?").run(
      round2(total),
      p.id
    );
  });
  try {
    run();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ pickup: viewFor(req.user, loadPickup(p.id)) });
});

function ownPickupForCitizen(req, res) {
  const p = db.prepare('SELECT * FROM pickups WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!p) res.status(404).json({ error: 'Pickup not found.' });
  return p;
}

// Citizen approves the final amount -> pickup completes, points + streak are awarded.
router.patch('/:id/approve', requireRole('citizen'), (req, res) => {
  const p = ownPickupForCitizen(req, res);
  if (!p) return;
  if (p.status !== 'awaiting_approval') return res.status(409).json({ error: 'Nothing to approve right now.' });

  let result;
  db.transaction(() => {
    const kg = db
      .prepare('SELECT COALESCE(SUM(actual_weight_kg),0) kg FROM pickup_items WHERE pickup_id = ?')
      .get(p.id).kg;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const streak = updateStreak(user);
    const pts = computePoints(kg, streak);
    db.prepare('UPDATE users SET streak_weeks = ?, last_week = ? WHERE id = ?').run(streak.streak, streak.lastWeek, user.id);
    db.prepare("UPDATE pickups SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(p.id);
    const led = db.prepare('INSERT INTO points_ledger (user_id, pickup_id, points, reason) VALUES (?,?,?,?)');
    if (pts.base) led.run(user.id, p.id, pts.base, `Recycled ${kg} kg`);
    if (pts.bonus) led.run(user.id, p.id, pts.bonus, `Streak bonus (${streak.streak} weeks)`);
    result = { kg, points: pts, streak: streak.streak };
  })();
  res.json({ pickup: viewFor(req.user, loadPickup(p.id)), award: result });
});

router.patch('/:id/dispute', requireRole('citizen'), (req, res) => {
  const p = ownPickupForCitizen(req, res);
  if (!p) return;
  if (p.status !== 'awaiting_approval') return res.status(409).json({ error: 'Nothing to report right now.' });
  const reason = String(req.body.reason || '').trim().slice(0, 300) || 'Weight does not look right';
  db.prepare("UPDATE pickups SET status = 'disputed', dispute_reason = ? WHERE id = ?").run(reason, p.id);
  res.json({ pickup: viewFor(req.user, loadPickup(p.id)) });
});

router.patch('/:id/cancel', requireRole('citizen'), (req, res) => {
  const p = ownPickupForCitizen(req, res);
  if (!p) return;
  if (!['requested', 'accepted', 'unassigned'].includes(p.status))
    return res.status(409).json({ error: 'This pickup can no longer be cancelled.' });
  db.prepare("UPDATE pickups SET status = 'cancelled' WHERE id = ?").run(p.id);
  res.json({ pickup: viewFor(req.user, loadPickup(p.id)) });
});

module.exports = router;
