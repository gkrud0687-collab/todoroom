import { ref, onValue, push, update, remove, set, serverTimestamp, runTransaction } from 'firebase/database';
import { EmailAuthProvider, linkWithCredential, updatePassword } from 'firebase/auth';
import { db, auth, loginEmail, ensureUser, manifest, MEMO_COLORS, MAX_TODOS, MAX_TEXT, todaysTodos, el } from './fb.js';
import { play, setSoundSettings, getSoundSettings } from './sound.js';
import { sendEvent, sendMail, MOOD_MAX, MEGA_MAX, MEGA_COOLDOWN, THROW_COOLDOWN, REWARD, giftById, monthKey, pomoSettings, MAIL_KEEP, NOTE_MAX, NOTE_COOLDOWN, TRASH_KEEP_MS, dndActive, dndUntilText, PRANKS, NICK_MAX, sendPrank } from './events.js';
import { fmtDuration, elapsedOf, RETENTION_MS, dayKey } from './time.js';

const $ = (s) => document.querySelector(s);
const msg = (t) => { $('#msg').textContent = t || ''; };
const FALLBACK_FONTS = ['맑은 고딕', '나눔고딕', '나눔스퀘어', '나눔바른고딕', '굴림', '돋움', '바탕', '궁서'];
const DEFAULT_FONT = '맑은 고딕';
const MAX_SHORTCUTS = 12;

let uid = null;
let config = {};
let allTodos = {};
let items = [];
let users = {};
let online = {};
let lastMega = 0, lastThrow = 0;
let reportChecked = false;
let mail = {}, rewards = {}, gifts = {};
let trash = {};                 // deleted to-dos kept for a day
const expectedGone = new Set(); // ids I removed myself (× / trash), so they are not "unexplained"
let pendingDel = null;          // { id, until }: the × was pressed once, press again to delete
let noteTo = null, lastNote = 0;
const log = (m) => { try { window.api.log('todo', m); } catch {} };
let yielded = false;      // another computer is using this character right now
let remotePomo = null;    // that computer's pomodoro (read-only here)
let serverOffset = 0;
const pomoState = () => (yielded ? remotePomo : config.pomoState || null);
// settings shared by all my computers: saved shortcuts and pomodoro minutes
async function setShared(partial) {
  config = await window.api.setConfig(partial);
  if (uid) update(ref(db, `prefs/${uid}`), partial).catch(() => {});
  return config;
}
const mmss = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

function showDate() {
  $('#date').textContent = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
}

// ---------- look: color, font, size ----------
function applyColor(c) {
  $('#memo').style.background = c;
  for (const s of document.querySelectorAll('.sw')) s.classList.toggle('sel', s.dataset.c === c);
}
function applyFont() {
  const f = config.font || DEFAULT_FONT;
  const size = Number(config.fontSize) || 15;
  document.documentElement.style.setProperty('--font', `"${f.replace(/"/g, '')}", "Malgun Gothic", "맑은 고딕", sans-serif`);
  document.documentElement.style.setProperty('--fs', size + 'px');
  for (const b of document.querySelectorAll('#sizes button')) b.classList.toggle('sel', Number(b.dataset.s) === size);
  const sel = $('#fontSel'); if (sel && sel.value !== f) sel.value = f;
}
function fillFontOptions(families) {
  const sel = $('#fontSel'); const cur = config.font || DEFAULT_FONT;
  const list = [...new Set([cur, DEFAULT_FONT, ...families])];
  sel.textContent = '';
  for (const f of list) { const o = el('option', { value: f, text: f }); o.style.fontFamily = `"${f}"`; sel.append(o); }
  sel.value = cur;
}
let fontsLoaded = false;
async function loadFonts() {
  if (fontsLoaded) return; fontsLoaded = true;
  try {
    if (!window.queryLocalFonts) throw new Error('no api');
    const fonts = await window.queryLocalFonts();
    const fam = [...new Set(fonts.map((f) => f.family))];
    if (!fam.length) throw new Error('empty');
    const ko = fam.filter((f) => /[가-힣]/.test(f)).sort((a, b) => a.localeCompare(b, 'ko'));
    const other = fam.filter((f) => !/[가-힣]/.test(f) && !/^(Segoe|Marlett|Webdings|Wingdings|Symbol|MT Extra|HoloLens|Sitka)/.test(f)).sort();
    fillFontOptions([...ko, ...other]);
    $('#fontHint').textContent = `컴퓨터에 있는 글꼴 ${fam.length}개를 불러왔어요.`;
  } catch (e) {
    fillFontOptions(FALLBACK_FONTS);
    $('#fontHint').textContent = '글꼴 목록을 불러오지 못해서 기본 글꼴만 보여요.';
  }
}
function buildLook() {
  const row = $('#swRow');
  for (const c of MEMO_COLORS) {
    const b = el('button', { class: 'sw', title: c });
    b.dataset.c = c; b.style.background = c;
    b.addEventListener('click', async () => {
      applyColor(c);
      config = await window.api.setConfig({ color: c });
      if (uid) update(ref(db, `users/${uid}`), { color: c }).catch(() => {});
    });
    row.append(b);
  }
  fillFontOptions(FALLBACK_FONTS);
  $('#fontSel').addEventListener('change', async () => { config = await window.api.setConfig({ font: $('#fontSel').value }); applyFont(); });
  for (const b of document.querySelectorAll('#sizes button')) {
    b.addEventListener('click', async () => { config = await window.api.setConfig({ fontSize: Number(b.dataset.s) }); applyFont(); });
  }
  $('#color').addEventListener('click', (e) => { e.stopPropagation(); togglePopup('#swatches'); loadFonts(); });
}

// ---------- rows ----------
function rowFor(item, idx) {
  const has = !!item;
  const running = has && !item.done && !!item.runningSince;
  const li = el('li', { class: (has && item.done ? 'done' : '') + (running ? ' running' : '') });
  li.dataset.idx = String(idx);
  if (has) li.dataset.id = item.id;
  const cb = el('button', { class: 'cb', title: has ? (item.done ? '완료 취소' : '완료') : '' },
    el('img', { src: has && item.done ? 'assets/ui/checkbox_checked.png' : 'assets/ui/checkbox_empty.png', alt: '' }));
  if (!has) cb.disabled = true;
  cb.addEventListener('click', () => toggle(item));
  const input = el('input', { class: 't', maxlength: String(MAX_TEXT), placeholder: has ? '' : '할 일 적기' });
  input.value = has ? item.text : '';
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = has ? item.text : ''; input.blur(); } });
  input.addEventListener('blur', () => commit(item, input.value));
  const tm = el('span', { class: 'tm' + (running ? ' run' : ''), title: '걸린 시간' });
  if (has) { tm.dataset.id = item.id; const ms = elapsedOf(item); tm.textContent = ms > 0 || running ? fmtDuration(ms) : ''; }
  const parts = [cb, input, tm];
  const ps = pomoState();
  const mine = has && ps && ps.todoId === item.id;
  const pomoOn = mine && ['focus', 'break', 'paused'].includes(ps.mode);
  if (has && !item.done) {
    if (pomoOn) {
      const pt = el('span', { class: 'pt' + (ps.mode === 'break' ? ' brk' : ps.mode === 'paused' ? ' pau' : ''), title: '뽀모도로' });
      pt.dataset.pomo = '1';
      parts.push(pt);
    } else {
      const tb = el('button', { class: 'tb', title: running ? '일시정지' : (elapsedOf(item) > 0 ? '이어서 하기' : '시작') },
        el('img', { src: running ? 'assets/ui/btn_pause.png' : 'assets/ui/btn_start.png', alt: '' }));
      tb.addEventListener('mousedown', (e) => e.preventDefault());
      tb.addEventListener('click', () => (running ? pauseTimer(item) : startTimer(item)));
      parts.push(tb);
    }
    const stop = pomoOn && ps.mode !== 'paused';
    const pb = el('button', { class: 'tb', title: stop ? '뽀모도로 그만하기' : (mine && ps.mode === 'paused' ? '뽀모도로 다시 시작' : '뽀모도로 시작') },
      el('img', { src: stop ? 'assets/ui/btn_pomodoro_stop.png' : 'assets/ui/btn_pomodoro.png', alt: '' }));
    pb.addEventListener('mousedown', (e) => e.preventDefault());
    if (yielded) { pb.disabled = true; pb.title = '다른 컴퓨터에서 쓰는 중이라 뽀모도로는 그 컴퓨터에서만 돼요'; pb.classList.add('off'); }
    pb.addEventListener('click', () => {
      if (yielded) return;
      if (stop) window.api.pomo({ type: 'stop' });
      else if (mine && ps.mode === 'paused') window.api.pomo({ type: 'resume' });
      else window.api.pomo({ type: 'start', todoId: item.id });
    });
    parts.push(pb);
  }
  const cheers = el('span', { class: 'cheers' });
  if (has && item.cheers) {
    for (const cid of Object.keys(item.cheers)) {
      const u = users[cid];
      if (u && manifest[u.char]) cheers.append(el('img', { src: manifest[u.char].face, title: `${u.name || '친구'}가 축하했어요`, alt: '' }));
    }
  }
  const asking = has && pendingDel && pendingDel.id === item.id && pendingDel.until > Date.now();
  const del = el('button', { class: 'del' + (has ? ' on' : '') + (asking ? ' ask' : ''), title: '지우기 (한 번 더 누르면 지워져요)', text: asking ? '지울까요?' : '×' });
  del.addEventListener('mousedown', (e) => e.preventDefault());
  del.addEventListener('click', () => {
    if (!has) return;
    if (pendingDel && pendingDel.id === item.id && pendingDel.until > Date.now()) { pendingDel = null; deleteTodo(item, '× 버튼'); return; }
    pendingDel = { id: item.id, until: Date.now() + 3000 };
    render();
    setTimeout(() => { if (pendingDel && pendingDel.id === item.id && pendingDel.until <= Date.now()) { pendingDel = null; render(); } }, 3100);
  });
  li.append(...parts, cheers, del);
  return li;
}

function render() {
  const list = $('#list');
  const active = document.activeElement;
  const activeLi = active && active.classList.contains('t') ? active.closest('li') : null;
  const keepIdx = activeLi ? activeLi.dataset.idx : null;
  const rows = [];
  for (let i = 0; i < MAX_TODOS; i++) {
    if (keepIdx !== null && String(i) === keepIdx) { rows.push(activeLi); continue; }
    rows.push(rowFor(items[i], i));
  }
  for (const r of [...list.children]) if (r !== activeLi) r.remove();
  rows.forEach((r, i) => { if (list.children[i] !== r) list.insertBefore(r, list.children[i] || null); });
  tickPomo();
  const done = items.filter((t) => t.done).length;
  $('#count').textContent = items.length ? `${done}/${items.length} 완료` : '할 일을 적어 보세요';
}
// '그대로 멈춰라' switch (same setting as the tray menu item)
function renderFreeze() {
  const on = !!config.freeze;
  $('#freezeBtn').classList.toggle('on', on);
  $('#freezeSt').textContent = on ? '제자리에 서 있어요' : '돌아다녀요';
}
function tickPomo() {
  const ps = pomoState(); const n = document.querySelector('.pt[data-pomo]');
  if (!n || !ps) return;
  if (ps.mode === 'focus') n.textContent = `🍅 ${mmss(ps.endsAt - Date.now())}`;
  else if (ps.mode === 'break') n.textContent = `☕ ${mmss(ps.endsAt - Date.now())}`;
  else if (ps.mode === 'paused') n.textContent = `멈춤 ${mmss(ps.remaining || 0)}`;
}
// tick running timers without rebuilding rows
setInterval(() => {
  tickPomo();
  for (const t of items) {
    if (!t.runningSince || t.done) continue;
    const n = document.querySelector(`.tm[data-id="${CSS.escape(t.id)}"]`);
    if (n) n.textContent = fmtDuration(elapsedOf(t));
  }
}, 1000);

function fail(e) { console.error(e); msg('저장하지 못했어요. 인터넷 연결을 확인해 주세요.'); setTimeout(() => msg(''), 4000); }

let focusNext = false;
async function addTodo(text) {
  if (items.length >= MAX_TODOS) { msg(`오늘 할 일은 ${MAX_TODOS}개까지 적을 수 있어요.`); setTimeout(() => msg(''), 3000); return false; }
  await push(ref(db, `todos/${uid}`), { text: text.slice(0, MAX_TEXT), done: false, createdAt: Date.now() });
  return true;
}
// delete = move to the trash (restorable for a day) in one write
function trashRecord(t, reason) {
  const rec = { text: String(t.text || ''), done: !!t.done, createdAt: Number(t.createdAt) || Date.now(), deletedAt: Date.now(), reason, device: config.device || 'local' };
  const el2 = elapsedOf(t); if (el2) rec.elapsed = el2;
  if (t.doneAt) rec.doneAt = t.doneAt;
  if (t.pomos) rec.pomos = t.pomos;
  if (t.cheers) rec.cheers = t.cheers;
  return rec;
}
async function deleteTodo(item, reason) {
  if (!item || !uid) return;
  expectedGone.add(item.id);
  log(`할 일 지움(${reason}): "${item.text}"`);
  try {
    await update(ref(db), { [`todos/${uid}/${item.id}`]: null, [`trash/${uid}/${item.id}`]: trashRecord(item, reason) });
  } catch (e) {
    log(`휴지통에 넣지 못해서 그냥 지움: ${e && (e.code || e.message)}`);
    try { await remove(ref(db, `todos/${uid}/${item.id}`)); } catch (e2) { fail(e2); }
  }
}
async function restoreTodo(id) {
  const t = trash[id]; if (!t || !uid) return;
  if (items.length >= MAX_TODOS) { msg(`오늘 할 일이 ${MAX_TODOS}개라 되살릴 수 없어요. 하나를 먼저 정리해 주세요.`); setTimeout(() => msg(''), 3500); return; }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const back = { text: t.text, done: !!t.done, createdAt: Number(t.createdAt) >= today.getTime() ? Number(t.createdAt) : Date.now() };
  if (t.elapsed) back.elapsed = t.elapsed;
  if (t.doneAt) back.doneAt = t.doneAt;
  if (t.pomos) back.pomos = t.pomos;
  if (t.cheers) back.cheers = t.cheers;
  log(`할 일 되살림: "${t.text}"`);
  try { await update(ref(db), { [`todos/${uid}/${id}`]: back, [`trash/${uid}/${id}`]: null }); } catch (e) { fail(e); }
}
// a to-do vanished without my × or the 15-day clean-up: keep a copy in the trash and write it down
let prevTodos = null;
function watchVanished(now) {
  const before = prevTodos; prevTodos = { ...now };
  if (!before) return;
  for (const [id, t] of Object.entries(before)) {
    if (now[id] || !t || typeof t.text !== 'string') continue;
    if (expectedGone.has(id)) { expectedGone.delete(id); continue; }
    setTimeout(() => {
      if (allTodos[id] || trash[id]) return; // came back, or removed through the trash (e.g. on my other computer)
      log(`원인 모르게 사라진 할 일을 휴지통에 보관: "${t.text}" (만든 시각 ${new Date(Number(t.createdAt)).toLocaleString()})`);
      set(ref(db, `trash/${uid}/${id}`), trashRecord(t, '원인 모름')).catch((e) => log(`보관 실패: ${e && (e.code || e.message)}`));
    }, 4000);
  }
}
function renderTrash() {
  const box = $('#trashList'); if (!box) return; box.textContent = '';
  const list = Object.entries(trash).filter(([, t]) => t && t.text).sort((a, b) => (b[1].deletedAt || 0) - (a[1].deletedAt || 0));
  if (!list.length) { box.append(el('div', { class: 'empty', text: '휴지통이 비어 있어요' })); return; }
  for (const [id, t] of list) {
    const rs = el('button', { class: 'rs', text: '되살리기' });
    rs.addEventListener('click', (e) => { e.stopPropagation(); restoreTodo(id); });
    box.append(el('div', { class: 'mrow' },
      el('div', { class: 'mb' }, el('div', { text: `${t.done ? '☑' : '☐'} ${t.text}` }), el('div', { class: 'mt', text: `${when(t.deletedAt)} · ${t.reason || ''}` })), rs));
  }
}
function purgeTrash() {
  const cut = Date.now() - TRASH_KEEP_MS; const patch = {};
  for (const [id, t] of Object.entries(trash)) if (!t || !(Number(t.deletedAt) > cut)) patch[id] = null;
  if (Object.keys(patch).length && uid) update(ref(db, `trash/${uid}`), patch).catch(() => {});
}

async function commit(item, raw) {
  const text = raw.trim().slice(0, MAX_TEXT);
  try {
    if (item) {
      if (!text) { // emptying a line no longer deletes it: only the × does
        if (raw !== item.text) log(`빈 글로 바뀐 줄을 원래대로 되돌림: "${item.text}"`);
        msg('지우려면 줄 끝의 × 를 두 번 눌러 주세요.'); setTimeout(() => msg(''), 3000);
      } else if (text !== item.text) await update(ref(db, `todos/${uid}/${item.id}`), { text });
    } else if (text) {
      if (await addTodo(text)) focusNext = true;
    }
  } catch (e) { fail(e); }
  render();
  if (focusNext) {
    focusNext = false;
    const empty = document.querySelector('#list li:not([data-id]) input.t');
    if (empty) empty.focus();
  }
}

// ---------- timer ----------
function startTimer(item) {
  const now = Date.now();
  const patch = {};
  for (const t of items) {
    if (t.id !== item.id && t.runningSince) { patch[`${t.id}/elapsed`] = elapsedOf(t, now); patch[`${t.id}/runningSince`] = null; }
  }
  patch[`${item.id}/runningSince`] = now;
  update(ref(db, `todos/${uid}`), patch).catch(fail);
}
function pauseTimer(item) {
  update(ref(db, `todos/${uid}/${item.id}`), { elapsed: elapsedOf(item), runningSince: null }).catch(fail);
}
function toggle(item) {
  if (!item) return;
  const done = !item.done;
  if (done) play('complete');
  const patch = { done, doneAt: done ? Date.now() : null };
  if (done && item.runningSince) { patch.elapsed = elapsedOf(item); patch.runningSince = null; }
  // the character's snack: once per to-do, the first time it is completed
  const reward = done && !item.rewarded;
  if (reward) patch.rewarded = true;
  update(ref(db, `todos/${uid}/${item.id}`), patch).catch(fail);
  if (reward) runTransaction(ref(db, `rewards/${uid}/${monthKey(Date.now())}`), (n) => (Number(n) || 0) + 1).catch((e) => log(`보상 저장 실패: ${e && (e.code || e.message)}`));
}

// ---------- popups (only one open at a time) ----------
const POPUPS = ['#swatches', '#panel', '#moodPanel', '#megaPanel', '#throwPanel', '#scPanel', '#giftPanel', '#mailPanel', '#notePanel', '#trashPanel', '#dndPanel'];
function togglePopup(sel) {
  for (const p of POPUPS) if (p !== sel) $(p).classList.remove('show');
  $(sel).classList.toggle('show');
}
document.addEventListener('click', (e) => {
  for (const p of POPUPS) { const n = $(p); if (!n.contains(e.target)) n.classList.remove('show'); }
});

// ---------- settings ----------
function syncPanel() {
  const h = { mine: false, all: false, ...(config.hide || {}) };
  $('#hMine').checked = !!h.mine; $('#hAll').checked = !!h.all;
  const s = getSoundSettings();
  $('#sOn').checked = s.on; $('#sFriend').checked = s.friend;
  const P = pomoSettings(config);
  for (const [id, k] of [['#pFocus', 'focus'], ['#pShort', 'short'], ['#pLong', 'long'], ['#pEvery', 'every']]) if (document.activeElement !== $(id)) $(id).value = String(P[k]);
  $('#sVol').value = String(Math.round(s.volume * 100)); $('#sVolTxt').textContent = Math.round(s.volume * 100) + '%';
  $('#sVol').disabled = !s.on; $('#sFriend').disabled = !s.on;
  $('#autoStart').checked = !!config.autoStart;
  $('#gpuOn').checked = config.gpu === true;
}
async function fillMonitors() {
  let list = [];
  try { list = await window.api.listScreens(); } catch {}
  const sel = $('#monSel'); sel.textContent = '';
  sel.append(el('option', { value: 'primary', text: '주 모니터' }));
  for (const d of list) sel.append(el('option', { value: String(d.id), text: `${d.n}번 (${d.w}×${d.h})${d.primary ? ' · 주' : ''}` }));
  const cur = config.monitor;
  sel.value = cur != null && cur !== 'primary' && list.some((d) => String(d.id) === String(cur)) ? String(cur) : 'primary';
}
function buildPanel() {
  const save = () => {
    const s = { on: $('#sOn').checked, volume: Number($('#sVol').value) / 100, friend: $('#sFriend').checked };
    setSoundSettings(s); syncPanel(); window.api.setConfig({ sound: s });
  };
  $('#sOn').addEventListener('change', save);
  $('#sFriend').addEventListener('change', save);
  $('#sVol').addEventListener('input', () => { $('#sVolTxt').textContent = $('#sVol').value + '%'; });
  $('#sVol').addEventListener('change', () => { save(); play('complete'); });
  $('#sTest').addEventListener('click', () => play('complete', { force: true }));
  const saveHide = async () => { config = await window.api.setConfig({ hide: { mine: $('#hMine').checked, all: $('#hAll').checked } }); };
  $('#hMine').addEventListener('change', saveHide);
  $('#hAll').addEventListener('change', saveHide);
  $('#quit').addEventListener('click', () => window.api.quit());
  $('#autoStart').addEventListener('change', async () => { config = await window.api.setConfig({ autoStart: $('#autoStart').checked }); });
  $('#gpuOn').addEventListener('change', async () => { config = await window.api.setConfig({ gpu: $('#gpuOn').checked }); msg('프로그램을 다시 켜면 적용돼요'); setTimeout(() => msg(''), 3000); });
  $('#openLog').addEventListener('click', () => window.api.openLog());
  $('#monSel').addEventListener('change', async () => { const v = $('#monSel').value; config = await window.api.setConfig({ monitor: v === 'primary' ? 'primary' : Number(v) }); });
  $('#settings').addEventListener('click', () => fillMonitors());
  $('#pwSave').addEventListener('click', savePassword);
  $('#pwIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePassword(); });
  const savePomo = async () => {
    const P = pomoSettings({ pomo: { focus: $('#pFocus').value, short: $('#pShort').value, long: $('#pLong').value, every: $('#pEvery').value } });
    await setShared({ pomo: P }); syncPanel();
  };
  for (const id of ['#pFocus', '#pShort', '#pLong', '#pEvery']) $(id).addEventListener('change', savePomo);
  $('#settings').addEventListener('click', (e) => { e.stopPropagation(); togglePopup('#panel'); });
  syncPanel();
}

// ---------- use the same character on another computer ----------
function renderLink() {
  const linked = !!(users[uid] && users[uid].linked) && auth.currentUser && !auth.currentUser.isAnonymous;
  $('#pwState').textContent = linked ? '비밀번호가 있어요. 다른 컴퓨터에서 품절된 내 캐릭터를 누르고 비밀번호를 넣으면 들어가져요.'
    : '비밀번호를 정하면 다른 컴퓨터에서도 이 캐릭터로 들어갈 수 있어요.';
  $('#pwSave').textContent = linked ? '비밀번호 바꾸기' : '비밀번호 정하기';
}
async function savePassword() {
  const pw = $('#pwIn').value;
  const out = (t) => { $('#pwState').textContent = t; };
  if (!uid || !auth.currentUser) return;
  if (pw.length < 6) { out('비밀번호는 6자 이상이어야 해요.'); return; }
  $('#pwSave').disabled = true;
  try {
    const u = auth.currentUser;
    if (u.isAnonymous) await linkWithCredential(u, EmailAuthProvider.credential(loginEmail(uid), pw));
    else await updatePassword(u, pw);
    await update(ref(db, `users/${uid}`), { linked: true });
    $('#pwIn').value = '';
    renderLink();
    out('저장했어요! 다른 컴퓨터에서 품절된 내 캐릭터를 누르고 이 비밀번호를 넣어 주세요.');
  } catch (e) {
    console.error(e);
    const c = e && e.code;
    if (c === 'auth/operation-not-allowed') out('Firebase에서 "이메일/비밀번호" 로그인을 먼저 켜 주세요.');
    else if (c === 'auth/requires-recent-login') out('보안 때문에 지금은 바꿀 수 없어요. 프로그램을 껐다 켠 뒤 비밀번호로 다시 들어와서 바꿔 주세요.');
    else if (c === 'auth/weak-password') out('비밀번호가 너무 쉬워요. 6자 이상으로 정해 주세요.');
    else out('저장하지 못했어요. 인터넷 연결을 확인해 주세요.');
  } finally { $('#pwSave').disabled = false; }
}
function useHere() {
  if (!uid) return;
  set(ref(db, `active/${uid}`), { device: config.device || 'local', ts: serverTimestamp() }).catch(fail);
}

// ---------- mood / megaphone / throw ----------
function me() { return { uid, name: config.name, char: config.char }; }
function onlineIds() { return Object.entries(online).filter(([, v]) => v && v.char).map(([k]) => k); }
const friendDnd = (id) => !!(online[id] && dndActive(online[id].dnd));
function todayMood() {
  const m = config.mood; if (!m || !m.text) return '';
  return new Date(m.ts || 0).toDateString() === new Date().toDateString() ? String(m.text) : '';
}
function buildMood() {
  $('#moodBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#moodIn').value = todayMood(); togglePopup('#moodPanel'); setTimeout(() => $('#moodIn').focus(), 0); });
  const save = async (text) => {
    config = await window.api.setConfig({ mood: text ? { text: text.slice(0, MOOD_MAX), ts: Date.now() } : null });
    $('#moodPanel').classList.remove('show');
  };
  $('#moodSave').addEventListener('click', () => save($('#moodIn').value.trim()));
  $('#moodIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') save($('#moodIn').value.trim()); });
  $('#moodClear').addEventListener('click', () => { $('#moodIn').value = ''; save(''); });
}
function buildMega() {
  $('#megaBtn').addEventListener('click', (e) => { e.stopPropagation(); togglePopup('#megaPanel'); setTimeout(() => $('#megaIn').focus(), 0); });
  const send = async () => {
    const text = $('#megaIn').value.trim().slice(0, MEGA_MAX);
    if (!text || !uid) return;
    const wait = MEGA_COOLDOWN - (Date.now() - lastMega);
    if (wait > 0) { $('#megaNote').textContent = `${Math.ceil(wait / 1000)}초 뒤에 다시 외칠 수 있어요`; return; }
    lastMega = Date.now();
    try {
      const skipped = Object.keys(users).filter((id) => id !== uid && friendDnd(id));
      const everyone = [...new Set([...Object.keys(users), uid])].filter((id) => !skipped.includes(id));
      const mailId = await sendMail(me(), everyone, { type: 'megaphone', text });
      update(ref(db, `mail/${uid}/${mailId}`), { read: true }).catch(() => {});
      await sendEvent(me(), [...onlineIds(), uid].filter((id) => !skipped.includes(id)), { type: 'megaphone', text, mailId });
      $('#megaIn').value = '';
      if (skipped.length) {
        $('#megaNote').textContent = `${skipped.map((id) => (users[id] && users[id].name) || '친구').join(', ')}님은 방해 금지 중이라 못 받았어요`;
        setTimeout(() => { $('#megaNote').textContent = ''; $('#megaPanel').classList.remove('show'); }, 3500);
      } else { $('#megaNote').textContent = ''; $('#megaPanel').classList.remove('show'); }
    } catch (e) { fail(e); }
  };
  $('#megaSend').addEventListener('click', send);
  $('#megaIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
}
function renderThrowList() {
  const box = $('#throwList'); box.textContent = '';
  const friends = Object.entries(online).filter(([id, v]) => id !== uid && v && manifest[v.char] && !v.hidden);
  if (!friends.length) { box.append(el('div', { class: 'empty', text: '지금 접속한 친구가 없어요' })); return; }
  for (const [id, v] of friends) {
    const row = el('div', { class: 'frow' }, el('img', { class: 'f', src: manifest[v.char].face, alt: '' }), el('span', { text: String(v.name || '친구') }));
    if (dndActive(v.dnd)) {
      row.append(el('span', { class: 'busy', text: '🔕 방해 금지 중' }));
      box.append(row); continue;
    }
    if (v.pomo && v.pomo.mode === 'focus') {
      row.append(el('span', { class: 'busy' }, el('img', { src: 'assets/ui/focus_badge.png', alt: '' }), '집중 중'));
      box.append(row); continue;
    }
    const btns = el('div', { class: 'pbtns' });
    for (const [kind, pr] of Object.entries(PRANKS)) {
      const b = el('button', { title: pr.label }, pr.icon ? el('img', { src: pr.icon, alt: '' }) : '🏷', pr.short);
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (kind === 'nametag') {
          let r = row.nextSibling && row.nextSibling.classList && row.nextSibling.classList.contains('nickrow') ? row.nextSibling : null;
          if (r) { r.querySelector('input').focus(); return; }
          const inp = el('input', { class: 'field', maxlength: String(NICK_MAX), placeholder: `새 이름 (${NICK_MAX}자까지)` });
          const ok = el('button', { class: 'test' }, '바꾸기');
          r = el('div', { class: 'nickrow' }, inp, ok);
          row.after(r); inp.focus();
          const go = async () => { const why = await sendPrank(me(), onlineIds(), online[id], id, 'nametag', inp.value).catch((er) => { fail(er); return '보내지 못했어요'; }); if (why) { $('#throwNote').textContent = why; } else { r.remove(); $('#throwNote').textContent = '이름표를 바꿨어요! 5분 뒤 돌아와요'; } };
          ok.addEventListener('click', (ev2) => { ev2.stopPropagation(); go(); });
          inp.addEventListener('keydown', (ev2) => { if (ev2.key === 'Enter' && !ev2.isComposing) { ev2.preventDefault(); go(); } });
          return;
        }
        const why = await sendPrank(me(), onlineIds(), online[id], id, kind).catch((er) => { fail(er); return '보내지 못했어요'; });
        $('#throwNote').textContent = why || (kind === 'peel' ? '바나나 껍질을 몰래 놓았어요 🤫' : '');
      });
      btns.append(b);
    }
    for (const [item, label, src] of [['banana', '바나나', 'assets/props/banana.png'], ['poop', '똥', 'assets/props/poop_fly.png']]) {
      const b = el('button', {}, el('img', { src, alt: '' }), label);
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (Date.now() - lastThrow < THROW_COOLDOWN) return;
        lastThrow = Date.now();
        try {
          await sendEvent(me(), [...onlineIds(), uid], { type: 'throw', to: id, item });
          sendMail(me(), [id], { type: 'throw', item }).catch(() => {});
        } catch (err) { fail(err); }
      });
      btns.prepend(b);
    }
    row.append(btns);
    box.append(row);
  }
}
function buildThrow() {
  $('#throwBtn').addEventListener('click', (e) => { e.stopPropagation(); renderThrowList(); togglePopup('#throwPanel'); });
}

// ---------- shortcuts ----------
function shortcuts() { return Array.isArray(config.shortcuts) ? config.shortcuts.filter((s) => typeof s === 'string') : []; }
function renderChips() {
  const box = $('#chips'); box.textContent = '';
  const list = shortcuts();
  if (!list.length) { box.append(el('div', { class: 'empty', text: '아직 저장한 할 일이 없어요' })); return; }
  list.forEach((text, i) => {
    const add = el('button', { class: 'add', text, title: '오늘 할 일에 넣기' });
    add.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!uid) return;
      try { if (await addTodo(text)) $('#scPanel').classList.remove('show'); } catch (err) { fail(err); }
    });
    const x = el('button', { class: 'x', text: '×', title: '저장 목록에서 빼기' });
    x.addEventListener('click', async (e) => {
      e.stopPropagation();
      const next = shortcuts(); next.splice(i, 1);
      await setShared({ shortcuts: next }); renderChips();
    });
    box.append(el('span', { class: 'chip' }, add, x));
  });
}
function buildShortcuts() {
  $('#scBtn').addEventListener('click', (e) => { e.stopPropagation(); renderChips(); togglePopup('#scPanel'); });
  const save = async () => {
    const text = $('#scIn').value.trim().slice(0, MAX_TEXT);
    if (!text) return;
    const next = shortcuts().filter((s) => s !== text);
    next.unshift(text);
    await setShared({ shortcuts: next.slice(0, MAX_SHORTCUTS) });
    $('#scIn').value = ''; renderChips();
  };
  $('#scAdd').addEventListener('click', save);
  $('#scIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

// ---------- monthly snack ranking + my gifts ----------
function renderMyReward() {
  const r = REWARD[config.char]; const n = Number(rewards[uid] && rewards[uid][monthKey()]) || 0;
  const box = $('#myReward'); box.textContent = '';
  if (r) box.append(' · ', el('img', { src: r.icon, alt: '', title: `이번 달 ${r.name}` }), `${n}`);
}
function renderGiftPanel() {
  const mk = monthKey();
  $('#rankTitle').textContent = `${Number(mk.split('-')[1])}월 간식 순위`;
  const rows = Object.entries(users).filter(([, u]) => u && manifest[u.char])
    .map(([id, u]) => ({ id, u, n: Number(rewards[id] && rewards[id][mk]) || 0 }))
    .sort((a, b) => b.n - a.n);
  const box = $('#rank'); box.textContent = '';
  if (!rows.length) box.append(el('div', { class: 'empty', text: '아직 순위가 없어요' }));
  rows.forEach((r, i) => {
    const rw = REWARD[r.u.char];
    box.append(el('div', { class: 'rrow' },
      el('span', { class: 'no', text: String(i + 1) }),
      el('img', { class: 'f', src: manifest[r.u.char].face, alt: '' }),
      el('span', { class: 'nm', text: (r.id === uid ? '나 · ' : '') + String(r.u.name || '친구') }),
      i === 0 && r.n > 0 ? el('img', { class: 'tr', src: 'assets/ui/trophy.png', alt: '1등' }) : null,
      el('span', { class: 'ct' }, rw ? el('img', { src: rw.icon, alt: '' }) : null, `${r.n}`)));
  });
  const g = $('#gifts'); g.textContent = '';
  const list = Object.values(gifts || {}).filter((x) => x && giftById(x.item)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (!list.length) { g.append(el('div', { class: 'empty', text: '받은 선물이 아직 없어요' })); return; }
  for (const x of list) {
    const it = giftById(x.item);
    g.append(el('div', { class: 'gift ' + it.tier, title: `${it.name} · ${x.month || ''}` }, el('img', { src: it.icon, alt: '' }), el('span', { text: it.name })));
  }
}
function buildGifts() {
  $('#giftBtn').addEventListener('click', (e) => { e.stopPropagation(); renderGiftPanel(); togglePopup('#giftPanel'); });
}

// ---------- mailbox ----------
function when(ts) {
  const d = new Date(ts || 0), now = new Date();
  const t = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return t;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `어제 ${t}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
function mailText(m) {
  const who = m.from === uid ? '나' : `${m.name || '친구'} 님`;
  if (m.type === 'megaphone') return `📢 ${who}: ${m.text || ''}`;
  if (m.type === 'note') return `✉ ${who}의 쪽지: ${m.text || ''}`;
  if (m.type === 'note_sent') return `✉ ${m.toName || '친구'} 님에게 보낸 쪽지: ${m.text || ''}`;
  if (m.type === 'throw') return `${m.item === 'banana' ? '🍌' : '💩'} ${m.from === uid ? '내가' : `${m.name || '친구'} 님이`} ${m.item === 'banana' ? '바나나를' : '똥을'} 던졌어요`;
  if (m.type === 'prank') {
    const pr = PRANKS[m.kind]; const nm = m.from === uid ? '내가' : `${m.name || '친구'} 님이`;
    if (m.kind === 'peel') return `🍌 ${m.name || '친구'} 님이 놓은 바나나 껍질을 밟았어요`;
    if (m.kind === 'nametag') return `🏷 ${nm} 내 이름표를 '${m.text || ''}'(으)로 바꿨어요`;
    if (m.kind === 'bonk') return `🔨 ${nm} 뿅망치로 때렸어요`;
    if (m.kind === 'poke') return `👉 ${nm} 콕 찔렀어요`;
    if (m.kind === 'tickle') return `🪶 ${nm} 간지럽혔어요`;
    if (m.kind === 'water') return `💧 ${nm} 물풍선을 던졌어요`;
    return `${nm} ${pr ? pr.label : '장난'}을 쳤어요`;
  }
  if (m.type === 'cheer') return `🎉 ${who}의 축하: ${m.phrase || '축하해요!'}${m.todoText ? ` ('${m.todoText}')` : ''}`;
  return `${who}`;
}
const isUnreadable = (m) => m && (m.type === 'megaphone' || m.type === 'note');
function unreadCount() { return Object.values(mail).filter((m) => isUnreadable(m) && !m.read && m.from !== uid).length; }
function renderMail() {
  const n = unreadCount(); const b = $('#mailBadge');
  b.textContent = n > 9 ? '9+' : String(n); b.classList.toggle('on', n > 0);
  const box = $('#mails'); box.textContent = '';
  const list = Object.entries(mail).filter(([, m]) => m && m.type).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
  if (!list.length) { box.append(el('div', { class: 'empty', text: '쪽지가 아직 없어요' })); return; }
  for (const [id, m] of list) {
    const x = el('button', { class: 'mx', text: '×', title: '내 쪽지함에서 지우기' });
    x.addEventListener('click', (e) => { e.stopPropagation(); remove(ref(db, `mail/${uid}/${id}`)).catch(fail); });
    let rp = null;
    if (m.type === 'note' && m.from !== uid) {
      rp = el('button', { class: 'rp', text: '답장' });
      rp.addEventListener('click', (e) => { e.stopPropagation(); openNote(m.from); });
    }
    const face = m.type === 'note_sent' ? (users[m.to] && manifest[users[m.to].char] ? manifest[users[m.to].char].face : null) : (manifest[m.char] ? manifest[m.char].face : null);
    box.append(el('div', { class: 'mrow' + (isUnreadable(m) && !m.read && m.from !== uid ? ' unread' : '') },
      face ? el('img', { class: 'f', src: face, alt: '' }) : null,
      el('div', { class: 'mb' }, el('div', { text: mailText(m) }), el('div', { class: 'mt', text: when(m.ts) })), rp, x));
  }
}
function trimMail() {
  const list = Object.entries(mail).sort((a, b) => ((b[1] && b[1].ts) || 0) - ((a[1] && a[1].ts) || 0));
  if (list.length <= MAIL_KEEP) return;
  const patch = {}; for (const [id] of list.slice(MAIL_KEEP)) patch[id] = null;
  update(ref(db, `mail/${uid}`), patch).catch(() => {});
}
// ---------- private notes ----------
function renderNoteTo() {
  const box = $('#noteTo'); box.textContent = '';
  const friends = Object.entries(users).filter(([id, u]) => id !== uid && u && u.char && manifest[u.char]);
  if (!friends.length) { box.append(el('span', { class: 'hint', text: '아직 쪽지를 보낼 친구가 없어요' })); return; }
  if (noteTo && !users[noteTo]) noteTo = null;
  for (const [id, u] of friends) {
    const dnd = friendDnd(id);
    const b = el('button', { class: (noteTo === id ? 'sel' : '') + (dnd ? ' dnd' : ''), title: dnd ? '방해 금지 중이라 보낼 수 없어요' : online[id] ? '지금 접속 중' : '접속하지 않음 (다음에 켤 때 보여요)' },
      el('span', { class: 'dot' + (online[id] ? ' on' : '') }), el('img', { src: manifest[u.char].face, alt: '' }), el('span', { text: (u.name || '친구') + (dnd ? ' 🔕' : '') }));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dnd) { $('#noteNote').textContent = `${u.name || '친구'}님은 방해 금지 중이라 보낼 수 없어요`; return; }
      noteTo = id; $('#noteNote').textContent = ''; renderNoteTo(); $('#noteIn').focus();
    });
    box.append(b);
  }
}
function openNote(to) {
  if (to) noteTo = to;
  $('#noteNote').textContent = '';
  if (!$('#notePanel').classList.contains('show')) togglePopup('#notePanel');
  renderNoteTo();
  setTimeout(() => $('#noteIn').focus(), 0);
}
function buildNote() {
  $('#noteBtn').addEventListener('click', (e) => { e.stopPropagation(); if ($('#notePanel').classList.contains('show')) togglePopup('#notePanel'); else openNote(null); });
  window.api.onComposeNote((to) => openNote(to));
  const cnt = () => { $('#noteCnt').textContent = `${$('#noteIn').value.length}/${NOTE_MAX}`; };
  $('#noteIn').addEventListener('input', cnt);
  const send = async () => {
    const text = $('#noteIn').value.trim().slice(0, NOTE_MAX);
    if (!uid) return;
    if (!noteTo) { $('#noteNote').textContent = '받을 친구를 골라 주세요'; return; }
    if (!text) { $('#noteNote').textContent = '보낼 말을 적어 주세요'; return; }
    if (friendDnd(noteTo)) { $('#noteNote').textContent = `${(users[noteTo] && users[noteTo].name) || '친구'}님은 방해 금지 중이라 보낼 수 없어요`; return; }
    const wait = NOTE_COOLDOWN - (Date.now() - lastNote);
    if (wait > 0) { $('#noteNote').textContent = `${Math.ceil(wait / 1000)}초 뒤에 보낼 수 있어요`; return; }
    lastNote = Date.now();
    const to = noteTo; const u = users[to] || {};
    $('#noteSend').disabled = true;
    try {
      const mailId = await sendMail(me(), [to], { type: 'note', text, to });
      const sentId = await sendMail(me(), [uid], { type: 'note_sent', text, to, toName: String(u.name || '친구').slice(0, 12) });
      update(ref(db, `mail/${uid}/${sentId}`), { read: true }).catch(() => {});
      if (online[to]) await sendEvent(me(), [to], { type: 'note', text, to, mailId });
      $('#noteIn').value = ''; cnt();
      $('#noteNote').textContent = online[to] ? `${u.name || '친구'}에게 보냈어요` : `${u.name || '친구'}가 다음에 켤 때 보여요`;
      play('complete');
      setTimeout(() => { if ($('#notePanel').classList.contains('show')) togglePopup('#notePanel'); }, 1200);
    } catch (e) { fail(e); $('#noteNote').textContent = '보내지 못했어요'; }
    finally { $('#noteSend').disabled = false; }
  };
  $('#noteSend').addEventListener('click', send);
  $('#noteIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
}
// ---------- my do-not-disturb ----------
function renderDnd() {
  const on = dndActive(config.dnd);
  $('#dndBtn').classList.toggle('on', on);
  $('#dndBtn').title = on ? `방해 금지 켜짐 (${dndUntilText(config.dnd)})` : '방해 금지';
  $('#dndState').textContent = on ? `켜져 있어요 · ${dndUntilText(config.dnd)}` : '꺼져 있어요';
  $('#dndOff').style.display = on ? '' : 'none';
}
function buildDnd() {
  $('#dndBtn').addEventListener('click', (e) => { e.stopPropagation(); renderDnd(); togglePopup('#dndPanel'); });
  const set1 = async (v) => { config = await window.api.setConfig({ dnd: v }); renderDnd(); };
  $('#dndHour').addEventListener('click', () => set1({ until: Date.now() + 3600000 }));
  $('#dndToday').addEventListener('click', () => { const t = new Date(); t.setHours(24, 0, 0, 0); set1({ until: t.getTime() }); });
  $('#dndManual').addEventListener('click', () => set1({ until: null }));
  $('#dndOff').addEventListener('click', () => set1(null));
  setInterval(renderDnd, 30000);
  renderDnd();
}
function buildTrash() {
  $('#trashBtn').addEventListener('click', (e) => { e.stopPropagation(); togglePopup('#trashPanel'); renderTrash(); });
}

function buildMail() {
  let ask = 0;
  $('#mailClear').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!uid || !Object.keys(mail).length) return;
    if (Date.now() > ask) { ask = Date.now() + 3000; $('#mailClear').textContent = '정말 모두 지울까요?'; $('#mailClear').classList.add('warn');
      setTimeout(() => { if (Date.now() > ask) { $('#mailClear').textContent = '모두 지우기'; $('#mailClear').classList.remove('warn'); } }, 3100); return; }
    ask = 0; $('#mailClear').textContent = '모두 지우기'; $('#mailClear').classList.remove('warn');
    try { await remove(ref(db, `mail/${uid}`)); log('쪽지함 모두 지움'); } catch (err) { fail(err); }
  });
  $('#mailBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopup('#mailPanel'); renderMail();
    if ($('#mailPanel').classList.contains('show') && uid) {
      const patch = {};
      for (const [id, m] of Object.entries(mail)) if (isUnreadable(m) && !m.read) patch[`${id}/read`] = true;
      if (Object.keys(patch).length) update(ref(db, `mail/${uid}`), patch).catch(() => {});
    }
  });
}

// ---------- 15-day report ----------
function checkReport() {
  if (reportChecked) return;
  reportChecked = true;
  const cutoff = Date.now() - RETENTION_MS;
  const expired = Object.values(allTodos).filter((t) => t && Number(t.createdAt) < cutoff);
  if (expired.length && config.lastReport !== dayKey(Date.now())) window.api.openReport(true);
}

async function main() {
  config = await window.api.getConfig();
  showDate();
  buildLook();
  applyColor(config.color || MEMO_COLORS[0]);
  applyFont();
  if (config.char && manifest[config.char]) $('#face').src = manifest[config.char].face;
  $('#hello').textContent = config.name ? `${config.name}의 오늘 할 일` : '오늘 할 일';
  render();

  const pin = $('#pin');
  pin.classList.toggle('off', config.pinned === false);
  pin.addEventListener('click', async () => { const on = await window.api.togglePin(); pin.classList.toggle('off', !on); });
  $('#min').addEventListener('click', () => { play('close'); window.api.minimizeTodo(); });
  $('#close').addEventListener('click', () => { play('close'); window.api.hideTodo(); });
  $('#reportBtn').addEventListener('click', () => window.api.openReport(false));
  $('#freezeBtn').addEventListener('click', async () => { config = await window.api.setConfig({ freeze: !config.freeze }); renderFreeze(); });
  renderFreeze();
  $('#useHere').addEventListener('click', useHere);
  window.api.onProfileChanged(() => location.reload());
  window.api.onTodoShown(() => play('open'));
  window.api.onConfigChanged((cfg) => {
    const before = JSON.stringify(config.pomoState || null);
    config = cfg; setSoundSettings(cfg.sound); syncPanel(); applyFont(); renderDnd(); renderFreeze();
    if (JSON.stringify(cfg.pomoState || null) !== before) render();
  });
  setSoundSettings(config.sound);
  buildPanel(); buildMood(); buildMega(); buildThrow(); buildShortcuts(); buildGifts(); buildMail(); buildNote(); buildTrash(); buildDnd(); fillMonitors();

  try {
    const user = await ensureUser();
    uid = user.uid;
    if (config.uid && config.uid !== uid) msg('계정 정보가 바뀌었어요. 트레이 메뉴에서 캐릭터를 다시 골라 주세요.');
    onValue(ref(db, `todos/${uid}`), (snap) => {
      allTodos = snap.val() || {};
      watchVanished(allTodos);
      items = todaysTodos(allTodos);
      render();
      checkReport();
    }, fail);
    onValue(ref(db, 'users'), (snap) => { users = snap.val() || {}; render(); renderLink(); if ($('#giftPanel').classList.contains('show')) renderGiftPanel(); }, () => {});
    onValue(ref(db, 'rewards'), (snap) => { rewards = snap.val() || {}; renderMyReward(); if ($('#giftPanel').classList.contains('show')) renderGiftPanel(); }, () => {});
    onValue(ref(db, `gifts/${uid}`), (snap) => { gifts = snap.val() || {}; if ($('#giftPanel').classList.contains('show')) renderGiftPanel(); }, () => {});
    onValue(ref(db, `trash/${uid}`), (snap) => { trash = snap.val() || {}; purgeTrash(); if ($('#trashPanel').classList.contains('show')) renderTrash(); }, (e) => log(`휴지통 읽기 실패: ${e && (e.code || e.message)}`));
    onValue(ref(db, `mail/${uid}`), (snap) => { mail = snap.val() || {}; renderMail(); trimMail(); }, () => {});
    onValue(ref(db, '.info/serverTimeOffset'), (s) => { serverOffset = Number(s.val()) || 0; });
    // which of my computers is in use (the one opened last)
    onValue(ref(db, `active/${uid}`), (snap) => {
      const v = snap.val();
      const was = yielded;
      yielded = !!(v && v.device && v.device !== (config.device || 'local'));
      $('#handoff').classList.toggle('show', yielded);
      if (was !== yielded) render();
    }, () => {});
    // shared settings: the saved copy wins; the first computer uploads its own
    onValue(ref(db, `prefs/${uid}`), async (snap) => {
      const v = snap.val();
      if (!v) { const up = {}; if (Array.isArray(config.shortcuts)) up.shortcuts = config.shortcuts; if (config.pomo) up.pomo = config.pomo; if (Object.keys(up).length) update(ref(db, `prefs/${uid}`), up).catch(() => {}); return; }
      const patch = {};
      if (Array.isArray(v.shortcuts) && JSON.stringify(v.shortcuts) !== JSON.stringify(config.shortcuts || [])) patch.shortcuts = v.shortcuts;
      if (v.pomo && JSON.stringify(v.pomo) !== JSON.stringify(config.pomo || null)) patch.pomo = v.pomo;
      if (Object.keys(patch).length) { config = await window.api.setConfig(patch); syncPanel(); if ($('#scPanel').classList.contains('show')) renderChips(); }
    }, () => {});
    onValue(ref(db, 'presence'), (snap) => {
      online = snap.val() || {};
      { const mineP = online[uid] && online[uid].pomo;
        const before = JSON.stringify(remotePomo);
        remotePomo = mineP && mineP.mode ? { mode: mineP.mode, endsAt: Number(mineP.endsAt) - serverOffset, todoId: mineP.todoId || null } : null;
        if (yielded && JSON.stringify(remotePomo) !== before) render(); }
      if ($('#throwPanel').classList.contains('show')) renderThrowList();
      const box = $('#online'); box.textContent = '';
      for (const p of Object.values(online)) {
        if (p && manifest[p.char]) box.append(el('img', { class: p.hidden ? 'off' : '', src: manifest[p.char].face, title: String(p.name || '') + (p.hidden ? ' (숨김)' : '') + (p.working ? ' · 일하는 중' : ''), alt: String(p.name || '') }));
      }
    }, () => {});
  } catch (e) { fail(e); }

  // refresh date + list at midnight
  let day = new Date().getDate();
  setInterval(() => { if (new Date().getDate() !== day) { day = new Date().getDate(); location.reload(); } }, 60000);
}
main();

// Developer hook for offline visual checks.
window.__todoroomDebug = {
  show(list, u) { if (u) users = u; items = list; render(); },
  p4(data) {
    uid = 'me'; users = data.users; rewards = data.rewards; gifts = data.gifts; mail = data.mail;
    config = { ...config, pomoState: data.pomoState }; items = data.items; render(); renderMyReward(); renderMail();
  },
  setConfig(c) { config = { ...config, ...c }; applyFont(); },
  p6(d) {
    uid = 'me'; users = d.users; online = d.online || {}; mail = d.mail || {}; trash = d.trash || {}; items = d.items;
    config = { ...config, autoStart: true }; render(); renderMail(); syncPanel();
  },
  askDel(id) { pendingDel = { id, until: Date.now() + 60000 }; render(); },
  openNote(to) { openNote(to); $('#noteIn').value = '오늘 저녁에 같이 온라인 작업할래? 9시쯤 어때?'; },
  openDnd() { config = { ...config, dnd: { until: Date.now() + 3600000 } }; renderDnd(); togglePopup('#dndPanel'); },
  openTrash() { togglePopup('#trashPanel'); renderTrash(); },
  openMail() { togglePopup('#mailPanel'); renderMail(); },
  openSettings() { togglePopup('#panel'); fillMonitors(); const p = $('#panel'); p.scrollTop = p.scrollHeight; },
  handoff(on, rp) { yielded = on; remotePomo = rp || null; $('#handoff').classList.toggle('show', on); render(); renderLink(); },
};
