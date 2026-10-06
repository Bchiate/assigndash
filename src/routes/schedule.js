'use strict';

const express = require('express');
const { HttpError, parseBody } = require('../http-errors');
const { ScheduleInput, MergeInput } = require('../extraction/schema');
const { toDashboardPayload } = require('../store/dashboard');
const { createOwnershipGuard } = require('./ownership');

module.exports = function scheduleRoutes({ store, sessions }) {
  const router = express.Router();
  const assertOwner = createOwnershipGuard(store);
  const { requireAuth } = sessions;

  // Saves a reviewed schedule as the user's semester, replacing the previous one atomically.
  router.post('/save-schedule', requireAuth, async (req, res) => {
    const schedule = parseBody(ScheduleInput, req.body);
    const semesterId = await store.saveSchedule(req.userId, schedule);
    res.json({ ok: true, semesterId });
  });

  // Merges classes from another syllabus into the current semester.
  router.post('/add-to-schedule', requireAuth, async (req, res) => {
    const schedule = parseBody(MergeInput, req.body);
    const semesterId = await store.mergeSchedule(req.userId, schedule);
    if (!semesterId) throw new HttpError(404, 'You have no semester to add to yet. Upload a syllabus first.');
    res.json({ ok: true, semesterId });
  });

  // The whole semester (classes and their assignments) comes back from one nested query.
  router.get('/dashboard', requireAuth, async (req, res) => {
    res.json(toDashboardPayload(await store.getSemester(req.userId)));
  });

  router.delete('/semester/:id', requireAuth, async (req, res) => {
    const id = await assertOwner('semester', req.params.id, req.userId);
    await store.deleteSemester(id);
    res.json({ ok: true });
  });

  return router;
};
