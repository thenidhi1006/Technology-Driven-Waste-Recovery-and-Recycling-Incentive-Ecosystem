require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

require('./db'); // creates tables and seeds demo data on first run

const app = express();
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // jsdelivr + 'unsafe-eval' are only needed for the optional Teachable Machine photo model.
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net', "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'https://teachablemachine.withgoogle.com', 'https://storage.googleapis.com', 'https://tfhub.dev', 'https://www.kaggle.com'],
        upgradeInsecureRequests: null,
      },
    },
  })
);
app.use(express.json({ limit: '100kb' }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/pickups', require('./routes/pickups'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/catalog'));
app.use('/api', require('./routes/community'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Waste to Wealth running at http://localhost:${port}`));
}

module.exports = app;
