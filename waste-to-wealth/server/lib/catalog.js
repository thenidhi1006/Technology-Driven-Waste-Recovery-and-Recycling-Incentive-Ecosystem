const db = require('../db');

// Current (latest) indicative rate for every active category.
function currentRates() {
  return db
    .prepare(
      `SELECT c.id, c.name, c.icon, c.co2_factor, c.quoted,
        COALESCE((SELECT r.rate_per_kg FROM rates r WHERE r.category_id = c.id
                  ORDER BY r.effective_from DESC, r.id DESC LIMIT 1), 0) AS rate_per_kg,
        (SELECT r.effective_from FROM rates r WHERE r.category_id = c.id
                  ORDER BY r.effective_from DESC, r.id DESC LIMIT 1) AS updated_at
       FROM categories c WHERE c.active = 1 ORDER BY c.id`
    )
    .all();
}

function localities() {
  const set = new Set();
  for (const r of db.prepare('SELECT service_areas FROM recyclers WHERE verified = 1').all()) {
    r.service_areas.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => set.add(s));
  }
  return [...set].sort();
}

module.exports = { currentRates, localities };
