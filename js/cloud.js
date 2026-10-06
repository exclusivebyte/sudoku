// Google sign-in and per-user cloud saves, backed by Firebase Auth + Firestore.
// Everything here is a no-op when js/firebase-config.js has no config.
import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

let fb = null; // loaded SDK modules + instances

export const isConfigured = () => !!firebaseConfig;

export const isAdminEmail = (email) =>
  !!email && ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase());

async function sdk() {
  if (fb) return fb;
  const [app, auth, store] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const instance = app.initializeApp(firebaseConfig);
  fb = { auth, store, a: auth.getAuth(instance), db: store.getFirestore(instance) };
  return fb;
}

function toUser(u) {
  if (!u) return null;
  return {
    uid: u.uid,
    email: u.email,
    name: u.displayName || u.email,
    photo: u.photoURL,
    isAdmin: isAdminEmail(u.email) && u.emailVerified,
  };
}

// Calls `cb(user | null)` now and whenever the signed-in user changes.
export async function onUserChanged(cb) {
  if (!isConfigured()) { cb(null); return; }
  const { auth, a } = await sdk();
  auth.onAuthStateChanged(a, (u) => cb(toUser(u)));
}

export async function signIn() {
  const { auth, a } = await sdk();
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await auth.signInWithPopup(a, provider);
  } catch (err) {
    // Some installed-app contexts block popups; fall back to a full-page redirect.
    if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/operation-not-supported-in-this-environment') {
      await auth.signInWithRedirect(a, provider);
    } else if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
      throw err;
    }
  }
}

export async function signOut() {
  const { auth, a } = await sdk();
  await auth.signOut(a);
}

// Returns the user's saved game data, creating their account record on first sign-in.
export async function loadUserData(user) {
  const { store, db } = await sdk();
  const ref = store.doc(db, 'users', user.uid);
  const snap = await store.getDoc(ref);
  const profile = { email: user.email, name: user.name, photo: user.photo || null, lastSeen: store.serverTimestamp() };
  if (snap.exists()) {
    await store.updateDoc(ref, profile);
    return snap.data().game || null;
  }
  await store.setDoc(ref, { ...profile, createdAt: store.serverTimestamp(), completedCount: 0, game: null });
  return null;
}

export async function saveUserData(user, game) {
  const { store, db } = await sdk();
  await store.updateDoc(store.doc(db, 'users', user.uid), {
    game,
    completedCount: Object.keys(game.completed || {}).length,
    lastSeen: store.serverTimestamp(),
  });
}

// ---------- Admin ----------
export async function adminStats() {
  const { store, db } = await sdk();
  const users = store.collection(db, 'users');
  const weekAgo = store.Timestamp.fromMillis(Date.now() - 7 * 24 * 3600 * 1000);
  const [total, newThisWeek, activeThisWeek] = await Promise.all([
    store.getCountFromServer(users),
    store.getCountFromServer(store.query(users, store.where('createdAt', '>=', weekAgo))),
    store.getCountFromServer(store.query(users, store.where('lastSeen', '>=', weekAgo))),
  ]);
  return {
    total: total.data().count,
    newThisWeek: newThisWeek.data().count,
    activeThisWeek: activeThisWeek.data().count,
  };
}

export async function adminRecentUsers(max = 100) {
  const { store, db } = await sdk();
  const q = store.query(store.collection(db, 'users'), store.orderBy('createdAt', 'desc'), store.limit(max));
  const snap = await store.getDocs(q);
  return snap.docs.map((d) => {
    const u = d.data();
    return {
      name: u.name,
      email: u.email,
      photo: u.photo,
      createdAt: u.createdAt?.toDate?.() ?? null,
      lastSeen: u.lastSeen?.toDate?.() ?? null,
      completed: u.completedCount ?? 0,
    };
  });
}
