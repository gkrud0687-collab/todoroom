// Shared Firebase setup + helpers
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import manifest from './manifest.json';

import { firebaseConfig } from './firebase-config.js';

export const fbApp = initializeApp(firebaseConfig);
export const auth = getAuth(fbApp);
export const db = getDatabase(fbApp);
export { manifest };

// sign-in address for using one character on several computers (no real mailbox; only the password matters)
// keep authDomain unchanged: accounts that already set a password sign in with this exact address
export const loginEmail = (uid) => `u${String(uid).toLowerCase()}@${firebaseConfig.authDomain}`;

export const CHARS = ['black_cat', 'hamster', 'squirrel', 'chick'];
export const CHAR_LABEL = { black_cat: '검은 고양이', hamster: '햄스터', squirrel: '날다람쥐', chick: '오리' };
export const MEMO_COLORS = ['#F9E4EC', '#E3F1F8', '#FFF4BA', '#E0EFE0', '#EAE1F4', '#ECE0D1', '#E5E6E8', '#FCF9F2'];
export const MAX_TODOS = 5;
export const MAX_TEXT = 60;

// Wait for the persisted user first; only create a new anonymous user when none exists.
export function ensureUser() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (user) return resolve(user);
      try { const cred = await signInAnonymously(auth); resolve(cred.user); }
      catch (e) { reject(e); }
    }, reject);
  });
}

export function startOfToday() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
}

// todos object -> today's list sorted by createdAt
export function todaysTodos(obj) {
  const s = startOfToday();
  return Object.entries(obj || {})
    .map(([id, t]) => ({ id, ...t }))
    .filter((t) => t && typeof t.text === 'string' && Number(t.createdAt) >= s)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, MAX_TODOS);
}

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
}
