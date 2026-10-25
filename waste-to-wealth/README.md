# ♻ Waste to Wealth

**Scan it. Sell it. Streak it.**
A full-stack web app that shows households and campuses what their scrap is worth, books a pickup with a local recycler (kabadiwala), and rewards regular recycling with Green Points, weekly streaks and leaderboards.

Built by Team **She Codes** (Malla Reddy Engineering College for Women) for the theme *Sustainable Future: Building a Greener Tomorrow*.

---

## 1. Run it in VS Code (5 steps)

**You need:** [Node.js 22 or newer](https://nodejs.org) (LTS recommended) and VS Code.

```bash
# 1. open the project folder in VS Code  (File > Open Folder > waste-to-wealth)
# 2. open the terminal in VS Code        (Ctrl + `)
npm install          # 3. installs every library listed below
npm start            # 4. starts the server
# 5. open http://localhost:3000 in your browser
```

Useful commands

| Command | What it does |
|---|---|
| `npm start` | Run the app |
| `npm run dev` | Run with auto-restart when you save a file (nodemon) |
| `npm test` | Run the unit tests for the points and streak rules |
| `npm run seed` | Delete the local database; the next `npm start` re-creates fresh demo data |

> `better-sqlite3` ships ready-made binaries for supported Node versions, so no extra build tools are normally needed. Use Node 22 or newer; older Node versions are not supported by the current SQLite package.

### Demo accounts (created automatically)

| Role | Login | Password |
|---|---|---|
| Citizen | `demo@wtw.in` | `Demo@123` |
| Recycler | `ravi@wtw.in` (serves Kukatpally, Miyapur, Campus) | `Recycler@123` |
| Admin | `admin@wtw.in` | `Admin@123` |

The login screen also has one-tap "Try the demo" buttons.

### Try the full flow (2 minutes)
1. Log in as **Citizen** → enter weights (e.g. 5 kg newspaper) → see the rupee value and Green Points → **Book a pickup** (area: *Kukatpally*).
2. Log in as **Recycler** (use another browser or a private window) → **Accept** → enter the actual weights → **Send to customer**.
3. Back as **Citizen** → **Pickups** → **Approve amount** → points and streak are added. Check **My Impact**, **Leaderboard** and **Rewards**.
4. Log in as **Admin** → change a rate, verify a new recycler.

---

## 2. Libraries installed (and why)

All are installed by `npm install` from `package.json`. Nothing else is required.

| Library | Purpose |
|---|---|
| `express` | Web server and REST API |
| `better-sqlite3` | Database (SQLite, a single file, zero setup, fast) |
| `bcryptjs` | Hashes passwords (never stored in plain text) |
| `jsonwebtoken` | Login tokens (JWT, 7-day expiry) with role-based access |
| `multer` | Safe photo uploads (type and size checked, stored privately) |
| `helmet` | Security headers |
| `express-rate-limit` | Slows down password-guessing on login |
| `dotenv` | Reads settings from the `.env` file |
| `nodemon` *(dev)* | Auto-restart while developing |

Frontend: plain HTML, CSS and JavaScript served by Express. No build step and no framework to learn, so it is easy to read, explain and extend.

**Recommended VS Code extensions:** ESLint, Prettier, SQLite Viewer (to open `data/wtw.db`), REST Client.

---

## 3. Project structure

```
waste-to-wealth/
├─ server/
│  ├─ index.js            Express app, security, routes
│  ├─ db.js               SQLite schema + demo data
│  ├─ lib/
│  │  ├─ points.js        Points, streak and reward rules
│  │  ├─ auth.js          JWT + role guards
│  │  └─ catalog.js       Current rates, localities
│  └─ routes/
│     ├─ auth.js          register, login, me
│     ├─ catalog.js       categories, estimate, photo scans, config
│     ├─ pickups.js       booking, accept/decline, weigh, approve, dispute
│     ├─ community.js     leaderboard, impact, rewards
│     └─ admin.js         rates, categories, recycler verification, stats
├─ public/                index.html, css/styles.css, js/app.js, js/i18n.js
├─ tests/points.test.js
├─ data/                  created at run time (database + private photos)
└─ .env                   PORT, JWT_SECRET, optional TM_MODEL_URL
```

---

## 4. What makes it useful and different

Existing apps cover pickup, B2B trading or complaints, but not **value + pickup + rewards together for households** (see *Research and Analysis*). This project fills that gap, and goes further on trust and accessibility:

- **Item-wise rupee value before you book.** People learn what their scrap is actually worth.
- **Supports local recyclers instead of replacing them.** They get a simple, one-screen request list.
- **Trust built in.**
  - The rate is locked at booking, so it cannot change under you.
  - The recycler enters the weight and the citizen **approves or reports a problem**; disputes go back to the recycler to re-weigh.
  - The address and phone are hidden from the recycler until they accept.
  - Declined requests are automatically reassigned to the next best recycler in the area.
- **Habit loop.** Weekly streaks (+20 bonus from week 2), personal and group leaderboards, and redeemable rewards (100 points = ₹10). Ranking uses *points earned*, so redeeming never drops your rank.
- **Real impact numbers.** kg recycled, rupees earned and an estimated CO₂ saving.
- **Accessible to everyone.** English / हिन्दी / తెలుగు for navigation and key screens, large tap targets, high contrast, full keyboard use, screen-reader labels, skip link, works on low-end phones (no heavy framework).
- **Rate history.** Admin rate changes are appended, never overwritten.

---

## 5. Rules implemented (from the Functional Requirements)

- Estimated value = weight × rate; final amount = confirmed weight × rate.
- Green Points = 10 per confirmed kg; streak bonus = +20 for each new week continuing a 2+ week streak; a missed week resets the streak.
- E-waste is priced by the recycler at pickup.
- Rates are always labelled **indicative**; final payment depends on confirmed weight.
- Payment is cash or UPI directly between recycler and citizen, recorded in the app.
- Sample rates (₹/kg): Paper 12, Cardboard 8, Plastic bottles 10, Hard plastic 15, Iron & steel 30, Aluminium 90, Copper & brass 400.

---

## 6. API summary

| Method & path | Who | Purpose |
|---|---|---|
| `POST /api/auth/register`, `/login`, `GET /me` | all | Account and session |
| `GET /api/categories` | all | Categories with current rates |
| `POST /api/estimate` | all | Estimated value |
| `POST /api/scans` | citizen | Save a photo scan |
| `POST /api/pickups`, `GET /api/pickups` | citizen / recycler / admin | Book and list |
| `PATCH /api/pickups/:id/accept` | recycler | Accept or decline (`{accept:false}`) |
| `PATCH /api/pickups/:id/complete` | recycler | Submit actual weights |
| `PATCH /api/pickups/:id/approve`, `/dispute`, `/cancel` | citizen | Approve, report, cancel |
| `GET /api/leaderboard` | logged in | Ranked users and groups |
| `GET /api/impact/me` | citizen | kg, rupees, CO₂, points, streak |
| `GET /api/rewards`, `POST /api/rewards/:id/redeem` | citizen | Redeem points |
| `GET /api/admin/stats`, `PUT /api/admin/rates/:categoryId`, `POST /api/admin/categories`, `GET /api/admin/recyclers`, `PATCH /api/admin/recyclers/:id/verify` | admin | Management |

---

## 7. Optional: photo scan with Teachable Machine

The scan card works out of the box by letting the user pick the category. To turn on automatic suggestions:

1. Train an *Image Project* at [teachablemachine.withgoogle.com](https://teachablemachine.withgoogle.com) with classes such as `paper`, `cardboard`, `plastic bottle`, `hard plastic`, `metal`, `e-waste` (60–100 photos each).
2. Click **Export Model → Upload (shareable link)** and copy the link.
3. Put it in `.env`, with the trailing slash: `TM_MODEL_URL=https://teachablemachine.withgoogle.com/models/XXXX/`
4. Restart the server. If confidence is below 60%, the user is asked to choose manually (as per the technical requirements).

---

## 8. Before the final submission

- Replace `JWT_SECRET` in `.env` with a long random string.
- Re-check the CPCB figures and competitor details in the Research document, as that document itself asks.
- Add real survey numbers to the Research document after collecting responses.
- Scaling path (from the Technical Requirements): one colony → city (PostgreSQL, caching, background jobs, SMS/push) → multi-city with municipal dashboards.
