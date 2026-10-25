// Points and streak rules (from the Functional Requirements, section 6):
//  - 10 Green Points per confirmed kg
//  - +20 bonus for each new week that continues a streak of 2+ weeks
//  - A week with no completed pickup resets the streak
const DAY_MS = 86400000;

// Weeks start on Monday. 1970-01-05 was a Monday (epoch day 4).
function weekIndex(date = new Date()) {
  const days = Math.floor(date.getTime() / DAY_MS);
  return Math.floor((days - 4) / 7);
}

function updateStreak(user, date = new Date()) {
  const cur = weekIndex(date);
  const streak = user.streak_weeks || 0;
  const last = user.last_week;
  if (last === cur) return { streak, lastWeek: cur, advanced: false };
  if (last === cur - 1) return { streak: streak + 1, lastWeek: cur, advanced: true };
  return { streak: 1, lastWeek: cur, advanced: true };
}

// Streak shown on screen: it is only alive if the last pickup was this week or last week.
function activeStreak(user, date = new Date()) {
  const cur = weekIndex(date);
  if (user.last_week === cur || user.last_week === cur - 1) return user.streak_weeks || 0;
  return 0;
}

function computePoints(kg, streakInfo) {
  const base = Math.round(10 * kg);
  const bonus = streakInfo.advanced && streakInfo.streak >= 2 ? 20 : 0;
  return { base, bonus, total: base + bonus };
}

// Future reward rule: 100 points = Rs 10 discount
const pointsToRupees = (points) => Math.floor(points / 100) * 10;

module.exports = { weekIndex, updateStreak, activeStreak, computePoints, pointsToRupees };
