import { ref, onValue, runTransaction, update, remove, get } from 'firebase/database';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { db, auth, loginEmail, ensureUser, manifest, CHARS, CHAR_LABEL, el } from './fb.js';

const $ = (s) => document.querySelector(s);
const msg = (t) => { $('#msg').textContent = t || ''; };

let uid = null;
let claims = {};
let users = {};
let loginChar = null; // a sold-out character I'm signing in to from this computer
let picked = null;
let config = {};

function render() {
  const box = $('#cards');
  box.textContent = '';
  for (const c of CHARS) {
    const owner = claims[c];
    const sold = owner && owner !== uid;
    const card = el('div', { class: 'card' + (sold ? ' sold' : '') + (picked === c || loginChar === c ? ' sel' : ''), title: sold ? '품절' : CHAR_LABEL[c] },
      el('img', { class: 'pic', src: manifest[c].select, alt: CHAR_LABEL[c], draggable: 'false' }),
      el('div', { class: 'lbl', text: CHAR_LABEL[c] }),
      el('img', { class: 'stamp', src: 'assets/ui/soldout_stamp.png', alt: '품절', draggable: 'false' }));
    card.addEventListener('click', () => {
      if (sold) { openLogin(c); return; }
      closeLogin(); picked = c; msg(''); render(); updateGo();
    });
    box.append(card);
  }
}

function updateGo() {
  const name = $('#name').value.trim();
  $('#go').disabled = !(uid && picked && name.length >= 1);
}

async function start() {
  const name = $('#name').value.trim().slice(0, 12);
  if (!picked || !name) return;
  $('#go').disabled = true;
  msg('저장하는 중…');
  try {
    const res = await runTransaction(ref(db, `claims/${picked}`), (cur) => {
      if (cur === null || cur === uid) return uid;
      return; // abort: sold out
    });
    if (!res.committed) { msg('앗, 방금 다른 친구가 골랐어요. 다른 캐릭터를 골라 주세요.'); picked = null; render(); updateGo(); return; }
    // release the previous character if it was mine
    for (const c of CHARS) if (c !== picked && claims[c] === uid) await remove(ref(db, `claims/${c}`));
    const color = config.color || null;
    await update(ref(db, `users/${uid}`), color ? { name, char: picked, color, updatedAt: Date.now() } : { name, char: picked, updatedAt: Date.now() });
    await window.api.setConfig({ uid, char: picked, name });
    window.api.setupDone();
  } catch (e) {
    console.error(e);
    msg('저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.');
    updateGo();
  }
}

// ---------- sign in to my own character from another computer ----------
function openLogin(c) {
  const owner = claims[c]; const u = users[owner] || {};
  picked = null;
  if (!u.linked) {
    closeLogin(); render(); updateGo();
    msg(`${CHAR_LABEL[c]}는 이미 다른 친구가 골랐어요. 품절! (내 캐릭터라면 원래 컴퓨터의 설정에서 비밀번호를 먼저 정해 주세요)`);
    return;
  }
  loginChar = c;
  $('#pickRow').style.display = 'none'; $('#loginRow').style.display = '';
  $('#loginWho').textContent = `${u.name || CHAR_LABEL[c]}의 ${CHAR_LABEL[c]}`;
  msg('내 캐릭터라면 원래 컴퓨터에서 정한 비밀번호를 넣어 주세요.');
  render(); $('#pw').value = ''; $('#pw').focus();
}
function closeLogin() {
  loginChar = null;
  $('#pickRow').style.display = ''; $('#loginRow').style.display = 'none';
}
async function login() {
  const c = loginChar; const owner = c && claims[c]; const pw = $('#pw').value;
  if (!owner || !pw) return;
  $('#loginGo').disabled = true; msg('확인하는 중…');
  try {
    const cred = await signInWithEmailAndPassword(auth, loginEmail(owner), pw);
    if (cred.user.uid !== owner) throw Object.assign(new Error('other account'), { code: 'auth/invalid-credential' });
    const u = users[owner] || {};
    const patch = { uid: owner, char: c, name: String(u.name || CHAR_LABEL[c]).slice(0, 12) };
    if (u.color) patch.color = u.color;
    await window.api.setConfig(patch);
    window.api.setupDone();
  } catch (e) {
    console.error(e);
    const code = e && e.code;
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials', 'auth/invalid-email'].includes(code)) msg('비밀번호가 맞지 않아요.');
    else if (code === 'auth/too-many-requests') msg('너무 여러 번 틀렸어요. 잠시 뒤에 다시 해 주세요.');
    else if (code === 'auth/operation-not-allowed') msg('Firebase에서 "이메일/비밀번호" 로그인을 먼저 켜 주세요.');
    else msg('들어가지 못했어요. 인터넷 연결을 확인해 주세요.');
  } finally { $('#loginGo').disabled = false; }
}

async function main() {
  config = await window.api.getConfig();
  if (config.name) $('#name').value = config.name;
  if (config.char) picked = config.char;
  render();
  $('#name').addEventListener('input', updateGo);
  $('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
  $('#go').addEventListener('click', start);
  $('#loginGo').addEventListener('click', login);
  $('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('#loginBack').addEventListener('click', () => { closeLogin(); msg(''); render(); });
  $('#close').addEventListener('click', () => window.api.setupCancel());
  try {
    const user = await ensureUser();
    uid = user.uid;
    if (config.uid && config.uid !== uid) console.warn('uid changed', config.uid, uid);
    onValue(ref(db, 'users'), (snap) => { users = snap.val() || {}; }, () => {});
    onValue(ref(db, 'claims'), (snap) => {
      claims = snap.val() || {};
      if (picked && claims[picked] && claims[picked] !== uid) picked = null;
      msg(''); render(); updateGo();
    }, (e) => { console.error(e); msg('목록을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'); });
  } catch (e) {
    console.error(e);
    msg('연결하지 못했어요. 인터넷 연결을 확인하고 다시 열어 주세요.');
  }
}
main();

window.__todoroomDebug = {
  p5() { uid = 'x'; claims = { black_cat: 'me', hamster: 'u1' }; users = { me: { name: '하경', char: 'black_cat', linked: true }, u1: { name: '민지', char: 'hamster' } }; render(); openLogin('black_cat'); },
  p5b() { openLogin('hamster'); },
};
