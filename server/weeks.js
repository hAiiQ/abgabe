export const FIRST_WEEK = '2026-10-19';
export const TIME_ZONE = 'Europe/Berlin';

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function currentWeek(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type).value;
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function validWeek(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1 && value >= FIRST_WEEK && value <= (currentWeek(now) < FIRST_WEEK ? FIRST_WEEK : currentWeek(now));
}

export async function ensureWeeks(tx, now = new Date()) {
  const { weekly_goal: goal } = await tx.get('SELECT weekly_goal FROM settings WHERE id = 1');
  const latest = currentWeek(now) < FIRST_WEEK ? FIRST_WEEK : currentWeek(now);
  for (let week = FIRST_WEEK; week <= latest; week = addDays(week, 7)) {
    await tx.run('INSERT INTO weeks(id, goal) VALUES(?, ?) ON CONFLICT(id) DO NOTHING', [week, goal]);
  }
}
