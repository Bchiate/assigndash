'use strict';

const { z } = require('zod');
const { HttpError } = require('../http-errors');
const { isRealDate, addDays } = require('../dates');

const ASSIGNMENT_TYPES = ['exam', 'due', 'quiz', 'discussion', 'conference', 'workshop', 'prep'];

const LIMITS = {
  classes: 30,
  assignmentsPerClass: 500,
  title: 300,
  className: 200,
  shortName: 40,
  semesterName: 100,
};

const TIME_24 = /^([01]\d|2[0-3]):[0-5]\d$/;

const IsoDate = z.string().refine(isRealDate, 'Dates must be real calendar dates in YYYY-MM-DD format.');
const Time24 = z.string().regex(TIME_24, 'Times must use 24-hour HH:MM format.');

/** Turns "9:00", "09:00" or "09:00:00" into "09:00"; anything else becomes null. */
function normalizeTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

function deriveShortName(name) {
  return name.split(/\s+/).slice(0, 2).join(' ').slice(0, 20);
}

/** end_date is only kept for genuine multi-day items. */
function normalizeAssignment({ title, date, end_date, due_time, type }) {
  return {
    title,
    date,
    end_date: end_date && end_date > date ? end_date : null,
    due_time: due_time ?? null,
    type,
  };
}

// ---------------------------------------------------------------------------
// Request bodies: what the browser may send when saving a reviewed schedule or
// editing a single assignment. Unknown keys are stripped.
// ---------------------------------------------------------------------------

const AssignmentFields = z.object({
  title: z.string().trim().min(1, 'Every item needs a title.').max(LIMITS.title, `Titles can be at most ${LIMITS.title} characters.`),
  date: IsoDate,
  end_date: IsoDate.nullish(),
  due_time: Time24.nullish(),
  type: z.enum(ASSIGNMENT_TYPES),
});

const AssignmentInput = AssignmentFields.extend({ type: z.enum(ASSIGNMENT_TYPES).default('due') }).transform(normalizeAssignment);

const ClassInput = z
  .object({
    name: z.string().trim().min(1, 'Every class needs a name.').max(LIMITS.className),
    short_name: z.string().trim().max(LIMITS.shortName).nullish(),
    assignments: z.array(AssignmentInput).max(LIMITS.assignmentsPerClass).default([]),
  })
  .transform((cls) => ({ ...cls, short_name: cls.short_name || deriveShortName(cls.name) }));

const Classes = z.array(ClassInput).min(1, 'Add at least one class.').max(LIMITS.classes);

const ScheduleInput = z
  .object({
    semester_name: z.string().trim().min(1, 'The semester needs a name.').max(LIMITS.semesterName),
    semester_start: IsoDate,
    semester_end: IsoDate,
    classes: Classes,
  })
  .refine((s) => s.semester_end >= s.semester_start, {
    message: 'The semester must end after it starts.',
    path: ['semester_end'],
  });

const MergeInput = z.object({
  semester_start: IsoDate.nullish(),
  semester_end: IsoDate.nullish(),
  classes: Classes,
});

// ---------------------------------------------------------------------------
// Model output. OpenAI receives EXTRACTION_JSON_SCHEMA with strict structured outputs,
// so the shape is guaranteed; validateExtraction() still checks every value, because
// a well-formed response can contain an impossible date or an empty title.
// ---------------------------------------------------------------------------

const nullableString = (description) => ({ type: ['string', 'null'], description });

const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['semester_name', 'semester_start', 'semester_end', 'classes'],
  properties: {
    semester_name: { type: 'string', description: 'Term name, for example "Spring 2027".' },
    semester_start: { type: 'string', description: 'First day of the term, YYYY-MM-DD.' },
    semester_end: { type: 'string', description: 'Last day of the term, YYYY-MM-DD.' },
    classes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'short_name', 'assignments'],
        properties: {
          name: { type: 'string', description: 'Full course title.' },
          short_name: { type: 'string', description: 'Course code or a short label, for example "BIO 101" or "Writing".' },
          assignments: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'date', 'end_date', 'due_time', 'type'],
              properties: {
                title: { type: 'string' },
                date: { type: 'string', description: 'YYYY-MM-DD' },
                end_date: nullableString('YYYY-MM-DD, only for multi-day events; otherwise null.'),
                due_time: nullableString('24-hour HH:MM when the source states a time for this item; otherwise null.'),
                type: { type: 'string', enum: ASSIGNMENT_TYPES },
              },
            },
          },
        },
      },
    },
  },
};

const ModelEnvelope = z.object({
  semester_name: z.string(),
  semester_start: z.string(),
  semester_end: z.string(),
  classes: z.array(
    z.object({
      name: z.string(),
      short_name: z.string().nullish(),
      assignments: z.array(z.unknown()),
    }),
  ),
});

const ModelAssignment = z.object({
  title: z.string().trim().min(1).transform((title) => title.slice(0, LIMITS.title)),
  date: IsoDate,
  end_date: z.string().nullish(),
  due_time: z.string().nullish(),
  type: z.enum(ASSIGNMENT_TYPES),
});

/**
 * Checks a model response and turns it into data the review screen can display and the
 * save endpoint will accept. Individual items with impossible dates are dropped (and
 * counted in `warnings`) rather than failing the whole document.
 */
function validateExtraction(raw) {
  const envelope = ModelEnvelope.safeParse(raw);
  if (!envelope.success) {
    throw new HttpError(502, 'The AI response did not have the expected format. Please try again.');
  }

  let skipped = 0;
  const classes = [];
  for (const cls of envelope.data.classes.slice(0, LIMITS.classes)) {
    const name = cls.name.trim().slice(0, LIMITS.className);
    const assignments = [];
    for (const item of cls.assignments) {
      const parsed = ModelAssignment.safeParse(item);
      if (!parsed.success) {
        skipped += 1;
        continue;
      }
      const { end_date: endDate, due_time: dueTime, ...rest } = parsed.data;
      assignments.push(
        normalizeAssignment({
          ...rest,
          end_date: isRealDate(endDate) ? endDate : null,
          due_time: normalizeTime(dueTime),
        }),
      );
    }
    if (!name || assignments.length === 0) {
      skipped += assignments.length;
      continue;
    }
    classes.push({
      name,
      short_name: (cls.short_name ?? '').trim().slice(0, LIMITS.shortName) || deriveShortName(name),
      assignments: assignments.slice(0, LIMITS.assignmentsPerClass),
    });
  }

  if (classes.length === 0) {
    throw new HttpError(422, 'No classes with dated assignments were found. Make sure the document includes a schedule with dates.');
  }

  // If the term dates are missing or nonsensical, pad the assignment range by a week.
  const dates = classes.flatMap((c) => c.assignments.flatMap((a) => [a.date, a.end_date].filter(Boolean))).sort();
  let start = envelope.data.semester_start;
  let end = envelope.data.semester_end;
  if (!isRealDate(start) || !isRealDate(end) || end < start) {
    start = addDays(dates[0], -7);
    end = addDays(dates[dates.length - 1], 7);
  }

  const warnings = skipped
    ? [`Skipped ${skipped} item${skipped === 1 ? '' : 's'} with a missing title or an invalid date.`]
    : [];

  return {
    data: {
      semester_name: envelope.data.semester_name.trim().slice(0, LIMITS.semesterName) || 'My Semester',
      semester_start: start,
      semester_end: end,
      classes,
    },
    warnings,
  };
}

module.exports = {
  ASSIGNMENT_TYPES,
  LIMITS,
  IsoDate,
  Time24,
  AssignmentFields,
  ScheduleInput,
  MergeInput,
  EXTRACTION_JSON_SCHEMA,
  validateExtraction,
  normalizeAssignment,
  normalizeTime,
};
