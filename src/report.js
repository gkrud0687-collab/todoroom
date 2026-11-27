import { ref, get, update } from 'firebase/database';
import { db, ensureUser, manifest, el } from './fb.js';
import { elapsedOf, fmtHours, dayKey, DAY_MS, RETENTION_MS, RETENTION_DAYS } from './time.js';

const $ = (s) => document.querySelector(s);
const auto = new URLSearchParams(location.search).get('auto') === '1';
let uid = null, expiredIds = [], allById = {}, cfg0 = {};

function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
const md = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };

function stat(v, k) { return el('div', { class: 'stat' }, el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k })); }

function render(todos, users) {
  const list = Object.entries(todos || {}).map(([id, t]) => ({ id, ...t })).filter((t) => t && typeof t.text === 'string' && Number(t.createdAt) > 0);
  const now = Date.now();
  const today = startOfDay(now);
  const first = list.length ? startOfDay(Math.min(...list.map((t) => Number(t.createdAt)))) : today - (RETENTION_DAYS - 1) * DAY_MS;
  const start = Math.max(first, today - 19 * DAY_MS); // at most 20 columns
  const inRange = list.filter((t) => Number(t.createdAt) >= start);
  const done = inRange.filter((t) => t.done);
  const total = inRange.reduce((a, t) => a + elapsedOf(t, now), 0);
  const cheers = inRange.reduce((a, t) => a + (t.cheers ? Object.keys(t.cheers).length : 0), 0);

  $('#period').textContent = `${md(start)} ~ ${md(now)}`;
  const s = $('#stats'); s.textContent = '';
  s.append(
    stat(`${inRange.length}개`, '적은 할 일'),
    stat(inRange.length ? `${Math.round((done.length / inRange.length) * 100)}%` : '-', `완료 ${done.length}개`),
    stat(total ? fmtHours(total) : '0분', '타이머로 잰 시간'),
    stat(`${cheers}번`, '받은 축하'),
  );

  // daily columns
  const days = [];
  for (let d = start; d <= today; d += DAY_MS) days.push(d);
  const byDay = new Map(days.map((d) => [dayKey(d), { all: 0, done: 0 }]));
  for (const t of inRange) { const b = byDay.get(dayKey(Number(t.createdAt))); if (b) { b.all += 1; if (t.done) b.done += 1; } }
  const max = Math.max(1, ...[...byDay.values()].map((b) => b.all));
  const cols = $('#cols'), lab = $('#days'); cols.textContent = ''; lab.textContent = '';
  for (const d of days) {
    const b = byDay.get(dayKey(d));
    const all = el('div', { class: 'all', title: `${md(d)}: ${b.all}개 중 ${b.done}개 완료` });
    all.style.height = (b.all / max) * 100 + '%';
    const dn = el('div', { class: 'done' }); dn.style.height = b.all ? (b.done / b.all) * 100 + '%' : '0';
    all.append(dn);
    cols.append(el('div', { class: 'col' }, all));
    lab.append(el('span', { text: String(new Date(d).getDate()) }));
  }

  // longest tasks
  const best = $('#best'); best.textContent = '';
  best.append(el('b', { text: '가장 오래 집중한 일' }));
  const top = inRange.map((t) => ({ t, ms: elapsedOf(t, now) })).filter((x) => x.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 3);
  if (!top.length) best.append(el('div', { class: 'none', text: '타이머로 잰 할 일이 아직 없어요' }));
  else { const ol = el('ol'); for (const { t, ms } of top) ol.append(el('li', { text: `${t.text} · ${fmtHours(ms)}` })); best.append(ol); }

  // who cheered most
  const ch = $('#cheer'); ch.textContent = '';
  ch.append(el('b', { text: '나를 축하해 준 친구' }));
  const count = {};
  for (const t of inRange) for (const c of Object.keys(t.cheers || {})) count[c] = (count[c] || 0) + 1;
  const ranked = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!ranked.length) ch.append(el('div', { class: 'none', text: '아직 받은 축하가 없어요' }));
  else { const ol = el('ol'); for (const [cid, n] of ranked) ol.append(el('li', { text: `${(users[cid] && users[cid].name) || '친구'} · ${n}번` })); ch.append(ol); }

  // what will be cleaned up
  const cutoff = now - RETENTION_MS;
  expiredIds = list.filter((t) => Number(t.createdAt) < cutoff).map((t) => t.id);
  allById = Object.fromEntries(list.map((t) => [t.id, t]));
  $('#note').textContent = expiredIds.length
    ? `적은 지 ${RETENTION_DAYS}일이 지난 할 일 ${expiredIds.length}개는 이 창을 닫으면 정리돼요.`
    : '';
  $('#ok').textContent = expiredIds.length ? '확인하고 정리하기' : '닫기';
}

async function finish() {
  $('#ok').disabled = true;
  try {
    if (uid && expiredIds.length) {
      // goes through the trash too, so a mistaken clean-up can be undone for a day
      const patch = {};
      for (const id of expiredIds) {
        const t = allById[id] || {};
        patch[`todos/${uid}/${id}`] = null;
        patch[`trash/${uid}/${id}`] = { text: String(t.text || ''), done: !!t.done, createdAt: Number(t.createdAt) || 0, deletedAt: Date.now(), reason: '15일 정리', device: cfg0.device || 'local', ...(t.elapsed ? { elapsed: t.elapsed } : {}) };
      }
      try { await update(ref(db), patch); }
      catch (e) { const p2 = {}; for (const id of expiredIds) p2[id] = null; await update(ref(db, `todos/${uid}`), p2); }
      try { window.api.log('report', `15일 지난 할 일 ${expiredIds.length}개 정리`); } catch {}
    }
    if (auto || expiredIds.length) await window.api.setConfig({ lastReport: dayKey(Date.now()) });
  } catch (e) { console.error(e); $('#note').textContent = '정리하지 못했어요. 인터넷 연결을 확인해 주세요.'; $('#ok').disabled = false; return; }
  window.api.closeReport();
}

async function main() {
  const cfg = await window.api.getConfig(); cfg0 = cfg;
  if (cfg.char && manifest[cfg.char]) $('#face').src = manifest[cfg.char].face;
  $('#who').textContent = `${cfg.name || ''}의 15일 보고서`;
  $('#ok').addEventListener('click', finish);
  // the automatic report cleans up however it is closed
  $('#x').addEventListener('click', () => { if (auto) finish(); else window.api.closeReport(); });
  try {
    const user = await ensureUser(); uid = user.uid;
    const [t, u] = await Promise.all([get(ref(db, `todos/${uid}`)), get(ref(db, 'users'))]);
    render(t.val(), u.val() || {});
  } catch (e) { console.error(e); $('#period').textContent = '불러오지 못했어요. 인터넷 연결을 확인해 주세요.'; }
}
main();

// Developer hook for offline visual checks.
window.__todoroomDebug = { render };
