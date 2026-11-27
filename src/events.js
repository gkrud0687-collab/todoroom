// Sending signals to friends' screens through their inbox.
import { ref, push, set, serverTimestamp } from 'firebase/database';
import { db } from './fb.js';

export const CHEER_PHRASES = ['축하해요!', '수고했어!', '최고야!', '대단해!'];
export const MOOD_MAX = 30;
export const MEGA_MAX = 40;
export const MEGA_COOLDOWN = 15000;
export const THROW_COOLDOWN = 3000;

// White-ball positions (in the 512px frame) to hide behind the thrown item.
export const THROW_HAND = {
  hamster: { f1: [300, 362], f3: [386, 320] },
  squirrel: { f1: [316, 400], f3: [444, 296] },
  chick: { f1: [315, 415], f3: [453, 312] },
  black_cat: { f1: null, f3: [400, 300] },
};

// me = { uid, name, char }; targets = list of uids (include me.uid to see it on my own screen)
export async function sendEvent(me, targets, data) {
  const payload = { ...data, from: me.uid, name: String(me.name || ''), char: String(me.char || ''), ts: serverTimestamp() };
  const unique = [...new Set(targets)];
  await Promise.all(unique.map((to) => push(ref(db, `inbox/${to}`), payload)));
}

// ---- rewards / gifts ----
export const REWARD = {
  black_cat: { name: '츄르', icon: 'assets/rewards/reward_black_cat.png', big: 'assets/rewards/reward_black_cat_get.png' },
  squirrel: { name: '도토리', icon: 'assets/rewards/reward_squirrel.png', big: 'assets/rewards/reward_squirrel_get.png' },
  hamster: { name: '해바라기씨', icon: 'assets/rewards/reward_hamster.png', big: 'assets/rewards/reward_hamster_get.png' },
  chick: { name: '완두콩', icon: 'assets/rewards/reward_chick.png', big: 'assets/rewards/reward_chick_get.png' },
};
export const GIFT_TIERS = { jackpot: { label: '대박', weight: 10 }, good: { label: '좋음', weight: 30 }, normal: { label: '보통', weight: 30 }, bust: { label: '꽝', weight: 30 } };
export const GIFTS = [
  { id: 'cake', name: '딸기 케이크', tier: 'jackpot' },
  { id: 'crown', name: '왕관', tier: 'jackpot' },
  { id: 'icecream', name: '아이스크림', tier: 'good' },
  { id: 'flowers', name: '꽃다발', tier: 'good' },
  { id: 'candy', name: '사탕 한 알', tier: 'normal' },
  { id: 'sticker', name: '스티커', tier: 'normal' },
  { id: 'sock', name: '짝 잃은 양말', tier: 'bust' },
  { id: 'stone', name: '돌멩이', tier: 'bust' },
  { id: 'can', name: '빈 깡통', tier: 'bust' },
  { id: 'dust', name: '먼지 뭉치', tier: 'bust' },
  { id: 'broken_umbrella', name: '구멍 난 우산', tier: 'bust' },
  { id: 'empty_snack', name: '빈 과자봉지', tier: 'bust' },
].map((g) => ({ ...g, icon: `assets/gifts/gift_${g.id}.png` }));
export const giftById = (id) => GIFTS.find((g) => g.id === id);
export function drawGift() {
  let r = Math.random() * Object.values(GIFT_TIERS).reduce((a, t) => a + t.weight, 0);
  let tier = 'bust';
  for (const [k, t] of Object.entries(GIFT_TIERS)) { if ((r -= t.weight) <= 0) { tier = k; break; } }
  const pool = GIFTS.filter((g) => g.tier === tier);
  return pool[Math.floor(Math.random() * pool.length)];
}
export function monthKey(ts = Date.now()) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
export function prevMonthKey(ts = Date.now()) { const d = new Date(ts); d.setDate(1); d.setMonth(d.getMonth() - 1); return monthKey(d.getTime()); }

// ---- pomodoro ----
export const POMO_DEFAULT = { focus: 25, short: 5, long: 15, every: 4 };
export function pomoSettings(cfg) {
  const p = { ...POMO_DEFAULT, ...((cfg && cfg.pomo) || {}) };
  const clampN = (v, a, b, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
  return { focus: clampN(p.focus, 1, 180, 25), short: clampN(p.short, 1, 60, 5), long: clampN(p.long, 1, 120, 15), every: clampN(p.every, 1, 12, 4) };
}
export const IDLE_SECONDS = 180;

// ---- mailbox ----
export const MAIL_KEEP = 20;
export const NOTE_MAX = 100;          // private note length
export const NOTE_COOLDOWN = 3000;
export const TRASH_KEEP_MS = 24 * 60 * 60 * 1000; // deleted to-dos can be restored for a day
// write one record into each user's mailbox (a shared id lets the live popup and the mailbox entry match)
export async function sendMail(me, targets, data, id) {
  const key = id || push(ref(db, 'mail')).key;
  const payload = { ...data, from: me.uid, name: String(me.name || ''), char: String(me.char || ''), ts: serverTimestamp(), read: false };
  await Promise.all([...new Set(targets)].map((to) => set(ref(db, `mail/${to}/${key}`), payload)));
  return key;
}

// do-not-disturb: config/presence value { until: ms } (until null = until turned off)
export function dndActive(d, now = Date.now()) {
  if (!d) return false;
  if (d === true) return true;
  if (typeof d === 'object') return d.until == null ? true : Number(d.until) > now;
  return false;
}
export function dndUntilText(d) {
  if (!d || d.until == null) return '직접 끌 때까지';
  const t = new Date(Number(d.until));
  return `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}까지`;
}

// ---------- pranks ----------
export const PRANKS = {
  peel: { label: '바나나 껍질', short: '껍질', icon: 'assets/props/banana_peel.png', cool: 60000 },
  bonk: { label: '뿅망치', short: '뿅망치', icon: 'assets/props/toy_hammer.png', cool: 5000 },
  poke: { label: '콕 찌르기', short: '콕', icon: 'assets/props/poke_finger.png', cool: 3000 },
  tickle: { label: '간지럽히기', short: '간질', icon: 'assets/props/tickle_feather.png', cool: 3000 },
  water: { label: '물풍선', short: '물풍선', icon: 'assets/props/water_balloon.png', cool: 5000 },
  nametag: { label: '이름표 장난', short: '이름표', icon: null, cool: 300000 },
};
export const NICK_MAX = 6;
export const NICK_MS = 5 * 60 * 1000;
export const PEEL_MS = 30 * 60 * 1000;
// cooldowns live in localStorage so the to-do window and the character window share them
export function prankWait(kind) {
  try { const t = Number(localStorage.getItem('todoroom.prank.' + kind)) || 0; return Math.max(0, (PRANKS[kind] ? PRANKS[kind].cool : 3000) - (Date.now() - t)); } catch { return 0; }
}
function prankMark(kind) { try { localStorage.setItem('todoroom.prank.' + kind, String(Date.now())); } catch {} }
// returns '' when sent, or a message saying why not
export async function sendPrank(me, onlineTargets, info, to, kind, text) {
  if (!PRANKS[kind]) return '알 수 없는 장난이에요';
  if (info && info.pomo && info.pomo.mode === 'focus') return '친구가 집중 중이라 장난칠 수 없어요';
  if (info && dndActive(info.dnd)) return '친구가 방해 금지 중이라 장난칠 수 없어요';
  const wait = prankWait(kind);
  if (wait > 0) return `${Math.ceil(wait / 1000)}초 뒤에 다시 할 수 있어요`;
  let nick = '';
  if (kind === 'nametag') { nick = String(text || '').trim().slice(0, NICK_MAX); if (!nick) return '바꿀 이름을 적어 주세요'; }
  prankMark(kind);
  const data = { type: 'prank', to, kind, id: Math.random().toString(36).slice(2, 10) };
  if (nick) data.text = nick;
  await sendEvent(me, [...new Set([...onlineTargets, me.uid])], data);
  if (kind !== 'peel') sendMail(me, [to], { type: 'prank', kind, ...(nick ? { text: nick } : {}) }).catch(() => {});
  return '';
}
