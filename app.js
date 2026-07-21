const PILOT = {
  version: 1,
  name: 'Solo Productivity Pilot',
  startDate: '2026-07-21',
  endDate: '2026-07-24',
  targetHoursPerDay: 7,
  storageKey: 'solo-productivity-pilot-v1'
};

const $ = (id) => document.getElementById(id);
const todayIso = () => new Date().toLocaleDateString('en-CA');
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

function defaultDay(date) {
  return {
    date,
    startTime: '',
    endTime: '',
    mission: { primary: '', stretch: '', difficulty: 'normal' },
    tasks: [],
    materials: [],
    focusResets: [],
    quality: 'clean',
    reflection: { performance: 'normal', feeling: 'neutral', blockers: '', notes: '' },
    finished: false,
    xp: { momentum: 0, craft: 0, stewardship: 0, focus: 0, total: 0 }
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(PILOT.storageKey));
    if (saved?.version === PILOT.version) return saved;
  } catch (err) { console.warn('Could not load saved pilot state', err); }
  const dates = ['2026-07-21','2026-07-22','2026-07-23','2026-07-24'];
  return { version: PILOT.version, pilot: PILOT, days: dates.map(defaultDay) };
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

function completion(day) {
  if (!day.tasks.length) return 0;
  return Math.round((day.tasks.filter(t => t.done).length / day.tasks.length) * 100);
}

function elapsedMs(day) {
  if (!day.startTime) return 0;
  const end = day.endTime ? new Date(day.endTime) : new Date();
  return Math.max(0, end - new Date(day.startTime));
}

function fmtElapsed(ms) {
  const mins = Math.floor(ms / 60000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

function calcXp(day) {
  const pct = completion(day);
  const done = day.tasks.filter(t => t.done).length;
  const momentum = Math.round(pct * 4 + Math.min(done * 20, 100));
  const craft = day.quality === 'clean' ? 200 : day.quality === 'minor' ? 100 : 0;
  const materialBase = day.materials.length ? 100 : 0;
  const wastePenalty = day.materials.reduce((n,m) => n + (m.waste === 'significant' ? 70 : m.waste === 'minor' ? 20 : 0), 0);
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

function renderTasks(container, day) {
  const el = $(container);
  if (!day.tasks.length) {
    el.className = 'task-list empty-state';
    el.textContent = 'No tasks yet.';
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

function escapeHtml(s='') {
  return s.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
}

function nextTask(day) {
  return day.tasks.find(t => !t.done)?.text || (day.tasks.length ? 'Mission complete. Protect quality and close out clean.' : 'Add a few clear tasks so the day has a finish line.');
}

function renderMaterials(day) {
  const el = $('materialList');
  if (!day.materials.length) {
    el.innerHTML = '<div class="card muted">No material checks yet.</div>';
    return;
  }
  el.innerHTML = day.materials.map(m => {
    const used = (Number(m.start || 0) - Number(m.remaining || 0));
    return `<div class="material-card">
      <div class="topline"><strong>${escapeHtml(m.name)}</strong><span class="status-pill">${m.waste.toUpperCase()} WASTE</span></div>
      <p class="muted">Started ${m.start || '—'} ${escapeHtml(m.unit || '')} · Remaining ${m.remaining || '—'} ${escapeHtml(m.unit || '')}</p>
      <strong>Estimated used: ${Number.isFinite(used) ? Math.max(0, used).toFixed(1) : '—'} ${escapeHtml(m.unit || '')}</strong>
    </div>`;
  }).join('');
}

function renderWeek() {
  const pilotDays = state.days.filter(d => d.date >= PILOT.startDate && d.date <= PILOT.endDate).sort((a,b) => a.date.localeCompare(b.date));
  const finished = pilotDays.filter(d => d.finished);
  const totalTasks = pilotDays.reduce((n,d) => n + d.tasks.length, 0);
  const doneTasks = pilotDays.reduce((n,d) => n + d.tasks.filter(t => t.done).length, 0);
  const totalFocus = pilotDays.reduce((n,d) => n + d.focusResets.length, 0);
  const totalXp = pilotDays.reduce((n,d) => n + calcXp(d).total, 0);
  $('weekDays').textContent = `${finished.length} / 4`;
  $('weekCompletion').textContent = `${totalTasks ? Math.round(doneTasks / totalTasks * 100) : 0}%`;
  $('weekFocus').textContent = totalFocus;
  $('weekXp').textContent = totalXp;
  $('weekDaysList').innerHTML = pilotDays.map(d => {
    const xp = calcXp(d);
    return `<div class="day-card">
      <div class="topline"><strong>${fmtDate(d.date)}</strong><span class="status-pill">${d.finished ? 'FINISHED' : d.startTime ? 'ACTIVE' : 'READY'}</span></div>
      <p>${escapeHtml(d.mission.primary || 'No mission recorded')}</p>
      <p class="muted">${completion(d)}% complete · ${d.focusResets.length} focus resets · ${xp.total} XP</p>
    </div>`;
  }).join('');
}

function render() {
  const day = getDay();
  day.xp = calcXp(day);
  saveState();

  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === activeScreen));
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === activeScreen));
  $('screenTitle').textContent = ({today:'Today', mission:'Mission', materials:'Materials', finish:'Finish Day', week:'My Week'})[activeScreen];

  $('todayDate').textContent = fmtDate(day.date);
  $('dayStatus').textContent = day.finished ? 'FINISHED' : day.startTime ? 'ACTIVE' : 'READY';
  $('missionPercent').textContent = `${completion(day)}%`;
  $('missionBar').style.width = `${completion(day)}%`;
  $('elapsedTime').textContent = fmtElapsed(elapsedMs(day));
  $('focusCount').textContent = day.focusResets.length;
  $('todayXp').textContent = day.xp.total;
  $('mainMissionText').textContent = day.mission.primary || "Set today's mission";
  $('nextMoveText').textContent = nextTask(day);
  $('startDayBtn').textContent = day.startTime ? 'Day Started' : 'Start Day';
  $('startDayBtn').disabled = !!day.startTime;
  $('taskSummary').textContent = `${day.tasks.filter(t => t.done).length} / ${day.tasks.length}`;

  const pct = completion(day);
  $('momentumLabel').textContent = pct >= 90 ? 'Strong finish' : pct >= 60 ? 'Building' : day.startTime ? 'In motion' : 'Ready';
  $('craftLabel').textContent = day.finished ? (day.quality === 'clean' ? 'Clean' : day.quality === 'minor' ? 'Needs touch-up' : 'Rework') : 'Unrated';
  $('stewardshipLabel').textContent = day.materials.length ? (day.materials.some(m => m.waste === 'significant') ? 'Review' : 'Aware') : 'Unrated';
  $('focusLabel').textContent = day.focusResets.length >= 5 ? 'Recovering well' : day.focusResets.length ? 'Aware' : 'Fresh start';

  renderTasks('todayTasks', day);
  renderTasks('missionTasks', day);
  renderMaterials(day);

  $('mainMissionInput').value = day.mission.primary;
  $('stretchGoalInput').value = day.mission.stretch;
  $('difficultyInput').value = day.mission.difficulty;
  $('qualityInput').value = day.quality;
  $('performanceInput').value = day.reflection.performance;
  $('feelingInput').value = day.reflection.feeling;
  $('blockersInput').value = day.reflection.blockers;
  $('notesInput').value = day.reflection.notes;

  const preview = calcXp({...day, quality: $('qualityInput').value});
  $('scorePreview').innerHTML = `<strong>Projected XP: ${preview.total}</strong><br><span class="muted">Momentum ${preview.momentum} · Craft ${preview.craft} · Stewardship ${preview.stewardship} · Focus ${preview.focus}</span>`;
  renderWeek();
}

function navigate(screen) {
  activeScreen = screen;
  render();
  window.scrollTo({top: 0, behavior: 'smooth'});
}

document.querySelectorAll('[data-nav]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.nav)));

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
  day.mission.primary = $('mainMissionInput').value.trim();
  day.mission.stretch = $('stretchGoalInput').value.trim();
  day.mission.difficulty = $('difficultyInput').value;
  saveState();
  toast('Mission saved.');
  render();
});

$('taskForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('taskInput');
  const text = input.value.trim();
  if (!text) return;
  getDay().tasks.push({ id: uid(), text, done: false, createdAt: new Date().toISOString() });
  input.value = '';
  saveState();
  render();
});

document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-task-toggle]');
  const del = e.target.closest('[data-task-delete]');
  if (toggle) {
    const task = getDay().tasks.find(t => t.id === toggle.dataset.taskToggle);
    if (task) task.done = !task.done;
    saveState(); render();
  }
  if (del) {
    const day = getDay();
    day.tasks = day.tasks.filter(t => t.id !== del.dataset.taskDelete);
    saveState(); render();
  }
});

$('clearCompletedBtn').addEventListener('click', () => {
  const day = getDay();
  day.tasks = day.tasks.filter(t => !t.done);
  saveState(); render();
});

$('materialForm').addEventListener('submit', (e) => {
  e.preventDefault();
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
  e.target.reset();
  saveState();
  toast('Material check added.');
  render();
});

['qualityInput','performanceInput','feelingInput'].forEach(id => $(id).addEventListener('change', render));

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
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `productivity-pilot-${todayIso()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

setInterval(() => { if (activeScreen === 'today') render(); }, 60000);
render();
