import { generate, PEERS, ROW, COL, DIFFICULTIES } from './sudoku.js';

const SAVE_KEY = 'sudoku.game';
const BEST_KEY = 'sudoku.best';
const THEME_KEY = 'sudoku.theme';
const DIFF_KEY = 'sudoku.difficulty';

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const numpadEl = $('numpad');
const timerEl = $('timer');
const mistakesEl = $('mistakes');
const difficultyEl = $('difficulty');
const notesBtn = $('notes-btn');
const pauseOverlay = $('pause-overlay');

let state = null;      // current game, persisted
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

// ---------- Game lifecycle ----------
function newGame(difficulty) {
  const { puzzle, solution } = generate(difficulty);
  state = {
    difficulty,
    puzzle,
    solution,
    values: puzzle.slice(),
    notes: new Array(81).fill(0),
    elapsed: 0,
    mistakes: 0,
    hints: 0,
    history: [],
    solved: false,
  };
  selected = -1;
  boardEl.classList.remove('solved');
  store(DIFF_KEY, difficulty);
  save();
  setPaused(false);
  render();
}

function save() {
  if (state) store(SAVE_KEY, state);
}

function isInProgress() {
  return state && !state.solved && state.history.length > 0;
}

async function confirmNewGame() {
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
  const best = load(BEST_KEY, {});
  const prevBest = best[state.difficulty];
  const isRecord = !state.hints && (prevBest == null || state.elapsed < prevBest);
  if (isRecord) {
    best[state.difficulty] = state.elapsed;
    store(BEST_KEY, best);
  }
  boardEl.classList.add('solved');

  const label = DIFFICULTIES[state.difficulty].label;
  const parts = [`${label} puzzle solved in ${formatTime(state.elapsed)}`];
  parts.push(state.mistakes === 1 ? 'with 1 mistake' : `with ${state.mistakes} mistakes`);
  if (state.hints) parts.push(`and ${state.hints} hint${state.hints > 1 ? 's' : ''}`);
  let text = parts.join(' ') + '.';
  if (isRecord && prevBest != null) text += ' New best time!';
  else if (isRecord) text += ' First win at this level!';
  else if (prevBest != null) text += ` Best: ${formatTime(prevBest)}.`;
  $('win-text').textContent = text;
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
    if (state.elapsed % 5 === 0) save();
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
  if (paused) { stopTimer(); save(); } else startTimer();
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
  difficultyEl.value = state.difficulty;
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
  if (e.target === difficultyEl) return;

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

$('new-btn').addEventListener('click', async () => {
  if (await confirmNewGame()) newGame(difficultyEl.value);
});

difficultyEl.addEventListener('change', async () => {
  if (await confirmNewGame()) newGame(difficultyEl.value);
  else difficultyEl.value = state.difficulty;
  difficultyEl.blur();
});

$('win-dialog').addEventListener('close', () => {
  if ($('win-dialog').returnValue === 'new') newGame(difficultyEl.value);
});

// Pause automatically when the window is hidden; resume when it's back.
let autoPaused = false;
document.addEventListener('visibilitychange', () => {
  if (!state || state.solved) return;
  if (document.hidden) {
    if (!paused) { autoPaused = true; setPaused(true); }
  } else if (autoPaused) {
    autoPaused = false;
    setPaused(false);
  }
});
window.addEventListener('pagehide', save);

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

// ---------- Boot ----------
applyTheme(load(THEME_KEY));
buildBoard();

const saved = load(SAVE_KEY);
if (saved && Array.isArray(saved.values) && saved.values.length === 81 && !saved.solved) {
  state = saved;
  render();
  startTimer();
} else {
  newGame(load(DIFF_KEY, 'easy'));
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
