const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireRole } = require('../lib/auth');
const { activeStreak, pointsToRupees } = require('../lib/points');

router.use(requireAuth);

const balanceOf = (userId) =>
  db.prepare('SELECT COALESCE(SUM(points),0) b FROM points_ledger WHERE user_id = ?').get(userId).b;

// Names are shortened on the public leaderboard ("Anita S.") for privacy.
const shortName = (n) => {
  const parts = String(n).split(' ');
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
};

router.get('/leaderboard', (req, res) => {
  // Rank by points EARNED so spending points on rewards never drops your rank.
  const users = db
    .prepare(
      `SELECT u.id, u.name, u.group_name, COALESCE(SUM(CASE WHEN l.points > 0 THEN l.points END),0) AS points
       FROM users u LEFT JOIN points_ledger l ON l.user_id = u.id
       WHERE u.role = 'citizen' GROUP BY u.id ORDER BY points DESC, u.id ASC`
    )
    .all();
  const groups = db
    .prepare(
      `SELECT u.group_name AS name, COUNT(DISTINCT u.id) AS members,
              COALESCE(SUM(CASE WHEN l.points > 0 THEN l.points END),0) AS points
       FROM users u LEFT JOIN points_ledger l ON l.user_id = u.id
       WHERE u.role = 'citizen' AND u.group_name != '' GROUP BY u.group_name ORDER BY points DESC`
    )
    .all();
  const myIndex = users.findIndex((u) => u.id === req.user.id);
  res.json({
    users: users.slice(0, 20).map((u, i) => ({ rank: i + 1, name: shortName(u.name), group: u.group_name, points: u.points, me: u.id === req.user.id })),
    groups: groups.slice(0, 10).map((g, i) => ({ rank: i + 1, ...g })),
    my_rank: myIndex >= 0 ? myIndex + 1 : null,
  });
});

router.get('/impact/me', requireRole('citizen'), (req, res) => {
  const t = db
    .prepare(
      `SELECT COALESCE(SUM(i.actual_weight_kg),0) kg,
              COALESCE(SUM(i.actual_weight_kg * i.rate_applied),0) rupees,
              COALESCE(SUM(i.actual_weight_kg * c.co2_factor),0) co2,
              COUNT(DISTINCT p.id) pickups
       FROM pickups p JOIN pickup_items i ON i.pickup_id = p.id JOIN categories c ON c.id = i.category_id
       WHERE p.user_id = ? AND p.status = 'completed'`
    )
    .get(req.user.id);
  const byCategory = db
    .prepare(
      `SELECT c.name, c.icon, SUM(i.actual_weight_kg) kg FROM pickups p
       JOIN pickup_items i ON i.pickup_id = p.id JOIN categories c ON c.id = i.category_id
       WHERE p.user_id = ? AND p.status = 'completed' GROUP BY c.id ORDER BY kg DESC`
    )
    .all(req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const points = balanceOf(req.user.id);
  const ledger = db
    .prepare('SELECT points, reason, created_at FROM points_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 10')
    .all(req.user.id);
  res.json({
    kg: Math.round(t.kg * 100) / 100,
    rupees: Math.round(t.rupees * 100) / 100,
    co2_kg: Math.round(t.co2 * 10) / 10, // estimate only
    pickups: t.pickups,
    points,
    points_value_rs: pointsToRupees(points),
    streak: activeStreak(user),
    by_category: byCategory,
    ledger,
  });
});

router.get('/rewards', requireRole('citizen'), (req, res) => {
  const rewards = db.prepare('SELECT id, partner_name, description, points_cost FROM rewards WHERE active = 1 ORDER BY points_cost').all();
  const mine = db
    .prepare(
      `SELECT r.partner_name, r.description, x.code, x.created_at FROM redemptions x
       JOIN rewards r ON r.id = x.reward_id WHERE x.user_id = ? ORDER BY x.id DESC LIMIT 10`
    )
    .all(req.user.id);
  res.json({ rewards, balance: balanceOf(req.user.id), redeemed: mine });
});

router.post('/rewards/:id/redeem', requireRole('citizen'), (req, res) => {
  const reward = db.prepare('SELECT * FROM rewards WHERE id = ? AND active = 1').get(req.params.id);
  if (!reward) return res.status(404).json({ error: 'Reward not found.' });
  let code;
  try {
    db.transaction(() => {
      if (balanceOf(req.user.id) < reward.points_cost) throw new Error('Not enough Green Points yet.');
      code = 'WTW-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      db.prepare('INSERT INTO points_ledger (user_id, points, reason) VALUES (?,?,?)').run(
        req.user.id,
        -reward.points_cost,
        `Redeemed: ${reward.partner_name}`
      );
      db.prepare('INSERT INTO redemptions (user_id, reward_id, code) VALUES (?,?,?)').run(req.user.id, reward.id, code);
    })();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ code, balance: balanceOf(req.user.id), reward: { partner_name: reward.partner_name, description: reward.description } });
});

module.exports = router;
