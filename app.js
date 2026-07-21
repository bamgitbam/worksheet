const PILOT = {
  version: 3,
  name: 'Solo Productivity Pilot',
  startDate: '2026-07-21',
  endDate: '2026-07-24',
  targetHoursPerDay: 8,
  storageKey: 'solo-productivity-pilot-v3',
  previousStorageKey: 'solo-productivity-pilot-v2',
  legacyStorageKey: 'solo-productivity-pilot-v1'
};

const PILOT_DATES = ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24'];
const $ = (id) => document.getElementById(id);
const todayIso = () => new Date().toLocaleDateString('en-CA');
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
let activeScreen = 'today';
let stopPanelOpen = false;

function defaultDay(date) {
  return {
    date,
    startTime: '',
    endTime: '',
    scheduleStart: '08:00',
    mission: { primary: '', stretch: '', difficulty: 'normal' },
    workBlocks: [],
    tasks: [],
    sessions: [],
    accomplishments: [],
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
    ...(raw || {}),
    scheduleStart: raw?.scheduleStart || '08:00',
    mission: { ...base.mission, ...(raw?.mission || {}) },
    reflection: { ...base.reflection, ...(raw?.reflection || {}) },
    workBlocks: Array.isArray(raw?.workBlocks) ? raw.workBlocks : [],
    tasks: Array.isArray(raw?.tasks) ? raw.tasks : [],
    sessions: Array.isArray(raw?.sessions) ? raw.sessions : [],
    accomplishments: Array.isArray(raw?.accomplishments) ? raw.accomplishments : [],
    materials: Array.isArray(raw?.materials) ? raw.materials : [],
    focusResets: Array.isArray(raw?.focusResets) ? raw.focusResets : []
  };
}

function isAccidentalEmptyFinish(day) {
  if (!day?.finished || !day.startTime || !day.endTime) return false;
  const duration = new Date(day.endTime) - new Date(day.startTime);
  const hasActualData = (day.sessions?.length || 0) + (day.accomplishments?.length || 0) +
    (day.materials?.length || 0) + (day.focusResets?.length || 0) +
    (day.workBlocks?.filter(b => b.done).length || 0) + (day.tasks?.filter(t => t.done).length || 0);
  return duration < 5 * 60 * 1000 && hasActualData === 0;
}

function migrateState(saved) {
  const days = PILOT_DATES.map(date => normalizeDay(saved?.days?.find(d => d.date === date), date));
  days.forEach(day => {
    if (isAccidentalEmptyFinish(day)) {
      day.startTime = '';
      day.endTime = '';
      day.finished = false;
      day.xp = { momentum: 0, craft: 0, stewardship: 0, focus: 0, total: 0 };
    }
  });
  return { version: PILOT.version, pilot: PILOT, days };
}

function loadState() {
  try {
    const current = JSON.parse(localStorage.getItem(PILOT.storageKey));
    if (current?.version === PILOT.version) return migrateState(current);

    const previous = JSON.parse(localStorage.getItem(PILOT.previousStorageKey));
    if (previous) return migrateState(previous);

    const legacy = JSON.parse(localStorage.getItem(PILOT.legacyStorageKey));
    if (legacy) return migrateState(legacy);
  } catch (err) {
    console.warn('Could not load saved pilot state', err);
  }
  return { version: PILOT.version, pilot: PILOT, days: PILOT_DATES.map(defaultDay) };
}

let state = loadState();

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

function fmtClock(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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

function fmtTimer(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function sessionMinutes(session, includeRunning = false) {
  if (!session?.startAt) return 0;
  const end = session.endAt ? new Date(session.endAt) : includeRunning ? new Date() : null;
  if (!end) return 0;
  return Math.max(0, (end - new Date(session.startAt)) / 60000);
}

function closedSessions(day) {
  return day.sessions.filter(session => session.endAt);
}

function activeSession(day) {
  return day.sessions.find(session => !session.endAt) || null;
}

function actualMinutes(day, includeBreak = true, includeRunning = true) {
  return day.sessions
    .filter(session => includeBreak || session.activity !== 'Break')
    .reduce((sum, session) => sum + sessionMinutes(session, includeRunning), 0);
}

function totalBlockMinutes(day) {
  return day.workBlocks.reduce((sum, block) => sum + Number(block.duration || 0), 0);
}

function blockCompletion(day) {
  if (!day.workBlocks.length) return 0;
  return Math.round(day.workBlocks.filter(block => block.done).length / day.workBlocks.length * 100);
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
  const workMinutes = actualMinutes(day, false, false);
  const momentum = Math.min(400, Math.round(workMinutes / (PILOT.targetHoursPerDay * 60) * 400)) + Math.min(day.accomplishments.length * 20, 100);
  const hasRealWork = workMinutes >= 30 || day.accomplishments.length > 0;
  const craft = day.finished && hasRealWork ? (day.quality === 'clean' ? 200 : day.quality === 'minor' ? 100 : 0) : 0;
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

function outcomeLabel(value) {
  return ({ done: 'Did what I intended', progress: 'Made good progress', switch: 'Switched activities', blocked: 'Blocked / interrupted' })[value] || 'Logged';
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
    el.textContent = container === 'todayBlocks' ? 'No planned blocks yet. Planning is optional.' : 'No planned blocks yet.';
    return;
  }
  el.className = 'block-list';
  el.innerHTML = rows.map(block => `
    <div class="block-row ${block.done ? 'done' : ''} ${block.activity === 'Break' ? 'break-block' : ''}">
      <button class="check-btn" data-block-toggle="${block.id}" aria-label="Toggle planned block">${block.done ? '✓' : '○'}</button>
      <div class="block-body">
        <div class="block-topline"><strong>${escapeHtml(block.activity)}</strong><span>${block.startLabel}–${block.endLabel}</span></div>
        <div class="block-meta">${block.duration === 60 ? '1 hour' : '30 minutes'}${block.note ? ` · ${escapeHtml(block.note)}` : ''}</div>
      </div>
      ${includeDelete ? `<button class="delete-btn" data-block-delete="${block.id}" aria-label="Delete planned block">×</button>` : ''}
    </div>`).join('');
}

function renderTimeline(day) {
  const items = [
    ...day.sessions.map(session => ({ type: 'session', at: session.startAt, item: session })),
    ...day.accomplishments.map(accomplishment => ({ type: 'win', at: accomplishment.at, item: accomplishment }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  const el = $('todayTimeline');
  if (!items.length) {
    el.className = 'timeline empty-state';
    el.textContent = 'Start an activity or log a quick win.';
  } else {
    el.className = 'timeline';
    el.innerHTML = items.map(entry => {
      if (entry.type === 'win') {
        const win = entry.item;
        return `<div class="timeline-item win-item">
          <div class="timeline-time">${fmtClock(win.at)}</div>
          <div class="timeline-body"><strong>I did something</strong><p>${escapeHtml(win.text)}</p></div>
          <button class="delete-btn small-delete" data-win-delete="${win.id}" aria-label="Delete quick win">×</button>
        </div>`;
      }
      const session = entry.item;
      const running = !session.endAt;
      return `<div class="timeline-item ${running ? 'running-item' : ''} ${session.activity === 'Break' ? 'break-item' : ''}">
        <div class="timeline-time">${fmtClock(session.startAt)}${session.endAt ? `<br><span>to ${fmtClock(session.endAt)}</span>` : '<br><span>running</span>'}</div>
        <div class="timeline-body">
          <div class="timeline-heading"><strong>${escapeHtml(session.activity)}</strong><span>${fmtMinutes(sessionMinutes(session, running))}</span></div>
          ${session.note ? `<p>${escapeHtml(session.note)}</p>` : ''}
          ${session.result ? `<p class="result-line"><b>${escapeHtml(outcomeLabel(session.outcome))}:</b> ${escapeHtml(session.result)}</p>` : session.endAt ? `<p class="result-line">${escapeHtml(outcomeLabel(session.outcome))}</p>` : ''}
        </div>
        ${session.endAt ? `<button class="delete-btn small-delete" data-session-delete="${session.id}" aria-label="Delete activity">×</button>` : ''}
      </div>`;
    }).join('');
  }

  const closed = closedSessions(day).length;
  $('timelineSummary').textContent = `${closed} session${closed === 1 ? '' : 's'} · ${fmtMinutes(actualMinutes(day, true, true))}`;
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
  days.forEach(day => day.sessions.forEach(session => {
    const minutes = sessionMinutes(session, false);
    if (minutes <= 0) return;
    totals[session.activity] = (totals[session.activity] || 0) + minutes;
  }));
  return totals;
}

function renderWeek() {
  const pilotDays = state.days.filter(day => day.date >= PILOT.startDate && day.date <= PILOT.endDate).sort((a, b) => a.date.localeCompare(b.date));
  const finished = pilotDays.filter(day => day.finished);
  const totalFocus = pilotDays.reduce((n, day) => n + day.focusResets.length, 0);
  const totalXp = pilotDays.reduce((n, day) => n + calcXp(day).total, 0);
  const logged = pilotDays.reduce((n, day) => n + actualMinutes(day, true, false), 0);

  $('weekDays').textContent = `${finished.length} / 4`;
  $('weekLogged').textContent = fmtMinutes(logged);
  $('weekFocus').textContent = totalFocus;
  $('weekXp').textContent = totalXp;

  const totals = Object.entries(activityTotals(pilotDays)).sort((a, b) => b[1] - a[1]);
  $('weekActivityTotals').innerHTML = totals.length
    ? `<div class="section-head"><h3>Actual Time by Activity</h3><span class="muted">Start / stop log</span></div>
       <div class="activity-totals">${totals.map(([activity, minutes]) => `<div><span>${escapeHtml(activity)}</span><strong>${fmtMinutes(minutes)}</strong></div>`).join('')}</div>`
    : '<h3>Actual Time by Activity</h3><p class="muted">Start and stop activities to build the week breakdown.</p>';

  $('weekDaysList').innerHTML = pilotDays.map(day => {
    const xp = calcXp(day);
    const status = day.finished ? 'FINISHED' : activeSession(day) ? 'WORKING' : day.startTime ? 'ACTIVE' : 'READY';
    return `<div class="day-card">
      <div class="topline"><strong>${fmtDate(day.date)}</strong><span class="status-pill">${status}</span></div>
      <p>${escapeHtml(day.mission.primary || 'No mission recorded')}</p>
      <p class="muted">${closedSessions(day).length} sessions · ${fmtMinutes(actualMinutes(day, true, false))} logged · ${day.accomplishments.length} quick wins · ${day.focusResets.length} focus resets · ${xp.total} XP</p>
    </div>`;
  }).join('');
}

function renderActivity(day) {
  const session = activeSession(day);
  const dayCanWork = Boolean(day.startTime) && !day.finished;
  $('idleActivityPanel').classList.toggle('hidden', Boolean(session) || !dayCanWork);
  $('runningActivityPanel').classList.toggle('hidden', !session);
  $('liveDot').classList.toggle('hidden', !session);
  $('stopActivityPanel').classList.toggle('hidden', !session || !stopPanelOpen);

  if (!day.startTime) {
    $('activityStateTitle').textContent = 'Start the day first';
  } else if (day.finished) {
    $('activityStateTitle').textContent = 'Day finished';
  } else if (!session) {
    $('activityStateTitle').textContent = 'Nothing running';
  } else {
    $('activityStateTitle').textContent = session.activity;
    $('runningActivityName').textContent = session.activity;
    $('runningActivityTimer').textContent = fmtTimer(new Date() - new Date(session.startAt));
    $('runningActivityNote').textContent = session.note || 'No starting note';
    $('runningActivityStarted').textContent = `Started ${fmtClock(session.startAt)}`;
  }
}

function renderFinish(day) {
  const session = activeSession(day);
  const logged = actualMinutes(day, true, false);
  const work = actualMinutes(day, false, false);
  const canFinish = Boolean(day.startTime) && !session && (closedSessions(day).length > 0 || day.accomplishments.length > 0);

  $('finishSummary').innerHTML = `
    <div><span>Sessions</span><strong>${closedSessions(day).length}</strong></div>
    <div><span>Total logged</span><strong>${fmtMinutes(logged)}</strong></div>
    <div><span>Work excluding breaks</span><strong>${fmtMinutes(work)}</strong></div>
    <div><span>Quick wins</span><strong>${day.accomplishments.length}</strong></div>`;

  if (day.finished) {
    $('finishGateMessage').textContent = 'This day is closed. Reopen it if you need to keep logging.';
  } else if (session) {
    $('finishGateMessage').textContent = `Stop your running ${session.activity} activity before ending the day.`;
  } else if (!day.startTime) {
    $('finishGateMessage').textContent = 'Start the day before you can finish it.';
  } else if (!canFinish) {
    $('finishGateMessage').textContent = 'Log at least one real activity or quick win before finishing the day.';
  } else {
    $('finishGateMessage').textContent = 'Review the day honestly, then close it when you are actually done.';
  }

  $('finishDayBtn').disabled = !canFinish || day.finished;
  $('finishDayBtn').classList.toggle('hidden', day.finished);
  $('reopenDayBtn').classList.toggle('hidden', !day.finished);
}

function render() {
  const day = getDay();
  day.xp = calcXp(day);
  saveState();

  document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('active', screen.dataset.screen === activeScreen));
  document.querySelectorAll('[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === activeScreen));
  $('screenTitle').textContent = ({ today: 'Today', plan: 'Plan', materials: 'Materials', finish: 'Finish Day', week: 'My Week' })[activeScreen];

  const current = activeSession(day);
  const logged = actualMinutes(day, true, true);
  $('todayDate').textContent = fmtDate(day.date);
  $('dayStatus').textContent = day.finished ? 'FINISHED' : current ? 'WORKING' : day.startTime ? 'ACTIVE' : 'READY';
  $('elapsedTime').textContent = fmtElapsed(elapsedMs(day));
  $('loggedWorkTime').textContent = fmtMinutes(logged);
  $('todayXp').textContent = day.xp.total;
  $('mainMissionText').textContent = day.mission.primary || "Set today's mission";
  $('nextMoveText').textContent = current ? `${current.activity}${current.note ? ` — ${current.note}` : ''}` : day.startTime ? 'Start whatever you are actually doing next.' : 'Start the day, then log what you actually do.';
  $('startDayBtn').textContent = day.finished ? 'Day Finished' : day.startTime ? 'Day Started' : 'Start Day';
  $('startDayBtn').disabled = Boolean(day.startTime);
  $('blockSummary').textContent = `${day.workBlocks.filter(block => block.done).length} / ${day.workBlocks.length}`;
  $('planTotal').textContent = `${fmtMinutes(totalBlockMinutes(day))} planned / 8h`;
  $('reviewDayBtn').disabled = !day.startTime;

  $('momentumLabel').textContent = logged >= 360 ? 'Strong day' : logged >= 180 ? 'Building' : logged > 0 ? 'In motion' : 'Ready';
  $('craftLabel').textContent = day.finished ? (day.quality === 'clean' ? 'Clean' : day.quality === 'minor' ? 'Touch-up' : 'Rework') : 'Unrated';
  $('stewardshipLabel').textContent = day.materials.length ? (day.materials.some(m => m.waste === 'significant') ? 'Review' : 'Aware') : 'Unrated';
  $('focusLabel').textContent = day.focusResets.length >= 5 ? 'Recovering well' : day.focusResets.length ? 'Aware' : 'Fresh start';

  renderActivity(day);
  renderTimeline(day);
  renderBlocks('todayBlocks', day, false);
  renderBlocks('planBlocks', day, true);
  renderTasks('missionTasks', day);
  renderMaterials(day);
  renderFinish(day);

  $('dayStartInput').value = day.scheduleStart || '08:00';
  $('mainMissionInput').value = day.mission.primary;
  $('stretchGoalInput').value = day.mission.stretch;
  $('qualityInput').value = day.quality;
  $('performanceInput').value = day.reflection.performance;
  $('feelingInput').value = day.reflection.feeling;
  $('blockersInput').value = day.reflection.blockers;
  $('notesInput').value = day.reflection.notes;

  const previewDay = { ...day, quality: $('qualityInput').value };
  const preview = calcXp(previewDay);
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
  day.workBlocks.push({ id: uid(), activity, duration: Number(duration), note: note.trim(), done: false, createdAt: new Date().toISOString() });
  saveState();
  render();
}

function startActivity(activity, note = '') {
  const day = getDay();
  if (!day.startTime || day.finished || activeSession(day)) return false;
  day.sessions.push({ id: uid(), activity, note: note.trim(), startAt: new Date().toISOString(), endAt: '', outcome: '', result: '' });
  stopPanelOpen = false;
  saveState();
  render();
  return true;
}

document.querySelectorAll('[data-nav]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.nav)));

$('startDayBtn').addEventListener('click', () => {
  const day = getDay();
  if (!day.startTime) {
    day.startTime = new Date().toISOString();
    day.endTime = '';
    day.finished = false;
    saveState();
    toast('Day started. Now start what you are actually doing.');
    render();
  }
});

$('startActivityBtn').addEventListener('click', () => {
  if (startActivity($('liveActivityInput').value, $('liveActivityNote').value)) {
    $('liveActivityNote').value = '';
    toast('Activity started.');
  }
});

$('quickBreakBtn').addEventListener('click', () => {
  if (startActivity('Break', '')) toast('Break started.');
});

$('openStopActivityBtn').addEventListener('click', () => {
  stopPanelOpen = true;
  render();
  $('activityResultInput').focus();
});

$('cancelStopActivityBtn').addEventListener('click', () => {
  stopPanelOpen = false;
  render();
});

$('saveStopActivityBtn').addEventListener('click', () => {
  const day = getDay();
  const session = activeSession(day);
  if (!session) return;
  session.endAt = new Date().toISOString();
  session.outcome = $('activityOutcomeInput').value;
  session.result = $('activityResultInput').value.trim();
  $('activityResultInput').value = '';
  $('activityOutcomeInput').value = 'done';
  stopPanelOpen = false;
  saveState();
  toast(`${session.activity} logged · ${fmtMinutes(sessionMinutes(session))}`);
  render();
});

$('focusResetBtn').addEventListener('click', () => {
  const day = getDay();
  day.focusResets.push({ at: new Date().toISOString(), sessionId: activeSession(day)?.id || '' });
  saveState();
  toast(`Focus recovered · Reset ${day.focusResets.length}`);
  render();
});

$('didSomethingBtn').addEventListener('click', () => {
  $('accomplishmentPanel').classList.remove('hidden');
  $('accomplishmentInput').focus();
});

$('cancelAccomplishmentBtn').addEventListener('click', () => {
  $('accomplishmentPanel').classList.add('hidden');
  $('accomplishmentInput').value = '';
});

$('saveAccomplishmentBtn').addEventListener('click', () => {
  const text = $('accomplishmentInput').value.trim();
  if (!text) return;
  getDay().accomplishments.push({ id: uid(), text, at: new Date().toISOString() });
  $('accomplishmentInput').value = '';
  $('accomplishmentPanel').classList.add('hidden');
  saveState();
  toast('Quick win logged.');
  render();
});

$('reviewDayBtn').addEventListener('click', () => navigate('finish'));

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
  toast('Planned block added.');
});

document.querySelectorAll('[data-quick-activity]').forEach(button => button.addEventListener('click', () => {
  addWorkBlock(button.dataset.quickActivity, button.dataset.quickDuration);
  toast(`${button.dataset.quickActivity} added to plan.`);
}));

$('taskForm').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('taskInput').value.trim();
  if (!text) return;
  getDay().tasks.push({ id: uid(), text, done: false, createdAt: new Date().toISOString() });
  $('taskInput').value = '';
  saveState();
  render();
});

document.addEventListener('click', event => {
  const blockToggle = event.target.closest('[data-block-toggle]');
  const blockDelete = event.target.closest('[data-block-delete]');
  const taskToggle = event.target.closest('[data-task-toggle]');
  const taskDelete = event.target.closest('[data-task-delete]');
  const sessionDelete = event.target.closest('[data-session-delete]');
  const winDelete = event.target.closest('[data-win-delete]');

  if (blockToggle) {
    const block = getDay().workBlocks.find(item => item.id === blockToggle.dataset.blockToggle);
    if (block) block.done = !block.done;
  }
  if (blockDelete) getDay().workBlocks = getDay().workBlocks.filter(item => item.id !== blockDelete.dataset.blockDelete);
  if (taskToggle) {
    const task = getDay().tasks.find(item => item.id === taskToggle.dataset.taskToggle);
    if (task) task.done = !task.done;
  }
  if (taskDelete) getDay().tasks = getDay().tasks.filter(item => item.id !== taskDelete.dataset.taskDelete);
  if (sessionDelete) getDay().sessions = getDay().sessions.filter(item => item.id !== sessionDelete.dataset.sessionDelete);
  if (winDelete) getDay().accomplishments = getDay().accomplishments.filter(item => item.id !== winDelete.dataset.winDelete);

  if (blockToggle || blockDelete || taskToggle || taskDelete || sessionDelete || winDelete) {
    saveState();
    render();
  }
});

$('clearDoneBlocksBtn').addEventListener('click', () => {
  getDay().workBlocks = getDay().workBlocks.filter(block => !block.done);
  saveState();
  render();
});

$('clearCompletedBtn').addEventListener('click', () => {
  getDay().tasks = getDay().tasks.filter(task => !task.done);
  saveState();
  render();
});

$('materialForm').addEventListener('submit', event => {
  event.preventDefault();
  const day = getDay();
  day.materials.push({
    id: uid(), name: $('materialName').value.trim(), start: $('materialStart').value,
    remaining: $('materialRemaining').value, unit: $('materialUnit').value.trim(),
    waste: $('materialWaste').value, at: new Date().toISOString()
  });
  event.target.reset();
  saveState();
  toast('Material check added.');
  render();
});

['qualityInput', 'performanceInput', 'feelingInput'].forEach(id => $(id).addEventListener('change', render));

$('finishDayBtn').addEventListener('click', () => {
  const day = getDay();
  if (!day.startTime || activeSession(day) || (!closedSessions(day).length && !day.accomplishments.length)) return;
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
  toast(`Day complete · ${day.xp.total} XP`);
  navigate('week');
});

$('reopenDayBtn').addEventListener('click', () => {
  const day = getDay();
  day.finished = false;
  day.endTime = '';
  saveState();
  toast('Day reopened.');
  navigate('today');
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
}, 1000);

render();
