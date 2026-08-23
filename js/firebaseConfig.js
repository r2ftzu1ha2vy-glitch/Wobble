// ============================================================
// FIREBASE CONFIGURATION
// ============================================================
// Replace the values below with your own Firebase project's
// config (Project Settings -> General -> Your apps -> SDK setup).
//
// Only Firebase Realtime Database is used by this game.
// Do NOT enable / use Firebase Storage.
//
// Example:
// const firebaseConfig = {
//   apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
//   authDomain: "your-project.firebaseapp.com",
//   databaseURL: "https://your-project-default-rtdb.firebaseio.com",
//   projectId: "your-project",
//   storageBucket: "your-project.appspot.com", // not used
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abcdef123456"
// };
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyA6rHdshpKKdGQhaTo2pRKkE2TF-JlFBZ4",
  authDomain: "wobble-2273b.firebaseapp.com",
  databaseURL: "https://wobble-2273b-default-rtdb.firebaseio.com",
  projectId: "wobble-2273b",
  storageBucket: "wobble-2273b.firebasestorage.app",              // intentionally unused — no Firebase Storage
  messagingSenderId: "1071368884205",
  appId: "1:1071368884205:web:3cb5887df5ad27941de1e4"
};

let app = null;
let db = null;
let firebaseReady = false;

export function initFirebase() {
  if (firebaseReady) return { app, db, ok: true };
  try {
    if (typeof firebase === "undefined") {
      console.warn("[Wobble] Firebase SDK not loaded.");
      return { app: null, db: null, ok: false };
    }
    if (firebaseConfig.apiKey === "REPLACE_ME") {
      console.warn(
        "[Wobble] Firebase config not set. Multiplayer will not work until " +
        "you fill in js/firebaseConfig.js with your project's credentials."
      );
      return { app: null, db: null, ok: false };
    }
    app = firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    firebaseReady = true;
    return { app, db, ok: true };
  } catch (err) {
    console.error("[Wobble] Firebase init failed:", err);
    return { app: null, db: null, ok: false };
  }
}

export function getDb() {
  return db;
}

export function isFirebaseReady() {
  return firebaseReady;
}
