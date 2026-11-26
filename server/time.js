/**
 * time.js - Asia/Manila timezone helpers so all due dates, overdue checks,
 * billing months, and reservation expiries use Philippine Standard Time (UTC+8).
 */

const TZ = 'Asia/Manila';

function manilaParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const map = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return map;
}

/** Returns YYYY-MM-DD in Asia/Manila. */
function manilaToday(date = new Date()) {
  const p = manilaParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Returns YYYY-MM in Asia/Manila. */
function manilaBillingMonth(date = new Date()) {
  return manilaToday(date).slice(0, 7);
}

/** Returns ISO timestamp with +08:00 offset for Asia/Manila. */
function manilaNowIso(date = new Date()) {
  const p = manilaParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

/** Adds N calendar days to a YYYY-MM-DD date string. */
function addDays(isoDate, days) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Adds N calendar months to a YYYY-MM-DD date string. */
function addMonths(isoDate, months) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

/** Returns signed day difference (endIso - startIso). */
function daysBetween(startIso, endIso) {
  const toUtc = (s) => {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(endIso) - toUtc(startIso)) / 86400000);
}

/** Computes start/end YYYY-MM-DD range in Asia/Manila for reports & dashboard. */
function getDateRange(q = {}) {
  const t = manilaToday();
  if (q.range === 'custom' && q.start && q.end) {
    return { start: String(q.start).slice(0, 10), end: String(q.end).slice(0, 10) };
  }
  if (q.range === 'today') return { start: t, end: t };
  if (q.range === 'week') return { start: addDays(t, -6), end: t };
  if (q.range === 'month') {
    const ym = t.slice(0, 7);
    return { start: `${ym}-01`, end: `${ym}-31` };
  }
  if (q.range === 'year') {
    const y = t.slice(0, 4);
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  return { start: '2000-01-01', end: '2099-12-31' };
}

module.exports = {
  TZ,
  manilaToday,
  manilaBillingMonth,
  manilaNowIso,
  addDays,
  addMonths,
  daysBetween,
  getDateRange,
};
