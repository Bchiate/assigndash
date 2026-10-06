'use strict';

const express = require('express');
const { z } = require('zod');
const { parseBody } = require('../http-errors');
const { AssignmentFields, normalizeAssignment } = require('../extraction/schema');
const { toClientAssignment, classKey } = require('../store/dashboard');
const { createOwnershipGuard } = require('./ownership');

const CreateAssignmentBody = AssignmentFields.extend({ classId: z.coerce.number() });
const ToggleBody = z.object({ assignmentId: z.coerce.number(), completed: z.boolean() });

module.exports = function assignmentRoutes({ store, sessions }) {
  const router = express.Router();
  const assertOwner = createOwnershipGuard(store);
  const { requireAuth } = sessions;

  router.post('/toggle-complete', requireAuth, async (req, res) => {
    const { assignmentId, completed } = parseBody(ToggleBody, req.body);
    const id = await assertOwner('assignment', assignmentId, req.userId);
    await store.setAssignmentCompleted(id, completed);
    res.json({ ok: true });
  });

  router.post('/assignment', requireAuth, async (req, res) => {
    const { classId, ...fields } = parseBody(CreateAssignmentBody, req.body);
    const id = await assertOwner('class', classId, req.userId, 'Class not found');
    const row = await store.createAssignment(id, normalizeAssignment(fields));
    res.status(201).json({ ok: true, assignment: toClientAssignment(row, classKey(id)) });
  });

  router.put('/assignment/:id', requireAuth, async (req, res) => {
    const fields = parseBody(AssignmentFields, req.body);
    const id = await assertOwner('assignment', req.params.id, req.userId);
    await store.updateAssignment(id, normalizeAssignment(fields));
    res.json({ ok: true });
  });

  router.delete('/assignment/:id', requireAuth, async (req, res) => {
    const id = await assertOwner('assignment', req.params.id, req.userId);
    await store.deleteAssignment(id);
    res.json({ ok: true });
  });

  // Removes a class and, through the cascade, all of its assignments.
  router.delete('/class/:id', requireAuth, async (req, res) => {
    const id = await assertOwner('class', req.params.id, req.userId);
    await store.deleteClass(id);
    res.json({ ok: true });
  });

  return router;
};
