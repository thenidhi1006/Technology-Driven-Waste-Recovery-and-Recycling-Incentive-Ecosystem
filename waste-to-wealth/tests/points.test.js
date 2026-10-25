const test = require('node:test');
const assert = require('node:assert');
const { weekIndex, updateStreak, activeStreak, computePoints, pointsToRupees } = require('../server/lib/points');

const day = (s) => new Date(s + 'T12:00:00Z');

test('weeks start on Monday', () => {
  // Sun 2026-10-25 and Mon 2026-10-26 are in different weeks
  assert.strictEqual(weekIndex(day('2026-10-26')) - weekIndex(day('2026-10-25')), 1);
  assert.strictEqual(weekIndex(day('2026-10-19')), weekIndex(day('2026-10-25')));
});

test('first pickup starts a streak of 1 with no bonus', () => {
  const s = updateStreak({ streak_weeks: 0, last_week: null }, day('2026-10-20'));
  assert.deepStrictEqual([s.streak, s.advanced], [1, true]);
  assert.strictEqual(computePoints(3, s).total, 30);
});

test('consecutive week continues streak and gives +20 bonus', () => {
  const last = weekIndex(day('2026-10-20'));
  const s = updateStreak({ streak_weeks: 1, last_week: last }, day('2026-10-27'));
  assert.strictEqual(s.streak, 2);
  assert.deepStrictEqual(computePoints(2, s), { base: 20, bonus: 20, total: 40 });
});

test('second pickup in the same week gives no extra streak bonus', () => {
  const last = weekIndex(day('2026-10-27'));
  const s = updateStreak({ streak_weeks: 2, last_week: last }, day('2026-10-29'));
  assert.strictEqual(s.advanced, false);
  assert.strictEqual(computePoints(1, s).bonus, 0);
});

test('missing a week resets the streak', () => {
  const last = weekIndex(day('2026-10-06'));
  assert.strictEqual(updateStreak({ streak_weeks: 5, last_week: last }, day('2026-10-27')).streak, 1);
  assert.strictEqual(activeStreak({ streak_weeks: 5, last_week: last }, day('2026-10-27')), 0);
});

test('100 points = Rs 10', () => {
  assert.strictEqual(pointsToRupees(250), 20);
});
