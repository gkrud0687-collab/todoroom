import { ref, onValue, onChildAdded, onDisconnect, set, update, remove, get, runTransaction, push, serverTimestamp } from 'firebase/database';
import { db, ensureUser, manifest, todaysTodos, el } from './fb.js';
import { play, voice, setSoundSettings } from './sound.js';
import { sendEvent, sendMail, NOTE_COOLDOWN, CHEER_PHRASES, THROW_HAND, THROW_COOLDOWN, REWARD, GIFTS, giftById, drawGift, GIFT_TIERS, monthKey, prevMonthKey, pomoSettings, NOTE_MAX, MEGA_MAX, dndActive, PRANKS, NICK_MAX, NICK_MS, PEEL_MS, sendPrank } from './events.js';
import { elapsedOf } from './time.js';

const SIZE = 112;
const K = SIZE / 512; // frame px -> screen px
const FOOT = Math.round(483 * K); // feet line inside a 512px frame
// some characters are drawn bigger inside their frames; shrink them on screen around the feet line
const CHAR_SCALE = { black_cat: 0.85 };
// '그대로 멈춰라': on this screen every character just stands where it is (still reacts to pranks, clicks…)
let frozen = false;
const FPS = { idle: 2.2, walk: 8, sit: 1.5, rest: 1, work: 2.5, happy: 6, held: 3, fall: 3, hit: 5, megaphone: 3 };
const IDLE_SEQ = [0, 0, 0, 1, 0, 0, 0, 2, 0, 0];
const ITEM_FLY = { poop: 'assets/props/poop_fly.png', banana: 'assets/props/banana.png', water: 'assets/props/water_balloon.png' };
const ITEM_HIT = { poop: 'assets/props/poop_hit.png', banana: 'assets/props/banana_hit.png' };

const stage = document.getElementById('stage');
let W = window.innerWidth, H = window.innerHeight, GROUND = H - 48;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let hide = { mine: false, all: false };
let myUid = null, myInfo = null, serverOffset = 0;
let online = {}; // presence snapshot
let lastThrow = 0;
let kingUid = null;
let config = {};
const inFocus = (info) => !!(info && info.pomo && info.pomo.mode === 'focus');
const inDnd = (info) => !!(info && dndActive(info.dnd));
const myDndOn = () => dndActive(config && config.dnd);

// preload frames
const cache = new Map();
function preload(src) { if (!cache.has(src)) { const i = new Image(); i.src = src; cache.set(src, i); } }
for (const c of Object.values(manifest)) for (const list of Object.values(c.anims)) list.forEach(preload);
Object.values(ITEM_FLY).concat(Object.values(ITEM_HIT), ['assets/props/hit_effect_dizzy.png', 'assets/props/speech_bubble.png', 'assets/props/megaphone_bubble.png',
  'assets/gifts/giftbox_closed.png', 'assets/gifts/giftbox_open_01.png', 'assets/gifts/giftbox_open_02.png', 'assets/ui/tomato.png', 'assets/ui/crown_badge.png'],
  Object.values(REWARD).map((r) => r.big), GIFTS.map((g) => g.icon)).forEach(preload);

// fit text inside a fixed box by shrinking the font
function fitText(node, max, min) {
  let s = max; node.style.fontSize = s + 'px';
  while (s > min && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)) { s -= 1; node.style.fontSize = s + 'px'; }
}

class Pet {
  constructor({ uid, char, name, me, enter }) {
    this.uid = uid; this.char = char; this.name = name; this.me = me;
    this.anims = manifest[char].anims;
    this.scale = CHAR_SCALE[char] || 1;
    this.x = enter ? (Math.random() < 0.5 ? -SIZE : W) : rand(0, W - SIZE);
    this.y = GROUND; this.vy = 0; this.dir = 1;
    this.state = 'idle'; this.until = 0; this.t = 0; this.frameSrc = '';
    this.todos = []; this.doneIds = null; this.lastDoneId = null;
    this.mood = ''; this.sayText = ''; this.anim = null;
    this.node = el('div', { class: 'pet' + (me ? ' me' : '') });
    this.img = el('img', { class: 'spr', alt: '', draggable: 'false' });
    this.held = el('img', { class: 'inhand', alt: '', draggable: 'false' });
    this.stuck = el('img', { class: 'stuck', alt: '', draggable: 'false' });
    this.dizzy = el('img', { class: 'dizzy', src: 'assets/props/hit_effect_dizzy.png', alt: '', draggable: 'false' });
    this.drops = el('img', { class: 'drops', src: 'assets/props/wet_drops.png', alt: '', draggable: 'false' });
    this.hit = el('div', { class: 'hit', title: me ? '클릭: 신나요! · 두 번 클릭: 할 일 창 · 꾹 눌러 옮기기 · 오른쪽 클릭: 메뉴' : `${name} · 클릭: 오늘 할 일, 던지기, 축하하기` });
    this.tag = el('div', { class: 'tag' });
    this.focus = null; this.away = false;
    this.bubbleText = el('div', { class: 'btext' });
    this.bubble = el('div', { class: 'bubble' }, el('img', { src: 'assets/props/speech_bubble.png', alt: '', draggable: 'false' }), this.bubbleText);
    this.badge = el('div', { class: 'badge' }, el('span', { text: '할 일 완료!' }));
    if (!me) {
      const btn = el('button', { class: 'cheerbtn ui', text: '🎉 축하하기' });
      btn.addEventListener('click', (e) => { e.stopPropagation(); sendCheer(this, this.lastDoneId); });
      this.badge.append(btn);
    }
    if (this.scale !== 1) {
      const sz = SIZE * this.scale;
      this.node.style.setProperty('--dy', `${Math.round((FOOT - SIZE * 0.36) * (1 - this.scale))}px`); // head is lower → move tag/stars/drops down too
      Object.assign(this.img.style, { inset: 'auto', left: `${(SIZE - sz) / 2}px`, top: `${FOOT * (1 - this.scale)}px`, width: `${sz}px`, height: `${sz}px` });
    }
    this.node.append(this.img, this.held, this.stuck, this.dizzy, this.drops, this.hit, this.tag, this.bubble, this.badge);
    this.hit._pet = this;
    stage.append(this.node);
    this.renderTag();
    this.applyHidden();
    if (enter) this.walkTo(rand(80, W - SIZE - 80)); else this.setState('idle', rand(2, 4));
  }
  get hidden() { return hide.all || (this.me && hide.mine); }
  // name tag: crown for last month's winner, tomato + minutes while focusing, zzz while away
  renderTag() {
    const t = this.tag; t.textContent = '';
    if (kingUid && this.uid === kingUid) t.append(el('img', { class: 'crown', src: 'assets/ui/crown_badge.png', alt: '', title: '지난달 보상왕' }));
    if (this.nick && this.nick.until > Date.now()) t.append(el('span', { class: 'nick', text: `😜 ${this.nick.text}`, title: this.me ? '친구가 바꾼 이름표예요 · 내 캐릭터를 클릭하면 원래대로' : `원래 이름: ${this.name}` }));
    else t.append(el('span', { text: this.name || '' }));
    if (this.away) t.append(el('span', { class: 'st away', text: '💤 자리 비움' }));
    else if (this.focus && this.focus.mode === 'focus') {
      const min = Math.max(0, Math.ceil((this.focus.endsAt - (Date.now() + serverOffset)) / 60000));
      t.append(el('span', { class: 'st focus' }, el('img', { src: 'assets/ui/tomato.png', alt: '' }), `${min}분`));
    } else if (this.focus && this.focus.mode === 'break') t.append(el('span', { class: 'st brk', text: '☕ 휴식' }));
    if (this.dnd) t.append(el('span', { class: 'st dnd', text: '🔕', title: '방해 금지 중' }));
  }
  setNick(text, until) {
    clearTimeout(this.nickT);
    this.nick = text ? { text: String(text).slice(0, NICK_MAX), until } : null;
    this.renderTag();
    if (this.nick) this.nickT = setTimeout(() => { this.nick = null; this.renderTag(); }, Math.max(0, until - Date.now()));
  }
  // ---- prank reactions ----
  ouch(stuckSrc, secs = 1.8) {
    this.anim = null; this.held.style.display = 'none';
    if (this.state === 'held') return;
    this.y = GROUND; this.vy = 0; this.setState('hit', secs);
    if (stuckSrc) this.stuck.src = stuckSrc;
    this.node.classList.toggle('nostuck', !stuckSrc);
    this.node.classList.add('ouch');
    clearTimeout(this.ouchTimer); this.ouchTimer = setTimeout(() => this.node.classList.remove('ouch', 'nostuck'), 2600);
  }
  hop() {
    if (this.state === 'held') return;
    this.anim = null; this.held.style.display = 'none';
    this.y = GROUND; this.vy = -640; this.setState('fall');
    this.node.classList.add('startle'); clearTimeout(this.hopT); this.hopT = setTimeout(() => this.node.classList.remove('startle'), 900);
  }
  giggle(secs = 1.9) {
    this.happy(secs); this.node.classList.add('giggle');
    clearTimeout(this.gigT); this.gigT = setTimeout(() => this.node.classList.remove('giggle'), secs * 1000);
  }
  wet(ms = 4500) { this.node.classList.add('wet'); clearTimeout(this.wetT); this.wetT = setTimeout(() => this.node.classList.remove('wet'), ms); }
  slipFall() {
    this.ouch(null, 2.0); this.node.classList.add('slip');
    clearTimeout(this.slipT); this.slipT = setTimeout(() => this.node.classList.remove('slip'), 1900);
  }
  setDnd(on) { on = !!on; if (on === !!this.dnd) return; this.dnd = on; this.renderTag(); }
  setFocus(f) {
    const was = this.focus && this.focus.mode;
    this.focus = f && f.mode ? f : null; this.renderTag();
    if (!this.me && was === 'focus' && this.focus && this.focus.mode === 'break' && !this.away) this.happy(2.5);
  }
  setAway(on) {
    on = !!on; if (on === this.away) return;
    this.away = on;
    if (on) { if (!frozen && !this.busy() && !(this.state === 'walk' && this.outside())) this.setState('rest', 1e6); }
    else if (this.state === 'rest') this.setState('idle', rand(1, 2));
    this.renderTag();
  }
  get headX() { return this.x + SIZE / 2; }
  get headY() { return this.y - FOOT + this.py(SIZE * 0.42); }
  // frame-space (already × K) → position inside the pet box, taking the character's scale into account
  px(x) { return SIZE / 2 + (x - SIZE / 2) * this.scale; }
  py(y) { return FOOT + (y - FOOT) * this.scale; }
  applyHidden() { const h = this.hidden || (this.me && yielded); this.node.style.display = h ? 'none' : ''; if (h) closePop(this); }
  setState(s, secs = 0) { this.state = s; this.t = 0; this.until = performance.now() + secs * 1000; }
  // standing (partly) outside the screen, e.g. still on the way in
  outside() { return this.x < -2 || this.x > W - SIZE + 2; }
  walkIn() { this.walkTo(W > SIZE + 160 ? rand(80, W - SIZE - 80) : (W - SIZE) / 2); }
  walkTo(tx) { this.tx = clamp(tx, 0, W - SIZE); this.dir = this.tx >= this.x ? 1 : -1; this.setState('walk'); }
  busy() { return ['held', 'fall', 'hit'].includes(this.state) || !!this.anim; }
  happy(secs = 2.6) { if (this.state !== 'held') { this.anim = null; this.held.style.display = 'none'; this.y = GROUND; this.vy = 0; this.setState('happy', secs); } }
  // focus done: eat the reward snack, then stretch into the break
  treat() {
    if (this.state === 'held' || this.hidden) return false;
    const eat = this.anims.eat || [], st = this.anims.stretch || [];
    if (!eat.length && !st.length) { this.happy(3.5); return false; }
    this.held.style.display = 'none'; this.y = GROUND; this.vy = 0;
    const list = eat.concat(st), seq = [];
    for (let r = 0; r < 3; r++) eat.forEach((_, i) => seq.push([i, 0.4]));
    st.forEach((_, i) => seq.push([eat.length + i, i === st.length - 2 ? 0.9 : 0.45]));
    this.setState('idle', 1e6);
    this.anim = { list, seq, i: 0, t: 0, launched: true };
    return true;
  }
  celebrate(reward) {
    if (reward && this.treat()) {
      if (this.me) { rewardPop(this); this.say(`${REWARD[this.char] ? REWARD[this.char].name : '간식'} 획득!`, 4); }
    } else this.happy(3.6);
    this.node.classList.add('cheer');
    clearTimeout(this.cheerTimer);
    this.cheerTimer = setTimeout(() => this.node.classList.remove('cheer'), this.me ? 3200 : 6500);
    if (!this.hidden) voice(this.char, 'happy', { fromFriend: !this.me });
  }
  // ---- speech bubble (mood, or a short temporary line) ----
  setMood(text) { this.mood = String(text || '').slice(0, 30); this.renderBubble(); }
  say(text, secs = 4) {
    this.sayText = text; this.renderBubble();
    clearTimeout(this.sayTimer); this.sayTimer = setTimeout(() => { this.sayText = ''; this.renderBubble(); }, secs * 1000);
  }
  renderBubble() {
    const t = this.sayText || this.mood;
    this.bubble.classList.toggle('show', !!t);
    this.bubble.classList.toggle('temp', !!this.sayText);
    this.bubbleText.textContent = t;
    if (t && !this.hidden) fitText(this.bubbleText, 14, 9);
  }
  // ---- throwing ----
  throwAt(target, item, onLaunch) {
    if (this.state === 'held') return false;
    this.dir = target.headX >= this.headX ? 1 : -1;
    this.y = GROUND; this.vy = 0;
    const frames = this.anims.throw || [];
    if (!frames.length) { onLaunch(this.handPoint('f3')); return true; }
    const hand = THROW_HAND[this.char] || {};
    this.anim = { list: frames, seq: [[0, 0.28], [1, 0.16], [2, 0.14]], i: 0, t: 0, item, onLaunch, launched: false };
    this.held.src = ITEM_FLY[item];
    this.placeInHand(hand.f1);
    this.held.style.display = hand.f1 ? 'block' : 'none';
    return true;
  }
  handPoint(key) {
    const h = (THROW_HAND[this.char] || {})[key] || [400, 300];
    const fx = this.dir < 0 ? 512 - h[0] : h[0];
    return { x: this.x + this.px(fx * K), y: this.y - FOOT + this.py(h[1] * K) };
  }
  placeInHand(h) {
    if (!h) return;
    const fx = this.dir < 0 ? 512 - h[0] : h[0];
    this.held.style.left = (this.px(fx * K) - 13) + 'px'; this.held.style.top = (this.py(h[1] * K) - 13) + 'px';
  }
  getHit(item) {
    this.anim = null; this.held.style.display = 'none';
    if (this.state === 'held') return;
    this.y = GROUND; this.vy = 0; this.setState('hit', 1.8);
    this.stuck.src = ITEM_HIT[item] || ITEM_HIT.poop; this.node.classList.remove('nostuck');
    this.node.classList.add('ouch');
    clearTimeout(this.ouchTimer); this.ouchTimer = setTimeout(() => this.node.classList.remove('ouch'), 2600);
  }
  // timer running (mine or a friend's): sit at the laptop until it stops
  setWorking(on) {
    on = !!on;
    if (on === !!this.working) return;
    this.working = on;
    if (on) { if (!frozen && !this.busy() && this.state !== 'happy' && !(this.state === 'walk' && this.outside())) this.setState('work', 1e6); }
    else if (this.state === 'work') this.setState('idle', rand(1, 2));
    this.node.classList.toggle('working', on);
  }
  // pick the next everyday action; avoid doing the same thing twice in a row
  decide() {
    if (frozen) { this.setState('idle', 1e6); return; }
    if (this.away) { this.setState('rest', 1e6); return; }
    if (this.working && this.anims.work && this.anims.work.length) { this.setState('work', 1e6); return; }
    const has = (k) => this.anims[k] && this.anims[k].length;
    const options = [
      ['walk', 28], ['idle', 12], ['sit', 14],
      ['work', has('work') ? 26 : 0], ['rest', has('rest') ? 20 : 0],
    ].filter(([k, w]) => w > 0 && k !== this.lastAct);
    let r = Math.random() * options.reduce((a, [, w]) => a + w, 0);
    let act = options[0][0];
    for (const [k, w] of options) { if ((r -= w) <= 0) { act = k; break; } }
    this.lastAct = act;
    if (act === 'walk') this.walkTo(clamp(this.x + rand(-420, 420), 0, W - SIZE));
    else if (act === 'idle') this.setState('idle', rand(3, 6));
    else if (act === 'sit') this.setState('sit', rand(5, 10));
    else if (act === 'work') this.setState('work', rand(10, 22));
    else this.setState('rest', rand(10, 20));
  }
  update(dt, now) {
    this.t += dt;
    if (this.anim) {
      const a = this.anim; a.t += dt;
      while (a.i < a.seq.length && a.t >= a.seq[a.i][1]) { a.t -= a.seq[a.i][1]; a.i += 1; if (a.i === 1) this.held.style.display = 'none'; }
      if (!a.launched && a.onLaunch && a.i >= 2) { a.launched = true; a.onLaunch(this.handPoint('f3')); }
      if (a.i >= a.seq.length) { this.anim = null; this.setState('idle', rand(1, 2)); }
    } else {
      switch (this.state) {
        case 'walk': {
          this.x += this.dir * 46 * dt;
          if (peels.size && stepOnPeel(this)) break;
          if ((this.dir > 0 && this.x >= this.tx) || (this.dir < 0 && this.x <= this.tx)) { this.x = this.tx; if (this.away || this.working) this.decide(); else this.setState('idle', rand(2, 5)); }
          break;
        }
        case 'fall': {
          this.vy += 2200 * dt; this.y += this.vy * dt;
          if (this.y >= GROUND) { this.y = GROUND; this.vy = 0; this.setState('idle', rand(1.5, 3)); if (this.dropped) { this.dropped = false; play('drop'); } }
          break;
        }
        case 'held': break;
        default:
          // never sit outside the screen (sleeping or working right after coming in, screen got smaller…)
          if (W > SIZE && !this.busy() && this.outside()) { this.walkIn(); window.api.log('pet', `화면 밖 캐릭터 안으로 데려옴: ${this.name}`); break; }
          if (now > this.until) { if (['happy', 'hit', 'megaphone'].includes(this.state)) this.setState('idle', rand(1, 3)); else this.decide(); }
      }
    }
    if (!this.hidden) this.draw();
  }
  frames(state) {
    const a = this.anims;
    if (state === 'fall') return a.held || a.idle;
    return a[state] && a[state].length ? a[state] : a.idle;
  }
  draw() {
    let src;
    if (this.anim) src = this.anim.list[this.anim.seq[Math.min(this.anim.i, this.anim.seq.length - 1)][0]] || this.anim.list[0];
    else {
      const list = this.frames(this.state);
      const n = Math.floor(this.t * (FPS[this.state] || 2));
      const idx = this.state === 'idle' ? IDLE_SEQ[n % IDLE_SEQ.length] % list.length : n % list.length;
      src = list[idx];
    }
    if (src !== this.frameSrc) { this.img.src = src; this.frameSrc = src; }
    const flip = (this.state === 'walk' || this.anim) && this.dir < 0;
    this.node.classList.toggle('flip', flip);
    this.node.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y - FOOT)}px)`;
    if (this.pop) placePop(this);
  }
  setTodos(list, cheersOf) {
    this.todos = list;
    const nowDone = new Set(list.filter((t) => t.done).map((t) => t.id));
    const nowRew = new Set(list.filter((t) => t.done && t.rewarded).map((t) => t.id));
    if (this.doneIds !== null) {
      let fresh = null, rew = false;
      for (const id of nowDone) if (!this.doneIds.has(id)) { fresh = id; if (nowRew.has(id) && !(this.rewIds && this.rewIds.has(id))) rew = true; }
      if (fresh) { this.lastDoneId = fresh; this.celebrate(rew); }
    }
    this.doneIds = nowDone; this.rewIds = nowRew;
    if (this.pop) fillPop(this);
  }
  destroy() {
    closePop(this);
    this.node.classList.add('leaving');
    setTimeout(() => this.node.remove(), 700);
  }
}

// ---------- friend popover: todos + throw + cheer ----------
function fillPop(p) {
  const box = p.pop; box.textContent = '';
  box.append(el('b', { text: `${p.name || '친구'}의 오늘 할 일` }));
  if (!p.todos.length) box.append(el('div', { class: 'none', text: '아직 적은 할 일이 없어요' }));
  else {
    const ul = el('ul');
    for (const t of p.todos) {
      const li = el('li', { class: t.done ? 'done' : '' }, el('span', { text: (t.done ? '☑ ' : '☐ ') + t.text }));
      if (t.done) {
        const mine = t.cheers && myUid && t.cheers[myUid];
        const b = el('button', { class: 'mini ui' + (mine ? ' did' : ''), text: mine ? '🎉 축하함' : '🎉', title: mine ? '이미 축하했어요' : '축하하기' });
        if (!mine) b.addEventListener('click', (e) => { e.stopPropagation(); sendCheer(p, t.id); });
        li.append(b);
      }
      ul.append(li);
    }
    box.append(ul);
  }
  const row = el('div', { class: 'acts' });
  if (inDnd(online[p.uid])) {
    for (const b of box.querySelectorAll('button.mini')) b.remove();
    row.append(el('div', { class: 'busy' }, el('span', { text: '🔕 방해 금지 중이라 던지기·쪽지·축하를 할 수 없어요' })));
    box.append(row);
    return;
  }
  if (inFocus(online[p.uid])) {
    row.append(el('div', { class: 'busy' }, el('img', { src: 'assets/ui/focus_badge.png', alt: '' }), el('span', { text: '집중 중이라 장난칠 수 없어요' })));
  } else {
    const grid = el('div', { class: 'pgrid' });
    for (const [item, label] of [['poop', '똥'], ['banana', '바나나']]) {
      const b = el('button', { class: 'act ui' }, el('img', { src: ITEM_FLY[item], alt: '' }), el('span', { text: label }));
      b.addEventListener('click', (e) => { e.stopPropagation(); requestThrow(p.uid, item); });
      grid.append(b);
    }
    for (const [kind, pr] of Object.entries(PRANKS)) {
      const b = el('button', { class: 'act ui', title: pr.label }, pr.icon ? el('img', { src: pr.icon, alt: '' }) : el('i', { text: '🏷' }), el('span', { text: pr.short }));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (kind === 'nametag') { openNickInput(p, box); return; }
        doPrank(p.uid, kind);
      });
      grid.append(b);
    }
    box.append(el('div', { class: 'ptitle', text: '장난치기' }), grid);
  }
  const nb = el('button', { class: 'act ui' }, el('img', { src: 'assets/props/note.png', alt: '' }), el('span', { text: '쪽지 보내기' }));
  nb.addEventListener('click', (e) => { e.stopPropagation(); closePop(p); window.api.composeNote(p.uid); });
  row.append(nb);
  box.append(row);
}
function openNickInput(p, box) {
  let r = box.querySelector('.nickrow');
  if (r) { r.querySelector('input').focus(); return; }
  const inp = el('input', { class: 'nickin', maxlength: String(NICK_MAX), placeholder: `새 이름 (${NICK_MAX}자까지)` });
  const ok = el('button', { class: 'act ui', text: '바꾸기' });
  r = el('div', { class: 'nickrow' }, inp, ok);
  box.append(r); placePop(p);
  const go = () => { doPrank(p.uid, 'nametag', inp.value); };
  ok.addEventListener('click', (e) => { e.stopPropagation(); go(); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
  for (const x of [inp, ok]) x.addEventListener('mousedown', (e) => e.stopPropagation());
  window.api.focusPet(); setTimeout(() => inp.focus(), 60);
}
async function doPrank(to, kind, text) {
  if (!myUid || !myInfo) return;
  try {
    const why = await sendPrank(myInfo, onlineIds(), online[to], to, kind, text);
    if (why) toast(why);
    else if (kind === 'peel') toast('바나나 껍질을 몰래 놓았어요 🤫');
    else if (kind === 'nametag') { const p = petOf(to); if (p) closePop(p); }
  } catch (e) { console.error(e); toast('보내지 못했어요. 인터넷 연결을 확인해 주세요.'); }
}
function placePop(p) {
  const b = p.pop; const w = b.offsetWidth, h = b.offsetHeight;
  b.style.left = clamp(p.x + SIZE / 2 - w / 2, 4, W - w - 4) + 'px';
  b.style.top = Math.max(4, p.y - FOOT + 16 - h - 6) + 'px';
}
function openPop(p) {
  for (const q of pets.values()) if (q !== p) closePop(q);
  p.pop = el('div', { class: 'pop ui' }); stage.append(p.pop); fillPop(p); placePop(p);
  p.pop.addEventListener('mouseenter', () => clearTimeout(p.popTimer));
  p.pop.addEventListener('mouseleave', () => { clearTimeout(p.popTimer); p.popTimer = setTimeout(() => closePop(p), 6000); });
  clearTimeout(p.popTimer); p.popTimer = setTimeout(() => closePop(p), 12000);
}
function closePop(p) { if (p.pop) { p.pop.remove(); p.pop = null; } clearTimeout(p.popTimer); }

// ---------- sending ----------
function onlineIds() { return Object.entries(online).filter(([, v]) => v && v.char).map(([k]) => k); }
async function requestThrow(targetUid, item) {
  if (!myUid || !myInfo) return;
  const now = Date.now();
  if (now - lastThrow < THROW_COOLDOWN) { toast('조금만 쉬었다가 던져요!'); return; }
  if (inFocus(online[targetUid])) { toast('친구가 집중 중이라 던질 수 없어요'); return; }
  if (inDnd(online[targetUid])) { toast('친구가 방해 금지 중이라 던질 수 없어요'); return; }
  lastThrow = now;
  try {
    await sendEvent(myInfo, [...onlineIds(), myUid], { type: 'throw', to: targetUid, item });
    sendMail(myInfo, [targetUid], { type: 'throw', item }).catch(() => {});
  } catch (e) { console.error(e); toast('보내지 못했어요. 인터넷 연결을 확인해 주세요.'); }
}
async function sendCheer(p, todoId) {
  if (!myUid || !myInfo || !todoId) return;
  if (inDnd(online[p.uid])) { toast('친구가 방해 금지 중이라 축하할 수 없어요'); return; }
  const phrase = pick(CHEER_PHRASES);
  try {
    await set(ref(db, `todos/${p.uid}/${todoId}/cheers/${myUid}`), Date.now());
  } catch (e) { toast('이미 축하했어요!'); return; }
  p.node.classList.remove('cheer');
  const todo = p.todos.find((t) => t.id === todoId);
  try {
    await sendEvent(myInfo, [p.uid, myUid], { type: 'cheer', to: p.uid, phrase, todoId });
    sendMail(myInfo, [p.uid], { type: 'cheer', phrase, todoText: todo ? String(todo.text).slice(0, 60) : '' }).catch(() => {});
  } catch (e) { console.error(e); }
}
function toast(text) {
  const t = el('div', { class: 'toast', text }); stage.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- receiving ----------
function petOf(id) { return id === myUid ? pets.get(myUid) : pets.get(id); }
function handleEvent(ev) {
  const fromMe = ev.from === myUid;
  const sender = petOf(ev.from);
  if (ev.type === 'throw') {
    const target = petOf(ev.to);
    if (!target || target.hidden) return;
    if (target.me && pomo && pomo.mode === 'focus') return; // do not disturb
    if (target.me && myDndOn()) return;
    const launch = (from) => flyItem(from, target, ev.item, () => {
      target.getHit(ev.item);
      voice(target.char, 'hit', { fromFriend: !fromMe });
    });
    play('throw', { fromFriend: !fromMe });
    if (sender && !sender.hidden && sender !== target) { if (!sender.throwAt(target, ev.item, launch)) launch(edgePoint(target)); }
    else launch(edgePoint(target));
  } else if (ev.type === 'prank') {
    handlePrank(ev, fromMe, sender);
  } else if (ev.type === 'cheer') {
    const target = petOf(ev.to);
    if (target && target.me && myDndOn()) return;
    const line = String(ev.phrase || '축하해요!').slice(0, 20);
    if (sender && !sender.hidden) { sender.happy(3); sender.say(line, 4.5); }
    else if (target && !target.hidden) target.say(`${ev.name || '친구'}: ${line}`, 4.5);
    if (target && target.me && !target.hidden) target.happy(3);
    voice(ev.char || (sender && sender.char), 'happy', { fromFriend: !fromMe });
  } else if (ev.type === 'megaphone') {
    if (sender && !sender.hidden && !sender.busy()) { sender.y = GROUND; sender.setState('megaphone', 3); }
    if (!fromMe && myDndOn()) return; // do-not-disturb: no popup (senders skip me anyway)
    if (!fromMe && pomo && pomo.mode === 'focus') { heldDuringFocus.add(ev.mailId || Math.random()); return; } // kept in the mailbox
    if (ev.mailId && (readMail.has(ev.mailId) || shownMail.has(ev.mailId))) return;
    showMegaphone(ev, fromMe);
  } else if (ev.type === 'note') {
    if (ev.to !== myUid || fromMe) return;
    if (myDndOn()) return; // kept unread in the mailbox; shown as a card when do-not-disturb ends
    if (pomo && pomo.mode === 'focus') { heldDuringFocus.add(ev.mailId || Math.random()); return; } // kept in the mailbox
    if (ev.mailId && (readMail.has(ev.mailId) || shownMail.has(ev.mailId))) return;
    showMegaphone(ev, false);
  } else if (ev.type === 'king') {
    announce({ icon: 'assets/ui/crown_badge.png', title: `${monthLabel(ev.month)} 보상왕`, text: `${ev.winnerName || '친구'}! 선물 상자를 받아요 🎁`, face: ev.winnerChar });
    play('tada', { fromFriend: !fromMe });
  } else if (ev.type === 'giftopen') {
    if (fromMe) return;
    const g = giftById(ev.item); if (!g) return;
    announce({ icon: g.icon, title: `${ev.name || '친구'}의 선물 상자`, text: `${g.name}${g.tier === 'jackpot' ? ' ✨대박!' : g.tier === 'bust' ? ' 😂꽝!' : ''}`, face: ev.char });
    play(g.tier === 'bust' ? 'fail' : 'tada', { fromFriend: true });
  }
}
const monthLabel = (m) => `${Number(String(m || '').split('-')[1]) || ''}월`;
function announce({ icon, title, text, face }) {
  const box = el('div', { class: 'annc' },
    el('img', { class: 'ai', src: icon, alt: '' }),
    el('div', {}, el('b', { text: title }), el('div', { text })),
    face && manifest[face] ? el('img', { class: 'af', src: manifest[face].face, alt: '' }) : null);
  stage.append(box);
  requestAnimationFrame(() => box.classList.add('show'));
  setTimeout(() => { box.classList.remove('show'); setTimeout(() => box.remove(), 400); }, 6000);
}
function edgePoint(target) {
  const left = target.headX > W / 2;
  return { x: left ? -30 : W + 30, y: target.headY - 160 };
}
// ---------- pranks ----------
const peels = new Map(); // id -> { uid, x, el, from, name, char }
function propAt(target, src, cls, ms, dx = 0, dy = 0) {
  const img = el('img', { class: 'prop ' + cls, src, alt: '' });
  img.style.left = (target.headX - 40 + dx) + 'px'; img.style.top = (target.headY - 40 + dy) + 'px';
  stage.append(img); setTimeout(() => img.remove(), ms);
  return img;
}
function placePeel(target, ev) {
  const old = [...peels.entries()].find(([, v]) => v.uid === target.uid && v.from === ev.from);
  if (old) { old[1].el.remove(); peels.delete(old[0]); }
  const side = Math.random() < 0.5 ? -1 : 1;
  const x = clamp(target.headX + side * rand(90, 220), 30, W - 30);
  const img = el('img', { class: 'peel', src: 'assets/props/banana_peel.png', alt: '' });
  img.style.left = (x - 26) + 'px'; img.style.top = (GROUND - 50) + 'px';
  stage.append(img);
  const id = ev.id || String(Math.random());
  peels.set(id, { uid: target.uid, x, el: img, from: ev.from, name: ev.name, char: ev.char });
  setTimeout(() => { const p = peels.get(id); if (p) { p.el.remove(); peels.delete(id); } }, PEEL_MS);
}
function stepOnPeel(pet) {
  for (const [id, pl] of peels) {
    if (pl.uid !== pet.uid || Math.abs(pet.headX - pl.x) > 14) continue;
    peels.delete(id);
    pl.el.classList.add('gone'); setTimeout(() => pl.el.remove(), 600);
    play('slip', { fromFriend: pl.from !== myUid }); voice(pet.char, 'hit', { fromFriend: !pet.me });
    pet.slipFall();
    if (pet.me && myUid) { // write it down in my own mailbox: who left the peel
      sendMail({ uid: pl.from, name: pl.name || '친구', char: pl.char || '' }, [myUid], { type: 'prank', kind: 'peel' }).catch(() => {});
      toast(`${pl.name || '친구'}의 바나나 껍질을 밟았어요!`);
    }
    return true;
  }
  return false;
}
function handlePrank(ev, fromMe, sender) {
  const target = petOf(ev.to);
  if (!target || target.hidden) return;
  if (ev.kind === 'unnick') { target.setNick(null); return; }
  if (target.me && !fromMe && ((pomo && pomo.mode === 'focus') || myDndOn())) return;
  const ff = { fromFriend: !fromMe };
  switch (ev.kind) {
    case 'bonk': {
      propAt(target, 'assets/props/toy_hammer.png', 'bonk', 900, 18, -46);
      setTimeout(() => { play('bonk', ff); target.ouch(null, 1.8); voice(target.char, 'hit', ff); }, 300);
      break;
    }
    case 'poke': {
      const side = target.headX > W / 2 ? 1 : -1;
      propAt(target, 'assets/props/poke_finger.png', 'poke' + (side > 0 ? ' r' : ''), 900, side * 70, 24);
      setTimeout(() => { play('poke', ff); target.hop(); voice(target.char, 'pickup', ff); }, 330);
      break;
    }
    case 'tickle': {
      propAt(target, 'assets/props/tickle_feather.png', 'tickle', 1700, 46, 18);
      play('tickle', ff); target.giggle(1.9);
      setTimeout(() => voice(target.char, 'happy', ff), 250);
      break;
    }
    case 'water': {
      const launch = (from) => flyItem(from, target, 'water', () => {
        propAt(target, 'assets/props/water_splash.png', 'splash', 700, 0, 0);
        play('splash', ff); target.ouch(null, 1.6); target.wet(); voice(target.char, 'hit', ff);
      });
      play('throw', ff);
      if (sender && !sender.hidden && sender !== target) { if (!sender.throwAt(target, 'water', launch)) launch(edgePoint(target)); }
      else launch(edgePoint(target));
      break;
    }
    case 'peel': placePeel(target, ev); break;
    case 'nametag': {
      const text = String(ev.text || '').slice(0, NICK_MAX); if (!text) return;
      target.setNick(text, Date.now() + NICK_MS);
      if (target.me) toast(`${ev.name || '친구'}가 내 이름표를 '${text}'(으)로 바꿨어요! 5분 뒤 돌아와요 (내 캐릭터를 누르면 바로)`);
      break;
    }
    default: break;
  }
}

function flyItem(from, target, item, onHit) {
  const img = el('img', { class: 'fly', src: ITEM_FLY[item] || ITEM_FLY.poop, alt: '' });
  stage.append(img);
  const sx = from.x, sy = from.y;
  const dur = clamp(Math.hypot(target.headX - sx, target.headY - sy) / 900, 0.45, 1.3);
  const peak = clamp(Math.abs(target.headX - sx) * 0.25, 60, 220);
  const spin = (target.headX >= sx ? 1 : -1) * 720;
  const t0 = performance.now();
  function step(now) {
    const k = Math.min(1, (now - t0) / 1000 / dur);
    const tx = target.headX, ty = target.headY; // target may move
    const x = sx + (tx - sx) * k;
    const y = sy + (ty - sy) * k - Math.sin(Math.PI * k) * peak;
    img.style.transform = `translate(${x - 14}px, ${y - 14}px) rotate(${spin * k}deg)`;
    if (k < 1) requestAnimationFrame(step); else { img.remove(); onHit(); }
  }
  requestAnimationFrame(step);
}
// Megaphone: big bubble for 5 s, then a small card in the top-right corner until it is clicked.
const megaQueue = [];
let megaBusy = false;
const readMail = new Set();      // megaphone mail ids already read
const shownMail = new Set();     // ids shown as a bubble or card in this session
const cards = new Map();         // mailId -> card element
const heldDuringFocus = new Set();
let cardBox = null;
function markRead(id) {
  if (!id || !myUid) return;
  readMail.add(id);
  update(ref(db, `mail/${myUid}/${id}`), { read: true }).catch(() => {});
}
function showMegaphone(ev, fromMe) {
  if (ev.mailId) shownMail.add(ev.mailId);
  megaQueue.push({ ev, fromMe });
  if (!megaBusy) nextMega();
}
function nextMega() {
  const item = megaQueue.shift();
  if (!item) { megaBusy = false; return; }
  megaBusy = true;
  const { ev, fromMe } = item;
  const isNote = ev.type === 'note';
  play('megaphone', { fromFriend: !fromMe });
  const text = el('div', { class: 'mtext', text: String(ev.text || '').slice(0, isNote ? NOTE_MAX : 40) });
  const who = el('div', { class: 'mwho' },
    manifest[ev.char] ? el('img', { src: manifest[ev.char].face, alt: '' }) : null,
    el('span', { text: `${fromMe ? '나' : (ev.name || '친구')}의 ${isNote ? '쪽지' : ev.reply ? '확성기 답장' : '확성기'} · 클릭하면 닫혀요` }));
  if (!fromMe && ev.from && ev.from !== myUid) { // notes and megaphones: reply right here (1:1 note to the sender)
    const rb = el('button', { class: 'reply ui', text: '답장' });
    rb.addEventListener('click', (e) => {
      e.stopPropagation(); replying = true;
      // forget this bubble first: marking it read makes the mailbox listener close every bubble/card of that mail,
      // which used to close the reply paper right away (nothing seemed to happen)
      if (ev.mailId) bubbles.delete(ev.mailId);
      markRead(ev.mailId);
      openReply({ from: ev.from, name: ev.name, char: ev.char }, box);
    });
    who.append(rb);
  }
  const box = el('div', { class: 'mega ui' + (isNote ? ' note' : '') }, el('img', { class: 'mbg', src: isNote ? 'assets/props/note_bubble.png' : 'assets/props/megaphone_bubble.png', alt: '' }), text, who);
  stage.append(box);
  fitText(text, isNote ? 26 : 34, isNote ? 14 : 16);
  requestAnimationFrame(() => box.classList.add('show'));
  let done = false, replying = false;
  const finish = (toCard) => {
    if (done) return; done = true;
    box.classList.remove('show');
    setTimeout(() => { box.remove(); setIgnore(true); nextMega(); }, 350);
    if (toCard && !fromMe && ev.mailId && !readMail.has(ev.mailId)) addCard(ev);
    else if (fromMe || !ev.mailId) { /* nothing to keep */ }
  };
  box.addEventListener('click', () => { if (replying) return; markRead(ev.mailId); finish(false); });
  box._close = () => finish(false);
  if (ev.mailId) bubbles.set(ev.mailId, box);
  setTimeout(() => { if (replying) return; if (ev.mailId) bubbles.delete(ev.mailId); finish(true); }, 5200);
}
const bubbles = new Map();
// ---------- reply to a note right here: the note paper itself turns into the reply paper ----------
let lastNoteAt = 0;
function openReply(m, existing) {
  const to = m && m.from; if (!to || !myInfo) return;
  try { window.api.log('note', `답장 쓰기 열림: ${m.name || to}`); } catch {}
  const name = (m.name || (online[to] && online[to].name) || '친구');
  // a megaphone is answered on megaphone paper (as a megaphone sent only to that friend), a note on note paper
  const mega = existing ? !existing.classList.contains('note') : m.type === 'megaphone';
  const MAX = mega ? MEGA_MAX : NOTE_MAX;
  let box = existing;
  if (!box) { // from a small card: open a fresh paper in the middle
    box = el('div', { class: 'mega ui' + (mega ? '' : ' note') }, el('img', { class: 'mbg', src: mega ? 'assets/props/megaphone_bubble.png' : 'assets/props/note_bubble.png', alt: '' }));
    stage.append(box);
    requestAnimationFrame(() => box.classList.add('show'));
  }
  box.classList.add('replying');
  for (const n of [...box.children]) if (!n.classList.contains('mbg')) n.remove();
  const ta = el('textarea', { class: 'mtext rin', maxlength: String(MAX), placeholder: mega ? `${name}에게 확성기로 답장 (${MAX}자까지)` : `${name}에게 보낼 답장 (${MAX}자까지)` });
  const cnt = el('em', { class: 'rcnt', text: `0/${MAX}` });
  const cancel = el('button', { class: 'rbtn grey', text: '취소' });
  const send = el('button', { class: 'rbtn', text: '보내기' });
  const label = el('span', { text: mega ? `📢 ${name}에게 답장` : `${name}에게 답장` });
  const who = el('div', { class: 'mwho' }, manifest[m.char] ? el('img', { src: manifest[m.char].face, alt: '' }) : null, label, cnt, cancel, send);
  box.append(ta, who);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    if (box._close) box._close(); // a bubble from the queue: let it finish normally
    else { box.classList.remove('show'); setTimeout(() => { box.remove(); setIgnore(true); }, 350); }
  };
  for (const b of [ta, cancel, send, who]) { b.addEventListener('mousedown', (e) => e.stopPropagation()); b.addEventListener('click', (e) => e.stopPropagation()); }
  ta.addEventListener('click', (e) => e.stopPropagation());
  ta.addEventListener('input', () => { cnt.textContent = `${ta.value.length}/${MAX}`; });
  cancel.addEventListener('click', () => close());
  const go = async () => {
    const text = ta.value.trim().slice(0, MAX);
    if (!text) { label.textContent = '보낼 말을 적어 주세요'; return; }
    if (inDnd(online[to])) { label.textContent = '방해 금지 중이라 보낼 수 없어요'; return; }
    const wait = NOTE_COOLDOWN - (Date.now() - lastNoteAt);
    if (wait > 0) { label.textContent = `${Math.ceil(wait / 1000)}초 뒤에 보낼 수 있어요`; return; }
    lastNoteAt = Date.now(); send.disabled = true; label.textContent = '보내는 중…';
    try {
      if (mega) {
        const mailId = await sendMail(myInfo, [to, myUid], { type: 'megaphone', reply: true, text, to, toName: String(name).slice(0, 12) });
        update(ref(db, `mail/${myUid}/${mailId}`), { read: true }).catch(() => {});
        if (online[to]) await sendEvent(myInfo, [to], { type: 'megaphone', reply: true, text, to, mailId });
      } else {
        const mailId = await sendMail(myInfo, [to], { type: 'note', text, to });
        const sentId = await sendMail(myInfo, [myUid], { type: 'note_sent', text, to, toName: String(name).slice(0, 12) });
        update(ref(db, `mail/${myUid}/${sentId}`), { read: true }).catch(() => {});
        if (online[to]) await sendEvent(myInfo, [to], { type: 'note', text, to, mailId });
      }
      play('complete');
      label.textContent = online[to] ? '보냈어요!' : '보냈어요! 다음에 켤 때 보여요';
      ta.disabled = true;
      try { window.api.log('note', `답장 보냄: ${name}`); } catch {}
      setTimeout(close, 1200);
    } catch (e) {
      label.textContent = '보내지 못했어요'; send.disabled = false;
      try { window.api.log('note', `답장 실패: ${e && (e.code || e.message)}`); } catch {}
    }
  };
  send.addEventListener('click', () => go());
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); }
    else if (e.key === 'Escape') close();
  });
  window.api.focusPet();
  setTimeout(() => ta.focus(), 80);
}

function addCard(m) {
  if (!m.mailId || cards.has(m.mailId) || readMail.has(m.mailId)) return;
  if (!cardBox) { cardBox = el('div', { class: 'cards' }); stage.append(cardBox); }
  const isNote = m.type === 'note';
  const c = el('div', { class: 'mcard ui' + (isNote ? ' note' : ''), title: '클릭하면 읽음으로 바뀌고 닫혀요' },
    isNote ? el('img', { src: 'assets/props/note.png', alt: '' }) : manifest[m.char] ? el('img', { src: manifest[m.char].face, alt: '' }) : null,
    el('div', { class: 'mc' }, el('b', { text: `${isNote ? '✉ 쪽지 · ' : m.reply ? '📢 답장 · ' : '📢 '}${m.name || '친구'}` }), el('span', { text: String(m.text || '').slice(0, isNote ? NOTE_MAX : 40) })));
  if (m.from && m.from !== myUid) {
    const rb = el('button', { class: 'reply', text: '답장' });
    rb.addEventListener('click', (e) => { e.stopPropagation(); markRead(m.mailId); removeCard(m.mailId); openReply({ from: m.from, name: m.name, char: m.char }); });
    c.append(rb);
  }
  c.addEventListener('click', () => { markRead(m.mailId); removeCard(m.mailId); });
  cards.set(m.mailId, c); shownMail.add(m.mailId);
  cardBox.prepend(c);
}
function quizCard(q) {
  if (!cardBox) { cardBox = el('div', { class: 'cards' }); stage.append(cardBox); }
  const key = 'quiz:' + q.id;
  const c = el('div', { class: 'mcard ui', title: '누르면 그림 맞추기 창이 열려요' },
    manifest[q.char] ? el('img', { src: manifest[q.char].face, alt: '' }) : null,
    el('div', { class: 'mc' }, el('b', { text: `🖍 ${q.name || '친구'}` }), el('span', {}, '그림 문제를 냈어요!', el('br'), '맞혀 보세요.')));
  const go = el('button', { class: 'reply', text: '풀기' });
  const open = (e) => { e.stopPropagation(); removeCard(key); window.api.openQuiz(); };
  go.addEventListener('click', open); c.addEventListener('click', open);
  c.append(go);
  cards.set(key, c);
  cardBox.prepend(c);
}
function removeCard(id) {
  const c = cards.get(id); if (c) { c.remove(); cards.delete(id); setIgnore(true); }
  const b = bubbles.get(id); if (b && b._close) { bubbles.delete(id); b._close(); }
}

// ---------- my pet's question bubble (resume after being away, start next pomodoro) ----------
let askBox = null;
function ask(text, buttons) {
  closeAsk();
  const me = pets.get(myUid) || pets.get('me'); if (!me) return;
  askBox = el('div', { class: 'ask ui' }, el('div', { class: 'aq', text }));
  const row = el('div', { class: 'ab' });
  for (const [label, fn, cls] of buttons) {
    const b = el('button', { class: cls || '', text: label });
    b.addEventListener('click', (e) => { e.stopPropagation(); closeAsk(); fn(); });
    row.append(b);
  }
  askBox.append(row);
  me.node.append(askBox); me.node.classList.add('asking');
}
function closeAsk() {
  if (askBox) { askBox.remove(); askBox = null; setIgnore(true); }
  for (const p of pets.values()) p.node.classList.remove('asking');
}

// ---------- reward pop ----------
function rewardPop(p) {
  const r = REWARD[p.char]; if (!r) return;
  const img = el('img', { class: 'rpop', src: r.big, alt: '' });
  p.node.append(img);
  setTimeout(() => img.remove(), 1900);
}

// ---------- pomodoro engine (lives here because this window is always open) ----------
let pomo = null;           // { mode: focus|break|paused|ready, todoId, endsAt, remaining, cycle, long }
let myTodosAll = {};
let pausedByAway = null;    // { todoId } when a plain todo timer was stopped by being away
let setPresence = () => {};
let yielded = false; // another computer took over this character
function savePomo() {
  window.api.setConfig({ pomoState: pomo });
  setPresence({ pomo: pomo && (pomo.mode === 'focus' || pomo.mode === 'break') ? { mode: pomo.mode, endsAt: pomo.endsAt + serverOffset, todoId: pomo.todoId || null } : null });
  const me = pets.get(myUid); if (me) me.setFocus(pomo && pomo.endsAt ? { mode: pomo.mode, endsAt: pomo.endsAt + serverOffset } : null);
}
function todoPatchPause(id, at) {
  const t = myTodosAll[id]; if (!t || !t.runningSince) return {};
  return { [`${id}/elapsed`]: elapsedOf(t, at), [`${id}/runningSince`]: null };
}
async function startTodoTimer(id) {
  const now = Date.now(); let patch = {};
  for (const [k, t] of Object.entries(myTodosAll)) if (k !== id && t && t.runningSince) patch = { ...patch, ...todoPatchPause(k, now) };
  patch[`${id}/runningSince`] = now;
  await update(ref(db, `todos/${myUid}`), patch);
}
async function pomoCmd(cmd) {
  if (!myUid || !cmd || yielded) return;
  const S = pomoSettings(config);
  const now = Date.now();
  if (cmd.type === 'start' && cmd.todoId && myTodosAll[cmd.todoId] && !myTodosAll[cmd.todoId].done) {
    closeAsk();
    const cycle = pomo && pomo.todoId === cmd.todoId ? pomo.cycle || 0 : 0;
    pomo = { mode: 'focus', todoId: cmd.todoId, endsAt: now + S.focus * 60000, cycle };
    await startTodoTimer(cmd.todoId).catch(() => {});
    savePomo();
  } else if (cmd.type === 'resume' && pomo && pomo.mode === 'paused') {
    pomo = { ...pomo, mode: 'focus', endsAt: now + Math.max(1000, pomo.remaining || 0), remaining: null };
    await startTodoTimer(pomo.todoId).catch(() => {});
    savePomo();
  } else if (cmd.type === 'stop') {
    closeAsk();
    if (pomo && pomo.todoId) update(ref(db, `todos/${myUid}`), todoPatchPause(pomo.todoId, now)).catch(() => {});
    pomo = null; savePomo();
  }
}
async function finishFocus() {
  const S = pomoSettings(config);
  const now = Date.now();
  const id = pomo.todoId;
  const patch = todoPatchPause(id, now);
  const t = myTodosAll[id];
  patch[`${id}/pomos`] = ((t && Number(t.pomos)) || 0) + 1;
  update(ref(db, `todos/${myUid}`), patch).catch(() => {});
  const cycle = (pomo.cycle || 0) + 1;
  const long = cycle % S.every === 0;
  pomo = { mode: 'break', todoId: id, endsAt: now + (long ? S.long : S.short) * 60000, cycle, long };
  savePomo();
  const me = pets.get(myUid);
  if (me && !me.hidden) {
    me.happy(2.5); voice(me.char, 'happy');
    me.say(`집중 끝! ${long ? '긴' : '짧은'} 휴식 ${long ? S.long : S.short}분`, 5);
  }
}
function finishBreak() {
  pomo = { mode: 'ready', todoId: pomo.todoId, cycle: pomo.cycle };
  savePomo();
  const me = pets.get(myUid);
  if (me && !me.hidden) { me.happy(2.5); voice(me.char, 'happy'); }
  ask('쉬는 시간 끝! 다시 집중할까요?', [['🍅 시작', () => pomoCmd({ type: 'start', todoId: pomo && pomo.todoId })], ['나중에', () => pomoCmd({ type: 'stop' })]]);
}
setInterval(() => {
  if (!pomo) return;
  const now = Date.now();
  if (pomo.mode === 'focus' && now >= pomo.endsAt) finishFocus();
  else if (pomo.mode === 'break' && now >= pomo.endsAt) finishBreak();
  const me = pets.get(myUid); if (me && pomo && pomo.mode === 'focus') me.renderTag();
}, 1000);
// friends' remaining minutes
setInterval(() => { for (const p of pets.values()) if (!p.me && p.focus) p.renderTag(); }, 20000);

// ---------- away: 3 minutes without input, screen lock or sleep ----------
async function onAway({ lastActive }) {
  if (yielded) return;
  const me = pets.get(myUid); if (me) me.setAway(true);
  setPresence({ away: true });
  if (!myUid) return;
  const at = Math.min(Date.now(), Number(lastActive) || Date.now());
  if (pomo && pomo.mode === 'focus') {
    const remaining = Math.max(1000, pomo.endsAt - at);
    update(ref(db, `todos/${myUid}`), todoPatchPause(pomo.todoId, at)).catch(() => {});
    pomo = { ...pomo, mode: 'paused', remaining, endsAt: null, byAway: true };
    savePomo();
    return;
  }
  const running = Object.entries(myTodosAll).find(([, t]) => t && t.runningSince && !t.done);
  if (running) {
    const [id, t] = running;
    const start = Number(t.runningSince);
    const stopAt = Math.max(start, at);
    update(ref(db, `todos/${myUid}/${id}`), { elapsed: (Number(t.elapsed) || 0) + Math.max(0, stopAt - start), runningSince: null }).catch(() => {});
    pausedByAway = { todoId: id };
  }
}
function onBack() {
  if (yielded) return;
  const me = pets.get(myUid); if (me) me.setAway(false);
  setPresence({ away: false });
  if (pomo && pomo.mode === 'paused' && pomo.byAway) {
    if (me && !me.hidden) voice(me.char, 'default');
    ask('자리 비운 동안 멈췄어요. 다시 시작할까요?', [['다시 시작', () => pomoCmd({ type: 'resume' })], ['그만하기', () => pomoCmd({ type: 'stop' })]]);
  } else if (pausedByAway) {
    const { todoId } = pausedByAway; pausedByAway = null;
    if (me && !me.hidden) voice(me.char, 'default');
    ask('자리 비운 동안 타이머를 멈췄어요. 다시 시작할까요?', [['다시 시작', () => startTodoTimer(todoId).catch(() => {})], ['괜찮아요', () => {}]]);
  }
}

// ---------- monthly winner + gift box ----------
let boxShown = false;
async function checkWinner() {
  if (!myUid) return;
  const pm = prevMonthKey();
  try {
    const w = await get(ref(db, `winners/${pm}`));
    if (w.exists()) return;
    const rw = (await get(ref(db, 'rewards'))).val() || {};
    let max = 0, cands = [];
    for (const [uid, months] of Object.entries(rw)) {
      const n = Number(months && months[pm]) || 0;
      if (n > max) { max = n; cands = [uid]; } else if (n === max && n > 0) cands.push(uid);
    }
    if (!max) return;
    const winner = cands[Math.floor(Math.random() * cands.length)];
    const res = await runTransaction(ref(db, `winners/${pm}`), (cur) => (cur === null ? { uid: winner, count: max, ts: Date.now() } : undefined));
    if (!res.committed) return;
    const users = (await get(ref(db, 'users'))).val() || {};
    const u = users[winner] || {};
    await sendEvent(myInfo, [...onlineIds(), myUid], { type: 'king', month: pm, winner, winnerName: String(u.name || '친구'), winnerChar: String(u.char || '') });
  } catch (e) { console.error(e); }
}
function watchWinner() {
  const pm = prevMonthKey();
  onValue(ref(db, `winners/${pm}`), (s) => {
    const w = s.val();
    kingUid = w && w.uid ? w.uid : null;
    for (const p of pets.values()) p.renderTag();
    if (w && w.uid === myUid && !w.gift && !boxShown && !yielded) dropBox(pm);
  }, () => {});
}
function dropBox(month) {
  const me = pets.get(myUid); if (!me) return;
  boxShown = true;
  const img = el('img', { src: 'assets/gifts/giftbox_closed.png', alt: '' });
  const glow = el('div', { class: 'glow' });
  const box = el('div', { class: 'gbox ui', title: '지난달 보상왕 선물이에요! 클릭해서 열어 보세요' }, glow, img, el('div', { class: 'ghint', text: '클릭해서 열기!' }));
  const x = clamp(me.x + SIZE + 10, 10, W - 140);
  box.style.left = x + 'px'; box.style.top = '-150px';
  stage.append(box);
  requestAnimationFrame(() => { box.style.transition = 'top .9s cubic-bezier(.3,1.4,.5,1)'; box.style.top = (GROUND - 128 + 6) + 'px'; });
  let opened = false;
  box.addEventListener('click', async () => {
    if (opened) return; opened = true;
    box.classList.add('shake'); box.querySelector('.ghint').remove();
    play('drumroll', { force: false });
    // decide and save the gift while the drum rolls; the animation never waits for the network
    let gift = drawGift();
    (async () => {
      try {
        const r = await runTransaction(ref(db, `winners/${month}/gift`), (cur) => (cur === null ? gift.id : undefined));
        if (!r.committed) { const g = giftById(r.snapshot.val()); if (g) { gift = g; return; } }
        await push(ref(db, `gifts/${myUid}`), { item: gift.id, month, ts: Date.now() });
      } catch (e) { console.error(e); }
    })();
    setTimeout(() => { box.classList.remove('shake'); img.src = 'assets/gifts/giftbox_open_01.png'; }, 2600);
    setTimeout(() => {
      img.src = 'assets/gifts/giftbox_open_02.png'; box.classList.add('open');
      const t = GIFT_TIERS[gift.tier];
      const out = el('div', { class: 'gout ' + gift.tier }, el('img', { src: gift.icon, alt: '' }), el('div', { text: `${gift.name} (${t ? t.label : ''})` }));
      box.append(out);
      play(gift.tier === 'bust' ? 'fail' : 'tada');
      if (gift.tier !== 'bust') { me.happy(3); voice(me.char, 'happy'); }
      sendEvent(myInfo, onlineIds().filter((id) => id !== myUid), { type: 'giftopen', item: gift.id, month }).catch(() => {});
      window.api.setConfig({ seenGiftMonth: month });
    }, 2950);
    setTimeout(() => { box.classList.add('bye'); setTimeout(() => { box.remove(); setIgnore(true); }, 600); }, 9500);
  });
}

// ---------- mouse: click-through except over pets and popovers ----------
let ignoring = true, drag = null;
function setIgnore(v) { if (v !== ignoring) { ignoring = v; window.api.setIgnore(v); } }
window.addEventListener('mousemove', (e) => {
  if (drag) {
    const p = drag.pet;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
    if (drag.moved && p.state !== 'held') { closePop(p); p.anim = null; p.held.style.display = 'none'; p.setState('held'); voice(p.char, 'pickup'); }
    p.x = clamp(e.clientX - drag.ox, -SIZE / 2, W - SIZE / 2);
    p.y = clamp(e.clientY - drag.oy, FOOT, GROUND);
    return;
  }
  const t = document.elementFromPoint(e.clientX, e.clientY);
  setIgnore(!(t && t.closest && t.closest('.hit, .ui')));
});
window.addEventListener('mousedown', (e) => {
  const p = e.target && e.target._pet; if (!p || e.button !== 0) return;
  drag = { pet: p, sx: e.clientX, sy: e.clientY, ox: e.clientX - p.x, oy: e.clientY - p.y, moved: false };
  setIgnore(false);
});
window.addEventListener('mouseup', (e) => {
  if (!drag || e.button !== 0) return;
  const { pet: p, moved } = drag; drag = null;
  if (moved) { p.vy = 0; p.dropped = true; p.setState('fall'); }
  else if (p.me) {
    if (p.nick && myInfo) { p.setNick(null); sendEvent(myInfo, [...onlineIds(), myUid], { type: 'prank', to: myUid, kind: 'unnick' }).catch(() => {}); }
    p.happy(); voice(p.char, 'default');
  }
  else { if (p.pop) closePop(p); else openPop(p); }
});
window.addEventListener('dblclick', (e) => { const p = e.target && e.target._pet; if (p && p.me) window.api.showTodo(); });
window.addEventListener('contextmenu', (e) => { const p = e.target && e.target._pet; if (p) { e.preventDefault(); window.api.petMenu(); } });
window.addEventListener('blur', () => { if (drag) { const p = drag.pet; drag = null; p.setState('fall'); } });

// ---------- main loop ----------
const pets = new Map(); // uid -> Pet
let last = performance.now();
function loop(now) {
  if (now - last < 30) { requestAnimationFrame(loop); return; } // ~30 fps is plenty, and lighter without the graphics card
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (const p of pets.values()) p.update(dt, now);
  requestAnimationFrame(loop);
}

function todayMood(cfg) {
  const m = cfg && cfg.mood;
  if (!m || !m.text) return '';
  const d = new Date(m.ts || 0), n = new Date();
  return d.toDateString() === n.toDateString() ? String(m.text) : '';
}

async function main() {
  const [cfg, scr] = await Promise.all([window.api.getConfig(), window.api.getScreen()]);
  W = window.innerWidth || scr.bounds.width; H = window.innerHeight || scr.bounds.height;
  GROUND = scr.workArea.y + scr.workArea.height - scr.bounds.y; // top of the taskbar
  window.api.onProfileChanged(() => location.reload());
  setSoundSettings(cfg.sound);
  config = cfg;
  hide = { mine: false, all: false, ...(cfg.hide || {}) };
  frozen = !!cfg.freeze;
  requestAnimationFrame(loop);
  if (!cfg.char || !manifest[cfg.char]) return;

  // my pet shows up right away, even before the network answers
  const me = new Pet({ uid: 'me', char: cfg.char, name: cfg.name, me: true, enter: false });
  pets.set('me', me);
  me.setMood(todayMood(cfg));
  if (!me.hidden) setTimeout(() => voice(cfg.char, 'default'), 600);

  let myRef = null;
  const isHiddenForFriends = () => !!(hide.mine || hide.all);
  let mood = todayMood(cfg);
  window.api.onConfigChanged((c) => {
    config = c;
    setFrozen(!!c.freeze);
    setSoundSettings(c.sound);
    const before = isHiddenForFriends();
    hide = { mine: false, all: false, ...(c.hide || {}) };
    for (const p of pets.values()) { p.applyHidden(); p.renderBubble(); }
    if (drag && drag.pet.hidden) drag = null;
    setIgnore(true);
    const patch = {};
    if (before !== isHiddenForFriends()) patch.hidden = isHiddenForFriends();
    const m = todayMood(c);
    if (m !== mood) { mood = m; me.setMood(m); patch.mood = m || null; }
    const dnd = myDndOn();
    if (dnd !== lastDnd) {
      lastDnd = dnd; me.setDnd(dnd); patch.dnd = dnd ? (c.dnd || { until: null }) : null;
      if (!dnd && dndChanged) dndChanged();
    }
    if (myRef && !yielded && Object.keys(patch).length) update(myRef, patch).catch(() => {});
  });
  let lastDnd = myDndOn(); me.setDnd(lastDnd);
  let dndChanged = null;
  // timed do-not-disturb ends by itself
  setInterval(() => { if (config.dnd && !myDndOn()) window.api.setConfig({ dnd: null }); }, 15000);

  const user = await ensureUser().catch((e) => { console.error(e); return null; });
  if (!user) return;
  const uid = user.uid;
  myUid = uid; myInfo = { uid, name: cfg.name, char: cfg.char };
  pets.delete('me'); me.uid = uid; pets.set(uid, me);
  onValue(ref(db, '.info/serverTimeOffset'), (s) => { serverOffset = Number(s.val()) || 0; });

  // my presence (hidden = friends don't see my character)
  let working = false;
  myRef = ref(db, `presence/${uid}`);
  setPresence = (patch) => { if (!yielded) update(myRef, patch).catch(() => {}); };
  // pomodoro left running from last time
  {
    const st = cfg.pomoState, now = Date.now();
    if (st && ((st.mode === 'focus' || st.mode === 'break') && st.endsAt > now || st.mode === 'paused' || st.mode === 'ready')) pomo = st;
    else pomo = null;
  }
  window.api.onPomoCmd((c) => pomoCmd(c));
  window.api.onIdleAway((d) => onAway(d || {}));
  window.api.onIdleBack(() => onBack());
  // one character on several computers: the computer opened last is the one in use
  const device = cfg.device || 'local';
  const activeRef = ref(db, `active/${uid}`);
  // a reload (midnight, new month…) of a computer that already handed over must not take the character back
  const YKEY = 'todoroom.yielded';
  const startYielded = new URLSearchParams(location.search).get('yielded') === '1' || (() => { try { return sessionStorage.getItem(YKEY) === '1'; } catch { return false; } })();
  if (startYielded) yielded = true;
  else set(activeRef, { device, ts: serverTimestamp() }).catch(() => {});
  let inboxOff = null;
  const yieldHere = () => {
    yielded = true;
    try { sessionStorage.setItem(YKEY, '1'); } catch {}
    window.api.setYielded(true);
    if (pomo) { // the running pomodoro stays on the computer that started it: stop it here, keep the time
      if (pomo.todoId) update(ref(db, `todos/${uid}`), todoPatchPause(pomo.todoId, Date.now())).catch(() => {});
      pomo = null; window.api.setConfig({ pomoState: null });
    }
    closeAsk();
    onDisconnect(myRef).cancel().catch(() => {});
    if (inboxOff) { inboxOff(); inboxOff = null; }
    for (const id of [...cards.keys()]) removeCard(id);
    me.applyHidden();
  };
  onValue(activeRef, (s) => {
    const v = s.val();
    if (!v || !v.device) return;
    if (v.device !== device && !yielded) yieldHere();
    else if (v.device === device && yielded) { // "use it here" was pressed
      try { sessionStorage.removeItem(YKEY); } catch {}
      window.api.setYielded(false);
      location.href = location.pathname + '?yielded=0';
    }
  }, () => {});
  let connected = false, leaving = false, healing = false;
  const writePresence = async () => {
    await onDisconnect(myRef).remove();
    await set(myRef, { char: cfg.char, name: cfg.name, hidden: isHiddenForFriends(), mood: mood || null, working, away: !!me.away, dnd: myDndOn() ? (config.dnd || { until: null }) : null,
        pomo: pomo && (pomo.mode === 'focus' || pomo.mode === 'break') ? { mode: pomo.mode, endsAt: pomo.endsAt + serverOffset, todoId: pomo.todoId || null } : null, ts: serverTimestamp() });
  };
  onValue(ref(db, '.info/connected'), async (snap) => {
    connected = snap.val() === true;
    if (!connected || yielded || leaving) return;
    try { await writePresence(); } catch (e) { console.error(e); }
  });
  // self-heal: an old connection's "remove on disconnect" can land after a reconnect or a reload
  // and wipe my presence while I'm still here — friends would stop seeing my character.
  onValue(myRef, async (snap) => {
    if (snap.exists() || !connected || yielded || leaving || healing) return;
    healing = true;
    try { await new Promise((r) => setTimeout(r, 800)); if (!yielded && !leaving && connected) await writePresence(); }
    catch (e) { console.error(e); } finally { healing = false; }
  }, () => {});
  window.addEventListener('beforeunload', () => { leaving = true; if (!yielded) remove(myRef).catch(() => {}); });

  // inbox: signals from friends (and echoes of my own)
  const inbox = ref(db, `inbox/${uid}`);
  inboxOff = onChildAdded(inbox, (snap) => {
    const ev = snap.val();
    remove(snap.ref).catch(() => {});
    if (!ev || typeof ev.ts !== 'number') return;
    if (Date.now() + serverOffset - ev.ts > 60000) return; // too old (I was offline)
    try { handleEvent(ev); } catch (e) { console.error(e); }
  }, (e) => console.error(e));
  if (startYielded) yieldHere();

  const todoSubs = new Map();
  function watchTodos(id) {
    if (todoSubs.has(id)) return;
    todoSubs.set(id, onValue(ref(db, `todos/${id}`), (s) => { const p = pets.get(id); if (p) p.setTodos(todaysTodos(s.val())); }, () => {}));
  }
  function unwatch(id) { const off = todoSubs.get(id); if (off) { off(); todoSubs.delete(id); } }
  watchTodos(uid);

  // my timer -> "working" for everyone
  const myTodosRef = ref(db, `todos/${uid}`);
  onValue(myTodosRef, (s) => {
    myTodosAll = s.val() || {};
    const list = todaysTodos(myTodosAll);
    const w = list.some((t) => t.runningSince && !t.done);
    me.setWorking(w);
    if (w !== working) { working = w; if (!yielded) update(myRef, { working: w }).catch(() => {}); }
  }, () => {});

  let firstPresence = true;
  onValue(ref(db, 'presence'), (snap) => {
    const all = snap.val() || {};
    online = all;
    let delay = 0;
    for (const [id, info] of Object.entries(all)) {
      if (id === uid || !info || !manifest[info.char] || info.hidden) continue;
      let p = pets.get(id);
      if (!p) {
        p = new Pet({ uid: id, char: info.char, name: String(info.name || '친구'), me: false, enter: true });
        pets.set(id, p); watchTodos(id);
        if (!firstPresence && !p.hidden) setTimeout(() => voice(info.char, 'default', { fromFriend: true }), 300 + delay);
        delay += 400;
      }
      if ((info.mood || '') !== p.mood) p.setMood(info.mood || '');
      p.setWorking(!!info.working);
      p.setAway(!!info.away);
      p.setDnd(inDnd(info));
      p.setFocus(info.pomo || null);
    }
    for (const [id, p] of [...pets]) {
      if (id === uid) continue;
      const info = all[id];
      if (!info || info.hidden) { p.destroy(); pets.delete(id); unwatch(id); }
    }
    firstPresence = false;
  }, (e) => console.error(e));

  savePomo();

  // mailbox: unread megaphones become small cards (also the ones sent while I was away or offline)
  let mailAll = {};
  const syncCards = () => {
    if (yielded || myDndOn()) return;
    const focusing = pomo && pomo.mode === 'focus';
    for (const [id, m] of Object.entries(mailAll)) {
      if (!m || (m.type !== 'megaphone' && m.type !== 'note')) continue;
      if (m.read) { readMail.add(id); removeCard(id); continue; }
      if (m.from === uid || focusing || shownMail.has(id)) continue;
      if (typeof m.ts === 'number' && Date.now() + serverOffset - m.ts < 8000) { setTimeout(syncCards, 8000); continue; } // the live bubble comes first
      addCard({ ...m, mailId: id });
    }
    for (const id of [...cards.keys()]) if (!mailAll[id]) removeCard(id);
  };
  onValue(ref(db, `mail/${uid}`), (snap) => { mailAll = snap.val() || {}; syncCards(); }, () => {});

  // 그림 맞추기: a friend's new drawing quiz becomes a small card; when it ends everyone gets a toast
  let quizSeen = null; let quizTimer = null;
  onValue(ref(db, 'quiz/current'), (snap) => {
    const q = snap.val();
    if (quizTimer) { clearTimeout(quizTimer); quizTimer = null; }
    if (!q || !q.id) return;
    const t = Date.now() + serverOffset;
    const open = q.status === 'open' && t < Number(q.endsAt);
    if (open) {
      if (q.from !== uid && !yielded && !myDndOn() && !cards.has('quiz:' + q.id)) quizCard(q);
      quizSeen = q.id;
      quizTimer = setTimeout(() => { removeCard('quiz:' + q.id); toast(`⏰ ${q.from === uid ? '내' : (q.name || '친구') + '의'} 그림 문제 시간이 끝났어요. 정답은 "${q.answer}"`); }, Number(q.endsAt) - t + 500);
      return;
    }
    removeCard('quiz:' + q.id);
    if (quizSeen === q.id) { // only announce endings we saw happening
      quizSeen = null;
      if (q.winner) toast(q.winner.uid === uid ? `🎉 정답! "${q.answer}"` : `🎉 ${q.winner.name} 정답! 정답은 "${q.answer}"`);
      else if (q.endedBy) toast(`${q.from === uid ? '내' : (q.name || '친구') + '의'} 그림 문제가 끝났어요. 정답은 "${q.answer}"`);
    }
  }, () => {});
  dndChanged = () => {
    const n = Object.values(mailAll).filter((m) => m && (m.type === 'note' || m.type === 'megaphone') && !m.read && m.from !== uid).length;
    if (n) toast(`방해 금지 동안 안 읽은 쪽지·확성기 ${n}개가 있어요`);
    syncCards();
  };
  let wasFocus = pomo && pomo.mode === 'focus';
  setInterval(() => {
    const f = pomo && pomo.mode === 'focus';
    if (wasFocus && !f) {
      if (heldDuringFocus.size) { toast(`집중하는 동안 확성기·쪽지 ${heldDuringFocus.size}개가 왔어요`); heldDuringFocus.clear(); }
      syncCards();
    }
    wasFocus = f;
  }, 1000);

  // last month's winner and the gift box
  watchWinner();
  checkWinner();
  setInterval(checkWinner, 30 * 60 * 1000);
  const mk = monthKey();
  setInterval(() => { if (monthKey() !== mk) location.reload(); }, 60 * 1000);
}

window.addEventListener('resize', () => { W = window.innerWidth; H = window.innerHeight; });
// the window was moved back onto the chosen monitor (monitor change, wake-up…): new floor, bring everyone inside
window.api.onScreenChanged((info) => {
  if (!info || !info.bounds) return;
  W = window.innerWidth || info.bounds.width; H = window.innerHeight || info.bounds.height;
  GROUND = info.workArea.y + info.workArea.height - info.bounds.y;
  if (!(GROUND > SIZE) || GROUND > H) GROUND = H; // no taskbar on this monitor: walk along the bottom edge
  for (const p of pets.values()) {
    p.x = clamp(p.x, 0, Math.max(0, W - SIZE));
    if (p.tx != null) p.tx = clamp(p.tx, 0, Math.max(0, W - SIZE));
    if (p.state !== 'held') { p.y = GROUND; p.vy = 0; }
  }
});
// heartbeat: the main process restarts this window if it stops answering
setInterval(() => { try { window.api.petAlive(); } catch {} }, 5000);
window.addEventListener('error', (e) => { try { window.api.log('pet', `오류: ${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`); } catch {} });
window.addEventListener('unhandledrejection', (e) => { try { window.api.log('pet', `오류(promise): ${e.reason && (e.reason.code || e.reason.message) || e.reason}`); } catch {} });
main();

// Developer hook for offline visual checks (no network needed).
function setFrozen(on) {
  if (on === frozen) return;
  frozen = on;
  for (const p of pets.values()) {
    if (p.busy() || p.state === 'happy') continue; // let reactions finish; they end in decide()
    if (p.state === 'walk' && p.outside()) continue; // still coming in from the edge
    if (on) p.setState('idle', 1e6); else p.decide();
  }
}
window.__todoroomDebug = {
  freeze(on) { setFrozen(!!on); return frozen; },
  _pet(k) { return pets.get(k); },
  isFrozen() { return frozen; },
  lineup(state) {
    const cs = [['l1', 'black_cat', '고양이'], ['l2', 'hamster', '햄스터'], ['l3', 'squirrel', '날다람쥐'], ['l4', 'chick', '오리']];
    cs.forEach(([uid, char, name], i) => {
      let p = pets.get(uid);
      if (!p) { p = new Pet({ uid, char, name, me: false, enter: false }); pets.set(uid, p); }
      p.x = 300 + i * 160; p.y = GROUND; p.dir = 1; p.anim = null; p.node.classList.remove('ouch', 'wet');
      if (state === 'hit') { p.setState('hit', 1e6); p.node.classList.add('ouch'); }
      else p.setState(state, 1e6);
    });
    return true;
  },
  enterTest() {
    const mk = (uid, char, name) => { const f = new Pet({ uid, char, name, me: false, enter: true }); pets.set(uid, f); return f; };
    const a = mk('t1', 'hamster', '타이머'); a.setWorking(true);
    const b = mk('t2', 'squirrel', '자리비움'); b.setAway(true);
    const c = mk('t3', 'chick', '옛버그'); c.walkTo(300); c.x = -SIZE; c.setState('work', 1e6); // what 0.7.0 left behind
    return true;
  },
  enterState() { return ['t1', 't2', 't3'].map((k) => { const p = pets.get(k); return `${p.name} x=${Math.round(p.x)} state=${p.state}`; }).join(' | '); },
  setup() {
    myUid = myUid || 'me';
    const me = pets.get('me') || pets.get(myUid);
    if (me) { me.x = W / 2 - 200; me.setState('idle', 60); me.setMood('오늘은 원고 3000자 쓰기!'); }
    const f = new Pet({ uid: 'f1', char: 'hamster', name: '친구', me: false, enter: false });
    f.x = W / 2 + 120; f.setState('idle', 60); f.setMood('졸려요…');
    pets.set('f1', f);
    return true;
  },
  prank(kind, extra) { handlePrank({ type: 'prank', to: 'f1', from: myUid || 'me', name: '하경', char: 'black_cat', kind, id: 'p' + kind, ...(extra || {}) }, false, pets.get(myUid || 'me')); },
  walkToPeel() { const f = pets.get('f1'); const pl = [...peels.values()][0]; if (f && pl) { f.x = pl.x - SIZE / 2 - 60 * (pl.x > f.headX ? 1 : -1); f.walkTo(pl.x - SIZE / 2 + 40 * (pl.x > f.headX ? 1 : -1)); } },
  popPranks() { online.f1 = { char: 'hamster' }; const f = pets.get('f1'); f.todos = [{ id: 'a', text: '원고 쓰기', done: false }]; openPop(f); const b = [...f.pop.querySelectorAll('.pgrid .act')].pop(); b.click(); },
  fire(ev) { handleEvent({ ts: Date.now(), name: '하경', char: 'black_cat', ...ev }); },
  dndPop() { online.f1 = { char: 'hamster', dnd: { until: null } }; const f = pets.get('f1'); f.setDnd(true); f.todos = [{ id: 'a', text: '원고 쓰기', done: true }]; openPop(f); },
  reply() { if (!myInfo) { myUid = myUid || 'me'; myInfo = { uid: myUid, name: '하경', char: 'black_cat' }; } openReply({ from: 'f1', name: '민지', char: 'hamster' }); },
  note() {
    if (!myInfo) { myUid = myUid || 'me'; myInfo = { uid: myUid, name: '하경', char: 'black_cat' }; }
    showMegaphone({ type: 'note', from: 'f1', name: '민지', char: 'hamster', text: '하경아 오늘 저녁에 같이 온라인 작업할래? 9시쯤 어때? 끝나고 수다도 떨자 ㅎㅎ 답장 줘!', mailId: 'n1' }, false);
    addCard({ type: 'note', mailId: 'n2', from: 'f2', name: '수아', char: 'squirrel', text: '어제 말한 자료 메일로 보냈어!' });
    addCard({ type: 'megaphone', mailId: 'm2', from: 'f1', name: '민지', char: 'hamster', text: '다들 점심 먹었어??' });
  },
  mega() {
    if (!myInfo) { myUid = myUid || 'me'; myInfo = { uid: myUid, name: '하경', char: 'black_cat' }; }
    showMegaphone({ type: 'megaphone', from: 'f1', name: '민지', char: 'hamster', text: '오늘 다들 몇 시까지 작업해?', mailId: 'm1' }, false);
    addCard({ type: 'megaphone', mailId: 'm3', from: 'f2', name: '수아', char: 'squirrel', text: '저녁 같이 먹을 사람!' });
  },
  syncRead(id) { removeCard(id); },
  quizCard() { quizCard({ id: 'qx', from: 'f1', name: '민지', char: 'hamster' }); }, // what the mailbox listener does once a mail is marked read
  megaReplyClick() { const b = document.querySelector('.mega .reply'); if (b) b.click(); return !!b; },
  celebrate(id) { const p = pets.get(id); if (p) { p.lastDoneId = 'x'; p.celebrate(); } },
  pop(id) { const p = pets.get(id); if (p) { p.todos = [{ id: 'a', text: '원고 쓰기', done: true }, { id: 'b', text: '빨래 개기', done: false }]; openPop(p); } },
};
window.__todoroomDebug.work = (id, on) => { const p = pets.get(id); if (p) p.setWorking(on); };
Object.assign(window.__todoroomDebug, {
  p4a() {
    myUid = myUid || 'me'; kingUid = 'me';
    const f = pets.get('f1'); if (f) { f.setFocus({ mode: 'focus', endsAt: Date.now() + 12 * 60000 }); }
    const me = pets.get('me'); if (me) { me.renderTag(); rewardPop(me); me.say('츄르 획득! 짧은 휴식 5분', 5); }
    showMegaphone({ name: '민지', char: 'hamster', text: '다들 점심 먹었어?? 오후도 화이팅!!', mailId: 'm1' }, false);
    addCard({ name: '수아', char: 'chick', text: '오늘 저녁에 같이 공부할 사람~', mailId: 'm0' });
  },
  p4b() {
    const me = pets.get('me'); if (!me) return;
    ask('자리 비운 동안 멈췄어요. 다시 시작할까요?', [['다시 시작', () => {}], ['그만하기', () => {}]]);
    announce({ icon: 'assets/ui/crown_badge.png', title: '11월 보상왕', text: '하경! 선물 상자를 받아요 🎁', face: 'black_cat' });
  },
  treatAll() { for (const p of pets.values()) { p.setState('idle', 1e6); p.treat(); } },
  p4c() { closeAsk(); const me = pets.get('me'); myUid = 'me'; dropBox('2026-10'); },
  p4open() { const b = document.querySelector('.gbox'); if (b) b.click(); },
});
