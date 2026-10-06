(function () {
  'use strict';

  // Every string that came from a user, an uploaded file or the model goes through esc()
  // before it is placed in an HTML template (see escape.js).
  const { esc } = window.AssignDash;

  const savedTheme = localStorage.getItem('assigndash-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  const COLOR_PALETTE = [
    { hex: '#a78bfa', rgb: '167,139,250' },
    { hex: '#34d399', rgb: '52,211,153' },
    { hex: '#60a5fa', rgb: '96,165,250' },
    { hex: '#fbbf24', rgb: '251,191,36' },
    { hex: '#f87171', rgb: '248,113,113' },
    { hex: '#fb923c', rgb: '251,146,60' },
    { hex: '#e879f9', rgb: '232,121,249' },
    { hex: '#22d3ee', rgb: '34,211,238' },
  ];

  const TODAY = new Date();
  TODAY.setHours(0, 0, 0, 0);

  let SEMESTER_ID, SEMESTER_START, SEMESTER_END, SEMESTER_NAME;
  let CLASSES = {};
  let ASSIGNMENTS = [];
  let userName = '';
  let activeFilter = 'all';
  let activeType = 'all';
  let activeView = localStorage.getItem('assigndash-default-view') || 'timeline';
  let calMonth = TODAY.getMonth();
  let calYear = TODAY.getFullYear();
  let showPast = false;
  let DEMO = false;
  const MAX_FILES = 10;
  const ACCEPTED_FILES = '.pdf,.txt,.csv,.xlsx,.ics,.png,.jpg,.jpeg,.webp';

  init();

  async function init() {
    try {
      const [meRes, configRes] = await Promise.all([fetch('/api/me'), fetch('/api/config')]);
      if (!meRes.ok) { window.location.href = '/'; return; }
      const me = await meRes.json();
      userName = me.name;
      DEMO = Boolean((await configRes.json().catch(() => ({}))).demo);
      if (DEMO) showDemoBanner();

      const dashRes = await fetch('/api/dashboard');
      const dashData = await dashRes.json();

      if (!dashData.hasSemester) {
        renderUploadFlow();
        return;
      }

      SEMESTER_ID = dashData.semester.id;
      SEMESTER_NAME = dashData.semester.name;
      SEMESTER_START = parseDate(dashData.semester.startDate);
      SEMESTER_END = parseDate(dashData.semester.endDate);
      CLASSES = dashData.classes;
      ASSIGNMENTS = dashData.assignments;

      // Planning ahead (or looking back)? Open the calendar on the semester, not an empty month.
      if (TODAY < SEMESTER_START || TODAY > SEMESTER_END) {
        calMonth = SEMESTER_START.getMonth();
        calYear = SEMESTER_START.getFullYear();
      }

      renderDashboard();
    } catch {
      window.location.href = '/';
    }
  }

  function showDemoBanner() {
    if (document.querySelector('.demo-banner')) return;
    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.textContent = 'Demo mode: sample data only. Your account and schedule are kept in memory and cleared when the server restarts.';
    document.body.prepend(banner);
  }

  function fileIcon(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) return '📄';
    if (name.endsWith('.csv') || name.endsWith('.xlsx')) return '📊';
    if (name.endsWith('.ics')) return '📅';
    if (file.type.startsWith('image/')) return '🖼️';
    return '📝';
  }

  // Demo mode only: fetch the generated sample documents as File objects.
  async function loadSampleFiles() {
    const list = await (await fetch('/demo/samples')).json();
    const files = [];
    for (const sample of list.filter((s) => s.autoload)) {
      const blob = await (await fetch(sample.url)).blob();
      files.push(new File([blob], sample.name, { type: blob.type }));
    }
    return files;
  }

  async function sampleText() {
    const list = await (await fetch('/demo/samples')).json();
    const txt = list.find((s) => s.name.endsWith('.txt'));
    return txt ? (await fetch(txt.url)).text() : '';
  }

  function demoSamplesHTML(idPrefix) {
    if (!DEMO) return '';
    return `
      <div class="demo-samples">
        <div class="demo-samples-text">
          <strong>No syllabus handy?</strong> Load three fictional sample documents: a PDF syllabus, an XLSX course schedule and an ICS calendar export.
          <a href="/demo/samples" id="${idPrefix}SampleList" class="demo-samples-links"></a>
        </div>
        <button type="button" class="btn-ghost btn-sm" id="${idPrefix}LoadSamplesBtn">Load sample files</button>
      </div>`;
  }

  function bindDemoSamples(idPrefix, addFiles) {
    if (!DEMO) return;
    const btn = document.getElementById(`${idPrefix}LoadSamplesBtn`);
    const links = document.getElementById(`${idPrefix}SampleList`);
    fetch('/demo/samples').then((r) => r.json()).then((list) => {
      const span = document.createElement('span');
      span.textContent = 'Download: ';
      list.forEach((sample, i) => {
        const a = document.createElement('a');
        a.href = sample.url;
        a.textContent = sample.name.split('.').pop().toUpperCase();
        a.title = sample.label;
        span.append(a);
        if (i < list.length - 1) span.append(' · ');
      });
      links.replaceWith(span);
    }).catch(() => {});
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Loading...';
      try {
        addFiles(await loadSampleFiles());
        btn.textContent = 'Samples added';
      } catch {
        btn.disabled = false;
        btn.textContent = 'Load sample files';
      }
    });
  }

  function getColor(classId) {
    const cls = CLASSES[classId];
    if (!cls) return COLOR_PALETTE[0];
    return COLOR_PALETTE[cls.color % COLOR_PALETTE.length];
  }

  function parseDate(str) {
    if (!str || typeof str !== 'string') return new Date(NaN);
    const parts = str.trim().split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return new Date(NaN);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  const TYPE_PRIORITY = { exam: 0, quiz: 1, due: 2, discussion: 3, conference: 4, workshop: 5, prep: 6 };

  function compareAssignments(a, b) {
    const da = parseDate(a.date), db = parseDate(b.date);
    const ta = da.getTime() || 0, tb = db.getTime() || 0;
    if (ta !== tb) return ta - tb;
    const pa = TYPE_PRIORITY[a.type] ?? 9, pb = TYPE_PRIORITY[b.type] ?? 9;
    if (pa !== pb) return pa - pb;
    return (a.title || '').localeCompare(b.title || '');
  }

  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

  function formatDate(d) {
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function weekdayShort(d) { return d.toLocaleDateString('en-US', { weekday: 'short' }); }

  function urgencyClass(days) {
    if (days <= 3) return 'urgent';
    if (days <= 7) return 'soon';
    return 'upcoming';
  }

  function formatTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h)) return '';
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return m ? `${h12}:${String(m).padStart(2,'0')} ${ampm}` : `${h12} ${ampm}`;
  }

  function countdownClass(days) {
    if (days <= 3) return 'urgent';
    if (days <= 7) return 'soon';
    return 'ok';
  }

  // ======================== UPLOAD FLOW ========================

  // `replacing` is set when starting a new semester from the dashboard: the current
  // semester stays in place until the new one has been reviewed and saved.
  function renderUploadFlow({ replacing = false } = {}) {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="upload-page">
        <header class="upload-header">
          <h1 class="logo">📚 <span class="gradient-text">AssignDash</span></h1>
          <div class="upload-header-right">
            <span class="upload-greeting">Hey, ${esc(userName)}</span>
            ${replacing ? '<button class="btn-ghost" id="backToDashBtn">Back to dashboard</button>' : ''}
            <button class="btn-ghost" id="logoutBtn">Log Out</button>
          </div>
        </header>

        <div class="upload-hero">
          <h2>${replacing ? 'Start a New Semester' : 'Upload Your Syllabi'}</h2>
          <p>${replacing
            ? 'Upload the new syllabi. Your current dashboard stays as it is until you save the new schedule.'
            : "Drop your syllabus files below and we'll build your dashboard. You'll review everything before it's saved."}</p>
        </div>

        <div class="input-tabs">
          <button class="input-tab active" data-tab="files" id="tabFiles">Upload Files</button>
          <button class="input-tab" data-tab="paste" id="tabPaste">Paste Text</button>
        </div>

        <div id="filesPane">
          <div class="upload-zone" id="uploadZone">
            <div class="upload-zone-content">
              <div class="upload-icon">📄</div>
              <p class="upload-zone-text">Drag & drop PDFs, spreadsheets (CSV, XLSX), calendar exports (ICS) or photos here</p>
              <p class="upload-zone-sub">or <button type="button" class="browse-link" id="browseBtn">browse files</button> (up to ${MAX_FILES} files)</p>
            </div>
            <input type="file" id="fileInput" multiple accept="${ACCEPTED_FILES}" style="display:none" />
          </div>
          ${demoSamplesHTML('upload')}

          <div class="file-list" id="fileList"></div>

          <button class="btn-primary upload-submit" id="uploadBtn" disabled>
            <span id="uploadBtnText">Upload & Parse Syllabi</span>
          </button>
        </div>

        <div id="pastePane" style="display:none">
          <div class="paste-actions">
            <button type="button" class="btn-ghost btn-sm" id="clipboardPasteBtn">📋 Paste from Clipboard</button>
            ${DEMO ? '<button type="button" class="btn-ghost btn-sm" id="sampleTextBtn">Insert sample text</button>' : ''}
            <button type="button" class="btn-ghost btn-sm" id="clearPasteBtn">✕ Clear</button>
          </div>
          <textarea class="paste-textarea" id="pasteInput" placeholder="Paste your syllabus schedule text here...\n\nInclude class names, assignment titles, and dates."></textarea>
          <button class="btn-primary upload-submit" id="pasteBtn" disabled>
            <span id="pasteBtnText">Parse Pasted Text</span>
          </button>
        </div>

        <div class="upload-status" id="uploadStatus"></div>

        <!-- Review step -->
        <div id="reviewSection" style="display:none">
          <div class="review-header">
            <h3>Review Extracted Schedule</h3>
            <p>Verify the data below looks correct, then save to create your dashboard.</p>
          </div>
          <div class="review-content" id="reviewContent"></div>
          <div class="review-actions">
            <button class="btn-ghost" id="reprocessBtn">Reprocess</button>
            <button class="btn-primary" id="saveBtn">Save & Create Dashboard</button>
          </div>
        </div>
      </div>
    `;

    const zone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const fileList = document.getElementById('fileList');
    const uploadBtn = document.getElementById('uploadBtn');
    const selectedFiles = [];

    document.getElementById('browseBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      addFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

    function addFiles(files) {
      for (const f of files) {
        if (selectedFiles.length < MAX_FILES) selectedFiles.push(f);
      }
      renderFileList();
    }
    bindDemoSamples('upload', addFiles);

    function renderFileList() {
      fileList.innerHTML = selectedFiles.map((f, i) => `
        <div class="file-item">
          <span class="file-item-icon">${fileIcon(f)}</span>
          <span class="file-item-name">${esc(f.name)}</span>
          <span class="file-item-size">${(f.size / 1024).toFixed(0)} KB</span>
          <button class="file-item-remove" data-idx="${i}">&times;</button>
        </div>
      `).join('');
      uploadBtn.disabled = selectedFiles.length === 0;
      fileList.querySelectorAll('.file-item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedFiles.splice(parseInt(btn.dataset.idx), 1);
          renderFileList();
        });
      });
    }

    uploadBtn.addEventListener('click', async () => {
      const btnText = document.getElementById('uploadBtnText');
      const status = document.getElementById('uploadStatus');
      uploadBtn.disabled = true;
      btnText.textContent = 'Parsing syllabi with AI...';

      const result = await parseFilesWithProgress(selectedFiles, status);

      if (result.error) {
        status.innerHTML = `<div class="status-error">${esc(result.error)}</div>`;
        uploadBtn.disabled = false;
        btnText.textContent = 'Upload & Parse Syllabi';
        return;
      }

      showReview(result.data, selectedFiles, result.warnings);
    });

    document.getElementById('tabFiles').addEventListener('click', () => {
      document.getElementById('tabFiles').classList.add('active');
      document.getElementById('tabPaste').classList.remove('active');
      document.getElementById('filesPane').style.display = '';
      document.getElementById('pastePane').style.display = 'none';
    });
    document.getElementById('tabPaste').addEventListener('click', () => {
      document.getElementById('tabPaste').classList.add('active');
      document.getElementById('tabFiles').classList.remove('active');
      document.getElementById('filesPane').style.display = 'none';
      document.getElementById('pastePane').style.display = '';
    });

    const pasteInput = document.getElementById('pasteInput');
    const pasteBtn = document.getElementById('pasteBtn');
    pasteInput.addEventListener('input', () => { pasteBtn.disabled = pasteInput.value.trim().length < 20; });

    document.getElementById('clipboardPasteBtn').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        pasteInput.value = text;
        pasteInput.dispatchEvent(new Event('input'));
        pasteInput.focus();
      } catch { pasteInput.focus(); }
    });
    document.getElementById('clearPasteBtn').addEventListener('click', () => {
      pasteInput.value = '';
      pasteInput.dispatchEvent(new Event('input'));
      pasteInput.focus();
    });
    if (DEMO) {
      document.getElementById('sampleTextBtn').addEventListener('click', async () => {
        pasteInput.value = await sampleText();
        pasteInput.dispatchEvent(new Event('input'));
      });
    }

    pasteBtn.addEventListener('click', async () => {
      const btnText = document.getElementById('pasteBtnText');
      const status = document.getElementById('uploadStatus');
      pasteBtn.disabled = true;
      btnText.textContent = 'Parsing with AI...';
      status.innerHTML = '<div class="status-loading"><div class="loading-spinner small"></div> This usually takes 10\u201320 seconds</div>';

      try {
        const r = await fetch('/api/parse-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: pasteInput.value })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        status.innerHTML = '';
        showReview(data.data, [], data.warnings);
      } catch (err) {
        status.innerHTML = `<div class="status-error">${esc(err.message)}</div>`;
        pasteBtn.disabled = false;
        btnText.textContent = 'Parse Pasted Text';
      }
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/';
    });
    if (replacing) {
      document.getElementById('backToDashBtn').addEventListener('click', () => renderDashboard());
    }
  }

  function warningsHTML(warnings) {
    if (!warnings || warnings.length === 0) return '';
    return `<div class="status-warning">${warnings.map(esc).join('<br>')}</div>`;
  }

  // One review row: everything shown here came from the model, so all of it is escaped.
  function reviewAssignmentHTML(a) {
    const when = a.due_time ? `${esc(a.date)} · ${esc(formatTime(a.due_time))}` : esc(a.date);
    const until = a.end_date ? ` → ${esc(a.end_date)}` : '';
    return `
      <div class="review-assignment">
        <span class="review-a-date">${when}${until}</span>
        <span class="review-a-title">${esc(a.title)}</span>
        <span class="tl-badge ${esc(a.type)}">${esc(a.type)}</span>
      </div>`;
  }

  function reviewClassesHTML(classes) {
    return classes.map((cls, i) => {
      const color = COLOR_PALETTE[i % COLOR_PALETTE.length];
      const sorted = [...cls.assignments].sort(compareAssignments);
      return `
        <div class="review-class">
          <div class="review-class-header" style="border-left: 3px solid ${color.hex}">
            <strong>${esc(cls.short_name && cls.short_name !== cls.name ? `${cls.short_name}: ${cls.name}` : cls.name)}</strong>
            <span class="review-class-count">${sorted.length} items</span>
          </div>
          <div class="review-assignments">${sorted.map(reviewAssignmentHTML).join('')}</div>
        </div>`;
    }).join('');
  }

  function showReview(data, files, warnings) {
    const section = document.getElementById('reviewSection');
    const content = document.getElementById('reviewContent');
    section.style.display = 'block';
    const filesPane = document.getElementById('filesPane');
    const pastePane = document.getElementById('pastePane');
    const inputTabs = document.querySelector('.input-tabs');
    if (filesPane) filesPane.style.display = 'none';
    if (pastePane) pastePane.style.display = 'none';
    if (inputTabs) inputTabs.style.display = 'none';
    const reprocessBtn = document.getElementById('reprocessBtn');
    if (reprocessBtn && (!files || files.length === 0)) reprocessBtn.style.display = 'none';

    content.innerHTML = `
      ${warningsHTML(warnings)}
      <div class="review-semester">
        <strong>${esc(data.semester_name)}</strong>
        <span class="review-dates">${esc(data.semester_start)} → ${esc(data.semester_end)}</span>
      </div>
      ${reviewClassesHTML(data.classes)}
    `;

    document.getElementById('saveBtn').onclick = async () => {
      const btn = document.getElementById('saveBtn');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      try {
        const r = await fetch('/api/save-schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        window.location.reload();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Save & Create Dashboard';
        alert('Error: ' + err.message);
      }
    };

    document.getElementById('reprocessBtn').onclick = async () => {
      const btn = document.getElementById('reprocessBtn');
      const saveBtn = document.getElementById('saveBtn');
      btn.disabled = true;
      saveBtn.disabled = true;
      btn.textContent = 'Reprocessing...';
      document.getElementById('uploadStatus').innerHTML = '';

      const progressContainer = document.getElementById('reviewContent');
      const result = await parseFilesWithProgress(files, progressContainer);

      btn.disabled = false;
      saveBtn.disabled = false;
      btn.textContent = 'Reprocess';
      if (result.error) {
        progressContainer.innerHTML = `<div class="status-error">${esc(result.error)}</div>`;
        return;
      }

      showReview(result.data, files, result.warnings);
    };
  }

  // ======================== DASHBOARD ========================

  function renderDashboard() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <header class="top-bar">
        <div class="top-bar-left">
          <h1 class="logo">📚 <span class="gradient-text">${esc(SEMESTER_NAME)}</span></h1>
          <p class="subtitle">Assignment Dashboard</p>
        </div>
        <div class="top-bar-right">
          <div class="date-display">${formatDate(TODAY)}</div>
          <div class="semester-progress">
            <span class="progress-label">Semester</span>
            <div class="progress-bar-container">
              <div class="progress-bar-fill" id="semesterProgress"></div>
            </div>
            <span class="progress-pct" id="semesterPct"></span>
          </div>
          <div class="user-menu">
            <span class="user-name">${esc(userName)}</span>
            <button class="btn-ghost btn-sm" id="exportPdfBtn" title="Export PDF">📥 Export</button>
            <button class="btn-primary btn-sm" id="addAssignmentBtn">+ Add Assignment</button>
            <button class="btn-ghost btn-sm" id="addSyllabusBtn">+ Add Syllabi</button>
            <button class="btn-ghost btn-sm" id="newUploadBtn">New Semester</button>
            <button class="btn-ghost btn-sm btn-icon" id="settingsBtn" title="Settings">⚙</button>
            <button class="btn-ghost btn-sm" id="logoutDashBtn">Log Out</button>
          </div>
        </div>
      </header>
      <section class="stats-row" id="statsRow"></section>
      <section class="filter-section">
        <div class="filter-rows">
          <div class="filter-tabs" id="filterTabs"></div>
          <div class="filter-tabs type-filters" id="typeFilters">
            <button class="type-tab active" data-type="all">All Types</button>
            <button class="type-tab" data-type="exam">Exams</button>
            <button class="type-tab" data-type="due">Assignments</button>
            <button class="type-tab" data-type="quiz">Quizzes</button>
            <button class="type-tab" data-type="discussion">Discussions</button>
            <button class="type-tab" data-type="conference">Conferences</button>
            <button class="type-tab" data-type="workshop">Workshops</button>
            <button class="type-tab" data-type="prep">Prep Work</button>
          </div>
        </div>
        <div class="view-toggle">
          <button class="view-btn ${activeView === 'timeline' ? 'active' : ''}" data-view="timeline" title="Timeline View">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <button class="view-btn ${activeView === 'calendar' ? 'active' : ''}" data-view="calendar" title="Calendar View">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </button>
          <button class="view-btn ${activeView === 'byclass' ? 'active' : ''}" data-view="byclass" title="By Class">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          </button>
        </div>
      </section>
      <section class="upcoming-spotlight" id="upcomingSpotlight"></section>
      <main class="main-content" id="mainContent"></main>
    `;

    renderSemesterProgress();
    renderFilterTabs();
    renderStats();
    renderSpotlight();
    renderMainContent();
    bindFilters();
    bindTypeFilters();
    bindViews();

    document.getElementById('logoutDashBtn').addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/';
    });

    // Nothing is deleted here: saving the new schedule replaces this one in a single
    // transaction, so abandoning the upload (or a failed save) leaves the dashboard intact.
    document.getElementById('newUploadBtn').addEventListener('click', () => {
      renderUploadFlow({ replacing: true });
    });

    document.getElementById('addAssignmentBtn').addEventListener('click', () => {
      renderAssignmentModal();
    });

    document.getElementById('addSyllabusBtn').addEventListener('click', () => {
      renderAddSyllabusModal();
    });

    document.getElementById('settingsBtn').addEventListener('click', () => {
      renderSettingsModal();
    });

    document.getElementById('exportPdfBtn').addEventListener('click', () => {
      exportPDF();
    });
  }

  function renderFilterTabs() {
    const container = document.getElementById('filterTabs');
    let html = '<button class="filter-tab active" data-filter="all">All Classes</button>';
    Object.entries(CLASSES).forEach(([key, cls]) => {
      const c = getColor(key);
      html += `<button class="filter-tab" data-filter="${esc(key)}" style="--tab-color:${c.hex}">${esc(cls.icon)} ${esc(cls.short)}</button>`;
    });
    container.innerHTML = html;
  }

  function renderSemesterProgress() {
    const total = daysBetween(SEMESTER_START, SEMESTER_END);
    const elapsed = Math.min(Math.max(daysBetween(SEMESTER_START, TODAY), 0), total);
    const pct = Math.round((elapsed / total) * 100);
    document.getElementById('semesterProgress').style.width = pct + '%';
    document.getElementById('semesterPct').textContent = pct + '%';
  }

  function getFilteredAssignments() {
    let list = [...ASSIGNMENTS];
    if (activeFilter !== 'all') list = list.filter(a => a.classId === activeFilter);
    if (activeType !== 'all') list = list.filter(a => a.type === activeType);
    return list.sort(compareAssignments);
  }

  function renderStats() {
    const filtered = getFilteredAssignments();
    const upcoming = filtered.filter(a => parseDate(a.date) >= TODAY && !a.completed);
    const past = filtered.filter(a => parseDate(a.date) < TODAY || a.completed);
    const exams = upcoming.filter(a => a.type === 'exam');

    const cards = [
      { icon: '📋', bg: 'rgba(96,165,250,0.1)', value: upcoming.length, label: 'Upcoming' },
      { icon: '✅', bg: 'rgba(52,211,153,0.1)', value: past.length, label: 'Past Events' },
      { icon: '📝', bg: 'rgba(248,113,113,0.1)', value: exams.length, label: 'Exams Left' },
    ];

    document.getElementById('statsRow').innerHTML = cards.map(c => `
      <div class="stat-card">
        <div class="stat-icon" style="background:${c.bg}">${c.icon}</div>
        <div class="stat-info">
          <div class="stat-value">${c.value}</div>
          <div class="stat-label">${c.label}</div>
        </div>
      </div>
    `).join('');
  }

  function renderSpotlight() {
    const pool = getFilteredAssignments();
    const upcoming = pool
      .filter(a => parseDate(a.date) >= TODAY && !a.completed)
      .filter(a => activeType !== 'all' || a.type === 'exam' || a.type === 'due')
      .sort(compareAssignments);

    const next = upcoming[0];
    const el = document.getElementById('upcomingSpotlight');
    if (!next) { el.innerHTML = ''; return; }

    const d = parseDate(next.date);
    const days = daysBetween(TODAY, d);
    const urg = urgencyClass(days);
    const cls = CLASSES[next.classId] || { name: 'Class', icon: '📚' };
    const c = getColor(next.classId);

    el.innerHTML = `
      <div class="spotlight-card ${urg}">
        <div class="spotlight-header">
          <span class="spotlight-label ${urg}">${days === 0 ? '🔴 Today' : days <= 3 ? '⚠️ Due Soon' : '📌 Next Up'}</span>
          <div class="spotlight-countdown">
            <div class="countdown-number ${urg}">${days === 0 ? 'TODAY' : days}</div>
            ${days > 0 ? `<div class="countdown-unit">day${days !== 1 ? 's' : ''} left</div>` : ''}
          </div>
        </div>
        <div class="spotlight-class" style="color:${c.hex}">${esc(cls.icon)} ${esc(cls.name)}</div>
        <div class="spotlight-title">${esc(next.title)}</div>
        <div class="spotlight-date">${formatDate(d)}${next.dueTime ? ` · ${formatTime(next.dueTime)}` : ''}</div>
      </div>
    `;
  }

  function bindFilters() {
    document.getElementById('filterTabs').addEventListener('click', e => {
      const tab = e.target.closest('.filter-tab');
      if (!tab) return;
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter;
      renderStats(); renderSpotlight(); renderMainContent();
    });
  }

  function bindTypeFilters() {
    document.getElementById('typeFilters').addEventListener('click', e => {
      const tab = e.target.closest('.type-tab');
      if (!tab) return;
      document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeType = tab.dataset.type;
      renderStats(); renderSpotlight(); renderMainContent();
    });
  }

  function bindViews() {
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeView = btn.dataset.view;
        renderMainContent();
      });
    });
  }

  function renderMainContent() {
    const container = document.getElementById('mainContent');
    switch (activeView) {
      case 'timeline': renderTimeline(container); break;
      case 'calendar': renderCalendar(container); break;
      case 'byclass': renderByClass(container); break;
    }
    bindCheckboxes();
    bindEditClicks();
    bindPastToggle();
  }

  // ======================== TIMELINE ========================

  function renderTimelineItem(a) {
    const d = parseDate(a.date);
    const days = daysBetween(TODAY, d);
    const isPast = days < 0;
    const isToday = days === 0;
    const cls = CLASSES[a.classId] || { short: '?', icon: '📚' };
    const c = getColor(a.classId);

    return `
      <div class="timeline-item ${isToday ? 'today' : ''} ${a.completed ? 'completed' : ''}" style="--item-color:${c.hex};--item-rgb:${c.rgb}">
        <div class="tl-date">
          <div class="tl-date-day">${d.getDate()}</div>
          <div class="tl-date-weekday">${weekdayShort(d)}</div>
        </div>
        <div class="tl-dot-container">
          <div class="tl-dot" style="background:${c.hex};box-shadow:0 0 8px rgba(${c.rgb},0.4)"></div>
        </div>
        <div class="tl-content" data-aid="${esc(a.id)}" style="cursor:pointer">
          <div class="tl-class" style="color:${c.hex}">${esc(cls.short)}</div>
          <div class="tl-title">${esc(a.title)}</div>
          <div class="tl-meta">
            <span class="tl-badge ${esc(a.type)}">${esc(a.type)}</span>
            ${a.dueTime ? `<span class="tl-time">${formatTime(a.dueTime)}</span>` : ''}
            ${a.endDate ? `<span style="font-size:0.7rem;color:var(--text-dim)">→ ${parseDate(a.endDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>` : ''}
          </div>
        </div>
        <button class="tl-check ${a.completed ? 'checked' : ''}" data-id="${esc(a.id)}" title="Mark complete" aria-label="Mark complete"></button>
        ${!isPast ? `<div class="tl-countdown">
              <div class="tl-countdown-num ${countdownClass(days)}">${isToday ? 'Today' : days + 'd'}</div>
              <div class="tl-countdown-label">${isToday ? '⚡' : 'remaining'}</div>
            </div>` : ''}
      </div>`;
  }

  function renderTimeline(container) {
    const items = getFilteredAssignments();
    if (!items.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">No assignments for this filter</div></div>';
      return;
    }
    const upcomingItems = items.filter(a => parseDate(a.date) >= TODAY && !a.completed);
    const pastItems = items.filter(a => parseDate(a.date) < TODAY || a.completed);
    let html = '<div class="timeline">';

    if (pastItems.length > 0) {
      html += `<div class="past-toggle-section">
        <button class="past-toggle-btn" id="pastToggleBtn">
          <svg class="past-toggle-chevron ${showPast ? 'open' : ''}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          <span>Past Events</span>
          <span class="past-toggle-count">${pastItems.length}</span>
        </button>
        <div class="past-events-container ${showPast ? 'open' : ''}" id="pastEventsContainer">`;
      groupByMonth(pastItems).forEach(([label, items]) => {
        html += `<div class="timeline-month"><div class="month-header">${label}</div>`;
        items.forEach(a => { html += renderTimelineItem(a); });
        html += '</div>';
      });
      html += '</div></div>';
    }

    if (upcomingItems.length > 0) {
      groupByMonth(upcomingItems).forEach(([label, items]) => {
        html += `<div class="timeline-month"><div class="month-header">${label}</div>`;
        items.forEach(a => { html += renderTimelineItem(a); });
        html += '</div>';
      });
    } else {
      html += '<div class="empty-state"><div class="empty-state-icon">🎉</div><div class="empty-state-text">No more upcoming assignments!</div></div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  function groupByMonth(items) {
    const groups = {};
    items.forEach(a => {
      const d = parseDate(a.date);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    });
    return Object.keys(groups).sort().map(key => {
      const [y, m] = key.split('-').map(Number);
      return [new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), groups[key]];
    });
  }

  // ======================== CALENDAR ========================

  function renderCalendar(container) {
    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startWeekday = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const monthLabel = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const eventsByDay = {};
    getFilteredAssignments().forEach(a => {
      const start = parseDate(a.date);
      const end = a.endDate && !isNaN(parseDate(a.endDate)) ? parseDate(a.endDate) : start;
      if (isNaN(start) || end < firstDay || start > lastDay) return;
      // Multi-day items (a conference window, a poster session) show on every day they cover.
      for (let d = new Date(Math.max(start, firstDay)); d <= end && d <= lastDay; d.setDate(d.getDate() + 1)) {
        (eventsByDay[d.getDate()] ||= []).push(a);
      }
    });

    let html = `
      <div class="cal-nav">
        <button class="cal-nav-btn" id="calPrev">← Prev</button>
        <div class="cal-month-label">${monthLabel}</div>
        <button class="cal-nav-btn" id="calNext">Next →</button>
      </div>
      <div class="calendar-grid">
        <div class="cal-header">Sun</div><div class="cal-header">Mon</div><div class="cal-header">Tue</div>
        <div class="cal-header">Wed</div><div class="cal-header">Thu</div><div class="cal-header">Fri</div><div class="cal-header">Sat</div>`;

    for (let i = 0; i < startWeekday; i++) html += '<div class="cal-day empty"></div>';

    for (let d = 1; d <= daysInMonth; d++) {
      const thisDate = new Date(calYear, calMonth, d);
      const isToday = thisDate.getTime() === TODAY.getTime();
      const isPast = thisDate < TODAY;
      const events = eventsByDay[d] || [];
      html += `<div class="cal-day ${isToday ? 'today' : ''} ${isPast && !isToday ? 'past' : ''}">
        <div class="cal-day-num">${d}</div>
        ${events.map(e => {
          const c = getColor(e.classId);
          const cls = CLASSES[e.classId] || { short: '?' };
          const timeStr = e.dueTime ? ' @ ' + formatTime(e.dueTime) : '';
          return `<div class="cal-event" data-aid="${esc(e.id)}" style="background:rgba(${c.rgb},0.08);color:${c.hex};border-left:2px solid ${c.hex};cursor:pointer" title="${esc(`${cls.short}: ${e.title}${timeStr}`)}"><span class="cal-event-label">${esc(e.title)}</span><span class="cal-event-detail">${esc(cls.short)}: ${esc(e.title)}${e.dueTime ? ' · ' + formatTime(e.dueTime) : ''}</span>${e.dueTime ? '<span class="cal-event-time">' + formatTime(e.dueTime) + '</span>' : ''}</div>`;
        }).join('')}
      </div>`;
    }

    html += '</div>';
    container.innerHTML = html;

    document.getElementById('calPrev').addEventListener('click', () => {
      calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar(container);
    });
    document.getElementById('calNext').addEventListener('click', () => {
      calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar(container);
    });

    container.querySelectorAll('.cal-day:not(.empty)').forEach(day => {
      day.addEventListener('click', (e) => {
        if (e.target.closest('.cal-event')) return;
        const wasExpanded = day.classList.contains('expanded');
        container.querySelectorAll('.cal-day.expanded').forEach(d => d.classList.remove('expanded'));
        if (!wasExpanded && day.querySelectorAll('.cal-event').length > 0) {
          day.classList.add('expanded');
        }
      });
    });
  }

  // ======================== BY CLASS ========================

  function renderByClass(container) {
    const classIds = activeFilter === 'all' ? Object.keys(CLASSES) : [activeFilter];
    let html = '<div class="class-grid">';

    classIds.forEach(cid => {
      const cls = CLASSES[cid];
      if (!cls) return;
      const c = getColor(cid);
      let allItems = ASSIGNMENTS.filter(a => a.classId === cid);
      if (activeType !== 'all') allItems = allItems.filter(a => a.type === activeType);
      allItems.sort(compareAssignments);
      const upcomingItems = allItems.filter(a => parseDate(a.date) >= TODAY && !a.completed);
      const pastItems = allItems.filter(a => parseDate(a.date) < TODAY || a.completed);

      html += `
        <div class="class-card">
          <div class="class-card-header" style="--card-color:${c.hex}">
            <div class="class-card-name">${esc(cls.icon)} ${esc(cls.name)}</div>
            <div class="class-card-sub">${upcomingItems.length} upcoming · ${pastItems.length} past</div>
          </div>
          <div class="class-card-body">`;

      upcomingItems.forEach(a => {
        const d = parseDate(a.date);
        html += `<div class="class-item">
          <button class="tl-check ${a.completed ? 'checked' : ''}" data-id="${esc(a.id)}" title="Mark complete" aria-label="Mark complete" style="width:16px;height:16px;min-width:16px"></button>
          <div class="class-item-info" data-aid="${esc(a.id)}" style="cursor:pointer">
            <div class="class-item-title">${esc(a.title)}</div>
            <div class="class-item-date">${d.toLocaleDateString('en-US',{month:'short',day:'numeric'})}${a.dueTime ? ' · ' + formatTime(a.dueTime) : ''}</div>
          </div>
          <span class="class-item-badge tl-badge ${esc(a.type)}">${esc(a.type)}</span>
        </div>`;
      });

      if (pastItems.length > 0) {
        html += `<div class="class-past-section">
          <button class="class-past-toggle" data-target="past-${esc(cid)}">
            <svg class="past-toggle-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            <span>${pastItems.length} past event${pastItems.length !== 1 ? 's' : ''}</span>
          </button>
          <div class="class-past-items" id="past-${esc(cid)}" style="display:none;">`;
        pastItems.forEach(a => {
          const d = parseDate(a.date);
          html += `<div class="class-item past">
            <button class="tl-check ${a.completed ? 'checked' : ''}" data-id="${esc(a.id)}" title="Mark complete" aria-label="Mark complete" style="width:16px;height:16px;min-width:16px"></button>
            <div class="class-item-info" data-aid="${esc(a.id)}" style="cursor:pointer">
              <div class="class-item-title">${esc(a.title)}</div>
              <div class="class-item-date">${d.toLocaleDateString('en-US',{month:'short',day:'numeric'})}${a.dueTime ? ' · ' + formatTime(a.dueTime) : ''}</div>
            </div>
            <span class="class-item-badge tl-badge ${esc(a.type)}">${esc(a.type)}</span>
          </div>`;
        });
        html += '</div></div>';
      }
      html += '</div></div>';
    });

    html += '</div>';
    container.innerHTML = html;

    document.querySelectorAll('.class-past-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        const chevron = btn.querySelector('.past-toggle-chevron');
        const isHidden = target.style.display === 'none';
        target.style.display = isHidden ? 'block' : 'none';
        chevron.classList.toggle('open', isHidden);
      });
    });
  }

  // ======================== INTERACTIONS ========================

  function bindPastToggle() {
    const btn = document.getElementById('pastToggleBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      showPast = !showPast;
      btn.querySelector('.past-toggle-chevron').classList.toggle('open', showPast);
      document.getElementById('pastEventsContainer').classList.toggle('open', showPast);
    });
  }

  function bindCheckboxes() {
    document.querySelectorAll('.tl-check').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        const assignment = ASSIGNMENTS.find(a => a.id === id);
        if (!assignment) return;
        assignment.completed = !assignment.completed;
        refreshDashboard();
        try {
          const r = await fetch('/api/toggle-complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignmentId: id, completed: assignment.completed })
          });
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not save that change.');
        } catch (err) {
          assignment.completed = !assignment.completed; // undo the optimistic update
          refreshDashboard();
          alert('Error: ' + err.message);
        }
      });
    });
  }

  // ======================== PER-FILE PARSING WITH PROGRESS ========================

  // Two files about the same course (a PDF syllabus and its schedule spreadsheet, say) are
  // shown as one class, the same way the server will save them.
  function mergeClassesByName(target, incoming) {
    const key = (a) => `${a.date}|${a.title.toLowerCase()}`;
    for (const cls of incoming) {
      const match = target.find(c => c.name.trim().toLowerCase() === cls.name.trim().toLowerCase());
      if (!match) {
        target.push({ ...cls, assignments: [...cls.assignments] });
        continue;
      }
      const seen = new Set(match.assignments.map(key));
      for (const a of cls.assignments) {
        if (!seen.has(key(a))) {
          seen.add(key(a));
          match.assignments.push(a);
        }
      }
    }
  }

  function buildProgressHTML(files) {
    let html = `<div class="parse-progress">
      <div class="parse-progress-header">
        <span class="parse-progress-header-text">Processing syllabi...</span>
        <span class="parse-progress-count">0 of ${files.length}</span>
      </div>
      <div class="parse-progress-bar">
        <div class="parse-progress-fill" style="width:0%"></div>
      </div>
      <div class="parse-progress-files">`;

    for (let i = 0; i < files.length; i++) {
      html += `<div class="parse-file pending" data-file="${i}"><span class="parse-file-icon">○</span> ${esc(files[i].name)}</div>`;
    }

    html += '</div></div>';
    return html;
  }

  async function parseFilesWithProgress(files, statusEl) {
    const total = files.length;
    let completedFiles = 0;
    const allClasses = [];
    let semesterData = null;
    const fileResults = [];
    const warnings = [];
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    statusEl.innerHTML = buildProgressHTML(files);

    const progressFill = statusEl.querySelector('.parse-progress-fill');
    const progressCount = statusEl.querySelector('.parse-progress-count');
    const headerText = statusEl.querySelector('.parse-progress-header-text');
    let smoothInterval;

    for (let i = 0; i < files.length; i++) {
      const fileEl = statusEl.querySelector(`[data-file="${i}"]`);
      if (fileEl) {
        fileEl.className = 'parse-file active';
        fileEl.innerHTML = `<div class="loading-spinner tiny"></div> ${esc(files[i].name)}`;
      }

      const segStart = (completedFiles / total) * 100;
      const segEnd = ((completedFiles + 1) / total) * 100;
      const startTime = Date.now();
      const estMs = 15000;

      smoothInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / estMs, 0.92);
        const pct = segStart + (segEnd - segStart) * progress;
        if (progressFill) progressFill.style.width = pct + '%';
      }, 300);

      const fd = new FormData();
      fd.append('files', files[i]);
      if (timeZone) fd.append('timezone', timeZone); // converts UTC times in calendar exports

      try {
        const r = await fetch('/api/upload-syllabus', { method: 'POST', body: fd });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);

        const classes = data.data.classes || [];
        const totalItems = classes.reduce((sum, c) => sum + (c.assignments?.length || 0), 0);

        if (!semesterData) {
          semesterData = {
            semester_name: data.data.semester_name,
            semester_start: data.data.semester_start,
            semester_end: data.data.semester_end,
          };
        } else {
          if (data.data.semester_start < semesterData.semester_start)
            semesterData.semester_start = data.data.semester_start;
          if (data.data.semester_end > semesterData.semester_end)
            semesterData.semester_end = data.data.semester_end;
        }

        mergeClassesByName(allClasses, classes);
        warnings.push(...(data.warnings || []));
        completedFiles++;
        fileResults.push({ status: 'done' });

        if (fileEl) {
          fileEl.className = 'parse-file done';
          fileEl.innerHTML = `<span class="parse-file-icon">✓</span> ${esc(files[i].name)}<span class="parse-file-detail">${classes.length} class${classes.length !== 1 ? 'es' : ''}, ${totalItems} item${totalItems !== 1 ? 's' : ''}</span>`;
        }
      } catch (err) {
        completedFiles++;
        fileResults.push({ status: 'error', message: err.message });

        if (fileEl) {
          fileEl.className = 'parse-file error';
          fileEl.innerHTML = `<span class="parse-file-icon">✕</span> ${esc(files[i].name)}<span class="parse-file-detail">${esc(err.message)}</span>`;
        }
      }

      clearInterval(smoothInterval);
      const actualPct = Math.round((completedFiles / total) * 100);
      if (progressFill) progressFill.style.width = actualPct + '%';
      if (progressCount) progressCount.textContent = `${completedFiles} of ${total}`;
    }

    if (headerText) headerText.textContent = 'Processing complete';

    if (allClasses.length === 0) {
      const errorMsgs = fileResults.filter(r => r.status === 'error').map(r => r.message);
      return { error: 'Could not extract any classes from the uploaded files.' + (errorMsgs.length ? ' ' + errorMsgs.join(' ') : '') };
    }

    for (const r of fileResults) if (r.status === 'error') warnings.push(r.message);
    return { data: { ...semesterData, classes: allClasses }, warnings };
  }

  // ======================== ASSIGNMENT MODAL ========================

  function refreshDashboard() {
    renderStats();
    renderSpotlight();
    renderMainContent();
  }

  function renderAssignmentModal(existingAssignment) {
    const existing = document.getElementById('assignmentModal');
    if (existing) existing.remove();

    const isEdit = !!existingAssignment;
    const classEntries = Object.entries(CLASSES);
    const types = ['due', 'exam', 'quiz', 'discussion', 'conference', 'workshop', 'prep'];

    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    modal.id = 'assignmentModal';
    modal.innerHTML = `
      <div class="modal-card" style="max-width:480px">
        <button class="modal-close" id="closeAssignmentModal">&times;</button>
        <h3 class="settings-title">${isEdit ? 'Edit Assignment' : 'Add Assignment'}</h3>
        <form id="assignmentForm" class="auth-form">
          <div class="form-group">
            <label>Class</label>
            <select id="asgClassSelect" class="setting-select" style="width:100%" ${isEdit ? 'disabled' : ''}>
              ${classEntries.map(([key, cls]) => `<option value="${esc(cls.dbId)}" ${isEdit && existingAssignment.classId === key ? 'selected' : ''}>${esc(cls.icon)} ${esc(cls.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Title</label>
            <input type="text" id="asgTitle" value="${isEdit ? esc(existingAssignment.title) : ''}" placeholder="e.g. Midterm Exam" maxlength="300" required />
          </div>
          <div class="form-row-2">
            <div class="form-group">
              <label>Date</label>
              <input type="date" id="asgDate" value="${isEdit ? esc(existingAssignment.date) : ''}" required />
            </div>
            <div class="form-group">
              <label>Time Due <span style="color:var(--text-dim);font-weight:400">(optional)</span></label>
              <input type="time" id="asgTime" value="${isEdit && existingAssignment.dueTime ? esc(existingAssignment.dueTime) : ''}" />
            </div>
          </div>
          <div class="form-group">
            <label>Type</label>
            <select id="asgType" class="setting-select" style="width:100%">
              ${types.map(t => `<option value="${t}" ${isEdit && existingAssignment.type === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
            </select>
          </div>
          <div class="asg-modal-actions">
            ${isEdit ? '<button type="button" class="btn-danger" id="asgDeleteBtn">Delete</button>' : '<span></span>'}
            <button type="submit" class="btn-primary">${isEdit ? 'Save Changes' : 'Add Assignment'}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('closeAssignmentModal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    document.getElementById('assignmentForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = isEdit ? 'Saving...' : 'Adding...';

      const payload = {
        title: document.getElementById('asgTitle').value.trim(),
        date: document.getElementById('asgDate').value,
        type: document.getElementById('asgType').value,
        end_date: null,
        due_time: document.getElementById('asgTime').value || null,
      };

      try {
        if (isEdit) {
          const r = await fetch(`/api/assignment/${existingAssignment.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const result = await r.json();
          if (!r.ok) throw new Error(result.error);

          const a = ASSIGNMENTS.find(x => x.id === existingAssignment.id);
          if (a) { a.title = payload.title; a.date = payload.date; a.type = payload.type; a.endDate = null; a.dueTime = payload.due_time; }
        } else {
          payload.classId = parseInt(document.getElementById('asgClassSelect').value);
          const r = await fetch('/api/assignment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const result = await r.json();
          if (!r.ok) throw new Error(result.error);
          ASSIGNMENTS.push(result.assignment);
        }
        modal.remove();
        refreshDashboard();
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Save Changes' : 'Add Assignment';
        alert('Error: ' + err.message);
      }
    });

    if (isEdit) {
      document.getElementById('asgDeleteBtn').addEventListener('click', async () => {
        if (!confirm('Delete this assignment?')) return;
        const btn = document.getElementById('asgDeleteBtn');
        btn.disabled = true;
        btn.textContent = 'Deleting...';
        try {
          const r = await fetch(`/api/assignment/${existingAssignment.id}`, { method: 'DELETE' });
          const result = await r.json();
          if (!r.ok) throw new Error(result.error);
          const idx = ASSIGNMENTS.findIndex(x => x.id === existingAssignment.id);
          if (idx !== -1) ASSIGNMENTS.splice(idx, 1);
          modal.remove();
          refreshDashboard();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Delete';
          alert('Error: ' + err.message);
        }
      });
    }
  }

  function bindEditClicks() {
    document.querySelectorAll('.tl-content[data-aid]').forEach(el => {
      el.addEventListener('click', () => {
        const a = ASSIGNMENTS.find(x => x.id === parseInt(el.dataset.aid));
        if (a) renderAssignmentModal(a);
      });
    });
    document.querySelectorAll('.class-item-info[data-aid]').forEach(el => {
      el.addEventListener('click', () => {
        const a = ASSIGNMENTS.find(x => x.id === parseInt(el.dataset.aid));
        if (a) renderAssignmentModal(a);
      });
    });
    document.querySelectorAll('.cal-event[data-aid]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = ASSIGNMENTS.find(x => x.id === parseInt(el.dataset.aid));
        if (a) renderAssignmentModal(a);
      });
    });
  }

  // ======================== ADD SYLLABUS MODAL ========================

  function renderAddSyllabusModal() {
    const existing = document.getElementById('addSyllabusModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    modal.id = 'addSyllabusModal';
    modal.innerHTML = `
      <div class="modal-card modal-lg">
        <button class="modal-close" id="closeAddModal">&times;</button>
        <div class="upload-hero" style="margin-bottom:24px">
          <h2 style="font-size:1.3rem">Add More Syllabi</h2>
          <p>Upload more syllabus files. Classes with the same name are merged; new ones are added.</p>
        </div>

        <div class="input-tabs">
          <button class="input-tab active" data-tab="files" id="addTabFiles">Upload Files</button>
          <button class="input-tab" data-tab="paste" id="addTabPaste">Paste Text</button>
        </div>

        <div id="addFilesPane">
          <div class="upload-zone" id="addUploadZone">
            <div class="upload-zone-content">
              <div class="upload-icon">📄</div>
              <p class="upload-zone-text">Drag & drop PDFs, spreadsheets (CSV, XLSX), calendar exports (ICS) or photos here</p>
              <p class="upload-zone-sub">or <button type="button" class="browse-link" id="addBrowseBtn">browse files</button> (up to ${MAX_FILES} files)</p>
            </div>
            <input type="file" id="addFileInput" multiple accept="${ACCEPTED_FILES}" style="display:none" />
          </div>
          ${demoSamplesHTML('add')}

          <div class="file-list" id="addFileList"></div>

          <button class="btn-primary upload-submit" id="addUploadBtn" disabled>
            <span id="addUploadBtnText">Upload & Parse Syllabi</span>
          </button>
        </div>

        <div id="addPastePane" style="display:none">
          <div class="paste-actions">
            <button type="button" class="btn-ghost btn-sm" id="addClipboardPasteBtn">📋 Paste from Clipboard</button>
            <button type="button" class="btn-ghost btn-sm" id="addClearPasteBtn">✕ Clear</button>
          </div>
          <textarea class="paste-textarea" id="addPasteInput" placeholder="Paste your syllabus schedule text here...\n\nInclude class names, assignment titles, and dates."></textarea>
          <button class="btn-primary upload-submit" id="addPasteBtn" disabled>
            <span id="addPasteBtnText">Parse Pasted Text</span>
          </button>
        </div>

        <div class="upload-status" id="addUploadStatus"></div>

        <div id="addReviewSection" style="display:none">
          <div class="review-header">
            <h3>Review Extracted Schedule</h3>
            <p>These items will be added to your current dashboard.</p>
          </div>
          <div class="review-content" id="addReviewContent"></div>
          <div class="review-actions">
            <button class="btn-ghost" id="addReprocessBtn">Reprocess</button>
            <button class="btn-primary" id="addSaveBtn">Add to Dashboard</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const zone = document.getElementById('addUploadZone');
    const fileInput = document.getElementById('addFileInput');
    const fileList = document.getElementById('addFileList');
    const uploadBtn = document.getElementById('addUploadBtn');
    const selectedFiles = [];

    document.getElementById('closeAddModal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    document.getElementById('addBrowseBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      addFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

    function addFiles(files) {
      for (const f of files) {
        if (selectedFiles.length < MAX_FILES) selectedFiles.push(f);
      }
      renderList();
    }
    bindDemoSamples('add', addFiles);

    function renderList() {
      fileList.innerHTML = selectedFiles.map((f, i) => `
        <div class="file-item">
          <span class="file-item-icon">${fileIcon(f)}</span>
          <span class="file-item-name">${esc(f.name)}</span>
          <span class="file-item-size">${(f.size / 1024).toFixed(0)} KB</span>
          <button class="file-item-remove" data-idx="${i}">&times;</button>
        </div>
      `).join('');
      uploadBtn.disabled = selectedFiles.length === 0;
      fileList.querySelectorAll('.file-item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedFiles.splice(parseInt(btn.dataset.idx), 1);
          renderList();
        });
      });
    }

    uploadBtn.addEventListener('click', async () => {
      const btnText = document.getElementById('addUploadBtnText');
      const status = document.getElementById('addUploadStatus');
      uploadBtn.disabled = true;
      btnText.textContent = 'Parsing syllabi with AI...';

      const result = await parseFilesWithProgress(selectedFiles, status);

      if (result.error) {
        status.innerHTML = `<div class="status-error">${esc(result.error)}</div>`;
        uploadBtn.disabled = false;
        btnText.textContent = 'Upload & Parse Syllabi';
        return;
      }

      showAddReview(result.data, modal, selectedFiles, result.warnings);
    });

    document.getElementById('addTabFiles').addEventListener('click', () => {
      document.getElementById('addTabFiles').classList.add('active');
      document.getElementById('addTabPaste').classList.remove('active');
      document.getElementById('addFilesPane').style.display = '';
      document.getElementById('addPastePane').style.display = 'none';
    });
    document.getElementById('addTabPaste').addEventListener('click', () => {
      document.getElementById('addTabPaste').classList.add('active');
      document.getElementById('addTabFiles').classList.remove('active');
      document.getElementById('addFilesPane').style.display = 'none';
      document.getElementById('addPastePane').style.display = '';
    });

    const addPasteInput = document.getElementById('addPasteInput');
    const addPasteBtn = document.getElementById('addPasteBtn');
    addPasteInput.addEventListener('input', () => { addPasteBtn.disabled = addPasteInput.value.trim().length < 20; });

    document.getElementById('addClipboardPasteBtn').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        addPasteInput.value = text;
        addPasteInput.dispatchEvent(new Event('input'));
        addPasteInput.focus();
      } catch { addPasteInput.focus(); }
    });
    document.getElementById('addClearPasteBtn').addEventListener('click', () => {
      addPasteInput.value = '';
      addPasteInput.dispatchEvent(new Event('input'));
      addPasteInput.focus();
    });

    addPasteBtn.addEventListener('click', async () => {
      const btnText = document.getElementById('addPasteBtnText');
      const status = document.getElementById('addUploadStatus');
      addPasteBtn.disabled = true;
      btnText.textContent = 'Parsing with AI...';
      status.innerHTML = '<div class="status-loading"><div class="loading-spinner small"></div> This usually takes 10\u201320 seconds</div>';

      try {
        const r = await fetch('/api/parse-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: addPasteInput.value })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        status.innerHTML = '';
        showAddReview(data.data, modal, [], data.warnings);
      } catch (err) {
        status.innerHTML = `<div class="status-error">${esc(err.message)}</div>`;
        addPasteBtn.disabled = false;
        btnText.textContent = 'Parse Pasted Text';
      }
    });
  }

  function showAddReview(data, modal, files, warnings) {
    const section = document.getElementById('addReviewSection');
    const content = document.getElementById('addReviewContent');
    section.style.display = 'block';
    const addFilesPane = document.getElementById('addFilesPane');
    const addPastePane = document.getElementById('addPastePane');
    const addInputTabs = modal.querySelector('.input-tabs');
    if (addFilesPane) addFilesPane.style.display = 'none';
    if (addPastePane) addPastePane.style.display = 'none';
    if (addInputTabs) addInputTabs.style.display = 'none';
    const addReprocessBtn = document.getElementById('addReprocessBtn');
    if (addReprocessBtn && (!files || files.length === 0)) addReprocessBtn.style.display = 'none';

    content.innerHTML = warningsHTML(warnings) + reviewClassesHTML(data.classes);

    document.getElementById('addSaveBtn').onclick = async () => {
      const btn = document.getElementById('addSaveBtn');
      btn.disabled = true;
      btn.textContent = 'Adding...';
      try {
        const r = await fetch('/api/add-to-schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        modal.remove();
        window.location.reload();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Add to Dashboard';
        alert('Error: ' + err.message);
      }
    };

    document.getElementById('addReprocessBtn').onclick = async () => {
      const btn = document.getElementById('addReprocessBtn');
      const saveBtn = document.getElementById('addSaveBtn');
      btn.disabled = true;
      saveBtn.disabled = true;
      btn.textContent = 'Reprocessing...';
      document.getElementById('addUploadStatus').innerHTML = '';

      const progressContainer = document.getElementById('addReviewContent');
      const result = await parseFilesWithProgress(files, progressContainer);

      btn.disabled = false;
      saveBtn.disabled = false;
      btn.textContent = 'Reprocess';
      if (result.error) {
        progressContainer.innerHTML = `<div class="status-error">${esc(result.error)}</div>`;
        return;
      }

      showAddReview(result.data, modal, files, result.warnings);
    };
  }

  // ======================== EXPORT PDF ========================

  function exportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 16;
    const contentWidth = pageWidth - margin * 2;
    let y = 0;

    doc.setFillColor(26, 26, 46);
    doc.rect(0, 0, pageWidth, 42, 'F');

    const gradientColors = [[167, 139, 250], [96, 165, 250], [52, 211, 153]];
    const segW = pageWidth / gradientColors.length;
    gradientColors.forEach((c, i) => {
      doc.setFillColor(...c);
      doc.rect(i * segW, 42, segW, 1.5, 'F');
    });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.text('AssignDash', margin, 20);

    doc.setFontSize(12);
    doc.setTextColor(167, 139, 250);
    doc.text(SEMESTER_NAME, margin, 32);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(136, 136, 160);
    const startStr = SEMESTER_START.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const endStr = SEMESTER_END.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    doc.text(`${startStr}  -  ${endStr}`, pageWidth - margin, 32, { align: 'right' });

    y = 52;

    const allAssignments = [...ASSIGNMENTS].sort(compareAssignments);
    const upcoming = allAssignments.filter(a => parseDate(a.date) >= TODAY);
    const completed = allAssignments.filter(a => a.completed);

    doc.setFontSize(9);
    doc.setTextColor(100, 100, 120);
    doc.text(
      `Total: ${allAssignments.length}   |   Upcoming: ${upcoming.length}   |   Completed: ${completed.length}   |   Generated: ${new Date().toLocaleDateString('en-US')}`,
      margin, y
    );
    y += 10;

    const classIds = Object.keys(CLASSES);
    classIds.forEach(cid => {
      const cls = CLASSES[cid];
      const c = getColor(cid);
      const classAssignments = allAssignments.filter(a => a.classId === cid);
      if (classAssignments.length === 0) return;

      if (y > pageHeight - 40) {
        doc.addPage();
        y = margin;
      }

      const [r, g, b] = c.rgb.split(',').map(Number);
      doc.setFillColor(r, g, b);
      doc.roundedRect(margin, y, contentWidth, 9, 1.5, 1.5, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(255, 255, 255);
      doc.text(`${cls.short}: ${cls.name}`, margin + 4, y + 6.2);

      doc.setFontSize(8);
      doc.text(`${classAssignments.length} items`, pageWidth - margin - 4, y + 6.2, { align: 'right' });

      y += 13;

      const sortedClassAssignments = [...classAssignments].sort(compareAssignments);
      const tableData = sortedClassAssignments.map(a => {
        const d = parseDate(a.date);
        const days = isNaN(d.getTime()) ? -999 : daysBetween(TODAY, d);
        let status;
        if (a.completed) status = 'Done';
        else if (days === -999) status = '—';
        else if (days < 0) status = 'Past';
        else if (days === 0) status = 'Today';
        else status = days + 'd left';

        const dateStr = isNaN(d.getTime()) ? a.date : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = a.dueTime ? ' ' + formatTime(a.dueTime) : '';
        return [
          dateStr + timeStr,
          a.title,
          a.type.charAt(0).toUpperCase() + a.type.slice(1),
          status
        ];
      });

      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Date', 'Title', 'Type', 'Status']],
        body: tableData,
        theme: 'plain',
        styles: {
          fontSize: 8.5,
          cellPadding: { top: 2.8, bottom: 2.8, left: 3, right: 3 },
          textColor: [60, 60, 80],
          lineColor: [220, 220, 230],
          lineWidth: 0.2,
          font: 'helvetica',
        },
        headStyles: {
          fillColor: [245, 245, 248],
          textColor: [80, 80, 100],
          fontStyle: 'bold',
          fontSize: 7.5,
        },
        columnStyles: {
          0: { cellWidth: 34 },
          2: { cellWidth: 24 },
          3: { cellWidth: 22 },
        },
        alternateRowStyles: {
          fillColor: [250, 250, 253],
        },
        didParseCell: function(data) {
          if (data.section === 'body' && data.column.index === 3) {
            const val = data.cell.raw;
            if (val === 'Done') data.cell.styles.textColor = [52, 211, 153];
            else if (val === 'Today') data.cell.styles.textColor = [248, 113, 113];
            else if (val === 'Past') data.cell.styles.textColor = [160, 160, 180];
            else data.cell.styles.textColor = [251, 191, 36];
          }
          if (data.section === 'body' && data.column.index === 2) {
            const t = data.cell.raw.toLowerCase();
            if (t === 'exam') data.cell.styles.textColor = [248, 113, 113];
            else if (t === 'quiz') data.cell.styles.textColor = [96, 165, 250];
            else if (t === 'due') data.cell.styles.textColor = [251, 191, 36];
            else if (t === 'conference') data.cell.styles.textColor = [167, 139, 250];
            else if (t === 'discussion') data.cell.styles.textColor = [251, 146, 60];
            else if (t === 'workshop') data.cell.styles.textColor = [52, 211, 153];
          }
        }
      });

      y = doc.lastAutoTable.finalY + 10;
    });

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 170);
      doc.text('AssignDash - Assignment Dashboard', margin, pageHeight - 8);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
    }

    const filename = SEMESTER_NAME.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_');
    doc.save(`${filename}_Schedule.pdf`);
  }

  // ======================== SETTINGS MODAL ========================

  function renderSettingsModal() {
    const existing = document.getElementById('settingsModal');
    if (existing) existing.remove();

    const currentTheme = localStorage.getItem('assigndash-theme') || 'dark';
    const savedView = localStorage.getItem('assigndash-default-view') || 'timeline';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    modal.id = 'settingsModal';
    modal.innerHTML = `
      <div class="modal-card" style="max-width:480px">
        <button class="modal-close" id="closeSettingsBtn">&times;</button>
        <h3 class="settings-title">Settings</h3>

        <div class="settings-section">
          <div class="settings-section-title">Appearance</div>
          <div class="setting-row">
            <div class="setting-label">
              <div class="setting-name">Theme</div>
              <div class="setting-desc">Switch between dark and light mode</div>
            </div>
            <div class="theme-switch">
              <button class="theme-option ${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark">🌙 Dark</button>
              <button class="theme-option ${currentTheme === 'light' ? 'active' : ''}" data-theme="light">☀️ Light</button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Preferences</div>
          <div class="setting-row">
            <div class="setting-label">
              <div class="setting-name">Default View</div>
              <div class="setting-desc">Choose your preferred dashboard view</div>
            </div>
            <select class="setting-select" id="defaultViewSelect">
              <option value="timeline" ${savedView === 'timeline' ? 'selected' : ''}>Timeline</option>
              <option value="calendar" ${savedView === 'calendar' ? 'selected' : ''}>Calendar</option>
              <option value="byclass" ${savedView === 'byclass' ? 'selected' : ''}>By Class</option>
            </select>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Manage Classes</div>
          <div class="setting-desc" style="margin-bottom:10px">Remove a class and all its assignments from your dashboard.</div>
          <div id="manageClassList">
            ${Object.entries(CLASSES).map(([key, cls]) => `
              <div class="manage-class-row" data-class-key="${esc(key)}" data-class-dbid="${esc(cls.dbId)}">
                <span class="manage-class-name">${esc(cls.icon)} ${esc(cls.name)}</span>
                <button class="btn-danger btn-sm delete-class-btn" data-dbid="${esc(cls.dbId)}" data-key="${esc(key)}">Remove</button>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Account</div>
          <div class="setting-row">
            <div class="setting-label">
              <div class="setting-name">Signed in as</div>
              <div class="setting-desc">${esc(userName)}</div>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <div class="setting-name">Delete this semester</div>
              <div class="setting-desc">Permanently removes ${esc(SEMESTER_NAME)} and all of its classes and assignments.</div>
            </div>
            <button class="btn-danger btn-sm" id="deleteSemesterBtn">Delete</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('closeSettingsBtn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    modal.querySelectorAll('.theme-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.theme;
        localStorage.setItem('assigndash-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
        modal.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('defaultViewSelect').addEventListener('change', (e) => {
      localStorage.setItem('assigndash-default-view', e.target.value);
      activeView = e.target.value;
      document.querySelectorAll('.view-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.view === activeView);
      });
      renderMainContent();
    });

    document.getElementById('deleteSemesterBtn').addEventListener('click', async () => {
      if (!confirm(`Delete ${SEMESTER_NAME} and everything in it? This cannot be undone.`)) return;
      const r = await fetch(`/api/semester/${SEMESTER_ID}`, { method: 'DELETE' });
      if (!r.ok) {
        alert('Error: ' + ((await r.json().catch(() => ({}))).error || 'Could not delete the semester.'));
        return;
      }
      window.location.reload();
    });

    modal.querySelectorAll('.delete-class-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dbId = btn.dataset.dbid;
        const key = btn.dataset.key;
        const cls = CLASSES[key];
        if (!cls) return;
        if (!confirm(`Remove "${cls.name}" and all its assignments?`)) return;

        btn.disabled = true;
        btn.textContent = 'Removing...';
        try {
          const r = await fetch(`/api/class/${dbId}`, { method: 'DELETE' });
          const result = await r.json();
          if (!r.ok) throw new Error(result.error);

          ASSIGNMENTS = ASSIGNMENTS.filter(a => a.classId !== key);
          delete CLASSES[key];

          const row = btn.closest('.manage-class-row');
          if (row) row.remove();

          renderFilterTabs();
          refreshDashboard();

          if (Object.keys(CLASSES).length === 0) {
            document.getElementById('manageClassList').innerHTML = '<div class="setting-desc">No classes remaining.</div>';
          }
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Remove';
          alert('Error: ' + err.message);
        }
      });
    });
  }

})();
