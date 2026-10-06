'use strict';

// Runs db/schema.sql against real Postgres (PGlite, Postgres compiled to WebAssembly) to
// check the transactional SQL functions and the deny-by-default access model.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

// The parts of a Supabase project the schema relies on, including Supabase's default
// grants, which hand every new table and function in "public" to the API roles.
const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const schedule = (overrides = {}) => ({
  semester_name: 'Fall 2026',
  semester_start: '2026-08-31',
  semester_end: '2026-12-18',
  classes: [
    {
      name: 'Introduction to Planetary Science',
      short_name: 'ASTR 1270',
      assignments: [
        { title: 'Problem Set 1', date: '2026-09-11', end_date: null, due_time: '23:59', type: 'due' },
        { title: 'problem set 1', date: '2026-09-11', end_date: null, due_time: null, type: 'due' },
        { title: 'Poster Session', date: '2026-12-07', end_date: '2026-12-09', due_time: null, type: 'workshop' },
      ],
    },
    {
      name: 'Applied Statistics with R',
      short_name: 'STAT 2380',
      assignments: [{ title: 'Midterm Exam', date: '2026-10-22', end_date: null, due_time: '13:00', type: 'exam' }],
    },
  ],
  ...overrides,
});

describe('db/schema.sql', () => {
  let db;
  let nextUser = 0;

  before(async () => {
    db = new PGlite();
    await db.exec(SUPABASE_SHIM);
    await db.exec(SCHEMA);
  });

  after(async () => {
    await db.close();
  });

  async function newUser() {
    nextUser += 1;
    const id = `00000000-0000-0000-0000-${String(nextUser).padStart(12, '0')}`;
    await db.query('insert into auth.users (id) values ($1)', [id]);
    return id;
  }

  /** Runs queries as one of the API roles, the way PostgREST would. */
  async function as(role, fn) {
    await db.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
    }
  }

  const call = (sql, params) => as('service_role', async () => (await db.query(sql, params)).rows);
  const save = (userId, body) => call('select public.save_schedule($1, $2) as id', [userId, body]).then((r) => r[0].id);
  const merge = (userId, body) => call('select public.merge_schedule($1, $2) as id', [userId, body]).then((r) => r[0].id);

  async function snapshot(userId) {
    return call(
      `select s.name as semester, s.start_date::text as start, s.end_date::text as "end", c.short_name, c.position,
              a.title, a.date::text as date, a.end_date::text as end_date, a.due_time::text as due_time, a.type
         from public.semesters s
         join public.classes c on c.semester_id = s.id
         left join public.assignments a on a.class_id = c.id
        where s.user_id = $1
        order by c.position, a.date, a.title`,
      [userId],
    );
  }

  it('can be applied more than once', async () => {
    await db.exec(SCHEMA);
  });

  it('saves a schedule, keeping class order and skipping duplicate items', async () => {
    const user = await newUser();
    await save(user, schedule());
    const rows = await snapshot(user);
    assert.deepEqual(
      rows.map((r) => [r.short_name, r.position, r.title, r.date, r.end_date, r.due_time, r.type]),
      [
        ['ASTR 1270', 0, 'Problem Set 1', '2026-09-11', null, '23:59:00', 'due'],
        ['ASTR 1270', 0, 'Poster Session', '2026-12-07', '2026-12-09', null, 'workshop'],
        ['STAT 2380', 1, 'Midterm Exam', '2026-10-22', null, '13:00:00', 'exam'],
      ],
    );
  });

  it('saves the same course from two documents as one class', async () => {
    const user = await newUser();
    const [astr, stat] = schedule().classes;
    const fromSpreadsheet = {
      name: 'introduction to planetary science ',
      short_name: 'ASTR 1270',
      assignments: [
        { title: 'Problem Set 1', date: '2026-09-11', end_date: null, due_time: null, type: 'due' },
        { title: 'Lab 1: Crater Counting', date: '2026-09-17', end_date: null, due_time: '17:00', type: 'due' },
      ],
    };
    await save(user, schedule({ classes: [astr, stat, fromSpreadsheet] }));
    const rows = await snapshot(user);
    assert.deepEqual(
      rows.map((r) => [r.short_name, r.position, r.title]),
      [
        ['ASTR 1270', 0, 'Problem Set 1'],
        ['ASTR 1270', 0, 'Lab 1: Crater Counting'],
        ['ASTR 1270', 0, 'Poster Session'],
        ['STAT 2380', 1, 'Midterm Exam'],
      ],
    );
  });

  it('replaces the previous semester when saving again', async () => {
    const user = await newUser();
    await save(user, schedule());
    await save(user, schedule({ semester_name: 'Spring 2027', classes: [schedule().classes[1]] }));
    const rows = await snapshot(user);
    assert.deepEqual([...new Set(rows.map((r) => r.semester))], ['Spring 2027']);
    assert.deepEqual(rows.map((r) => r.title), ['Midterm Exam']);
    const [{ count }] = await call('select count(*)::int as count from public.semesters where user_id = $1', [user]);
    assert.equal(count, 1);
  });

  it('leaves the existing schedule untouched when a save fails part-way', async () => {
    const user = await newUser();
    await save(user, schedule());
    const before = await snapshot(user);

    const broken = schedule({ semester_name: 'Spring 2027' });
    broken.classes[1].assignments[0].date = '2026-02-30'; // fails on the last insert
    await assert.rejects(save(user, broken), /out of range/);

    assert.deepEqual(await snapshot(user), before);
  });

  it('enforces types and date order in the tables themselves', async () => {
    const user = await newUser();
    await save(user, schedule());
    const [{ id: classId }] = await call(
      'select c.id from public.classes c join public.semesters s on s.id = c.semester_id where s.user_id = $1 limit 1',
      [user],
    );
    const insert = (type, date, endDate) =>
      call('insert into public.assignments (class_id, title, date, end_date, type) values ($1, $2, $3, $4, $5)', [
        classId,
        'Check',
        date,
        endDate,
        type,
      ]);
    await assert.rejects(insert('party', '2026-09-01', null), /check constraint/);
    await assert.rejects(insert('due', '2026-09-05', '2026-09-01'), /assignment_dates_in_order/);
    await insert('due', '2026-09-01', '2026-09-03');
  });

  it('merges another syllabus into the semester', async () => {
    const user = await newUser();
    await save(user, schedule());
    await merge(user, {
      semester_start: '2026-08-24',
      semester_end: null,
      classes: [
        {
          name: '  introduction to PLANETARY science',
          short_name: 'ASTR',
          assignments: [
            { title: 'PROBLEM SET 1', date: '2026-09-11', end_date: null, due_time: null, type: 'due' },
            { title: 'Problem Set 2', date: '2026-09-25', end_date: null, due_time: '23:59', type: 'due' },
          ],
        },
        {
          name: 'Writing Seminar',
          short_name: 'WRIT 1190',
          assignments: [{ title: 'Essay 1 Draft', date: '2026-09-28', end_date: null, due_time: null, type: 'due' }],
        },
      ],
    });
    const rows = await snapshot(user);
    assert.equal(rows[0].start, '2026-08-24', 'term start widened');
    assert.equal(rows[0].end, '2026-12-18', 'term end kept');
    assert.deepEqual(
      rows.map((r) => [r.short_name, r.position, r.title]),
      [
        ['ASTR 1270', 0, 'Problem Set 1'],
        ['ASTR 1270', 0, 'Problem Set 2'],
        ['ASTR 1270', 0, 'Poster Session'],
        ['STAT 2380', 1, 'Midterm Exam'],
        ['WRIT 1190', 2, 'Essay 1 Draft'],
      ],
    );
  });

  it('merge returns null for a user without a semester', async () => {
    const user = await newUser();
    assert.equal(await merge(user, schedule()), null);
  });

  it('counts extractions against per-user and global daily limits', async () => {
    const [first, second] = [await newUser(), await newUser()];
    const consume = (user, perUser, global) =>
      call('select public.consume_extraction_quota($1, $2, $3) as result', [user, perUser, global]).then((r) => r[0].result);

    assert.equal(await consume(first, 2, 100), 'ok');
    assert.equal(await consume(first, 2, 100), 'ok');
    assert.equal(await consume(first, 2, 100), 'user_limit');

    const [{ total }] = await call('select count as total from public.extraction_usage_total');
    assert.equal(await consume(second, 10, total), 'global_limit');
    const [{ count }] = await call('select count from public.extraction_usage where user_id = $1', [second]);
    assert.equal(count, 0, 'a refusal does not use up the user\'s own quota');
  });

  it('deletes a user\'s data with their account', async () => {
    const user = await newUser();
    await save(user, schedule());
    await db.query('delete from auth.users where id = $1', [user]);
    assert.deepEqual(await snapshot(user), []);
  });

  describe('API roles', () => {
    it('has row-level security enabled on every table', async () => {
      const { rows } = await db.query(
        `select relname, relrowsecurity from pg_class
          where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`,
      );
      assert.ok(rows.length >= 5);
      for (const row of rows) assert.equal(row.relrowsecurity, true, row.relname);
      const { rows: policies } = await db.query("select * from pg_policies where schemaname = 'public'");
      assert.deepEqual(policies, [], 'no policies: nothing is granted to API users');
    });

    for (const role of ['anon', 'authenticated']) {
      it(`gives the ${role} role no access to tables or functions`, async () => {
        const user = await newUser();
        await save(user, schedule());
        for (const table of ['semesters', 'classes', 'assignments', 'extraction_usage', 'extraction_usage_total']) {
          await assert.rejects(as(role, () => db.query(`select * from public.${table}`)), /permission denied/, table);
        }
        await assert.rejects(
          as(role, () => db.query("insert into public.semesters (user_id, name, start_date, end_date) values ($1, 'x', '2026-01-01', '2026-02-01')", [user])),
          /permission denied/,
        );
        await assert.rejects(as(role, () => db.query('select public.save_schedule($1, $2)', [user, schedule()])), /permission denied/);
        await assert.rejects(as(role, () => db.query("select public.merge_classes(1, '[]')")), /permission denied/);
        await assert.rejects(as(role, () => db.query('select public.consume_extraction_quota($1, 100, 100)', [user])), /permission denied/);
      });
    }
  });
});
