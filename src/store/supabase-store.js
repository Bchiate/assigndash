'use strict';

const { createClient } = require('@supabase/supabase-js');

const SEMESTER_TREE =
  'id, name, start_date, end_date, ' +
  'classes(id, name, short_name, position, assignments(id, title, date, end_date, due_time, type, completed))';

// Ownership is resolved by joining up to the semester's user_id in a single query.
const OWNER_QUERIES = {
  semester: (db, id) => db.from('semesters').select('user_id').eq('id', id).maybeSingle(),
  class: (db, id) => db.from('classes').select('id, semesters!inner(user_id)').eq('id', id).maybeSingle(),
  assignment: (db, id) =>
    db.from('assignments').select('id, classes!inner(semesters!inner(user_id))').eq('id', id).maybeSingle(),
};

function unwrap({ data, error }) {
  if (error) throw Object.assign(new Error(`Supabase: ${error.message}`), { cause: error });
  return data;
}

/**
 * Postgres access through Supabase's Data API with the service-role key. The key bypasses
 * row-level security, so every caller in src/routes checks ownership first (see
 * routes/ownership.js); the database itself denies the anon and authenticated roles.
 * Multi-row writes go through SQL functions so each one runs in a single transaction.
 */
function createSupabaseStore({ url, serviceRoleKey, fetch }) {
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: fetch ? { fetch } : {},
  });

  return {
    async getSemester(userId) {
      return unwrap(await db.from('semesters').select(SEMESTER_TREE).eq('user_id', userId).maybeSingle());
    },

    async saveSchedule(userId, schedule) {
      return unwrap(await db.rpc('save_schedule', { p_user_id: userId, p_schedule: schedule }));
    },

    async mergeSchedule(userId, schedule) {
      return unwrap(await db.rpc('merge_schedule', { p_user_id: userId, p_schedule: schedule }));
    },

    async ownerOf(kind, id) {
      const row = unwrap(await OWNER_QUERIES[kind](db, id));
      if (!row) return null;
      return row.user_id ?? row.semesters?.user_id ?? row.classes?.semesters?.user_id ?? null;
    },

    async createAssignment(classId, fields) {
      return unwrap(
        await db
          .from('assignments')
          .insert({ class_id: classId, ...fields })
          .select('id, title, date, end_date, due_time, type, completed')
          .single(),
      );
    },

    async updateAssignment(id, fields) {
      unwrap(await db.from('assignments').update(fields).eq('id', id));
    },

    async setAssignmentCompleted(id, completed) {
      unwrap(await db.from('assignments').update({ completed }).eq('id', id));
    },

    async deleteAssignment(id) {
      unwrap(await db.from('assignments').delete().eq('id', id));
    },

    // Classes and semesters cascade to their children (ON DELETE CASCADE in the schema).
    async deleteClass(id) {
      unwrap(await db.from('classes').delete().eq('id', id));
    },

    async deleteSemester(id) {
      unwrap(await db.from('semesters').delete().eq('id', id));
    },

    async consumeExtractionQuota(userId, { perUser, global }) {
      return unwrap(
        await db.rpc('consume_extraction_quota', { p_user_id: userId, p_user_limit: perUser, p_global_limit: global }),
      );
    },
  };
}

module.exports = { createSupabaseStore, SEMESTER_TREE };
