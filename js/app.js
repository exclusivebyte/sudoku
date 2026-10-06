import { solve, PEERS, ROW, COL, DIFFICULTIES } from './sudoku.js';
import { LEVELS } from './levels.js';
import * as cloud from './cloud.js';

// Used only when sign-in isn't configured: progress is kept on this device.
const LEVEL_KEY = 'sudoku.level';
const PROGRESS_KEY = 'sudoku.progress';
const DONE_KEY = 'sudoku.completed';
const THEME_KEY = 'sudoku.theme';
const LAST_UID_KEY = 'sudoku.lastUid';           // last signed-in account on this device
const accountCacheKey = (uid) => `sudoku.account.${uid}`;
const CLOUD_SAVE_DELAY = 8000;                   // batch cloud writes while playing

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const numpadEl = $('numpad');
const timerEl = $('timer');
const mistakesEl = $('mistakes');
const notesBtn = $('notes-btn');
const pauseOverlay = $('pause-overlay');

let state = null;      // the puzzle being played
let user = null;       // signed-in account, or null for a guest
let cloudTimer = null;
// All saved progress: { level, progress: { [level]: game }, completed: { [level]: result }, updatedAt }.
let game = emptyGame();
let selected = -1;     // selected cell index
let notesMode = false;
let paused = false;
let ticker = null;
const cells = [];
const numButtons = [];

// ---------- Storage helpers (never let storage errors break the game) ----------
function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// ---------- Saved progress ----------
function emptyGame() {
  return { level: 0, progress: {}, completed: {}, updatedAt: 0 };
}

// Copy of the saved progress without undo history (keeps cloud documents small).
function compact(g) {
  const progress = {};
  for (const [k, p] of Object.entries(g.progress)) {
    const { history, ...rest } = p;
    progress[k] = rest;
  }
  return { level: g.level, progress, completed: g.completed, updatedAt: g.updatedAt };
}

// Saves `game` where it belongs: this device when sign-in isn't set up,
// the player's account when signed in, nowhere for guests.
function persist({ cloudNow = false, skipCloud = false } = {}) {
  game.updatedAt = Date.now();
  if (!cloud.isConfigured()) {
    store(LEVEL_KEY, game.level);
    store(PROGRESS_KEY, game.progress);
    store(DONE_KEY, game.completed);
    return;
  }
  if (!user) return;
  store(accountCacheKey(user.uid), compact(game));
  if (skipCloud) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(pushToCloud, cloudNow ? 0 : CLOUD_SAVE_DELAY);
}

async function pushToCloud() {
  clearTimeout(cloudTimer);
  cloudTimer = null;
  if (!user || user.pending) return;
  try {
    await cloud.saveUserData(user, compact(game));
    setSyncStatus('saved');
  } catch (err) {
    console.warn('Cloud save failed', err);
    setSyncStatus('offline');
  }
}

function flushCloud() {
  if (cloudTimer) pushToCloud();
}

// Combines two sets of progress: best time per completed level, furthest game per level.
function mergeGames(a, b) {
  const out = { level: b.level, progress: { ...a.progress }, completed: { ...a.completed }, updatedAt: Date.now() };
  for (const [k, r] of Object.entries(b.completed)) {
    if (!out.completed[k] || r.time < out.completed[k].time) out.completed[k] = r;
  }
  for (const [k, p] of Object.entries(b.progress)) {
    if (!out.progress[k] || p.elapsed > out.progress[k].elapsed) out.progress[k] = p;
  }
  for (const k of Object.keys(out.completed)) delete out.progress[k];
  return out;
}

const hasAnything = (g) => Object.keys(g.progress).length > 0 || Object.keys(g.completed).length > 0;

// ---------- Game lifecycle ----------
// Opens a level, resuming any saved progress on it unless `fresh` is set.
function openLevel(level, fresh = false) {
  level = Math.max(0, Math.min(LEVELS.length - 1, level));
  const [difficulty, digits] = LEVELS[level];
  const puzzle = [...digits].map(Number);
  const saved = fresh ? null : game.progress[level];
  state = {
    level,
    difficulty,
    puzzle,
    solution: solve(puzzle),
    values: saved?.values ?? puzzle.slice(),
    notes: saved?.notes ?? new Array(81).fill(0),
    elapsed: saved?.elapsed ?? 0,
    mistakes: saved?.mistakes ?? 0,
    hints: saved?.hints ?? 0,
    history: saved?.history ?? [],
    started: !!saved,
    solved: false,
  };
  selected = -1;
  boardEl.classList.remove('solved');
  game.level = level;
  if (fresh) delete game.progress[level];
  persist();
  setPaused(false);
  render();
}

// Records the current puzzle into `game`. Timer ticks only update the local copy.
function save({ tick = false } = {}) {
  if (!state || state.solved) return;
  if (state.history.length) state.started = true;
  if (!state.started) return;
  const { values, notes, elapsed, mistakes, hints, history } = state;
  game.progress[state.level] = { values, notes, elapsed, mistakes, hints, history };
  persist({ skipCloud: tick });
}

function isInProgress() {
  return state && !state.solved && state.started;
}

async function confirmRestart() {
  if (!isInProgress()) return true;
  const dlg = $('confirm-dialog');
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}

// ---------- Moves ----------
function editable(i) {
  return i >= 0 && !state.puzzle[i] && !state.solved && !paused;
}

// Applies a set of cell changes and records them for undo.
function commit(changes) {
  const before = changes.map(({ i }) => ({ i, v: state.values[i], n: state.notes[i] }));
  let changed = false;
  for (const { i, v, n } of changes) {
    if (state.values[i] !== v || state.notes[i] !== n) changed = true;
    state.values[i] = v;
    state.notes[i] = n;
  }
  if (!changed) return false;
  state.history.push(before);
  if (state.history.length > 500) state.history.shift();
  return true;
}

function enterDigit(d) {
  const i = selected;
  if (!editable(i)) return;

  if (notesMode) {
    if (state.values[i]) return;
    commit([{ i, v: 0, n: state.notes[i] ^ (1 << d) }]);
  } else {
    if (state.values[i] === d) {
      commit([{ i, v: 0, n: state.notes[i] }]); // tapping the same digit clears it
    } else {
      const changes = [{ i, v: d, n: 0 }];
      // Remove this digit from notes in peer cells.
      for (const p of PEERS[i]) {
        if (state.notes[p] & (1 << d)) {
          changes.push({ i: p, v: state.values[p], n: state.notes[p] & ~(1 << d) });
        }
      }
      commit(changes);
      if (d !== state.solution[i]) {
        state.mistakes++;
        flash(i);
      }
    }
  }
  afterMove();
}

function erase() {
  const i = selected;
  if (!editable(i)) return;
  commit([{ i, v: 0, n: 0 }]);
  afterMove();
}

function undo() {
  if (!state.history.length || state.solved || paused) return;
  const prev = state.history.pop();
  state.started = true;
  for (const { i, v, n } of prev) {
    state.values[i] = v;
    state.notes[i] = n;
  }
  save();
  render();
}

function hint() {
  if (state.solved || paused) return;
  let i = selected;
  if (!editable(i) || state.values[i] === state.solution[i]) {
    // Pick a random empty or wrong cell instead.
    const open = [];
    for (let k = 0; k < 81; k++) {
      if (!state.puzzle[k] && state.values[k] !== state.solution[k]) open.push(k);
    }
    if (!open.length) return;
    i = open[Math.floor(Math.random() * open.length)];
    selected = i;
  }
  const d = state.solution[i];
  const changes = [{ i, v: d, n: 0 }];
  for (const p of PEERS[i]) {
    if (state.notes[p] & (1 << d)) changes.push({ i: p, v: state.values[p], n: state.notes[p] & ~(1 << d) });
  }
  commit(changes);
  state.hints++;
  afterMove();
  const el = cells[i];
  el.classList.remove('hinted');
  void el.offsetWidth;
  el.classList.add('hinted');
}

function afterMove() {
  if (state.values.every((v, i) => v === state.solution[i])) win();
  save();
  render();
}

function win() {
  state.solved = true;
  stopTimer();
  delete game.progress[state.level];

  const done = game.completed;
  const prev = done[state.level];
  const isRecord = !prev || state.elapsed < prev.time;
  if (isRecord) done[state.level] = { time: state.elapsed, mistakes: state.mistakes, hints: state.hints };
  persist({ cloudNow: true });
  boardEl.classList.add('solved');

  const parts = [`Solved in ${formatTime(state.elapsed)}`];
  parts.push(state.mistakes === 1 ? 'with 1 mistake' : `with ${state.mistakes} mistakes`);
  if (state.hints) parts.push(`and ${state.hints} hint${state.hints > 1 ? 's' : ''}`);
  let text = parts.join(' ') + '.';
  if (prev && isRecord) text += ' New best time!';
  else if (prev) text += ` Your best: ${formatTime(prev.time)}.`;
  const count = Object.keys(done).length;
  text += ` ${count} of ${LEVELS.length} levels complete.`;

  const last = state.level === LEVELS.length - 1;
  $('win-title').textContent = `Level ${state.level + 1} solved!`;
  $('win-text').textContent = text;
  $('next-btn').hidden = last;
  setTimeout(() => $('win-dialog').showModal(), 700);
}

function flash(i) {
  const el = cells[i];
  el.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }],
    { duration: 220 }
  );
}

// ---------- Timer ----------
function formatTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function startTimer() {
  if (ticker || state.solved || paused) return;
  ticker = setInterval(() => {
    state.elapsed++;
    timerEl.textContent = formatTime(state.elapsed);
    if (state.elapsed % 5 === 0) save({ tick: true });
  }, 1000);
}

function stopTimer() {
  clearInterval(ticker);
  ticker = null;
}

function setPaused(p) {
  paused = p && !state.solved;
  pauseOverlay.hidden = !paused;
  timerEl.classList.toggle('paused', paused);
  boardEl.style.visibility = paused ? 'hidden' : '';
  if (paused) { stopTimer(); save({ tick: true }); } else startTimer();
}

// ---------- Rendering ----------
function buildBoard() {
  for (let i = 0; i < 81; i++) {
    const el = document.createElement('div');
    el.className = `cell r${ROW[i]} c${COL[i]}`;
    el.setAttribute('role', 'gridcell');
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      select(i);
    });
    boardEl.appendChild(el);
    cells.push(el);
  }
  for (let d = 1; d <= 9; d++) {
    const b = document.createElement('button');
    b.className = 'num';
    b.innerHTML = `${d}<small></small>`;
    b.setAttribute('aria-label', `Enter ${d}`);
    b.addEventListener('click', () => enterDigit(d));
    numpadEl.appendChild(b);
    numButtons.push(b);
  }
}

function select(i) {
  if (paused) return;
  selected = i;
  render();
}

function render() {
  const { values, notes, puzzle, solution } = state;
  const selVal = selected >= 0 ? values[selected] : 0;

  // Find cells whose value clashes with a peer.
  const conflict = new Array(81).fill(false);
  for (let i = 0; i < 81; i++) {
    if (!values[i]) continue;
    for (const p of PEERS[i]) {
      if (values[p] === values[i]) { conflict[i] = true; break; }
    }
  }

  const selPeers = selected >= 0 ? new Set(PEERS[selected]) : new Set();

  for (let i = 0; i < 81; i++) {
    const el = cells[i];
    const v = values[i];
    el.className = `cell r${ROW[i]} c${COL[i]}`;
    if (puzzle[i]) el.classList.add('given');
    if (i === selected) el.classList.add('selected');
    else if (selVal && v === selVal) el.classList.add('same');
    else if (selPeers.has(i)) el.classList.add('peer');
    if (v && !puzzle[i] && v !== solution[i]) el.classList.add('error');
    if (conflict[i] && !puzzle[i]) el.classList.add('conflict');

    if (v) {
      el.textContent = v;
      el.setAttribute('aria-label', `Row ${ROW[i] + 1} column ${COL[i] + 1}: ${v}`);
    } else if (notes[i]) {
      let html = '<div class="notes">';
      for (let d = 1; d <= 9; d++) {
        const has = notes[i] & (1 << d);
        html += `<span${has && d === selVal ? ' class="match"' : ''}>${has ? d : ''}</span>`;
      }
      el.innerHTML = html + '</div>';
      el.setAttribute('aria-label', `Row ${ROW[i] + 1} column ${COL[i] + 1}: empty`);
    } else {
      el.textContent = '';
      el.setAttribute('aria-label', `Row ${ROW[i] + 1} column ${COL[i] + 1}: empty`);
    }
  }

  // Numpad: show how many of each digit are still to be placed.
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 81; i++) if (values[i] === solution[i]) counts[values[i]]++;
  numButtons.forEach((b, k) => {
    const left = 9 - counts[k + 1];
    b.querySelector('small').textContent = left > 0 ? left : '';
    b.disabled = left <= 0 && !notesMode;
  });

  numpadEl.classList.toggle('notes-mode', notesMode);
  notesBtn.setAttribute('aria-pressed', notesMode);
  $('notes-state').textContent = notesMode ? 'on' : 'off';
  mistakesEl.textContent = `Mistakes: ${state.mistakes}`;
  timerEl.textContent = formatTime(state.elapsed);
  $('level-name').textContent = `Level ${state.level + 1}`;
  const tag = $('level-tag');
  tag.textContent = DIFFICULTIES[state.difficulty].label;
  tag.className = `tag ${state.difficulty}`;
  $('undo-btn').disabled = !state.history.length || state.solved;
}

// ---------- Input ----------
function toggleNotes() {
  notesMode = !notesMode;
  render();
}

function moveSelection(dr, dc) {
  if (selected < 0) { select(40); return; }
  const r = (ROW[selected] + dr + 9) % 9;
  const c = (COL[selected] + dc + 9) % 9;
  select(r * 9 + c);
}

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const digit = /^(Digit|Numpad)([1-9])$/.exec(e.code);
  if (digit) {
    e.preventDefault();
    // Holding Shift enters a note without switching modes.
    if (e.shiftKey && !notesMode) {
      notesMode = true;
      enterDigit(+digit[2]);
      notesMode = false;
      render();
    } else {
      enterDigit(+digit[2]);
    }
    return;
  }

  switch (e.key) {
    case 'ArrowUp': e.preventDefault(); moveSelection(-1, 0); break;
    case 'ArrowDown': e.preventDefault(); moveSelection(1, 0); break;
    case 'ArrowLeft': e.preventDefault(); moveSelection(0, -1); break;
    case 'ArrowRight': e.preventDefault(); moveSelection(0, 1); break;
    case 'Backspace':
    case 'Delete':
    case '0': e.preventDefault(); erase(); break;
    case 'n': case 'N': toggleNotes(); break;
    case 'h': case 'H': hint(); break;
    case 'p': case 'P': case ' ': e.preventDefault(); setPaused(!paused); break;
    case 'Escape': selected = -1; render(); break;
  }
});

$('undo-btn').addEventListener('click', undo);
$('erase-btn').addEventListener('click', erase);
$('hint-btn').addEventListener('click', hint);
notesBtn.addEventListener('click', toggleNotes);
timerEl.addEventListener('click', () => setPaused(!paused));
$('resume-btn').addEventListener('click', () => setPaused(false));

$('restart-btn').addEventListener('click', async () => {
  if (await confirmRestart()) openLevel(state.level, true);
});

$('level-btn').addEventListener('click', showLevels);
$('levels-btn').addEventListener('click', showLevels);

$('win-dialog').addEventListener('close', () => {
  const choice = $('win-dialog').returnValue;
  if (choice === 'next') openLevel(state.level + 1);
  else if (choice === 'levels') showLevels();
});

// ---------- Level picker ----------
function showLevels() {
  save();
  const done = game.completed;
  const progress = game.progress;
  const list = $('levels-list');
  list.textContent = '';

  let grid = null;
  let group = null;
  LEVELS.forEach(([difficulty], i) => {
    if (difficulty !== group) {
      group = difficulty;
      const members = LEVELS.map((l, k) => k).filter((k) => LEVELS[k][0] === difficulty);
      const finished = members.filter((k) => done[k]).length;
      const h = document.createElement('h3');
      h.innerHTML = `<span class="tag ${difficulty}">${DIFFICULTIES[difficulty].label}</span>` +
        `<small>${finished} / ${members.length}</small>`;
      grid = document.createElement('div');
      grid.className = 'level-grid';
      list.append(h, grid);
    }
    const b = document.createElement('button');
    b.className = 'level';
    b.textContent = i + 1;
    if (done[i]) {
      b.classList.add('done');
      b.title = `Best time ${formatTime(done[i].time)}`;
    } else if (progress[i]) {
      b.classList.add('started');
      b.title = 'In progress';
    }
    if (i === state.level) b.classList.add('current');
    b.addEventListener('click', () => {
      $('levels-dialog').close();
      if (i !== state.level || state.solved) openLevel(i);
    });
    grid.appendChild(b);
  });

  const count = Object.keys(done).length;
  $('levels-summary').textContent = `${count} of ${LEVELS.length} complete`;
  $('levels-dialog').showModal();
  list.querySelector('.level.current')?.scrollIntoView({ block: 'center' });
}

// Show the next unfinished level after the one just completed.
function nextUnfinished(from) {
  const done = game.completed;
  for (let k = 1; k <= LEVELS.length; k++) {
    const i = (from + k) % LEVELS.length;
    if (!done[i]) return i;
  }
  return from;
}

// Pause automatically when the window is hidden; resume when it's back.
let autoPaused = false;
document.addEventListener('visibilitychange', () => {
  if (!state || state.solved) return;
  if (document.hidden) {
    flushCloud();
    if (!paused) { autoPaused = true; setPaused(true); }
  } else if (autoPaused) {
    autoPaused = false;
    setPaused(false);
  }
});
window.addEventListener('pagehide', () => { save(); flushCloud(); });

// ---------- Theme ----------
function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

$('theme-btn').addEventListener('click', () => {
  const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const current = document.documentElement.dataset.theme || (systemDark ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  store(THEME_KEY, next);
});

// ---------- Accounts ----------
const accountBtn = $('account-btn');
const accountDialog = $('account-dialog');

function setSyncStatus(status) {
  const el = $('sync-status');
  if (!el) return;
  el.textContent = status === 'offline'
    ? "Couldn't reach the server — progress is kept on this device and will sync later."
    : 'Your progress is saved to your Google account.';
  el.classList.toggle('warn', status === 'offline');
}

function renderAccount() {
  const configured = cloud.isConfigured();
  accountBtn.hidden = !configured;
  $('guest-note').hidden = !configured || !!user;
  if (!configured) return;

  if (user) {
    accountBtn.classList.add('signed-in');
    accountBtn.title = `Signed in as ${user.email}`;
    accountBtn.innerHTML = user.photo
      ? `<img src="${encodeURI(user.photo)}" alt="" referrerpolicy="no-referrer">`
      : `<span class="initial">${(user.name || '?')[0].toUpperCase()}</span>`;
  } else {
    accountBtn.classList.remove('signed-in');
    accountBtn.title = 'Sign in with Google';
    accountBtn.textContent = 'Sign in';
  }
}

function openAccountDialog() {
  if (!user || user.pending) { doSignIn(); return; }
  $('account-name').textContent = user.name;
  $('account-email').textContent = user.email;
  $('admin-link').hidden = !user.isAdmin;
  accountDialog.showModal();
}

async function doSignIn() {
  try {
    await cloud.signIn();
  } catch (err) {
    console.error(err);
    alert(`Sign-in failed: ${err?.message || err}`);
  }
}

function reopenCurrent() {
  const level = game.level ?? 0;
  openLevel(game.completed[level] && !game.progress[level] ? nextUnfinished(level) : level);
}

async function handleUserChanged(next) {
  if (!next) {
    if (user) {
      // Signed out: drop back to a fresh guest session.
      flushCloud();
      user = null;
      try { localStorage.removeItem(LAST_UID_KEY); } catch { /* ignore */ }
      game = emptyGame();
      reopenCurrent();
    }
    renderAccount();
    return;
  }
  if (user && !user.pending && user.uid === next.uid) return;

  const guestGame = user ? null : game; // progress made before signing in
  user = next;
  store(LAST_UID_KEY, next.uid);
  renderAccount();

  const cached = load(accountCacheKey(next.uid));
  let remote = null;
  let reachable = true;
  try {
    remote = await cloud.loadUserData(next);
  } catch (err) {
    console.warn('Could not load cloud progress', err);
    reachable = false;
  }

  // Use whichever copy is newer, then fold in anything played as a guest.
  let merged = [remote, cached].filter(Boolean).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  merged = merged ? { ...emptyGame(), ...merged } : emptyGame();
  if (guestGame && hasAnything(guestGame)) merged = mergeGames(merged, guestGame);

  const changed = JSON.stringify(compact(merged)) !== JSON.stringify(remote && compact({ ...emptyGame(), ...remote }));
  game = merged;
  for (const k of [LEVEL_KEY, PROGRESS_KEY, DONE_KEY]) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
  if (!state || !isInProgress() || guestGame) reopenCurrent();
  else save();
  if (changed) persist({ cloudNow: true });
  setSyncStatus(reachable ? 'saved' : 'offline');
}

accountBtn.addEventListener('click', openAccountDialog);
$('guest-signin').addEventListener('click', doSignIn);
$('signout-btn').addEventListener('click', async () => {
  accountDialog.close();
  await pushToCloud();
  await cloud.signOut();
});

// ---------- Boot ----------
applyTheme(load(THEME_KEY));
buildBoard();

if (!cloud.isConfigured()) {
  // No sign-in available: keep progress on this device.
  game = { ...emptyGame(), level: load(LEVEL_KEY, 0), progress: load(PROGRESS_KEY, {}), completed: load(DONE_KEY, {}) };
} else {
  // Show the last signed-in account's progress straight away; Firebase confirms the session shortly.
  const lastUid = load(LAST_UID_KEY);
  const cached = lastUid && load(accountCacheKey(lastUid));
  if (cached) {
    game = { ...emptyGame(), ...cached };
    user = { uid: lastUid, pending: true };
  } else {
    // Progress saved on this device before sign-in existed: offer it up as guest progress,
    // so it's carried into the account on first sign-in.
    const legacy = { ...emptyGame(), level: load(LEVEL_KEY, 0), progress: load(PROGRESS_KEY, {}), completed: load(DONE_KEY, {}) };
    if (hasAnything(legacy)) game = legacy;
  }
}
renderAccount();
reopenCurrent();

cloud.onUserChanged((u) => {
  handleUserChanged(u).catch((err) => console.error(err));
}).catch((err) => {
  console.warn('Sign-in unavailable', err);
  if (user?.pending) user = null;
  renderAccount();
});

// ---------- Updates ----------
// Installed apps can stay open for days, so check for a new version when the app comes
// back into view and every 30 minutes. A new version's service worker takes over straight
// away (skipWaiting + clients.claim), which fires `controllerchange`; reload then so the
// new code runs. Guests would lose unsaved progress, so they get a reload button instead.
const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    if (!reg) return;
    const check = () => reg.update().catch(() => {});
    setInterval(check, UPDATE_CHECK_INTERVAL);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }).catch(() => {});

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // first install: already running the latest code
    const guestWouldLose = cloud.isConfigured() && !user && (isInProgress() || hasAnything(game));
    if (guestWouldLose) {
      $('update-banner').hidden = false;
      return;
    }
    reloading = true;
    save(); // writes the local copy synchronously; the cloud catches up after reload
    location.reload();
  });
}

$('update-reload').addEventListener('click', () => location.reload());
