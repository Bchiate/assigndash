'use strict';

// Fictional sample documents for demo mode, generated at startup so their dates are always
// relative to today (the demo semester is in its sixth week). The same data produces the
// sample files and the "canned" extraction result the demo returns for them, so what the
// review screen shows always matches what is in the files.

const ExcelJS = require('exceljs');
const { addDays, localToday, weekday } = require('../dates');
const { createPdfPage } = require('./pdf-writer');

const UNIVERSITY = 'Northwind University';
const FICTION_NOTE = `Sample document generated for the AssignDash demo. ${UNIVERSITY}, its courses and its staff are fictional.`;
const DAY_OFFSET = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function buildTerm(today) {
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const start = addDays(monday, -35); // five weeks in
  const end = addDays(start, 15 * 7 + 4); // Friday of week 16
  const reference = addDays(start, 14);
  const month = Number(reference.slice(5, 7));
  const season = month <= 5 ? 'Spring' : month <= 7 ? 'Summer' : 'Fall';
  return {
    name: `${season} ${reference.slice(0, 4)}`,
    start,
    end,
    on: (week, day) => addDays(start, (week - 1) * 7 + DAY_OFFSET[day]),
  };
}

const describeDate = (iso) => {
  const date = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
};

const time12 = (hhmm) => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
};

// ---------------------------------------------------------------------------------------
// Course data
// ---------------------------------------------------------------------------------------

const PLANETARY = {
  code: 'ASTR 1270',
  title: 'Introduction to Planetary Science',
  instructor: 'Dr. Rowan Ashby',
  department: 'Department of Physics and Astronomy',
  meets: 'Mon/Wed/Fri 10:00-10:50 AM, Sycamore Hall 120',
  officeHours: 'Tue 2:00-4:00 PM, Sycamore Hall 214',
  items: [
    { week: 2, day: 'Wed', time: '10:00', type: 'quiz', title: 'Reading Quiz 1', detail: 'Start of class' },
    { week: 2, day: 'Fri', time: '23:59', type: 'due', title: 'Problem Set 1' },
    { week: 3, day: 'Thu', time: '17:00', type: 'due', title: 'Lab 1: Crater Counting' },
    { week: 4, day: 'Fri', time: '23:59', type: 'due', title: 'Problem Set 2' },
    { week: 5, day: 'Wed', time: '10:00', type: 'quiz', title: 'Reading Quiz 2', detail: 'Start of class' },
    { week: 6, day: 'Tue', time: '20:00', type: 'workshop', title: 'Observatory Night', detail: '8:00 PM, campus observatory' },
    { week: 6, day: 'Fri', time: '23:59', type: 'due', title: 'Problem Set 3' },
    { week: 8, day: 'Wed', time: '10:00', type: 'exam', title: 'Midterm Exam', detail: 'In class, Sycamore Hall 120' },
    { week: 9, day: 'Thu', time: '17:00', type: 'due', title: 'Lab 2: Spectra of the Gas Giants' },
    { week: 11, day: 'Wed', time: '10:00', type: 'quiz', title: 'Reading Quiz 3', detail: 'Start of class' },
    { week: 11, day: 'Fri', time: '23:59', type: 'due', title: 'Problem Set 4' },
    { week: 12, day: 'Fri', time: '23:59', type: 'due', title: 'Research Poster Proposal' },
    { week: 14, day: 'Mon', time: null, span: 2, type: 'workshop', title: 'Research Poster Session', detail: 'Science atrium, Mon-Wed' },
    { week: 14, day: 'Fri', time: '23:59', type: 'due', title: 'Problem Set 5' },
    { week: 16, day: 'Tue', time: '08:00', type: 'exam', title: 'Final Exam', detail: '8:00 AM, Sycamore Hall 120' },
  ],
  notes: [
    { week: 3, day: 'Mon', text: 'No class: campus holiday' },
    { week: 10, day: 'Mon', text: 'No class: mid-semester break' },
  ],
};

const STATISTICS = {
  code: 'STAT 2380',
  title: 'Applied Statistics with R',
  instructor: 'Prof. Imani Castellanos',
  meets: 'Tue/Thu 1:00-2:15 PM, Birch Hall 305',
  // One row per class meeting; rows with an item carry a deliverable.
  rows: [
    { week: 1, day: 'Tue', topic: 'Course overview; R and RStudio setup' },
    { week: 1, day: 'Thu', topic: 'Describing data: center and spread' },
    { week: 2, day: 'Tue', topic: 'Visualizing distributions', item: { title: 'Homework 1', time: '23:59', type: 'due' } },
    { week: 2, day: 'Thu', topic: 'Probability basics' },
    { week: 3, day: 'Tue', topic: 'Conditional probability' },
    { week: 3, day: 'Thu', topic: 'Random variables', item: { title: 'Quiz 1', time: '13:00', type: 'quiz' } },
    { week: 4, day: 'Tue', topic: 'The normal distribution', item: { title: 'Homework 2', time: '23:59', type: 'due' } },
    { week: 4, day: 'Thu', topic: 'Sampling distributions' },
    { week: 5, day: 'Tue', topic: 'The central limit theorem' },
    { week: 5, day: 'Thu', topic: 'Confidence intervals', item: { title: 'Quiz 2', time: '13:00', type: 'quiz' } },
    { week: 6, day: 'Tue', topic: 'Hypothesis tests', item: { title: 'Homework 3', time: '23:59', type: 'due' } },
    { week: 6, day: 'Thu', topic: 'Errors and power' },
    { week: 7, day: 'Tue', topic: 'Comparing two groups' },
    { week: 7, day: 'Thu', topic: 'Project kickoff', item: { title: 'Project Proposal', time: '23:59', type: 'due' } },
    { week: 8, day: 'Tue', topic: 'Midterm review' },
    { week: 8, day: 'Thu', topic: 'Midterm exam (in class)', item: { title: 'Midterm Exam', time: '13:00', type: 'exam' } },
    { week: 9, day: 'Tue', topic: 'Chi-square tests' },
    { week: 9, day: 'Thu', topic: 'Correlation' },
    { week: 10, day: 'Tue', topic: 'Simple linear regression', item: { title: 'Homework 4', time: '23:59', type: 'due' } },
    { week: 10, day: 'Thu', topic: 'Regression diagnostics' },
    { week: 11, day: 'Tue', topic: 'Multiple regression' },
    { week: 11, day: 'Thu', topic: 'Model selection', item: { title: 'Quiz 3', time: '13:00', type: 'quiz' } },
    { week: 12, day: 'Tue', topic: 'Interactions', item: { title: 'Homework 5', time: '23:59', type: 'due' } },
    {
      week: 12,
      day: 'Wed',
      topic: 'Project check-in meetings, Wed-Fri (book a 15-minute slot)',
      item: { title: 'Project Check-in Meeting', time: null, span: 2, type: 'conference' },
    },
    { week: 13, day: 'Tue', topic: 'Logistic regression' },
    { week: 13, day: 'Thu', topic: 'Project peer review (in class)', item: { title: 'Project Peer Review', time: '13:00', type: 'workshop' } },
    { week: 14, day: 'Tue', topic: 'Resampling methods', item: { title: 'Homework 6', time: '23:59', type: 'due' } },
    { week: 14, day: 'Thu', topic: 'No class' },
    { week: 15, day: 'Tue', topic: 'Course review' },
    { week: 15, day: 'Fri', topic: 'Final project report due', item: { title: 'Final Project Report', time: '23:59', type: 'due' } },
    { week: 16, day: 'Thu', topic: 'Final exam', item: { title: 'Final Exam', time: '14:00', type: 'exam' } },
  ],
};
STATISTICS.items = STATISTICS.rows.filter((row) => row.item).map((row) => ({ week: row.week, day: row.day, ...row.item }));

const WRITING = {
  code: 'WRIT 1190',
  title: 'Writing Seminar: Cities and Memory',
  instructor: 'Prof. Theo Lindqvist',
  items: [
    { week: 1, day: 'Sun', time: '23:59', type: 'discussion', title: 'Discussion Post 1', description: 'Introduce a place you remember well (250 words).' },
    { week: 3, day: 'Sun', time: '23:59', type: 'discussion', title: 'Discussion Post 2', description: 'Respond to two classmates.' },
    { week: 4, day: 'Mon', time: '23:59', type: 'due', title: 'Essay 1 Draft', description: 'Upload to the course site.' },
    { week: 4, day: 'Wed', time: '09:30', type: 'workshop', title: 'Peer Review Workshop: Essay 1', description: 'Bring two printed copies.' },
    { week: 5, day: 'Fri', time: '23:59', type: 'due', title: 'Essay 1 Final' },
    { week: 5, day: 'Sun', time: '23:59', type: 'discussion', title: 'Discussion Post 3' },
    { week: 7, day: 'Mon', time: null, span: 2, type: 'conference', title: 'One-on-one Conference', description: 'Sign up for a 20-minute slot.' },
    { week: 7, day: 'Sun', time: '23:59', type: 'discussion', title: 'Discussion Post 4' },
    { week: 8, day: 'Wed', time: '09:30', type: 'prep', title: 'Read Chapter 4 of the course reader' },
    { week: 9, day: 'Fri', time: '23:59', type: 'due', title: 'Essay 2 Proposal' },
    { week: 9, day: 'Sun', time: '23:59', type: 'discussion', title: 'Discussion Post 5' },
    { week: 11, day: 'Mon', time: '23:59', type: 'due', title: 'Essay 2 Draft' },
    { week: 11, day: 'Wed', time: '09:30', type: 'workshop', title: 'Peer Review Workshop: Essay 2' },
    { week: 12, day: 'Sun', time: '23:59', type: 'discussion', title: 'Discussion Post 6' },
    { week: 13, day: 'Fri', time: '23:59', type: 'due', title: 'Essay 2 Final' },
    { week: 15, day: 'Wed', time: '09:30', type: 'workshop', title: 'Portfolio Presentations' },
    { week: 16, day: 'Wed', time: '17:00', type: 'due', title: 'Final Portfolio' },
  ],
  notes: [{ week: 3, day: 'Mon', text: 'No class: campus holiday' }],
};

const COURSES = [PLANETARY, STATISTICS, WRITING];

/** The extraction a correct model run would return for this course. */
function expectedAssignments(course, term) {
  return course.items.map((item) => {
    const date = term.on(item.week, item.day);
    return {
      title: item.title,
      date,
      end_date: item.span ? addDays(date, item.span) : null,
      due_time: item.time,
      type: item.type,
    };
  });
}

// ---------------------------------------------------------------------------------------
// ASTR 1270: syllabus as PDF (and the same text as .txt for the "paste text" tab)
// ---------------------------------------------------------------------------------------

function syllabusSchedule(course, term) {
  const rows = course.items.map((item) => {
    const date = term.on(item.week, item.day);
    let detail = item.detail;
    if (!detail) detail = item.time ? `Due ${time12(item.time)}` : '';
    return { date, item: item.title, detail };
  });
  for (const note of course.notes) rows.push({ date: term.on(note.week, note.day), item: note.text, detail: '', note: true });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

function syllabusSections(course, term) {
  return {
    eyebrow: `${UNIVERSITY.toUpperCase()}  •  ${course.department}`,
    title: `${course.code}: ${course.title}`,
    meta: [`${term.name}  •  ${course.meets}`, `Instructor: ${course.instructor}  •  Office hours: ${course.officeHours}`],
    description: [
      'A survey of the planets, moons and small bodies of the solar system: how they formed, what their',
      'surfaces and atmospheres reveal, and how we study them with telescopes and spacecraft. No prior',
      'astronomy is required; comfort with high-school algebra is assumed.',
    ],
    grading: ['Problem sets 25%  •  Labs 15%  •  Reading quizzes 10%', 'Midterm exam 20%  •  Research poster 10%  •  Final exam 20%'],
    schedule: syllabusSchedule(course, term),
    policies: [
      'Problem sets and lab reports are due at the times listed and lose 10% per day late.',
      'Reading quizzes cannot be made up, but your lowest quiz score is dropped.',
      'Bring a calculator to both exams; notes and phones are not allowed.',
    ],
  };
}

function renderSyllabusPdf(course, term) {
  const s = syllabusSections(course, term);
  const page = createPdfPage();
  const left = 54;
  const right = 558;
  const muted = [95, 95, 115];
  let top = 58;

  page.rect(0, 0, 612, 6, { fill: [99, 102, 241] });
  page.text(left, top, s.eyebrow, { font: 'bold', size: 8.5, color: muted });
  top += 26;
  page.text(left, top, s.title, { font: 'bold', size: 18 });
  for (const line of s.meta) {
    top += 16;
    page.text(left, top, line, { size: 10, color: [55, 55, 70] });
  }
  top += 12;
  page.line(left, top, right, top);

  const heading = (text) => {
    top += 24;
    page.text(left, top, text, { font: 'bold', size: 11.5 });
  };
  const paragraph = (lines) => {
    for (const line of lines) {
      top += 14;
      page.text(left, top, line, { size: 9.5, color: [40, 40, 55] });
    }
  };

  heading('Course description');
  paragraph(s.description);
  heading('Grading');
  paragraph(s.grading);

  heading('Schedule');
  top += 8;
  page.rect(left, top, right - left, 16, { fill: [238, 238, 246] });
  const columns = [left + 6, left + 100, left + 330];
  ['Date', 'Item', 'Details'].forEach((label, i) => page.text(columns[i], top + 11.5, label, { font: 'bold', size: 8.5, color: muted }));
  top += 16;
  for (const row of s.schedule) {
    const style = row.note ? { font: 'italic', size: 9, color: [120, 120, 135] } : { size: 9, color: [30, 30, 40] };
    page.text(columns[0], top + 11, describeDate(row.date), style);
    page.text(columns[1], top + 11, row.item, row.note ? style : { ...style, font: 'bold' });
    page.text(columns[2], top + 11, row.detail, style);
    top += 15;
    page.line(left, top, right, top, { color: [228, 228, 236] });
  }

  heading('Policies');
  paragraph(s.policies);

  page.text(left, 756, FICTION_NOTE, { font: 'italic', size: 7.5, color: [130, 130, 145] });
  return page.toBuffer({ title: `${course.code} syllabus` });
}

function renderSyllabusText(course, term) {
  const s = syllabusSections(course, term);
  const schedule = s.schedule.map((row) => [describeDate(row.date), row.item, row.detail].filter(Boolean).join('   '));
  return [
    s.eyebrow,
    s.title,
    ...s.meta,
    '',
    'Course description',
    ...s.description,
    '',
    'Grading',
    ...s.grading,
    '',
    'Schedule',
    ...schedule,
    '',
    'Policies',
    ...s.policies,
    '',
    FICTION_NOTE,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------
// STAT 2380: course schedule as XLSX and CSV
// ---------------------------------------------------------------------------------------

function scheduleTitle(course, term) {
  return `${course.code} ${course.title}: ${term.name} schedule`;
}

async function renderScheduleXlsx(course, term) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AssignDash demo';
  workbook.created = workbook.modified = new Date(`${term.start}T00:00:00Z`); // reproducible output
  const sheet = workbook.addWorksheet('Schedule');
  sheet.columns = [{ width: 7 }, { width: 13 }, { width: 58 }, { width: 26 }, { width: 11 }];

  sheet.addRow([scheduleTitle(course, term)]).font = { bold: true, size: 13 };
  sheet.mergeCells('A1:E1');
  sheet.addRow([`${course.instructor}  •  ${course.meets}`]);
  sheet.mergeCells('A2:E2');
  sheet.addRow([]);
  sheet.addRow(['Week', 'Date', 'Topic', 'Deliverable', 'Due']).font = { bold: true };

  for (const row of course.rows) {
    const date = term.on(row.week, row.day);
    const added = sheet.addRow([
      row.week,
      new Date(`${date}T00:00:00Z`),
      row.topic,
      row.item?.title ?? '',
      row.item?.time ? time12(row.item.time) : '',
    ]);
    added.getCell(2).numFmt = 'ddd mmm d';
  }
  sheet.addRow([]);
  sheet.addRow([FICTION_NOTE]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function csvField(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderScheduleCsv(course, term) {
  const usDate = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`;
  const lines = [
    [scheduleTitle(course, term), '', '', '', ''],
    ['Week', 'Date', 'Topic', 'Deliverable', 'Due'],
    ...course.rows.map((row) => [
      row.week,
      usDate(term.on(row.week, row.day)),
      row.topic,
      row.item?.title ?? '',
      row.item?.time ? time12(row.item.time) : '',
    ]),
  ];
  return `${lines.map((fields) => fields.map(csvField).join(',')).join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------------------
// WRIT 1190: calendar export as ICS (floating local times, one all-day multi-day event)
// ---------------------------------------------------------------------------------------

const icsText = (value) => String(value).replace(/[\\;,]/g, '\\$&').replace(/\n/g, '\\n');
const icsDate = (iso) => iso.replace(/-/g, '');

function renderCalendarIcs(course, term) {
  const stamp = `${icsDate(term.start)}T000000Z`;
  const events = [
    ...course.items.map((item) => ({ ...item, date: term.on(item.week, item.day) })),
    ...course.notes.map((note) => ({ title: note.text, date: term.on(note.week, note.day), time: null })),
  ];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AssignDash//Demo calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsText(`${course.code} ${course.title}`)}`,
  ];
  events.forEach((event, index) => {
    lines.push('BEGIN:VEVENT', `UID:${course.code.replace(/\s+/g, '-').toLowerCase()}-${index + 1}`, `DTSTAMP:${stamp}`);
    if (event.time) {
      lines.push(`DTSTART:${icsDate(event.date)}T${event.time.replace(':', '')}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(event.date)}`, `DTEND;VALUE=DATE:${icsDate(addDays(event.date, (event.span ?? 0) + 1))}`);
    }
    lines.push(`SUMMARY:${icsText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${icsText(event.description)}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR', '');
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------------------

/**
 * Builds the sample files and canned extraction results for a given "today".
 */
async function buildDemoSamples({ today = localToday() } = {}) {
  const term = buildTerm(today);
  const files = [
    {
      name: 'astr-1270-syllabus.pdf',
      label: 'Syllabus (PDF)',
      contentType: 'application/pdf',
      body: renderSyllabusPdf(PLANETARY, term),
      autoload: true,
    },
    {
      name: 'stat-2380-schedule.xlsx',
      label: 'Course schedule (XLSX)',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: await renderScheduleXlsx(STATISTICS, term),
      autoload: true,
    },
    {
      name: 'writ-1190-calendar.ics',
      label: 'Calendar export (ICS)',
      contentType: 'text/calendar',
      body: Buffer.from(renderCalendarIcs(WRITING, term)),
      autoload: true,
    },
    {
      name: 'stat-2380-schedule.csv',
      label: 'Schedule as CSV',
      contentType: 'text/csv',
      body: Buffer.from(renderScheduleCsv(STATISTICS, term)),
      autoload: false,
    },
    {
      name: 'astr-1270-syllabus.txt',
      label: 'Syllabus as plain text',
      contentType: 'text/plain; charset=utf-8',
      body: Buffer.from(renderSyllabusText(PLANETARY, term)),
      autoload: false,
    },
  ];

  return {
    term,
    files,
    /** Sample courses whose course code appears in the given text. */
    coursesIn(text) {
      return COURSES.filter((course) => text.includes(course.code));
    },
    extractionFor(courses) {
      return {
        semester_name: term.name,
        semester_start: term.start,
        semester_end: term.end,
        classes: courses.map((course) => ({
          name: course.title,
          short_name: course.code,
          assignments: expectedAssignments(course, term),
        })),
      };
    },
  };
}

module.exports = { buildDemoSamples, buildTerm, COURSES };
