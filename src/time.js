export const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_DAYS = 15;
export const RETENTION_MS = RETENTION_DAYS * DAY_MS;

// total time spent on a todo, including a running timer
export function elapsedOf(t, now = Date.now()) {
  if (!t) return 0;
  const base = Math.max(0, Number(t.elapsed) || 0);
  const run = t.runningSince && !t.done ? Math.max(0, now - Number(t.runningSince)) : 0;
  return base + run;
}

export function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

export function fmtHours(ms) {
  if (ms > 0 && ms < 60000) return '1분 미만';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
