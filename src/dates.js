'use strict';

// Calendar dates travel through the app as "YYYY-MM-DD" strings. These helpers do the
// arithmetic in UTC so daylight-saving changes can never move a date by a day.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/** Today's date in the server's local time zone, as YYYY-MM-DD. */
function localToday(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Day of week for an ISO date: 0 = Sunday ... 6 = Saturday. */
function weekday(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

module.exports = { isRealDate, toIsoDate, addDays, localToday, weekday };
