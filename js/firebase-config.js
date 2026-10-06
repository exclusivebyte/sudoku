// Firebase project settings. These values are safe to publish: access to data is
// controlled by the security rules in firestore.rules, not by keeping this secret.
//
// To enable Google sign-in, replace `null` with the config object from
// Firebase console → Project settings → Your apps → Web app, e.g.
//
// export const firebaseConfig = {
//   apiKey: '...',
//   authDomain: 'your-project.firebaseapp.com',
//   projectId: 'your-project',
//   appId: '...',
// };
export const firebaseConfig = {
  apiKey: 'AIzaSyAz5itDG1gna0RpYZDtjk9uQN8xgtIlIIA',
  authDomain: 'sudoku-login-9da79.firebaseapp.com',
  projectId: 'sudoku-login-9da79',
  storageBucket: 'sudoku-login-9da79.firebasestorage.app',
  messagingSenderId: '85844456282',
  appId: '1:85844456282:web:74ba8b1e67818e56653963',
};

// Accounts allowed to open the admin panel. The real check is in firestore.rules —
// keep both lists in sync.
export const ADMIN_EMAILS = ['infiniteagario@gmail.com'];
