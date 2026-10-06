'use strict';

const ICAL = require('ical.js');
const { FileReadError } = require('./errors');
const { addDays } = require('../dates');

const MAX_EVENTS = 500;
const MAX_OCCURRENCES_PER_EVENT = 60;

function isValidTimeZone(zone) {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Calendar date and wall-clock time of an iCalendar time. UTC timestamps (what LMS feeds
 * such as Canvas export) are converted to the student's time zone so that a deadline at
 * 11:59 PM doesn't show up on the following day. Times with a TZID or no zone at all are
 * already wall-clock times and are kept as written.
 */
function wallClock(time, timeZone) {
  if (time.zone === ICAL.Timezone.utcTimezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(time.toJSDate());
    const get = (type) => parts.find((part) => part.type === type).value;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
  }
  return { date: `${time.year}-${pad(time.month)}-${pad(time.day)}`, time: `${pad(time.hour)}:${pad(time.minute)}` };
}

function text(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function toItem(event, start, end, timeZone) {
  const begins = wallClock(start, timeZone);
  let endDate = null;
  if (end) {
    // DTEND is exclusive for all-day events: an event on the 12th ends on the 13th.
    const last = start.isDate ? addDays(wallClock(end, timeZone).date, -1) : wallClock(end, timeZone).date;
    if (last > begins.date) endDate = last;
  }
  return {
    date: begins.date,
    time: start.isDate ? null : begins.time,
    endDate,
    summary: text(event.summary, 200) || '(untitled event)',
    description: text(event.description, 300),
    location: text(event.location, 120),
  };
}

/**
 * Parses an .ics file into its calendar name and a sorted list of dated items. Recurring
 * events are expanded (with EXDATE and RECURRENCE-ID overrides applied) up to a fixed
 * number of occurrences.
 */
function parseIcs(source, { timeZone } = {}) {
  let calendar;
  try {
    calendar = new ICAL.Component(ICAL.parse(source));
  } catch {
    throw new FileReadError("couldn't be parsed as an iCalendar (.ics) file.");
  }

  const calendarZone = calendar.getFirstPropertyValue('x-wr-timezone');
  const zone = [timeZone, calendarZone].find(isValidTimeZone) || 'UTC';

  const vevents = calendar.getAllSubcomponents('vevent');
  const overrides = vevents.filter((v) => v.hasProperty('recurrence-id'));
  const items = [];

  for (const vevent of vevents) {
    if (vevent.hasProperty('recurrence-id')) continue; // applied through its parent below
    const event = new ICAL.Event(vevent);

    if (!event.isRecurring()) {
      items.push(toItem(event, event.startDate, event.endDate, zone));
    } else {
      for (const override of overrides) {
        if (override.getFirstPropertyValue('uid') === event.uid) event.relateException(override);
      }
      const iterator = event.iterator();
      for (let n = 0, next = iterator.next(); next && n < MAX_OCCURRENCES_PER_EVENT; n += 1, next = iterator.next()) {
        const occurrence = event.getOccurrenceDetails(next);
        items.push(toItem(occurrence.item, occurrence.startDate, occurrence.endDate, zone));
        if (items.length >= MAX_EVENTS) break;
      }
    }
    if (items.length >= MAX_EVENTS) break;
  }

  items.sort((a, b) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`));
  return { name: text(calendar.getFirstPropertyValue('x-wr-calname'), 200) || null, items };
}

/** One line per event, e.g. "2026-10-05 23:59 | Essay 1 Draft | details | location". */
function formatEvents({ name, items }) {
  const lines = items.map((item) => {
    const when = `${item.date}${item.time ? ` ${item.time}` : ''}${item.endDate ? ` to ${item.endDate}` : ''}`;
    return [when, item.summary, item.description, item.location].filter(Boolean).join(' | ');
  });
  if (lines.length === 0) return '';
  return [name ? `Calendar: ${name}` : null, ...lines].filter(Boolean).join('\n');
}

module.exports = { parseIcs, formatEvents, isValidTimeZone };
