// Sound effects + character voices with on/off, volume and "friend sounds" settings.
const FILES = {
  open: 'assets/sounds/window_open.wav',
  close: 'assets/sounds/window_close.wav',
  drop: 'assets/sounds/character_drop.wav',
  complete: 'assets/sounds/task_complete.wav',
  throw: 'assets/sounds/item_throw.wav',
  megaphone: 'assets/sounds/megaphone.wav',
  drumroll: 'assets/sounds/gift_drumroll.wav',
  tada: 'assets/sounds/gift_tada.wav',
  fail: 'assets/sounds/gift_fail.wav',
  slip: 'assets/sounds/prank_slip.wav',
  bonk: 'assets/sounds/prank_bonk.wav',
  poke: 'assets/sounds/prank_poke.wav',
  tickle: 'assets/sounds/prank_tickle.wav',
  splash: 'assets/sounds/prank_splash.wav',
};
const VOICE_CHARS = ['black_cat', 'hamster', 'squirrel', 'chick'];
const VOICE_KINDS = ['default', 'happy', 'pickup', 'hit'];

export const DEFAULT_SOUND = { on: true, volume: 0.8, friend: true };

let settings = { ...DEFAULT_SOUND };
const base = {};
function load(key, src) { const a = new Audio(src); a.preload = 'auto'; base[key] = a; }
for (const [k, src] of Object.entries(FILES)) load(k, src);
for (const c of VOICE_CHARS) for (const k of VOICE_KINDS) load(`${c}:${k}`, `assets/voices/${c}_voice_${k}.wav`);

export function setSoundSettings(s) {
  settings = { ...DEFAULT_SOUND, ...(s || {}) };
  settings.volume = Math.max(0, Math.min(1, Number(settings.volume)));
  if (!Number.isFinite(settings.volume)) settings.volume = DEFAULT_SOUND.volume;
}
export function getSoundSettings() { return { ...settings }; }

function playKey(key, { fromFriend = false, force = false } = {}) {
  if (!force && !settings.on) return;
  if (!force && fromFriend && !settings.friend) return;
  const src = base[key]; if (!src) return;
  const a = src.cloneNode();
  a.volume = settings.volume;
  a.play().catch(() => {});
}

// fromFriend: true for sounds caused by a friend (their character's voice, megaphone, being hit)
export function play(name, opts) { playKey(name, opts); }
export function voice(char, kind, opts) { playKey(`${char}:${kind}`, opts); }
