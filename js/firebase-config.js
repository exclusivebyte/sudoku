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
export const firebaseConfig = null;

// Accounts allowed to open the admin panel. The real check is in firestore.rules —
// keep both lists in sync.
export const ADMIN_EMAILS = ['infiniteagario@gmail.com'];
