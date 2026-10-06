'use strict';

const { toIsoDate } = require('../dates');
const { HttpError } = require('../http-errors');

/**
 * An in-memory implementation of the store interface, used by demo mode and the tests.
 * It mirrors the semantics of the SQL functions in db/schema.sql: saving replaces the
 * user's semester, merging matches classes by name and skips duplicate items, and
 * deletes cascade. Every method finishes its writes synchronously, so a save can never be
 * observed half-done. `maxAssignments` bounds memory use when a demo is publicly reachable.
 */
function createMemoryStore({ now = () => new Date(), maxAssignments = Infinity } = {}) {
  let nextId = 1;
  const semesters = new Map();
  const classes = new Map();
  const assignments = new Map();
  const usage = new Map();

  const newId = () => nextId++;
  const ensureRoom = (incoming) => {
    if (assignments.size + incoming > maxAssignments) {
      throw new HttpError(503, 'The demo has run out of space. Restart the server to clear it.');
    }
  };
  const countItems = (schedule) => schedule.classes.reduce((sum, cls) => sum + cls.assignments.length, 0);
  const dedupeKey = (item) => `${item.date}|${item.title.toLowerCase()}`;

  function insertAssignments(classId, items) {
    const seen = new Set();
    for (const row of assignments.values()) if (row.class_id === classId) seen.add(dedupeKey(row));
    for (const item of items) {
      const key = dedupeKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      const id = newId();
      assignments.set(id, {
        id,
        class_id: classId,
        title: item.title,
        date: item.date,
        end_date: item.end_date ?? null,
        due_time: item.due_time ?? null,
        type: item.type ?? 'due',
        completed: false,
      });
    }
  }

  function deleteClassCascade(classId) {
    for (const [id, row] of assignments) if (row.class_id === classId) assignments.delete(id);
    classes.delete(classId);
  }

  function deleteSemesterCascade(semesterId) {
    for (const [id, row] of classes) if (row.semester_id === semesterId) deleteClassCascade(id);
    semesters.delete(semesterId);
  }

  function semesterOf(userId) {
    for (const row of semesters.values()) if (row.user_id === userId) return row;
    return null;
  }

  function classesOf(semesterId) {
    return [...classes.values()].filter((row) => row.semester_id === semesterId).sort((a, b) => a.position - b.position);
  }

  // Same rules as merge_classes() in db/schema.sql.
  function mergeClasses(semesterId, incoming) {
    const existing = classesOf(semesterId);
    let nextPosition = existing.reduce((max, cls) => Math.max(max, cls.position + 1), 0);
    const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
    for (const cls of incoming) {
      let row = existing.find((candidate) => sameName(candidate.name, cls.name));
      if (!row) {
        row = { id: newId(), semester_id: semesterId, name: cls.name.trim(), short_name: cls.short_name, position: nextPosition++ };
        classes.set(row.id, row);
        existing.push(row);
      }
      insertAssignments(row.id, cls.assignments);
    }
  }

  return {
    async getSemester(userId) {
      const semester = semesterOf(userId);
      if (!semester) return null;
      return {
        id: semester.id,
        name: semester.name,
        start_date: semester.start_date,
        end_date: semester.end_date,
        classes: classesOf(semester.id).map((cls) => ({
          id: cls.id,
          name: cls.name,
          short_name: cls.short_name,
          position: cls.position,
          assignments: [...assignments.values()].filter((a) => a.class_id === cls.id).map((a) => ({ ...a })),
        })),
      };
    },

    async saveSchedule(userId, schedule) {
      ensureRoom(countItems(schedule));
      const previous = semesterOf(userId);
      if (previous) deleteSemesterCascade(previous.id);

      const semesterId = newId();
      semesters.set(semesterId, {
        id: semesterId,
        user_id: userId,
        name: schedule.semester_name,
        start_date: schedule.semester_start,
        end_date: schedule.semester_end,
      });
      mergeClasses(semesterId, schedule.classes);
      return semesterId;
    },

    async mergeSchedule(userId, schedule) {
      const semester = semesterOf(userId);
      if (!semester) return null;
      ensureRoom(countItems(schedule));

      mergeClasses(semester.id, schedule.classes);
      if (schedule.semester_start && schedule.semester_start < semester.start_date) semester.start_date = schedule.semester_start;
      if (schedule.semester_end && schedule.semester_end > semester.end_date) semester.end_date = schedule.semester_end;
      return semester.id;
    },

    async ownerOf(kind, id) {
      if (kind === 'semester') return semesters.get(id)?.user_id ?? null;
      if (kind === 'class') return semesters.get(classes.get(id)?.semester_id)?.user_id ?? null;
      if (kind === 'assignment') {
        const cls = classes.get(assignments.get(id)?.class_id);
        return semesters.get(cls?.semester_id)?.user_id ?? null;
      }
      throw new Error(`Unknown resource kind: ${kind}`);
    },

    async createAssignment(classId, fields) {
      ensureRoom(1);
      const id = newId();
      const row = { id, class_id: classId, completed: false, ...fields };
      assignments.set(id, row);
      return { ...row };
    },

    async updateAssignment(id, fields) {
      Object.assign(assignments.get(id), fields);
    },

    async setAssignmentCompleted(id, completed) {
      assignments.get(id).completed = completed;
    },

    async deleteAssignment(id) {
      assignments.delete(id);
    },

    async deleteClass(id) {
      deleteClassCascade(id);
    },

    async deleteSemester(id) {
      deleteSemesterCascade(id);
    },

    async consumeExtractionQuota(userId, { perUser, global }) {
      const day = toIsoDate(now());
      const userKey = `${day}:${userId}`;
      const globalKey = `${day}:*`;
      const userCount = usage.get(userKey) ?? 0;
      const globalCount = usage.get(globalKey) ?? 0;
      if (userCount >= perUser) return 'user_limit';
      if (globalCount >= global) return 'global_limit';
      usage.set(userKey, userCount + 1);
      usage.set(globalKey, globalCount + 1);
      return 'ok';
    },

    /** Demo mode calls this when an evicted visitor's account is dropped. */
    async deleteUserData(userId) {
      const semester = semesterOf(userId);
      if (semester) deleteSemesterCascade(semester.id);
    },
  };
}

module.exports = { createMemoryStore };
