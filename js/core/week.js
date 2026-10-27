// Semaines ISO 8601 (lundi → dimanche), identifiants « 2026-W44 ».

export const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
export const SLOTS = { midi: 'Midi', soir: 'Soir' };

function utcDate(y, m, d) { return new Date(Date.UTC(y, m, d)); }

export function isoWeekId(date = new Date()) {
  const d = utcDate(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getUTCDay() + 6) % 7; // 0 = lundi
  d.setUTCDate(d.getUTCDate() - day + 3); // jeudi de la semaine
  const year = d.getUTCFullYear();
  const jan4 = utcDate(year, 0, 4);
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function parseWeekId(id) {
  const m = /^(\d{4})-W(\d{2})$/.exec(id || '');
  if (!m) throw new Error(`Identifiant de semaine invalide : ${id}`);
  return { year: Number(m[1]), week: Number(m[2]) };
}

// Lundi (date locale à minuit) de la semaine.
export function weekStart(id) {
  const { year, week } = parseWeekId(id);
  const jan4 = utcDate(year, 0, 4);
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const mon = new Date(mondayW1);
  mon.setUTCDate(mondayW1.getUTCDate() + (week - 1) * 7);
  return new Date(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate());
}

export function addWeeks(id, n) {
  const d = weekStart(id);
  d.setDate(d.getDate() + 7 * n + 3);
  return isoWeekId(d);
}

export function compareWeeks(a, b) {
  return weekStart(a) - weekStart(b);
}

const dfmt = new Intl.DateTimeFormat('fr-BE', { day: 'numeric', month: 'short' });

export function weekLabel(id, today = new Date()) {
  const cur = isoWeekId(today);
  const s = weekStart(id);
  const e = new Date(s); e.setDate(s.getDate() + 6);
  const range = `${dfmt.format(s)} – ${dfmt.format(e)}`;
  const { week } = parseWeekId(id);
  let rel = '';
  if (id === cur) rel = 'Cette semaine';
  else if (id === addWeeks(cur, 1)) rel = 'Semaine prochaine';
  else if (id === addWeeks(cur, -1)) rel = 'Semaine dernière';
  else rel = `Semaine ${week}`;
  return { rel, range, week };
}

export function dayDate(id, dayIndex) {
  const s = weekStart(id);
  s.setDate(s.getDate() + dayIndex);
  return s;
}
