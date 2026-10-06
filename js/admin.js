import * as cloud from './cloud.js';

const $ = (id) => document.getElementById(id);

const THEME_KEY = 'sudoku.theme';
try {
  const theme = JSON.parse(localStorage.getItem(THEME_KEY));
  if (theme) document.documentElement.dataset.theme = theme;
} catch { /* ignore */ }

function gate(text, showSignIn = false) {
  $('gate').hidden = false;
  $('dashboard').hidden = true;
  $('gate-text').textContent = text;
  $('signin-btn').hidden = !showSignIn;
}

const fmtDate = (d) => (d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

function relative(d) {
  if (!d) return '–';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return days < 30 ? `${days} d ago` : fmtDate(d);
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

async function loadDashboard() {
  $('gate').hidden = true;
  $('dashboard').hidden = false;
  $('refresh-btn').disabled = true;
  try {
    const [stats, users] = await Promise.all([cloud.adminStats(), cloud.adminRecentUsers(100)]);
    $('stat-total').textContent = stats.total.toLocaleString();
    $('stat-new').textContent = stats.newThisWeek.toLocaleString();
    $('stat-active').textContent = stats.activeThisWeek.toLocaleString();

    const body = $('users');
    body.textContent = '';
    for (const u of users) {
      const tr = document.createElement('tr');
      const who = document.createElement('td');
      const wrap = document.createElement('div');
      wrap.className = 'player';
      if (u.photo) {
        const img = document.createElement('img');
        img.src = u.photo;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        wrap.appendChild(img);
      } else {
        const span = document.createElement('span');
        span.className = 'initial';
        span.textContent = (u.name || u.email || '?')[0].toUpperCase();
        wrap.appendChild(span);
      }
      const label = document.createElement('div');
      label.textContent = u.name || u.email;
      const email = document.createElement('small');
      email.textContent = u.email;
      label.appendChild(email);
      wrap.appendChild(label);
      who.appendChild(wrap);
      const done = cell(u.completed);
      done.className = 'num-col';
      tr.append(who, cell(fmtDate(u.createdAt)), cell(relative(u.lastSeen)), done);
      body.appendChild(tr);
    }
    $('table-note').textContent = users.length
      ? (stats.total > users.length ? `Showing the ${users.length} most recent of ${stats.total}.` : '')
      : 'No one has signed up yet.';
  } catch (err) {
    console.error(err);
    gate(`Couldn't load data: ${err?.message || err}`);
  } finally {
    $('refresh-btn').disabled = false;
  }
}

function renderWho(user) {
  const who = $('who');
  who.textContent = '';
  if (!user) return;
  const span = document.createElement('span');
  span.textContent = user.email;
  const out = document.createElement('button');
  out.textContent = 'Sign out';
  out.addEventListener('click', () => cloud.signOut());
  who.append(span, out);
}

$('signin-btn').addEventListener('click', () => cloud.signIn().catch((e) => gate(`Sign-in failed: ${e?.message || e}`, true)));
$('refresh-btn').addEventListener('click', loadDashboard);

if (!cloud.isConfigured()) {
  gate('Sign-in isn\'t set up yet. Add your Firebase config to js/firebase-config.js (see README).');
} else {
  cloud.onUserChanged((user) => {
    renderWho(user);
    if (!user) gate('Sign in with the admin Google account to see player stats.', true);
    else if (!user.isAdmin) gate(`${user.email} doesn't have admin access.`);
    else loadDashboard();
  }).catch((err) => gate(`Couldn't start sign-in: ${err?.message || err}`));
}
