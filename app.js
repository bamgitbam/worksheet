const PILOT = {
  version: 2,
  name: 'Solo Productivity Pilot',
  startDate: '2026-07-21',
  endDate: '2026-07-24',
  targetHoursPerDay: 8,
  storageKey: 'solo-productivity-pilot-v2',
  legacyStorageKey: 'solo-productivity-pilot-v1'
};

const PILOT_DATES = ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24'];
const $ = (id) => document.getElementById(id);
const todayIso = () => new Date().toLocaleDateString('en-CA');
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

function defaultDay(date) {
  return {
    date,
    startTime: '',
    endTime: '',
    scheduleStart: '08:00',
    mission: { primary: '', stretch: '', difficulty: 'normal' },
    workBlocks: [],
    tasks: [],
    materials: [],
    focusResets: [],
    quality: 'clean',
    reflection: { performance: 'normal', feeling: 'neutral', blockers: '', notes: '' },
    finished: false,
    xp: { momentum: 0, craft: 0, stewardship: 0, focus: 0, total: 0 }
  };
}

function normalizeDay(raw, date) {
  const base = defaultDay(date || raw?.date || todayIso());
  return {
    ...base,
    ...raw,
    scheduleStart: raw?.scheduleStart || '08:00',
    mission: { ...base.mission, ...(raw?.mission || {}) },
    reflection: { ...base.reflection, ...(raw?.reflection || {}) },
    workBlocks: Array.isArray(raw?.workBlocks) ? raw.workBlocks : [],
    tasks: Array.isArray(raw?.tasks) ? raw.tasks : [],
    materials: Array.isArray(raw?.materials) ? raw.materials : [],
    focusResets: Array.isArray(raw?.focusResets) ? raw.focusResets : []
  };
}

function migrateLegacy(saved) {
  return {
    version: PILOT.version,
    pilot: PILOT,
    days: PILOT_DATES.map(date => normalizeDay(saved?.days?.find(d => d.date === date), date))
  };
}

function loadState() {
  try {
    const current = JSON.parse(localStorage.getItem(PILOT.storageKey));
    if (current?.version === PILOT.version) {
      current.days = PILOT_DATES.map(date => normalizeDay(current.days?.find(d => d.date === date), date));
      return current;
    }

    const legacy = JSON.parse(localStorage.getItem(PILOT.legacyStorageKey));
    if (legacy) return migrateLegacy(legacy);
  } catch (err) {
    console.warn('Could not load saved pilot state', err);
  }

  return { version: PILOT.version, pilot: PILOT, days: PILOT_DATES.map(defaultDay) };
}

let state = loadState();
let activeScreen = 'today';

function saveState() {
  localStorage.setItem(PILOT.storageKey, JSON.stringify(state));
}

function getActiveDate() {
  const now = todayIso();
  if (now < PILOT.startDate) return PILOT.startDate;
  if (now > PILOT.endDate) return PILOT.endDate;
  return now;
}

function getDay(date = getActiveDate()) {
  let day = state.days.find(d => d.date === date);
  if (!day) {
    day = defaultDay(date);
    state.days.push(day);
  }
  return day;
}

function fmtDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function elapsedMs(day) {
  if (!day.startTime) return 0;
  const end = day.endTime ? new Date(day.endTime) : new Date();
  return Math.max(0, end - new Date(day.startTime));
}

function fmtMinutes(minutes) {
  const mins = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

function fmtElapsed(ms) {
  return fmtMinutes(Math.floor(ms / 60000));
}

function totalBlockMinutes(day) {
  return day.workBlocks.reduce((sum, block) => sum + Number(block.duration || 0), 0);
}

function completedBlockMinutes(day) {
  return day.workBlocks.filter(block => block.done).reduce((sum, block) => sum + Number(block.duration || 0), 0);
}

function blockCompletion(day) {
  if (!day.workBlocks.length) return 0;
  return Math.round((day.workBlocks.filter(block => block.done).length / day.workBlocks.length) * 100);
}

function taskCompletion(day) {
  if (!day.tasks.length) return 0;
  return Math.round((day.tasks.filter(task => task.done).length / day.tasks.length) * 100);
}

function overallCompletion(day) {
  if (day.workBlocks.length) return blockCompletion(day);
  return taskCompletion(day);
}

function timeToMinutes(value = '08:00') {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function minutesToTime(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function scheduleRows(day) {
  let cursor = timeToMinutes(day.scheduleStart || '08:00');
  return day.workBlocks.map(block => {
    const start = cursor;
    const end = cursor + Number(block.duration || 0);
    cursor = end;
    return { ...block, startLabel: minutesToTime(start), endLabel: minutesToTime(end) };
  });
}

function calcXp(day) {
  const pct = overallCompletion(day);
  const blocksDone = day.workBlocks.filter(block => block.done).length;
  const tasksDone = day.tasks.filter(task => task.done).length;
  const momentum = Math.round(pct * 4 + Math.min(blocksDone * 15 + tasksDone * 10, 120));
  const craft = day.quality === 'clean' ? 200 : day.quality === 'minor' ? 100 : 0;
  const materialBase = day.materials.length ? 100 : 0;
  const wastePenalty = day.materials.reduce((n, m) => n + (m.waste === 'significant' ? 70 : m.waste === 'minor' ? 20 : 0), 0);
  const stewardship = Math.max(0, materialBase + day.materials.length * 25 - wastePenalty);
  const focus = Math.min(day.focusResets.length * 25, 200);
  return { momentum, craft, stewardship, focus, total: momentum + craft + stewardship + focus };
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 1800);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));
}

function renderTasks(container, day) {
  const el = $(container);
  if (!day.tasks.length) {
    el.className = 'task-list empty-state';
    el.textContent = 'No task notes yet.';
    return;
  }

  el.className = 'task-list';
  el.innerHTML = day.tasks.map(task => `
    <div class="task-row ${task.done ? 'done' : ''}">
      <button class="check-btn" data-task-toggle="${task.id}" aria-label="Toggle task">${task.done ? '✓' : '○'}</button>
      <div class="task-text">${escapeHtml(task.text)}</div>
      <button class="delete-btn" data-task-delete="${task.id}" aria-label="Delete task">×</button>
    </div>`).join('');
}

function renderBlocks(container, day, includeDelete = false) {
  const el = $(container);
  const rows = scheduleRows(day);
  if (!rows.length) {
    el.className = 'block-list empty-state';
    el.textContent = 'No work blocks yet.';
    return;
  }

  el.className = 'block-list';
  el.innerHTML = rows.map(block => `
    <div class="block-row ${block.done ? 'done' : ''} ${block.activity === 'Break' ? 'break-block' : ''}">
      <button class="check-btn" data-block-toggle="${block.id}" aria-label="Toggle work block">${block.done ? '✓' : '○'}</button>
      <div class="block-body">
        <div class="block-topline">
          <strong>${escapeHtml(block.activity)}</strong>
          <span>${block.startLabel}–${block.endLabel}</span>
        </div>
        <div class="block-meta">${block.duration === 60 ? '1 hour' : '30 minutes'}${block.note ? ` · ${escapeHtml(block.note)}` : ''}</div>
      </div>
      ${includeDelete ? `<button class="delete-btn" data-block-delete="${block.id}" aria-label="Delete work block">×</button>` : ''}
    </div>`).join('');
}

function nextBlock(day) {
  return scheduleRows(day).find(block => !block.done) || null;
}

function renderMaterials(day) {
  const el = $('materialList');
  if (!day.materials.length) {
    el.innerHTML = '<div class="card muted">No material checks yet.</div>';
    return;
  }

  el.innerHTML = day.materials.map(material => {
    const used = Number(material.start || 0) - Number(material.remaining || 0);
    return `<div class="material-card">
      <div class="topline"><strong>${escapeHtml(material.name)}</strong><span class="status-pill">${material.waste.toUpperCase()} WASTE</span></div>
      <p class="muted">Started ${material.start || '—'} ${escapeHtml(material.unit || '')} · Remaining ${material.remaining || '—'} ${escapeHtml(material.unit || '')}</p>
      <strong>Estimated used: ${Number.isFinite(used) ? Math.max(0, used).toFixed(1) : '—'} ${escapeHtml(material.unit || '')}</strong>
    </div>`;
  }).join('');
}

function activityTotals(days) {
  const totals = {};
  days.forEach(day => {
    day.workBlocks.filter(block => block.done).forEach(block => {
      totals[block.activity] = (totals[block.activity] || 0) + Number(block.duration || 0);
    });
  });
  return totals;
}

function renderWeek() {
  const pilotDays = state.days
    .filter(day => day.date >= PILOT.startDate && day.date <= PILOT.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  const finished = pilotDays.filter(day => day.finished);
  const totalBlocks = pilotDays.reduce((n, day) => n + day.workBlocks.length, 0);
  const doneBlocks = pilotDays.reduce((n, day) => n + day.workBlocks.filter(block => block.done).length, 0);
  const totalFocus = pilotDays.reduce((n, day) => n + day.focusResets.length, 0);
  const totalXp = pilotDays.reduce((n, day) => n + calcXp(day).total, 0);

  $('weekDays').textContent = `${finished.length} / 4`;
  $('weekCompletion').textContent = `${totalBlocks ? Math.round(doneBlocks / totalBlocks * 100) : 0}%`;
  $('weekFocus').textContent = totalFocus;
  $('weekXp').textContent = totalXp;

  const totals = Object.entries(activityTotals(pilotDays)).sort((a, b) => b[1] - a[1]);
  $('weekActivityTotals').innerHTML = totals.length
    ? `<div class="section-head"><h3>Completed Time by Activity</h3><span class="muted">30m / 1h blocks</span></div>
       <div class="activity-totals">${totals.map(([activity, minutes]) => `<div><span>${escapeHtml(activity)}</span><strong>${fmtMinutes(minutes)}</strong></div>`).join('')}</div>`
    : '<h3>Completed Time by Activity</h3><p class="muted">Complete work blocks to build your week breakdown.</p>';

  $('weekDaysList').innerHTML = pilotDays.map(day => {
    const xp = calcXp(day);
    return `<div class="day-card">
      <div class="topline"><strong>${fmtDate(day.date)}</strong><span class="status-pill">${day.finished ? 'FINISHED' : day.startTime ? 'ACTIVE' : 'READY'}</span></div>
      <p>${escapeHtml(day.mission.primary || 'No mission recorded')}</p>
      <p class="muted">${blockCompletion(day)}% blocks complete · ${fmtMinutes(completedBlockMinutes(day))} logged · ${day.focusResets.length} focus resets · ${xp.total} XP</p>
    </div>`;
  }).join('');
}

function render() {
  const day = getDay();
  day.xp = calcXp(day);
  saveState();

  document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('active', screen.dataset.screen === activeScreen));
  document.querySelectorAll('[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === activeScreen));
  $('screenTitle').textContent = ({ today: 'Today', plan: 'Plan', materials: 'Materials', finish: 'Finish Day', week: 'My Week' })[activeScreen];

  const completion = overallCompletion(day);
  const upcoming = nextBlock(day);

  $('todayDate').textContent = fmtDate(day.date);
  $('dayStatus').textContent = day.finished ? 'FINISHED' : day.startTime ? 'ACTIVE' : 'READY';
  $('missionPercent').textContent = `${completion}%`;
  $('missionBar').style.width = `${completion}%`;
  $('elapsedTime').textContent = fmtElapsed(elapsedMs(day));
  $('plannedTime').textContent = fmtMinutes(totalBlockMinutes(day));
  $('todayXp').textContent = day.xp.total;
  $('mainMissionText').textContent = day.mission.primary || "Set today's mission";
  $('nextMoveText').textContent = upcoming ? `${upcoming.activity}${upcoming.note ? ` — ${upcoming.note}` : ''}` : (day.workBlocks.length ? 'Day plan complete. Protect quality and close out clean.' : 'Build a few 30-minute or 1-hour work blocks.');
  $('currentBlockName').textContent = upcoming ? upcoming.activity : 'No work block planned';
  $('currentBlockTime').textContent = upcoming ? `${upcoming.startLabel}–${upcoming.endLabel}${upcoming.note ? ` · ${upcoming.note}` : ''}` : 'Open Plan to build the day.';
  $('startDayBtn').textContent = day.startTime ? 'Day Started' : 'Start Day';
  $('startDayBtn').disabled = Boolean(day.startTime);
  $('blockSummary').textContent = `${day.workBlocks.filter(block => block.done).length} / ${day.workBlocks.length}`;
  $('planTotal').textContent = `${fmtMinutes(totalBlockMinutes(day))} planned / 8h`;

  const pct = overallCompletion(day);
  $('momentumLabel').textContent = pct >= 90 ? 'Strong finish' : pct >= 60 ? 'Building' : day.startTime ? 'In motion' : 'Ready';
  $('craftLabel').textContent = day.finished ? (day.quality === 'clean' ? 'Clean' : day.quality === 'minor' ? 'Needs touch-up' : 'Rework') : 'Unrated';
  $('stewardshipLabel').textContent = day.materials.length ? (day.materials.some(m => m.waste === 'significant') ? 'Review' : 'Aware') : 'Unrated';
  $('focusLabel').textContent = day.focusResets.length >= 5 ? 'Recovering well' : day.focusResets.length ? 'Aware' : 'Fresh start';

  renderBlocks('todayBlocks', day, false);
  renderBlocks('planBlocks', day, true);
  renderTasks('missionTasks', day);
  renderMaterials(day);

  $('dayStartInput').value = day.scheduleStart || '08:00';
  $('mainMissionInput').value = day.mission.primary;
  $('stretchGoalInput').value = day.mission.stretch;
  $('qualityInput').value = day.quality;
  $('performanceInput').value = day.reflection.performance;
  $('feelingInput').value = day.reflection.feeling;
  $('blockersInput').value = day.reflection.blockers;
  $('notesInput').value = day.reflection.notes;

  const preview = calcXp({ ...day, quality: $('qualityInput').value });
  $('scorePreview').innerHTML = `<strong>Projected XP: ${preview.total}</strong><br><span class="muted">Momentum ${preview.momentum} · Craft ${preview.craft} · Stewardship ${preview.stewardship} · Focus ${preview.focus}</span>`;

  renderWeek();
}

function navigate(screen) {
  activeScreen = screen;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function addWorkBlock(activity, duration, note = '') {
  const day = getDay();
  day.workBlocks.push({
    id: uid(),
    activity,
    duration: Number(duration),
    note: note.trim(),
    done: false,
    createdAt: new Date().toISOString()
  });
  saveState();
  render();
}

document.querySelectorAll('[data-nav]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.nav)));

$('startDayBtn').addEventListener('click', () => {
  const day = getDay();
  if (!day.startTime) {
    day.startTime = new Date().toISOString();
    saveState();
    toast('Run started. Make the next move count.');
    render();
  }
});

$('finishShortcutBtn').addEventListener('click', () => navigate('finish'));

$('focusResetBtn').addEventListener('click', () => {
  const day = getDay();
  day.focusResets.push({ at: new Date().toISOString() });
  saveState();
  toast(`Focus recovered · Reset ${day.focusResets.length}`);
  render();
});

$('saveMissionBtn').addEventListener('click', () => {
  const day = getDay();
  day.scheduleStart = $('dayStartInput').value || '08:00';
  day.mission.primary = $('mainMissionInput').value.trim();
  day.mission.stretch = $('stretchGoalInput').value.trim();
  saveState();
  toast('Day plan saved.');
  render();
});

$('dayStartInput').addEventListener('change', () => {
  getDay().scheduleStart = $('dayStartInput').value || '08:00';
  saveState();
  render();
});

$('blockForm').addEventListener('submit', event => {
  event.preventDefault();
  addWorkBlock($('activityInput').value, $('durationInput').value, $('blockNoteInput').value);
  $('blockNoteInput').value = '';
  toast('Work block added.');
});

document.querySelectorAll('[data-quick-activity]').forEach(button => button.addEventListener('click', () => {
  addWorkBlock(button.dataset.quickActivity, button.dataset.quickDuration);
  toast(`${button.dataset.quickActivity} added.`);
}));

$('taskForm').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('taskInput');
  const text = input.value.trim();
  if (!text) return;
  getDay().tasks.push({ id: uid(), text, done: false, createdAt: new Date().toISOString() });
  input.value = '';
  saveState();
  render();
});

document.addEventListener('click', event => {
  const blockToggle = event.target.closest('[data-block-toggle]');
  const blockDelete = event.target.closest('[data-block-delete]');
  const taskToggle = event.target.closest('[data-task-toggle]');
  const taskDelete = event.target.closest('[data-task-delete]');

  if (blockToggle) {
    const block = getDay().workBlocks.find(item => item.id === blockToggle.dataset.blockToggle);
    if (block) block.done = !block.done;
    saveState();
    render();
  }

  if (blockDelete) {
    const day = getDay();
    day.workBlocks = day.workBlocks.filter(item => item.id !== blockDelete.dataset.blockDelete);
    saveState();
    render();
  }

  if (taskToggle) {
    const task = getDay().tasks.find(item => item.id === taskToggle.dataset.taskToggle);
    if (task) task.done = !task.done;
    saveState();
    render();
  }

  if (taskDelete) {
    const day = getDay();
    day.tasks = day.tasks.filter(item => item.id !== taskDelete.dataset.taskDelete);
    saveState();
    render();
  }
});

$('clearDoneBlocksBtn').addEventListener('click', () => {
  const day = getDay();
  day.workBlocks = day.workBlocks.filter(block => !block.done);
  saveState();
  render();
});

$('clearCompletedBtn').addEventListener('click', () => {
  const day = getDay();
  day.tasks = day.tasks.filter(task => !task.done);
  saveState();
  render();
});

$('materialForm').addEventListener('submit', event => {
  event.preventDefault();
  const day = getDay();
  day.materials.push({
    id: uid(),
    name: $('materialName').value.trim(),
    start: $('materialStart').value,
    remaining: $('materialRemaining').value,
    unit: $('materialUnit').value.trim(),
    waste: $('materialWaste').value,
    at: new Date().toISOString()
  });
  event.target.reset();
  saveState();
  toast('Material check added.');
  render();
});

['qualityInput', 'performanceInput', 'feelingInput'].forEach(id => $(id).addEventListener('change', render));

$('finishDayBtn').addEventListener('click', () => {
  const day = getDay();
  if (!day.startTime) day.startTime = new Date().toISOString();
  day.endTime = new Date().toISOString();
  day.quality = $('qualityInput').value;
  day.reflection = {
    performance: $('performanceInput').value,
    feeling: $('feelingInput').value,
    blockers: $('blockersInput').value.trim(),
    notes: $('notesInput').value.trim()
  };
  day.finished = true;
  day.xp = calcXp(day);
  saveState();
  toast(`Run complete · ${day.xp.total} XP`);
  navigate('week');
});

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `productivity-pilot-${todayIso()}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
});

setInterval(() => {
  if (activeScreen === 'today') render();
}, 60000);

render();
