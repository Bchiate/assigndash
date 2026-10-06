'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildApp, signUp, SCHEDULE } = require('./helpers');

// The server uses a database key that bypasses row-level security, so these checks are the
// only thing keeping one student's data away from another. Every data-changing route is
// exercised here as both the owner and a different signed-in user.

describe('ownership checks', () => {
  let app;
  let alice;
  let bob;
  let semesterId;
  let classDbId;
  let assignmentId;

  beforeEach(async () => {
    ({ app } = buildApp());
    alice = await signUp(app, { name: 'Alice' });
    bob = await signUp(app, { name: 'Bob' });
    const saved = await alice.post('/api/save-schedule').send(SCHEDULE);
    assert.equal(saved.status, 200);
    const dashboard = (await alice.get('/api/dashboard')).body;
    semesterId = dashboard.semester.id;
    classDbId = Object.values(dashboard.classes)[0].dbId;
    assignmentId = dashboard.assignments[0].id;
  });

  async function aliceAssignment() {
    return (await alice.get('/api/dashboard')).body.assignments.find((a) => a.id === assignmentId);
  }

  it("does not show one user's semester to another", async () => {
    const res = await bob.get('/api/dashboard');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { hasSemester: false });
  });

  it("refuses to toggle another user's assignment", async () => {
    const res = await bob.post('/api/toggle-complete').send({ assignmentId, completed: true });
    assert.equal(res.status, 404);
    assert.equal((await aliceAssignment()).completed, false);

    const own = await alice.post('/api/toggle-complete').send({ assignmentId, completed: true });
    assert.equal(own.status, 200);
    assert.equal((await aliceAssignment()).completed, true);
  });

  it("refuses to edit another user's assignment", async () => {
    const edit = { title: 'Hijacked', date: '2026-09-12', type: 'due', end_date: null, due_time: null };
    assert.equal((await bob.put(`/api/assignment/${assignmentId}`).send(edit)).status, 404);
    assert.notEqual((await aliceAssignment()).title, 'Hijacked');

    assert.equal((await alice.put(`/api/assignment/${assignmentId}`).send(edit)).status, 200);
    assert.equal((await aliceAssignment()).title, 'Hijacked');
  });

  it("refuses to delete another user's assignment", async () => {
    assert.equal((await bob.delete(`/api/assignment/${assignmentId}`)).status, 404);
    assert.ok(await aliceAssignment());

    assert.equal((await alice.delete(`/api/assignment/${assignmentId}`)).status, 200);
    assert.equal(await aliceAssignment(), undefined);
  });

  it("refuses to add an assignment to another user's class", async () => {
    const item = { classId: classDbId, title: 'Planted', date: '2026-09-20', type: 'due' };
    const res = await bob.post('/api/assignment').send(item);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Class not found');

    const own = await alice.post('/api/assignment').send({ ...item, due_time: '09:30' });
    assert.equal(own.status, 201);
    assert.equal(own.body.assignment.title, 'Planted');
    assert.equal(own.body.assignment.dueTime, '09:30');
  });

  it("refuses to delete another user's class or semester", async () => {
    assert.equal((await bob.delete(`/api/class/${classDbId}`)).status, 404);
    assert.equal((await bob.delete(`/api/semester/${semesterId}`)).status, 404);
    assert.equal((await alice.get('/api/dashboard')).body.assignments.length, 2);

    assert.equal((await alice.delete(`/api/class/${classDbId}`)).status, 200);
    const after = (await alice.get('/api/dashboard')).body;
    assert.deepEqual(after.classes, {});
    assert.deepEqual(after.assignments, [], 'deleting a class removes its assignments');

    assert.equal((await alice.delete(`/api/semester/${semesterId}`)).status, 200);
    assert.deepEqual((await alice.get('/api/dashboard')).body, { hasSemester: false });
  });

  it("can't merge into another user's semester", async () => {
    const merge = { classes: [{ name: 'Sneaky Seminar', assignments: [{ title: 'X', date: '2026-09-01', type: 'due' }] }] };
    const res = await bob.post('/api/add-to-schedule').send(merge);
    assert.equal(res.status, 404, 'Bob has no semester of his own to merge into');
    const classes = Object.values((await alice.get('/api/dashboard')).body.classes);
    assert.equal(classes.length, 1);
  });

  it('treats malformed and unknown ids as not found', async () => {
    for (const id of ['abc', '-1', '0', '1.5', '999999']) {
      assert.equal((await alice.delete(`/api/assignment/${id}`)).status, 404, id);
    }
    assert.equal((await alice.post('/api/toggle-complete').send({ assignmentId: 'abc', completed: true })).status, 400);
  });

  it('requires a session for every data route', async () => {
    const anonymous = request(app);
    assert.equal((await anonymous.post('/api/toggle-complete').send({ assignmentId, completed: true })).status, 401);
    assert.equal((await anonymous.delete(`/api/assignment/${assignmentId}`)).status, 401);
    assert.equal((await anonymous.delete(`/api/class/${classDbId}`)).status, 401);
    assert.equal((await anonymous.post('/api/add-to-schedule').send({})).status, 401);
  });
});

describe('saving and merging schedules', () => {
  it('replaces the previous semester when a new schedule is saved', async () => {
    const { app } = buildApp();
    const agent = await signUp(app);
    await agent.post('/api/save-schedule').send(SCHEDULE);
    const spring = { ...SCHEDULE, semester_name: 'Spring 2027', semester_start: '2027-01-11', semester_end: '2027-05-07' };
    spring.classes = [{ name: 'Applied Statistics with R', short_name: 'STAT 2380', assignments: [{ title: 'Homework 1', date: '2027-01-19', type: 'due' }] }];
    await agent.post('/api/save-schedule').send(spring);

    const dashboard = (await agent.get('/api/dashboard')).body;
    assert.equal(dashboard.semester.name, 'Spring 2027');
    assert.deepEqual(Object.values(dashboard.classes).map((c) => c.short), ['STAT 2380']);
    assert.equal(dashboard.assignments.length, 1);
  });

  it('merges classes by name, skips duplicates and widens the term', async () => {
    const { app } = buildApp();
    const agent = await signUp(app);
    await agent.post('/api/save-schedule').send(SCHEDULE);
    const res = await agent.post('/api/add-to-schedule').send({
      semester_start: '2026-08-24',
      semester_end: null,
      classes: [
        {
          name: 'introduction to planetary science ',
          assignments: [
            { title: 'problem set 1', date: '2026-09-11', type: 'due' },
            { title: 'Problem Set 2', date: '2026-09-25', type: 'due', due_time: '23:59' },
          ],
        },
        { name: 'Writing Seminar', short_name: 'WRIT 1190', assignments: [{ title: 'Essay 1 Draft', date: '2026-09-28', type: 'due' }] },
      ],
    });
    assert.equal(res.status, 200);

    const dashboard = (await agent.get('/api/dashboard')).body;
    assert.equal(dashboard.semester.startDate, '2026-08-24');
    assert.equal(dashboard.semester.endDate, '2026-12-18');
    const classes = Object.values(dashboard.classes);
    assert.deepEqual(classes.map((c) => c.short), ['ASTR 1270', 'WRIT 1190']);
    assert.deepEqual(classes.map((c) => c.color), [0, 1], 'new classes get the next colour');
    const titles = dashboard.assignments.map((a) => a.title).sort();
    assert.deepEqual(titles, ['Essay 1 Draft', 'Midterm Exam', 'Problem Set 1', 'Problem Set 2']);
  });

  it('saves the same course from two documents as one class', async () => {
    const { app } = buildApp();
    const agent = await signUp(app);
    const duplicate = {
      name: 'INTRODUCTION TO PLANETARY SCIENCE',
      short_name: 'ASTR 1270',
      assignments: [
        { title: 'Problem Set 1', date: '2026-09-11', type: 'due' },
        { title: 'Lab 1: Crater Counting', date: '2026-09-17', type: 'due' },
      ],
    };
    await agent.post('/api/save-schedule').send({ ...SCHEDULE, classes: [...SCHEDULE.classes, duplicate] });
    const dashboard = (await agent.get('/api/dashboard')).body;
    assert.equal(Object.keys(dashboard.classes).length, 1);
    assert.deepEqual(dashboard.assignments.map((a) => a.title).sort(), ['Lab 1: Crater Counting', 'Midterm Exam', 'Problem Set 1']);
  });

  it('validates schedules before saving', async () => {
    const { app } = buildApp();
    const agent = await signUp(app);
    const cases = [
      [{ ...SCHEDULE, semester_end: '2026-01-01' }, /end after it starts/],
      [{ ...SCHEDULE, classes: [] }, /at least one class/],
      [{ ...SCHEDULE, semester_start: '2026-02-30' }, /real calendar dates/],
      [{ ...SCHEDULE, classes: [{ name: 'X', assignments: [{ title: 'Y', date: '2026-09-01', type: 'party' }] }] }, /Invalid value/],
      [{ ...SCHEDULE, classes: [{ name: 'X', assignments: [{ title: 'Y', date: '2026-09-01', due_time: '25:00' }] }] }, /24-hour/],
    ];
    for (const [body, message] of cases) {
      const res = await agent.post('/api/save-schedule').send(body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      assert.match(res.body.error, message);
    }
  });
});
