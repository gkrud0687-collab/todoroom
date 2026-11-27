// 그림 맞추기: one friend draws a word and posts it; the others guess. First correct guess wins.
// Firebase: quiz/current (the one running quiz), quiz/guesses/{quizId}, quiz/hints/{quizId}/{uid} (how many hints that person opened)
import { ref, onValue, push, set, remove, runTransaction } from 'firebase/database';
import { db, ensureUser, manifest, el } from './fb.js';

export const QUIZ_MS = 5 * 60 * 1000;   // time limit
export const ANSWER_MAX = 12;
export const HINT_MAX = 20;
export const HINTS_PER_PERSON = 2;
const GUESS_GAP = 1000;

const $ = (s) => document.querySelector(s);
const snapMode = new URLSearchParams(location.search).get('snap') === '1';
// opened by itself because my quiz ended: show who wrote what, and stay open until closed
let keepOpen = new URLSearchParams(location.search).get('reason') === 'mine';
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
let uid = null, me = { name: '나', char: 'hamster' };
let cur = null, guesses = [], myHints = 0, offset = 0;
let seenResult = (() => { try { return localStorage.getItem('quiz.seen') || ''; } catch { return ''; } })();
const markSeen = (id) => { seenResult = id; try { localStorage.setItem('quiz.seen', id); } catch {} };
const CLOSE_AFTER = 5; // seconds the result stays before the window closes by itself
const endedAt = (q) => Number(q.endedAt || q.endsAt) || 0;
let closeTimer = null;
let mode = '';
let lastGuess = 0;
const now = () => Date.now() + offset;
const isOpen = (q) => !!(q && q.status === 'open' && now() < Number(q.endsAt));

// ---------- drawing ----------
const cv = $('#cv'); const ctx = cv.getContext('2d');
const S = cv.width / 248; // canvas is drawn at 2x for sharp lines
const COLORS = ['#3b2f4a', '#e5484d', '#f59e0b', '#22a06b', '#3b82f6', '#8b5a2b'];
let pen = { color: COLORS[0], size: 4, eraser: false };
let strokes = [], cur1 = null;

function paint() {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.strokeStyle = s.eraser ? '#fff' : s.color; ctx.lineWidth = s.size * S;
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * S, y * S) : ctx.moveTo(x * S, y * S)));
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * S + 0.1, s.pts[0][1] * S);
    ctx.stroke();
  }
}
const pos = (e) => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10]; };
function segment(s, a, b) { // draw just one piece of a stroke (cheap), instead of repainting everything
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = s.eraser ? '#fff' : s.color; ctx.lineWidth = s.size * S;
  ctx.beginPath(); ctx.moveTo(a[0] * S, a[1] * S); ctx.lineTo(b[0] * S + (a === b ? 0.1 : 0), b[1] * S); ctx.stroke();
}
cv.addEventListener('pointerdown', (e) => {
  if (mode !== 'draw') return;
  cv.setPointerCapture(e.pointerId);
  const p = pos(e);
  cur1 = { color: pen.color, size: pen.eraser ? 16 : pen.size, eraser: pen.eraser, pts: [p] };
  strokes.push(cur1); segment(cur1, p, p);
});
cv.addEventListener('pointermove', (e) => {
  if (!cur1) return;
  const p = pos(e); const last = cur1.pts[cur1.pts.length - 1];
  if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 1) return; // ignore tiny moves
  cur1.pts.push(p); segment(cur1, last, p);
});
const endStroke = () => { cur1 = null; };
cv.addEventListener('pointerup', endStroke); cv.addEventListener('pointercancel', endStroke);

function tools() {
  const t = $('#tools'); t.textContent = '';
  if (mode !== 'draw') return;
  for (const c of COLORS) {
    const b = el('button', { class: 'dot' + (!pen.eraser && pen.color === c ? ' on' : ''), title: '색', style: `background:${c}` });
    b.addEventListener('click', () => { pen.color = c; pen.eraser = false; tools(); });
    t.append(b);
  }
  const tb = (label, on, fn, title) => { const b = el('button', { class: 'tb' + (on ? ' on' : ''), text: label, title }); b.addEventListener('click', fn); t.append(b); };
  tb(pen.size > 4 ? '굵게' : '얇게', false, () => { pen.size = pen.size > 4 ? 4 : 9; pen.eraser = false; tools(); }, '선 굵기 바꾸기');
  tb('지우개', pen.eraser, () => { pen.eraser = !pen.eraser; tools(); });
  tb('↶', false, () => { strokes.pop(); paint(); }, '한 획 되돌리기');
  tb('🗑', false, () => { strokes = []; paint(); }, '전부 지우기');
}

// ---------- screens ----------
function side(...kids) { const s = $('#side'); s.textContent = ''; s.append(...kids); }
function showPic(src) {
  const p = $('#pic');
  if (src) { p.src = src; p.classList.remove('hide'); cv.classList.add('hide'); } else { p.classList.add('hide'); cv.classList.remove('hide'); }
}
const face = (char) => (manifest[char] ? el('img', { src: manifest[char].face, alt: '' }) : null);
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function render() {
  const open = isOpen(cur);
  // a finished quiz shows its result once (closing by itself); an old one (over a minute ago) or one already seen → new drawing
  const next = !cur ? 'draw' : open ? (cur.from === uid ? 'watch' : 'solve') : (seenResult === cur.id || now() - endedAt(cur) > 60000 ? 'draw' : 'result');
  if (next !== 'result' && closeTimer) { clearInterval(closeTimer); closeTimer = null; }
  if (next === mode && mode !== 'draw') { refresh(); return; }
  if (next === mode) return;
  mode = next;
  if (!snapMode && window.api.log) window.api.log('quiz', `화면: ${mode}${cur ? ` (${cur.id})` : ''}`);
  ({ draw: drawScreen, watch: watchScreen, solve: solveScreen, result: resultScreen })[mode]();
  tools();
}

function drawScreen() {
  showPic(null); paint();
  const ans = el('input', { maxlength: String(ANSWER_MAX), placeholder: `정답 (${ANSWER_MAX}자까지)` });
  const h1 = el('input', { maxlength: String(HINT_MAX), placeholder: '힌트 1 (예: 먹는 거)' });
  const h2 = el('input', { maxlength: String(HINT_MAX), placeholder: '힌트 2 (예: 노란색)' });
  const msg = el('div', { class: 'msg' });
  const go = el('button', { class: 'ok', text: '문제 내기' });
  go.addEventListener('click', async () => {
    const answer = ans.value.trim();
    if (!answer) { msg.textContent = '정답을 적어 주세요'; ans.focus(); return; }
    if (!strokes.length) { msg.textContent = '그림을 그려 주세요'; return; }
    go.disabled = true; msg.textContent = '';
    paint();
    const img = cv.toDataURL('image/jpeg', 0.82);
    const id = `q${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const t = now();
    const q = { id, from: uid, name: me.name, char: me.char, img, answer, hint1: h1.value.trim(), hint2: h2.value.trim(), startedAt: t, endsAt: t + QUIZ_MS, status: 'open' };
    try {
      const r = await runTransaction(ref(db, 'quiz/current'), (c) => (isOpen(c) ? undefined : q));
      if (!r.committed) { msg.textContent = '다른 친구의 문제가 진행 중이에요'; go.disabled = false; return; }
      remove(ref(db, 'quiz/guesses')).catch(() => {});
      remove(ref(db, 'quiz/hints')).catch(() => {});
      strokes = [];
      // posted: close my window; it opens again by itself if nobody gets it in time
      msg.style.color = '#15803d'; msg.textContent = '문제를 냈어요! 창을 닫을게요';
      setTimeout(() => { if (!snapMode) window.close(); }, 1200);
      window.api.log && window.api.log('quiz', `문제 냄 ${id}`);
    } catch (e) {
      msg.textContent = '보내지 못했어요. 인터넷 연결을 확인해 주세요'; go.disabled = false;
      window.api.log && window.api.log('quiz', `문제 내기 실패: ${e.message}`);
    }
  });
  side(
    el('div', { class: 'who' }, face(me.char), el('span', { text: '문제 내기' })),
    el('label', { text: '정답' }), ans,
    el('label', { text: '힌트 (친구 한 명당 2번까지 볼 수 있어요)' }), h1, h2,
    el('div', { style: 'flex:1' }), msg, go,
  );
  ans.focus();
}

let timerEl = null, logEl = null, hintEl = null, hintBtn = null;
function header(text) {
  timerEl = el('span', { class: 'timer' });
  return el('div', { class: 'who' }, face(cur.char), el('span', { text }), timerEl);
}
function logBox() { logEl = el('div', { class: 'log' }); return logEl; }
function fillLog() {
  if (!logEl) return;
  logEl.textContent = '';
  if (!guesses.length) { logEl.append(el('div', { class: 'empty', text: '아직 아무도 안 맞혔어요' })); return; }
  for (const g of guesses) logEl.append(el('div', { class: g.ok ? 'good' : '', text: g.ok ? `🎉 ${g.name}: ${g.text}` : `${g.name}: ${g.text} ✗` }));
  logEl.scrollTop = logEl.scrollHeight;
}
function fillHints() {
  if (!hintEl) return;
  hintEl.textContent = '';
  const list = [cur.hint1, cur.hint2];
  for (let i = 0; i < Math.min(myHints, HINTS_PER_PERSON); i += 1) hintEl.append(el('div', { class: 'h', text: `힌트 ${i + 1}: ${list[i] || '(출제자가 힌트를 안 적었어요)'}` }));
  if (hintBtn) {
    const left = HINTS_PER_PERSON - myHints;
    hintBtn.textContent = left > 0 ? `💡 힌트 보기 (${left}번 남음)` : '💡 힌트를 다 봤어요';
    hintBtn.disabled = left <= 0;
  }
}
function refresh() {
  if (timerEl && cur) timerEl.textContent = isOpen(cur) ? `⏱ ${mmss(Number(cur.endsAt) - now())}` : '';
  fillLog(); fillHints();
}

function watchScreen() {
  showPic(cur.img);
  const end = el('button', { class: 'sub', text: '문제 끝내기' });
  end.addEventListener('click', async () => {
    end.disabled = true;
    const id = cur.id;
    await runTransaction(ref(db, 'quiz/current'), (c) => (c && c.id === id && c.status === 'open' ? { ...c, status: 'done', endedBy: uid, endedAt: now() } : undefined)).catch(() => {});
  });
  side(header('내 문제'), el('div', { class: 'hints' }, el('div', { class: 'h', text: `정답: ${cur.answer}` })), el('label', { text: '친구들이 적은 답' }), logBox(), end);
  refresh();
}

function solveScreen() {
  showPic(cur.img);
  hintEl = el('div', { class: 'hints' });
  hintBtn = el('button', { class: 'sub' });
  hintBtn.addEventListener('click', () => {
    if (myHints >= HINTS_PER_PERSON) return;
    myHints += 1; fillHints();
    set(ref(db, `quiz/hints/${cur.id}/${uid}`), myHints).catch(() => {});
  });
  const inp = el('input', { maxlength: String(ANSWER_MAX + 8), placeholder: '정답 입력' });
  const go = el('button', { class: 'ok', text: '맞히기' });
  const msg = el('div', { class: 'msg' });
  const guess = async () => {
    const text = inp.value.trim();
    if (!text || !isOpen(cur)) return;
    if (Date.now() - lastGuess < GUESS_GAP) { msg.textContent = '조금만 천천히!'; return; }
    lastGuess = Date.now();
    const id = cur.id;
    const ok = norm(text) === norm(cur.answer);
    inp.value = '';
    push(ref(db, `quiz/guesses/${id}`), { uid, name: me.name, text, ok, ts: now() }).catch(() => {});
    if (!ok) { msg.textContent = '땡! 다시 해 봐요'; inp.focus(); return; }
    msg.textContent = '';
    await runTransaction(ref(db, 'quiz/current'), (c) => (c && c.id === id && c.status === 'open' ? { ...c, status: 'done', winner: { uid, name: me.name, char: me.char }, endedAt: now() } : undefined)).catch(() => {});
  };
  go.addEventListener('click', guess);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); guess(); } });
  side(header(`${cur.name || '친구'}의 문제`), hintEl, hintBtn, el('label', { text: '적은 답들' }), logBox(), msg, el('div', { class: 'row' }, inp, go));
  refresh();
  inp.focus();
}

function resultScreen() {
  showPic(cur.img);
  timerEl = null; hintEl = null; hintBtn = null;
  const w = cur.winner;
  const head = w ? (w.uid === uid ? '🎉 내가 맞혔어요!' : `🎉 ${w.name} 정답!`) : cur.endedBy ? '문제가 끝났어요' : '⏰ 시간이 끝났어요';
  const again = el('button', { class: 'ok', text: '새 문제 내기' });
  const left = el('div', { class: 'msg', style: 'text-align:center;color:#6b5ca8' });
  again.addEventListener('click', () => { markSeen(cur.id); strokes = []; render(); });
  const btns = el('div', { class: 'row' }, again);
  side(
    el('div', { class: 'who' }, face(cur.char), el('span', { text: `${cur.from === uid ? '내' : (cur.name || '친구') + '의'} 문제` })),
    el('div', { class: 'result' }, el('div', { text: head }), el('div', {}, '정답은 ', el('b', { text: cur.answer }))),
    el('label', { text: '적은 답들' }), logBox(), left, btns,
  );
  again.style.flex = '1';
  if (closeTimer) { clearInterval(closeTimer); closeTimer = null; }
  const id = cur.id;
  if (keepOpen || cur.from === uid) { // my own quiz: stay open so I can read what everyone wrote
    left.textContent = w ? '친구들이 적은 답을 보세요!' : '아무도 못 맞혔어요!';
    const close = el('button', { class: 'sub', text: '닫기' });
    close.addEventListener('click', () => { markSeen(id); window.close(); });
    btns.append(close);
    again.addEventListener('click', () => { keepOpen = false; });
  } else {
    // closes by itself after a few seconds (pressing '새 문제 내기' first keeps it open)
    let n = CLOSE_AFTER;
    const tick = () => { left.textContent = `${n}초 뒤에 창이 닫혀요`; };
    tick();
    closeTimer = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(closeTimer); closeTimer = null; markSeen(id); if (!snapMode) window.close(); return; }
      tick();
    }, 1000);
  }
  fillLog();
}

// ---------- start ----------
async function main() {
  $('#x').addEventListener('click', () => window.close());
  if (window.api.onQuizReason) window.api.onQuizReason((r) => { if (r === 'mine') { keepOpen = true; if (closeTimer) { clearInterval(closeTimer); closeTimer = null; } mode = ''; render(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
  const cfg = await window.api.getConfig();
  me = { name: cfg.name || '나', char: cfg.char || 'hamster' };
  const user = await ensureUser(); uid = user.uid;
  onValue(ref(db, '.info/serverTimeOffset'), (s) => { offset = Number(s.val()) || 0; if (cur) { mode = ''; render(); } }); // a PC clock that is off could show the wrong screen until this arrives
  let watched = '';
  onValue(ref(db, 'quiz/current'), (snap) => {
    cur = snap.val();
    if (cur && cur.id !== watched) {
      watched = cur.id; guesses = []; myHints = 0;
      onValue(ref(db, `quiz/guesses/${cur.id}`), (s) => {
        if (!cur || watched !== cur.id) return;
        guesses = Object.values(s.val() || {}).sort((a, b) => a.ts - b.ts);
        fillLog();
      });
      onValue(ref(db, `quiz/hints/${cur.id}/${uid}`), (s) => { myHints = Math.max(myHints, Number(s.val()) || 0); fillHints(); });
    }
    render();
  }, () => { cur = null; render(); });
  setInterval(() => { if (cur && mode !== 'draw' && mode !== 'result' && !isOpen(cur)) render(); else refresh(); }, 1000);
}

window.__todoroomDebug = {
  show(q, gs, hints, myUid) { uid = myUid || 'me'; cur = q; guesses = gs || []; myHints = hints || 0; mode = ''; render(); },
  draw(myUid) { uid = myUid || 'me'; cur = null; mode = ''; render(); },
  strokes(list) { strokes = list; paint(); },
};

if (!snapMode) main().catch((e) => { console.error(e); window.api && window.api.log && window.api.log('quiz', `오류: ${e.message}`); });
