'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  EXTRACTION_JSON_SCHEMA,
  ScheduleInput,
  validateExtraction,
  normalizeTime,
  ASSIGNMENT_TYPES,
} = require('../src/extraction/schema');

const item = (overrides = {}) => ({ title: 'Problem Set 1', date: '2026-09-11', end_date: null, due_time: '23:59', type: 'due', ...overrides });

const response = (assignments, overrides = {}) => ({
  semester_name: 'Fall 2026',
  semester_start: '2026-08-31',
  semester_end: '2026-12-18',
  classes: [{ name: 'Introduction to Planetary Science', short_name: 'ASTR 1270', assignments }],
  ...overrides,
});

describe('validateExtraction', () => {
  it('accepts a well-formed response', () => {
    const { data, warnings } = validateExtraction(response([item(), item({ title: 'Midterm Exam', date: '2026-10-21', type: 'exam', due_time: '10:00' })]));
    assert.deepEqual(warnings, []);
    assert.equal(data.classes[0].assignments.length, 2);
    assert.deepEqual(data.classes[0].assignments[0], item());
  });

  it('normalises times and single-day end dates', () => {
    const { data } = validateExtraction(
      response([
        item({ due_time: '9:05' }),
        item({ title: 'Lab', due_time: '23:59:00', end_date: '2026-09-11' }),
        item({ title: 'Poster session', due_time: 'noon', end_date: '2026-09-13' }),
      ]),
    );
    const [a, b, c] = data.classes[0].assignments;
    assert.equal(a.due_time, '09:05');
    assert.equal(b.due_time, '23:59');
    assert.equal(b.end_date, null, 'an end date equal to the start is dropped');
    assert.equal(c.due_time, null, 'unparseable times become null instead of failing');
    assert.equal(c.end_date, '2026-09-13');
  });

  it('drops items with impossible dates or missing titles, and says so', () => {
    const { data, warnings } = validateExtraction(
      response([item(), item({ date: '2026-02-30' }), item({ date: '09/11/2026' }), item({ title: '   ' }), item({ type: 'party' })]),
    );
    assert.equal(data.classes[0].assignments.length, 1);
    assert.deepEqual(warnings, ['Skipped 4 items with a missing title or an invalid date.']);
  });

  it('derives term dates from the items when the model gives nonsense', () => {
    const { data } = validateExtraction(
      response([item({ date: '2026-09-11' }), item({ title: 'Final', date: '2026-12-15', type: 'exam' })], {
        semester_start: 'sometime in fall',
        semester_end: '2026-13-01',
      }),
    );
    assert.equal(data.semester_start, '2026-09-04');
    assert.equal(data.semester_end, '2026-12-22');
  });

  it('fills in a short name and drops empty classes', () => {
    const { data } = validateExtraction({
      ...response([]),
      classes: [
        { name: 'Writing Seminar: Cities and Memory', short_name: '', assignments: [item()] },
        { name: 'Empty Class', short_name: 'EMPTY', assignments: [] },
      ],
    });
    assert.equal(data.classes.length, 1);
    assert.equal(data.classes[0].short_name, 'Writing Seminar:');
  });

  it('rejects responses with the wrong shape', () => {
    assert.throws(() => validateExtraction({ semester_name: 'Fall 2026' }), (err) => err.status === 502);
    assert.throws(() => validateExtraction('not an object'), (err) => err.status === 502);
  });

  it('rejects responses without a single usable item', () => {
    assert.throws(() => validateExtraction(response([item({ date: 'TBD' })])), (err) => err.status === 422 && /No classes/.test(err.message));
  });

  it('produces data the save endpoint accepts unchanged', () => {
    const { data } = validateExtraction(response([item(), item({ title: 'Poster session', end_date: '2026-09-13', due_time: null, type: 'workshop' })]));
    const parsed = ScheduleInput.safeParse(data);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.deepEqual(parsed.data, data);
  });
});

describe('normalizeTime', () => {
  it('accepts 24-hour times only', () => {
    assert.equal(normalizeTime('7:30'), '07:30');
    assert.equal(normalizeTime('24:00'), null);
    assert.equal(normalizeTime('11:59 PM'), null);
    assert.equal(normalizeTime(null), null);
  });
});

describe('EXTRACTION_JSON_SCHEMA', () => {
  // OpenAI strict structured outputs require every object to list all of its properties as
  // required and to forbid additional properties.
  function objectsIn(schema, path = '$') {
    const found = [];
    if (schema.type === 'object') found.push([path, schema]);
    for (const [key, child] of Object.entries(schema.properties ?? {})) found.push(...objectsIn(child, `${path}.${key}`));
    if (schema.items) found.push(...objectsIn(schema.items, `${path}[]`));
    return found;
  }

  it('is valid for strict mode', () => {
    for (const [path, object] of objectsIn(EXTRACTION_JSON_SCHEMA)) {
      assert.equal(object.additionalProperties, false, path);
      assert.deepEqual([...object.required].sort(), Object.keys(object.properties).sort(), path);
    }
  });

  it('matches the fields and types the validator expects', () => {
    const assignment = EXTRACTION_JSON_SCHEMA.properties.classes.items.properties.assignments.items;
    assert.deepEqual(Object.keys(assignment.properties).sort(), ['date', 'due_time', 'end_date', 'title', 'type']);
    assert.deepEqual(assignment.properties.type.enum, ASSIGNMENT_TYPES);
    assert.deepEqual(assignment.properties.due_time.type, ['string', 'null']);
  });
});
