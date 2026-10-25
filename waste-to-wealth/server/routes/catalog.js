const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../lib/auth');
const { currentRates, localities } = require('../lib/catalog');

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'data', 'uploads'),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + '.jpg'),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only JPG, PNG or WebP photos are allowed.')),
});

router.get('/config', (req, res) => {
  res.json({ modelUrl: process.env.TM_MODEL_URL || '', localities: localities() });
});

router.get('/categories', (req, res) => res.json({ categories: currentRates(), indicative: true }));

// Estimated value = sum(weight x rate)
router.post('/estimate', (req, res) => {
  const rates = new Map(currentRates().map((c) => [c.id, c]));
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  let total = 0;
  let hasQuoted = false;
  const lines = [];
  for (const it of items) {
    const cat = rates.get(Number(it.category_id));
    const kg = Number(it.weight_kg);
    if (!cat || !(kg > 0) || kg > 1000) continue;
    const value = cat.quoted ? 0 : Math.round(kg * cat.rate_per_kg * 100) / 100;
    if (cat.quoted) hasQuoted = true;
    total += value;
    lines.push({ category_id: cat.id, name: cat.name, weight_kg: kg, rate_per_kg: cat.rate_per_kg, value, quoted: !!cat.quoted });
  }
  res.json({
    lines,
    total: Math.round(total * 100) / 100,
    points_preview: Math.round(10 * lines.reduce((s, l) => s + l.weight_kg, 0)),
    note: hasQuoted ? 'E-waste is priced by the recycler at pickup.' : undefined,
    disclaimer: 'Rates are indicative. Final payment depends on the weight confirmed at pickup.',
  });
});

// Photos are stored privately (never served publicly). The category suggestion
// comes from the browser-side model (optional); the user can always change it.
router.post('/scans', requireAuth, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const confidence = Math.max(0, Math.min(1, Number(req.body.confidence) || 0));
    const finalCat = Number(req.body.final_category_id) || null;
    const info = db
      .prepare('INSERT INTO scans (user_id, image_path, predicted_category, confidence, final_category_id) VALUES (?,?,?,?,?)')
      .run(req.user.id, req.file ? req.file.filename : null, String(req.body.predicted_category || '').slice(0, 60), confidence, finalCat);
    res.status(201).json({ scan_id: info.lastInsertRowid, needs_manual: confidence < 0.6 });
  });
});

module.exports = router;
