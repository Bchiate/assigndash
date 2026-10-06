'use strict';

const CLASS_ICONS = ['📚', '📐', '💰', '🚀', '✍️', '🔬', '🎨', '📊', '💻', '🏛️', '🧮', '📝'];
const PALETTE_SIZE = 8; // number of class colours in public/app.js

// Pick an icon from the course name when it gives a hint; otherwise fall back to position.
const ICON_HINTS = [
  [/\b(writ|english|literat|composition|rhetoric|poetry)/, '✍️'],
  [/\b(statist|data|analytics)/, '📊'],
  [/\b(math|calculus|algebra|geometr)/, '📐'],
  [/\b(econ|financ|business|account|marketing)/, '💰'],
  [/\b(comput|programming|software|coding)/, '💻'],
  [/\b(physic|chem|bio|astro|planet|science)/, '🔬'],
  [/\b(art|design|music|film|theat)/, '🎨'],
  [/\b(histor|politic|government|law|philosoph)/, '🏛️'],
  [/\b(entrepreneur|startup|venture)/, '🚀'],
];

function iconFor(cls) {
  const text = `${cls.name} ${cls.short_name}`.toLowerCase();
  const hint = ICON_HINTS.find(([pattern]) => pattern.test(text));
  return hint ? hint[1] : CLASS_ICONS[cls.position % CLASS_ICONS.length];
}

/** Client-side key for a class. Derived from the row id, so it can never collide. */
function classKey(classId) {
  return `c${classId}`;
}

function toClientAssignment(row, key) {
  return {
    id: row.id,
    date: row.date,
    endDate: row.end_date ?? null,
    dueTime: row.due_time ? String(row.due_time).slice(0, 5) : null, // Postgres returns HH:MM:SS
    classId: key,
    title: row.title,
    type: row.type,
    completed: Boolean(row.completed),
  };
}

/** Shapes the nested semester → classes → assignments rows into what the dashboard renders. */
function toDashboardPayload(semester) {
  if (!semester) return { hasSemester: false };

  const classes = {};
  const assignments = [];
  const ordered = [...(semester.classes ?? [])].sort((a, b) => a.position - b.position);
  for (const cls of ordered) {
    const key = classKey(cls.id);
    classes[key] = {
      name: cls.name,
      short: cls.short_name,
      color: cls.position % PALETTE_SIZE,
      icon: iconFor(cls),
      dbId: cls.id,
    };
    for (const row of cls.assignments ?? []) assignments.push(toClientAssignment(row, key));
  }

  return {
    hasSemester: true,
    semester: { id: semester.id, name: semester.name, startDate: semester.start_date, endDate: semester.end_date },
    classes,
    assignments,
  };
}

module.exports = { toDashboardPayload, toClientAssignment, classKey, iconFor };
