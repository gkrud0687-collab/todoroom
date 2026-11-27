// 꼬물이 마을 — main process
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, powerMonitor, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Windows guesses which windows are hidden behind others and stops drawing them. For a transparent window that
// covers the whole screen (the characters) that guess goes wrong and the window turns invisible while still alive.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Transparent windows drawn by the graphics card can go blank when another window (a browser, a folder) comes
// in front. Drawing them in software avoids it. It can be turned back on in the settings (restart needed).
let gpuOn = false;
try { gpuOn = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8')).gpu === true; } catch {}
if (!gpuOn) app.disableHardwareAcceleration();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');
let config = {};
function loadConfig() {
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8')); } catch { config = {}; }
  if (!config.device) { config.device = require('crypto').randomUUID(); try { saveConfig(); } catch {} }
}
function saveConfig() {
  try { fs.writeFileSync(CONFIG_PATH(), JSON.stringify(config, null, 2)); } catch (e) { console.error(e); }
}

// ---------- log file (what happened to the character window, deleted to-dos…) ----------
const LOG_PATH = () => path.join(app.getPath('userData'), 'todoroom-log.txt');
function logLine(src, msg) {
  try {
    const p = LOG_PATH();
    try { if (fs.statSync(p).size > 512 * 1024) { const t = fs.readFileSync(p, 'utf8'); fs.writeFileSync(p, t.slice(-256 * 1024)); } } catch {}
    const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    fs.appendFileSync(p, `[${ts}] [${src}] ${String(msg).slice(0, 2000)}\n`);
  } catch (e) { console.error(e); }
}

let petWin = null, todoWin = null, setupWin = null, reportWin = null, tray = null;
let petYielded = false;     // the character window handed over to another computer (kept across restarts of the window)
let petAliveAt = Date.now(); // heartbeat from the character window
let quitting = false;

const webPrefs = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false,
};

function createSetup() {
  if (setupWin) { setupWin.show(); setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 600, height: 400, frame: false, transparent: true, resizable: false,
    title: '꼬물이 마을 — 캐릭터 고르기', icon: path.join(__dirname, 'assets/ui/app_icon.png'),
    webPreferences: webPrefs,
  });
  setupWin.loadFile('setup.html');
  setupWin.on('closed', () => { setupWin = null; });
}

// which monitor shows the characters: the chosen one if it is connected, else the primary
function petDisplay() {
  const all = screen.getAllDisplays();
  const want = config.monitor;
  if (want != null && want !== 'primary') {
    const d = all.find((x) => String(x.id) === String(want));
    if (d) return d;
  }
  return screen.getPrimaryDisplay();
}
function screenInfo() { const d = petDisplay(); return { bounds: d.bounds, workArea: d.workArea, id: d.id }; }

function createPet() {
  if (petWin) return;
  const d = petDisplay();
  const b = d.bounds;
  petWin = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, hasShadow: false, focusable: true, show: false,
    alwaysOnTop: true, title: 'TodoRoom pets',
    webPreferences: webPrefs,
  });
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.loadFile('pet.html', { query: { yielded: petYielded ? '1' : '0' } });
  petWin.once('ready-to-show', () => { if (petWin) { petWin.showInactive(); fitPet('show'); } });
  petAliveAt = Date.now();
  const wc = petWin.webContents;
  wc.on('render-process-gone', (_e, d) => { logLine('pet', `캐릭터 창이 꺼짐: ${d && d.reason} (${d && d.exitCode})`); recreatePet('꺼짐'); });
  wc.on('unresponsive', () => {
    logLine('pet', '캐릭터 창이 응답하지 않음');
    const w = petWin;
    setTimeout(() => { if (w && w === petWin && !w.isDestroyed() && w.__unresponsive) recreatePet('응답 없음'); }, 8000);
    if (w) w.__unresponsive = true;
  });
  wc.on('responsive', () => { if (petWin) petWin.__unresponsive = false; logLine('pet', '캐릭터 창이 다시 응답함'); });
  petWin.on('closed', () => { petWin = null; });
}
let recreating = false;
function recreatePet(reason) {
  if (recreating || quitting) return;
  recreating = true;
  logLine('pet', `캐릭터 창 다시 띄우기: ${reason}`);
  const old = petWin; petWin = null;
  try { if (old && !old.isDestroyed()) old.destroy(); } catch {}
  setTimeout(() => { recreating = false; if (!quitting && config.char) createPet(); }, 1200);
}
// keep the character window covering the whole chosen monitor, on top, and visible
let lastFitKey = '';
function fitPet(why) {
  if (!petWin || petWin.isDestroyed()) return;
  const info = screenInfo(); const b = info.bounds;
  const cur = petWin.getBounds();
  const off = (u, v) => Math.abs(u - v) > 4; // a pixel or two of difference is normal for transparent windows
  if (off(cur.x, b.x) || off(cur.y, b.y) || off(cur.width, b.width) || off(cur.height, b.height)) {
    logLine('screen', `캐릭터 창 위치·크기 바로잡음(${why}): ${cur.x},${cur.y} ${cur.width}x${cur.height} → ${b.x},${b.y} ${b.width}x${b.height}`);
    petWin.setBounds(b);
  }
  if (!petWin.isAlwaysOnTop()) { petWin.setAlwaysOnTop(true, 'screen-saver'); logLine('screen', `항상 위 다시 걸기(${why})`); }
  if (!petWin.isVisible()) { petWin.showInactive(); logLine('screen', `캐릭터 창 다시 보이기(${why})`); }
  const key = JSON.stringify([info.bounds, info.workArea]);
  if (key !== lastFitKey || why === 'show' || why === 'monitor') { lastFitKey = key; sendPet('screen:changed', info); }
}
let lastWatch = Date.now();
function startPetWatch() {
  const later = (why) => { for (const t of [800, 3500]) setTimeout(() => { fitPet(why); guardTodo(why); }, t); };
  screen.on('display-added', () => { logLine('screen', '모니터 연결됨'); later('모니터 연결'); });
  screen.on('display-removed', () => { logLine('screen', '모니터 빠짐'); later('모니터 빠짐'); });
  screen.on('display-metrics-changed', () => later('화면 변경'));
  powerMonitor.on('resume', () => { petAliveAt = Date.now(); later('절전 해제'); });
  powerMonitor.on('unlock-screen', () => { petAliveAt = Date.now(); later('잠금 해제'); });
  app.on('child-process-gone', (_e, d) => {
    if (!d || d.type !== 'GPU') return;
    logLine('gpu', `그래픽 처리 프로세스가 꺼짐: ${d.reason} (${d.exitCode})`);
    setTimeout(() => recreatePet('그래픽 처리 오류'), 1500);
  });
  setInterval(() => {
    const now = Date.now();
    const slept = now - lastWatch > 30000; // this process itself was paused (sleep)
    lastWatch = now;
    if (slept) { petAliveAt = now; return; }
    fitPet('주기 확인');
    guardTodo('주기 확인');
    if (petWin && !petWin.isDestroyed() && !petWin.webContents.isLoading() && now - petAliveAt > 45000) {
      logLine('pet', `캐릭터 창 신호 없음 ${Math.round((now - petAliveAt) / 1000)}초`);
      recreatePet('신호 없음');
    }
  }, 5000);
}

// ---------- start with Windows ----------
function applyAutoStart() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!config.autoStart, path: process.execPath, args: [] });
  } catch (e) { logLine('app', `자동 실행 설정 실패: ${e && e.message}`); }
}

// the to-do window: a spot on screen, kept on top when pinned
function defaultTodoPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - 400 - 24, y: Math.max(wa.y, wa.y + wa.height - 480 - 150) };
}
function visibleOnSomeScreen(b) {
  // at least the title bar (about 120×40) must be inside a monitor's usable area
  return screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    const ix = Math.min(b.x + b.width, w.x + w.width) - Math.max(b.x, w.x);
    const iy = Math.min(b.y + 40, w.y + w.height) - Math.max(b.y, w.y);
    return ix >= 120 && iy >= 30;
  });
}
function guardTodo(why) {
  if (!todoWin || todoWin.isDestroyed()) return;
  const b = todoWin.getBounds();
  if (!visibleOnSomeScreen(b)) {
    const p = defaultTodoPos();
    logLine('todo-win', `할 일 창이 화면 밖에 있어서 데려옴(${why}): ${b.x},${b.y} → ${p.x},${p.y}`);
    todoWin.setPosition(p.x, p.y);
    config.todoPos = p; saveConfig();
  }
  // re-pin only on calm moments (not every few seconds): fighting another always-on-top program makes windows flicker
  if (why !== '주기 확인' && config.pinned !== false && todoWin.isVisible() && !todoWin.isMinimized() && !todoWin.isAlwaysOnTop()) {
    todoWin.setAlwaysOnTop(true);
    logLine('todo-win', `할 일 창 맨 위 고정 다시 걸기(${why})`);
  }
}
function createTodo() {
  if (todoWin) {
    if (todoWin.isMinimized()) { todoWin.restore(); todoWin.focus(); return; } // 'restore' plays the sound
    if (!todoWin.isVisible()) { todoWin.show(); todoWin.webContents.send('todo:shown'); }
    todoWin.focus();
    return;
  }
  const W = 400, H = 480;
  const pos = config.todoPos && Number.isFinite(config.todoPos.x) && visibleOnSomeScreen({ x: config.todoPos.x, y: config.todoPos.y, width: W, height: H })
    ? config.todoPos : defaultTodoPos();
  todoWin = new BrowserWindow({
    x: pos.x, y: pos.y, width: W, height: H, frame: false, transparent: true,
    resizable: false, maximizable: false, alwaysOnTop: config.pinned !== false,
    title: '꼬물이 마을', icon: path.join(__dirname, 'assets/ui/app_icon.png'),
    show: false, webPreferences: webPrefs,
  });
  todoWin.loadFile('todo.html');
  todoWin.once('ready-to-show', () => { todoWin.show(); guardTodo('처음'); });
  todoWin.on('moved', () => {
    const [x, y] = todoWin.getPosition();
    config.todoPos = { x, y }; saveConfig();
  });
  todoWin.on('close', (e) => { if (!quitting) { e.preventDefault(); todoWin.minimize(); } });
  todoWin.on('restore', () => { if (todoWin) { todoWin.webContents.send('todo:shown'); guardTodo('다시 열기'); } });
  todoWin.on('show', () => guardTodo('보이기'));
  todoWin.on('always-on-top-changed', (_e, on) => { if (!on && config.pinned !== false) logLine('todo-win', '윈도우가 할 일 창의 맨 위 고정을 풀었음'); });
  todoWin.on('closed', () => { todoWin = null; });
}

function dndOn() { const d = config.dnd; return !!d && (d.until == null || Number(d.until) > Date.now()); }
function setDnd(mode) {
  if (mode === 'off') config.dnd = null;
  else if (mode === 'hour') config.dnd = { until: Date.now() + 60 * 60 * 1000 };
  else if (mode === 'today') { const t = new Date(); t.setHours(24, 0, 0, 0); config.dnd = { until: t.getTime() }; }
  else config.dnd = { until: null };
  saveConfig(); broadcastConfig(); refreshTrayMenu();
}
function setFreeze(on) {
  config.freeze = !!on;
  logLine('app', `그대로 멈춰라 ${on ? '켬' : '끔'}`);
  saveConfig(); broadcastConfig(); refreshTrayMenu(); refreshJumpList();
}
function hideState() { return { mine: false, all: false, ...(config.hide || {}) }; }
function broadcastConfig() {
  for (const w of [petWin, todoWin, setupWin, reportWin]) if (w && !w.isDestroyed()) w.webContents.send('config:changed', config);
}
function setHide(partial) {
  config.hide = { ...hideState(), ...partial };
  saveConfig(); broadcastConfig(); refreshTrayMenu();
}
function appMenuTemplate() {
  const h = hideState();
  return [
    { label: '할 일 창 열기', click: () => createTodo() },
    { label: '🖍 그림 맞추기', click: () => createQuiz() },
    { type: 'separator' },
    { label: dndOn() ? `🔕 방해 금지 켜짐 (${config.dnd.until == null ? '직접 끌 때까지' : new Date(config.dnd.until).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) + '까지'})` : '방해 금지', submenu: [
      { label: '1시간', click: () => setDnd('hour') },
      { label: '오늘 하루', click: () => setDnd('today') },
      { label: '직접 끌 때까지', click: () => setDnd('manual') },
      { type: 'separator' },
      { label: '방해 금지 끄기', enabled: dndOn(), click: () => setDnd('off') },
    ] },
    { type: 'separator' },
    { label: '내 캐릭터 숨기기', type: 'checkbox', checked: h.mine, click: (it) => setHide({ mine: it.checked }) },
    { label: '모든 캐릭터 숨기기', type: 'checkbox', checked: h.all, click: (it) => setHide({ all: it.checked }) },
    { type: 'separator' },
    { label: '그대로 멈춰라 (캐릭터 안 움직이기)', type: 'checkbox', checked: !!config.freeze, click: (it) => setFreeze(it.checked) },
    { label: '캐릭터 다시 불러오기', click: () => recreatePet('메뉴에서 다시 불러오기') },
    { label: '캐릭터·이름 바꾸기', click: () => createSetup() },
    { type: 'separator' },
    { label: updateLabel(), enabled: !!updater && updateState !== 'checking' && updateState !== 'downloading', click: () => updateMenuClick() },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ];
}
function refreshTrayMenu() {
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(appMenuTemplate()));
  refreshJumpList();
}

// Right-click menu on the taskbar button (Windows jump list). Each item relaunches the exe with a flag;
// the running app receives it through 'second-instance'.
function refreshJumpList() {
  if (process.platform !== 'win32' || !config.char) return;
  const h = hideState();
  const task = (title, arg) => ({ program: process.execPath, arguments: app.isPackaged ? arg : `"${app.getAppPath()}" ${arg}`, title, description: title, iconPath: process.execPath, iconIndex: 0 });
  try {
    app.setUserTasks([
      task('할 일 창 열기', '--todoroom-open'),
      task(dndOn() ? '방해 금지 끄기' : '방해 금지 켜기', '--todoroom-dnd'),
      task(h.mine ? '내 캐릭터 다시 보이기' : '내 캐릭터 숨기기', '--todoroom-hide-mine'),
      task(h.all ? '모든 캐릭터 다시 보이기' : '모든 캐릭터 숨기기', '--todoroom-hide-all'),
      task(config.freeze ? '그대로 멈춰라 끄기' : '그대로 멈춰라 켜기', '--todoroom-freeze'),
      task('캐릭터 다시 불러오기', '--todoroom-reload-pets'),
      task('캐릭터·이름 바꾸기', '--todoroom-setup'),
      task('업데이트 확인', '--todoroom-update'),
      task('종료', '--todoroom-quit'),
    ]);
  } catch (e) { console.error(e); }
}
function handleArgs(argv) {
  const has = (f) => argv.includes(f);
  if (has('--todoroom-quit')) { quitting = true; app.quit(); return true; }
  if (has('--todoroom-hide-mine')) { setHide({ mine: !hideState().mine }); return true; }
  if (has('--todoroom-hide-all')) { setHide({ all: !hideState().all }); return true; }
  if (has('--todoroom-setup')) { createSetup(); return true; }
  if (has('--todoroom-reload-pets')) { recreatePet('작업표시줄 메뉴에서 다시 불러오기'); return true; }
  if (has('--todoroom-open')) { createTodo(); return true; }
  if (has('--todoroom-dnd')) { setDnd(dndOn() ? 'off' : 'manual'); return true; }
  if (has('--todoroom-freeze')) { setFreeze(!config.freeze); return true; }
  if (has('--todoroom-update')) { if (updater) updateMenuClick(); else dialog.showMessageBox({ type: 'info', title: APP_NAME, message: '이 버전은 자동 업데이트를 쓰지 않아요', buttons: ['확인'] }); return true; }
  return false;
}

function createReport(auto) {
  if (reportWin) { reportWin.show(); reportWin.focus(); return; }
  reportWin = new BrowserWindow({
    width: 500, height: 400, frame: false, transparent: true, resizable: false, maximizable: false,
    alwaysOnTop: true, title: '15일 보고서', icon: path.join(__dirname, 'assets/ui/app_icon.png'),
    show: false, webPreferences: webPrefs,
  });
  reportWin.loadFile('report.html', { query: { auto: auto ? '1' : '0' } });
  reportWin.once('ready-to-show', () => reportWin.show());
  reportWin.on('closed', () => { reportWin = null; });
}

let quizWin = null;
function createQuiz() {
  if (quizWin) { quizWin.show(); quizWin.focus(); return; }
  quizWin = new BrowserWindow({
    width: 500, height: 400, frame: false, transparent: true, resizable: false, maximizable: false,
    alwaysOnTop: true, title: '그림 맞추기', icon: path.join(__dirname, 'assets/ui/app_icon.png'),
    show: false, webPreferences: webPrefs,
  });
  quizWin.loadFile('quiz.html', { query: { snap: process.env.TODOROOM_SNAP ? '1' : '0' } });
  quizWin.once('ready-to-show', () => quizWin.show());
  quizWin.on('closed', () => { quizWin = null; });
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/ui/app_icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('꼬물이 마을');
  refreshTrayMenu();
  tray.on('click', () => createTodo());
}

// ---------- away detection: 3 minutes without mouse/keyboard, screen lock or sleep ----------
const IDLE_SECONDS = 180;
let away = false, locked = false;
function sendPet(ch, data) { if (petWin && !petWin.isDestroyed()) petWin.webContents.send(ch, data); }
function goAway(idleSec) {
  if (away) return; away = true;
  sendPet('idle:away', { lastActive: Date.now() - Math.max(0, idleSec) * 1000 });
}
function startIdleWatch() {
  setInterval(() => {
    let idle = 0;
    try { idle = powerMonitor.getSystemIdleTime(); } catch (e) { return; }
    if (!away && idle >= IDLE_SECONDS) goAway(idle);
    else if (away && !locked && idle < 5) { away = false; sendPet('idle:back'); }
  }, 5000);
  const lockOn = () => { locked = true; goAway(0); };
  const lockOff = () => { locked = false; };
  powerMonitor.on('lock-screen', lockOn);
  powerMonitor.on('suspend', lockOn);
  powerMonitor.on('unlock-screen', lockOff);
  powerMonitor.on('resume', lockOff);
}

function startMain() {
  refreshJumpList();
  createTray();
  createPet();
  createTodo();
}

if (process.platform === 'win32') app.setAppUserModelId('com.todoroom.app');

// ---------- Start menu / desktop shortcuts ----------
// Windows only shows the app name and the taskbar jump list for an app that has a Start menu shortcut with the
// same AppUserModelID. After the rename (오늘 할 일 방 → 꼬물이 마을) that shortcut could go missing, so the installed
// app makes sure it is there, and renames an old desktop shortcut that points at this app.
const APP_NAME = '꼬물이 마을';
const OLD_NAMES = ['오늘 할 일 방'];
function fixShortcuts() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try {
    const exe = process.execPath;
    const opts = { target: exe, appUserModelId: 'com.todoroom.app', description: APP_NAME, icon: exe, iconIndex: 0 };
    const pointsHere = (lnk) => { try { return path.resolve(shell.readShortcutLink(lnk).target).toLowerCase() === path.resolve(exe).toLowerCase(); } catch { return false; } };
    const menuDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const menuLnk = path.join(menuDir, `${APP_NAME}.lnk`);
    const ok = shell.writeShortcutLink(menuLnk, fs.existsSync(menuLnk) ? 'update' : 'create', opts);
    for (const old of OLD_NAMES) {
      const o = path.join(menuDir, `${old}.lnk`);
      if (fs.existsSync(o) && pointsHere(o)) fs.rmSync(o, { force: true });
    }
    const desk = app.getPath('desktop');
    for (const old of OLD_NAMES) {
      const o = path.join(desk, `${old}.lnk`);
      const n = path.join(desk, `${APP_NAME}.lnk`);
      if (fs.existsSync(o) && pointsHere(o)) {
        if (!fs.existsSync(n)) shell.writeShortcutLink(n, 'create', opts);
        fs.rmSync(o, { force: true });
      }
    }
    logLine('app', `바로가기 확인: 시작 메뉴 ${ok ? '정상' : '실패'}`);
  } catch (e) { logLine('app', `바로가기 확인 실패: ${e.message}`); }
}

// ---------- automatic update (installed version only: GitHub Releases → setup.exe + latest.yml) ----------
let updater = null;
let updateState = 'idle'; // idle | checking | downloading | ready | none | error
let updateVersion = '';
let updateAsked = false;
function updateLabel() {
  if (!updater) return `버전 ${app.getVersion()}`;
  if (updateState === 'checking') return '업데이트 확인 중…';
  if (updateState === 'downloading') return `새 버전 ${updateVersion} 받는 중…`;
  if (updateState === 'ready') return `🎁 새 버전 ${updateVersion} 설치하고 다시 시작`;
  return `버전 ${app.getVersion()} · 업데이트 확인`;
}
function updateMenuClick() {
  if (!updater) return;
  if (updateState === 'ready') return installUpdate();
  if (updateState === 'checking' || updateState === 'downloading') return;
  checkUpdate(true);
}
let manualCheck = false;
function checkUpdate(manual = false) {
  if (!updater) return;
  manualCheck = manual;
  updater.checkForUpdates().catch((e) => logLine('update', `확인 실패: ${e && e.message}`));
}
function installUpdate() {
  logLine('update', `설치하고 다시 시작 (${updateVersion})`);
  quitting = true;
  setImmediate(() => updater.quitAndInstall(true, true));
}
function setUpdateState(st) { updateState = st; refreshTrayMenu(); }
function startUpdater() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
    logLine('update', '자동 업데이트 없음 (zip 버전)');
    return;
  }
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch (e) { logLine('update', `불러오기 실패: ${e.message}`); return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = { info: (m) => logLine('update', String(m)), warn: (m) => logLine('update', String(m)), error: (m) => logLine('update', String(m)), debug: () => {} };
  updater.on('checking-for-update', () => setUpdateState('checking'));
  updater.on('update-available', (info) => { updateVersion = info.version; setUpdateState('downloading'); });
  updater.on('update-not-available', () => {
    setUpdateState('none');
    if (manualCheck) dialog.showMessageBox({ type: 'info', title: '꼬물이 마을', message: `지금 최신 버전이에요 (${app.getVersion()})`, buttons: ['확인'] });
    manualCheck = false;
  });
  updater.on('error', (e) => {
    setUpdateState('error');
    logLine('update', `오류: ${e && e.message}`);
    if (manualCheck) dialog.showMessageBox({ type: 'warning', title: '꼬물이 마을', message: '업데이트를 확인하지 못했어요', detail: '인터넷 연결을 확인하고 잠시 뒤에 다시 해 주세요.', buttons: ['확인'] });
    manualCheck = false;
  });
  updater.on('update-downloaded', async (info) => {
    updateVersion = info.version;
    setUpdateState('ready');
    manualCheck = false;
    if (updateAsked) return;
    updateAsked = true;
    const r = await dialog.showMessageBox({
      type: 'info', title: '꼬물이 마을',
      message: `새 버전 ${info.version}이 준비됐어요!`,
      detail: '지금 다시 시작하면 바로 바뀌어요.\n나중에 해도 괜찮아요. 프로그램을 끌 때 자동으로 바뀌어요.',
      buttons: ['지금 다시 시작', '나중에'], defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) installUpdate();
  });
  setTimeout(() => checkUpdate(false), 15 * 1000);
  setInterval(() => { if (updateState !== 'ready') checkUpdate(false); }, 30 * 60 * 1000);
}

app.whenReady().then(() => {
  if (!gotLock) return;
  loadConfig();
  startIdleWatch();
  startPetWatch();
  applyAutoStart();
  logLine('app', `시작 (버전 ${app.getVersion()}, 모니터 ${screen.getAllDisplays().length}대, 그래픽 가속 ${gpuOn ? '켬' : '끔'})`);
  // only what the app needs: reading installed fonts for the font picker
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'local-fonts'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'local-fonts');
  if (process.argv.includes('--todoroom-quit')) { app.quit(); return; }
  if (process.env.TODOROOM_SNAP) return snapTest(process.env.TODOROOM_SNAP);
  if (config.uid && config.char && config.name) startMain();
  else createSetup();
  startUpdater();
  fixShortcuts();
});

app.on('second-instance', (_e, argv) => {
  if (handleArgs(argv || [])) return;
  if (config.char) createTodo(); else createSetup();
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (quitting || !config.char) app.quit(); });

// Developer check only: render each window offline and save screenshots.
async function snapTest(outDir) {
  config = { uid: 'test', char: process.env.TODOROOM_CHAR || 'black_cat', name: '하경', color: '#F9E4EC' };
  createSetup(); createPet(); createTodo();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (w, n) => { if (w) fs.writeFileSync(path.join(outDir, `${n}.png`), (await w.webContents.capturePage()).toPNG()); };
  await wait(5000);
  if (process.env.TODOROOM_FX && petWin) {
    const js = (c) => petWin.webContents.executeJavaScript(c);
    await js("window.__todoroomDebug.setup()");
    await wait(600); await shot(petWin, 'fx_mood');
    await js("window.__todoroomDebug.fire({type:'throw', from:'me', to:'f1', item:'banana'})");
    await wait(330); await shot(petWin, 'fx_throw_hand');
    await wait(250); await shot(petWin, 'fx_throw_fly');
    await wait(900); await shot(petWin, 'fx_hit');
    await js("window.__todoroomDebug.celebrate('f1')");
    await wait(500); await shot(petWin, 'fx_badge');
    await js("window.__todoroomDebug.fire({type:'cheer', from:'me', to:'f1', phrase:'수고했어!'})");
    await wait(500); await shot(petWin, 'fx_cheer');
    await js("window.__todoroomDebug.pop('f1')");
    await wait(300); await shot(petWin, 'fx_pop');
    await js("window.__todoroomDebug.fire({type:'megaphone', from:'f1', name:'친구', char:'hamster', text:'다들 점심 먹었어?? 오후도 화이팅!!'})");
    await wait(900); await shot(petWin, 'fx_mega');
  } else if (process.env.TODOROOM_WD) {
    const r = [];
    await wait(2500);
    petWin.setBounds({ x: 50, y: 50, width: 300, height: 200 }); r.push('moved ' + JSON.stringify(petWin.getBounds()));
    await wait(6500); r.push('after check ' + JSON.stringify(petWin.getBounds()));
    const old = petWin; petWin.webContents.forcefullyCrashRenderer();
    await wait(5000); r.push('recreated ' + (petWin && petWin !== old && !petWin.isDestroyed()) + ' ' + (petWin && JSON.stringify(petWin.getBounds())));
    await wait(2000); r.push('alive ' + (Date.now() - petAliveAt));
    recreatePet('test menu'); await wait(3000); r.push('menu reload ok ' + !!petWin);
    r.push('--- log ---\n' + fs.readFileSync(LOG_PATH(), 'utf8').split('\n').slice(-12).join('\n'));
    fs.writeFileSync(path.join(outDir, 'wd.txt'), r.join('\n'));
  } else if (process.env.TODOROOM_WD2) {
    const r = []; config.pinned = true;
    await wait(2000);
    todoWin.setPosition(5000, 3000); r.push('moved ' + JSON.stringify(todoWin.getBounds()));
    await wait(6000); r.push('after ' + JSON.stringify(todoWin.getBounds()));
    todoWin.setAlwaysOnTop(false); await wait(1500); r.push('ontop ' + todoWin.isAlwaysOnTop());
    r.push('--- log ---\n' + fs.readFileSync(LOG_PATH(), 'utf8').split('\n').slice(-6).join('\n'));
    fs.writeFileSync(path.join(outDir, 'wd2.txt'), r.join('\n'));
  } else if (process.env.TODOROOM_P14) {
    const now = Date.now();
    const users = { me: { name: '육몽', char: 'hamster' }, f1: { name: '민지', char: 'black_cat' } };
    const items = [
      { id: 'a', text: '작가 프로그램 완성', done: false, createdAt: now - 3600000 },
      { id: 'b', text: '캐릭터 프로필 작성', done: false, createdAt: now - 3500000 },
      { id: 'c', text: '피디 프로그램 수정', done: false, createdAt: now - 3400000, elapsed: 7242000 },
    ];
    const tj = (c) => todoWin.webContents.executeJavaScript(c);
    await tj(`window.__todoroomDebug.p6(${JSON.stringify({ users, online: {}, mail: {}, trash: {}, items })})`);
    await wait(600);
    for (const [n, css] of Object.entries({
      now: '',

    })) {
      await tj(`(() => { let s = document.querySelector('#p14css'); if (!s) { s = document.createElement('style'); s.id = 'p14css'; document.head.append(s); } s.textContent = ${JSON.stringify(css)}; if (${JSON.stringify(n)} === 'imgBoth') document.querySelector('#dndBtn').innerHTML = '<img src="assets/ui/btn_dnd.png" alt="">'; const tom = [...document.querySelectorAll('#list li')][0]; const bs = tom ? [...tom.querySelectorAll('button')].filter((b) => b.offsetParent) : []; const r = bs.length ? Math.max(...bs.map((b) => b.getBoundingClientRect().right)) : 0; const hb = document.querySelector('.hbtns'); document.documentElement.style.setProperty('--mr', '0px'); const cur = hb.getBoundingClientRect().right; document.documentElement.style.setProperty('--mr', Math.max(0, cur - r) + 'px'); })()`);
      await wait(300); await shot(todoWin, 'p14_' + n);
    }
  } else if (process.env.TODOROOM_P13) {
    const lg = (x) => fs.appendFileSync(path.join(outDir, 'p13.txt'), x + '\n');
    createQuiz(); await wait(2500); lg('quiz win ' + !!quizWin + ' visible ' + (quizWin && quizWin.isVisible()));
    const qj = (c) => quizWin.webContents.executeJavaScript(c).catch((e) => { lg('JS ERR ' + e.message); });
    // a banana-ish drawing
    const pts = (cx, cy, r, a0, a1, n = 24) => Array.from({ length: n }, (_, i) => { const a = a0 + (a1 - a0) * i / (n - 1); return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
    const strokes = [
      { color: '#f59e0b', size: 9, pts: pts(131, 60, 110, 0.55, 2.55) },
      { color: '#f59e0b', size: 9, pts: pts(131, 20, 120, 0.75, 2.4) },
      { color: '#8b5a2b', size: 9, pts: [[45, 140], [36, 150]] },
      { color: '#3b2f4a', size: 4, pts: pts(131, 60, 110, 0.55, 2.55).map(([x, y]) => [x, y + 6]) },
    ];
    await qj(`window.__todoroomDebug.draw('me'); window.__todoroomDebug.strokes(${JSON.stringify(strokes)}); document.querySelectorAll('input')[0].value='바나나'; document.querySelectorAll('input')[1].value='먹는 거'; document.querySelectorAll('input')[2].value='노란색';`);
    lg('strokes set'); await wait(400); await shot(quizWin, 'p13_draw'); lg('draw shot');
    const img = await qj(`document.querySelector('#cv').toDataURL('image/jpeg', 0.82)`);
    const now = Date.now();
    const q = { id: 'q1', from: 'f1', name: '민지', char: 'hamster', img, answer: '바나나', hint1: '먹는 거', hint2: '노란색', startedAt: now, endsAt: now + 251000, status: 'open' };
    const gs = [{ name: '수아', text: '초승달', ok: false, ts: 1 }, { name: '지우', text: '부메랑', ok: false, ts: 2 }];
    await qj(`window.__todoroomDebug.show(${JSON.stringify(q)}, ${JSON.stringify(gs)}, 1, 'me')`); await wait(500); await shot(quizWin, 'p13_solve');
    await qj(`window.__todoroomDebug.show(${JSON.stringify({ ...q, from: 'me', name: '육몽', char: 'black_cat' })}, ${JSON.stringify(gs)}, 0, 'me')`); await wait(500); await shot(quizWin, 'p13_watch');
    const done = { ...q, status: 'done', winner: { uid: 'f2', name: '수아', char: 'squirrel' } };
    await qj(`window.__todoroomDebug.show(${JSON.stringify(done)}, ${JSON.stringify([...gs, { name: '수아', text: '바나나', ok: true, ts: 3 }])}, 1, 'me')`); await wait(500); await shot(quizWin, 'p13_result');
    await petWin.webContents.executeJavaScript('window.__todoroomDebug.quizCard()'); await wait(500); await shot(petWin, 'p13_card');
    await shot(todoWin, 'p13_todo');
    const tj = (c) => todoWin.webContents.executeJavaScript(c).catch((e) => lg('TODO JS ' + e.message));
    await tj(`(() => { const h = document.querySelector('.hbtns'); h.style.flexDirection = 'column'; h.style.gap = '3px'; h.style.marginTop = '0'; })()`);
    await wait(300); await shot(todoWin, 'p13_optA');
    await tj(`(() => { const h = document.querySelector('.hbtns'); h.removeAttribute('style');
      const foot = document.querySelector('.foot'); const q = document.querySelector('#quizBtn'); const mb = document.querySelector('#mailBtn'); const nb = document.querySelector('#noteBtn');
      nb.replaceWith(mb); document.querySelector('#giftBtn').after(q);
      const p = document.querySelector('#mailPanel'); const row = p.querySelector('.btns');
      const w = document.createElement('button'); w.className = 'test'; w.textContent = '✉ 쪽지 쓰기'; row.prepend(w);
      p.classList.add('show'); })()`);
    await wait(400); await shot(todoWin, 'p13_optB');
  } else if (process.env.TODOROOM_P12) {
    const pj = (c) => petWin.webContents.executeJavaScript(c);
    await pj('window.__todoroomDebug.mega()'); await wait(900); await shot(petWin, 'p12_mega');
    const ok = await pj('window.__todoroomDebug.megaReplyClick()'); await wait(700);
    await pj(`window.__todoroomDebug.syncRead('m1')`); await wait(700);
    const stays = await pj(`!!document.querySelector('.mega textarea')`);
    await pj(`(() => { const t = document.querySelector('.mega textarea'); if (t) { t.value = '나는 11시까지!'; t.dispatchEvent(new Event('input')); } })()`);
    await wait(300); await shot(petWin, 'p12_reply');
    await pj(`(() => { document.querySelectorAll('.mega').forEach((b) => b._close && b._close()); setTimeout(() => window.__todoroomDebug.fire({ type: 'megaphone', reply: true, from: 'f1', name: '민지', char: 'hamster', text: '나도 11시까지 할 듯!', mailId: 'r1' }), 600); })()`);
    await wait(1600); await shot(petWin, 'p12_got');
    fs.writeFileSync(path.join(outDir, 'p12.txt'), 'reply button found: ' + ok + ' / reply paper still open after read-sync: ' + stays);
  } else if (process.env.TODOROOM_P8) {
    const pj = (c) => petWin.webContents.executeJavaScript(c);
    const r = [];
    await pj('window.__todoroomDebug.enterTest()');
    for (const t of [500, 5000, 20000, 30000]) { await wait(t); r.push(await pj('window.__todoroomDebug.enterState()')); }
    await shot(petWin, 'p8_end');
    fs.writeFileSync(path.join(outDir, 'p8.txt'), r.join('\n'));
  } else if (process.env.TODOROOM_P9) {
    const pj = (c) => petWin.webContents.executeJavaScript(c);
    for (const st of ['idle', 'walk', 'sit', 'work', 'happy', 'hit']) {
      await pj(`window.__todoroomDebug.lineup('${st}')`); await wait(900); await shot(petWin, 'p9_' + st);
    }
  } else if (process.env.TODOROOM_P10) {
    const pj = (c) => petWin.webContents.executeJavaScript(c);
    const st = () => pj(`[...['l1','l2','l3','l4']].map(k=>{const p=window.__todoroomDebug._pet(k);return p.name+' x='+Math.round(p.x)+' '+p.state}).join(' | ')`);
    const r = [];
    await pj(`window.__todoroomDebug.lineup('walk')`); await wait(500); r.push('걷는 중: ' + await st());
    await pj(`window.__todoroomDebug.freeze(true)`); await wait(6000); r.push('멈춤 6초 뒤: ' + await st());
    await pj(`window.__todoroomDebug._pet('l2').setAway(true); window.__todoroomDebug._pet('l3').setWorking(true)`); await wait(1000); r.push('자리비움·타이머 켜도: ' + await st());
    await pj(`window.__todoroomDebug.prank('bonk', {to:'l1'})`); await wait(400); r.push('뿅망치 맞는 중: ' + await st());
    await shot(petWin, 'p10_hit');
    await wait(4000); r.push('맞고 4초 뒤: ' + await st());
    await shot(petWin, 'p10_frozen');
    await pj(`window.__todoroomDebug.freeze(false)`); await wait(1500); r.push('멈춤 끈 뒤: ' + await st());
    fs.writeFileSync(path.join(outDir, 'p10.txt'), r.join('\n'));
  } else if (process.env.TODOROOM_P7) {
    const pj = (c) => petWin.webContents.executeJavaScript(c);
    const D = 'window.__todoroomDebug.';
    await pj(D + 'setup()'); await wait(400);
    await pj(D + 'popPranks()'); await wait(500); await shot(petWin, 'p7_pop');
    await pj("document.querySelectorAll('.pop').forEach(x=>x.remove())");
    for (const [k, t] of [['bonk', 420], ['poke', 520], ['tickle', 700], ['water', 1250], ['nametag', 300]]) {
      await pj(D + `prank('${k}', ${k === 'nametag' ? "{text:'잠꾸러기'}" : '{}'})`); await wait(t); await shot(petWin, 'p7_' + k); await wait(2300);
    }
    await pj(D + "prank('peel')"); await wait(700); await shot(petWin, 'p7_peel');
    await pj(D + 'walkToPeel()'); await wait(2300); await shot(petWin, 'p7_slip');
    const now = Date.now();
    const tj = (c) => todoWin.webContents.executeJavaScript(c);
    await tj(`window.__todoroomDebug.p6(${JSON.stringify({ users: { me: { name: '하경', char: 'black_cat' }, f1: { name: '민지', char: 'hamster' }, f2: { name: '수아', char: 'squirrel' } }, online: { f1: { char: 'hamster', name: '민지' }, f2: { char: 'squirrel', name: '수아', dnd: { until: null } } }, mail: { a: { type: 'prank', kind: 'bonk', from: 'f1', name: '민지', ts: now - 60000 }, b: { type: 'prank', kind: 'peel', from: 'f2', name: '수아', ts: now - 30000 }, c: { type: 'prank', kind: 'nametag', text: '잠꾸러기', from: 'f1', name: '민지', ts: now } }, trash: {}, items: [] })}); document.getElementById('throwBtn').click()`);
    await wait(500); await shot(todoWin, 'p7_todo_prank');
    await tj("window.__todoroomDebug.openMail()"); await wait(400); await shot(todoWin, 'p7_todo_mail');
  } else if (process.env.TODOROOM_P11) {
    const now = Date.now();
    const users = { me: { name: '육몽', char: 'hamster' }, f1: { name: '민지', char: 'black_cat' }, f2: { name: '수아', char: 'squirrel' }, f3: { name: '지우', char: 'chick' } };
    const items = [
      { id: 'a', text: '작가 프로그램 완성', done: false, createdAt: now - 3600000 },
      { id: 'b', text: '캐릭터 프로필 작성', done: false, createdAt: now - 3500000 },
      { id: 'c', text: '피디 프로그램 수정', done: false, createdAt: now - 3400000, elapsed: 7242000 },
      { id: 'd', text: '할일 프로그램 수정', done: false, createdAt: now - 3300000 },
    ];
    const tj = (c) => todoWin.webContents.executeJavaScript(c);
    await tj(`window.__todoroomDebug.p6(${JSON.stringify({ users, online: { f1: { char: 'black_cat' }, f2: { char: 'squirrel' }, f3: { char: 'chick' } }, mail: {}, trash: {}, items })})`);
    await wait(600); await shot(todoWin, 'p11_off');
    await tj("document.querySelector('#freezeBtn').click()"); await wait(800); await shot(todoWin, 'p11_on');
    const fr = await petWin.webContents.executeJavaScript('window.__todoroomDebug.isFrozen()');
    fs.writeFileSync(path.join(outDir, 'p11.txt'), `config.freeze=${config.freeze} pet frozen=${fr}`);
  } else if (process.env.TODOROOM_P6) {
    const now = Date.now();
    const users = { me: { name: '하경', char: 'black_cat' }, f1: { name: '민지', char: 'hamster' }, f2: { name: '수아', char: 'squirrel' }, f3: { name: '지우', char: 'chick' } };
    const items = [
      { id: 'a', text: '웹소설 3화 원고 쓰기', done: false, createdAt: now - 3600000, elapsed: 2537000 },
      { id: 'b', text: '이력서 고치기', done: true, createdAt: now - 7200000, elapsed: 1500000 },
      { id: 'c', text: '빨래 개기', done: false, createdAt: now - 3000000 },
    ];
    const mail = {
      n1: { type: 'note', from: 'f1', name: '민지', char: 'hamster', text: '오늘 저녁에 같이 작업할래?', ts: now - 120000, read: false },
      n2: { type: 'note_sent', from: 'me', name: '하경', char: 'black_cat', to: 'f2', toName: '수아', text: '자료 고마워!', ts: now - 600000, read: true },
      m1: { type: 'megaphone', from: 'f3', name: '지우', char: 'chick', text: '점심 먹자~', ts: now - 3600000, read: true },
    };
    const trash = { t1: { text: '장보기', done: false, createdAt: now - 5000000, deletedAt: now - 1800000, reason: '× 버튼' }, t2: { text: '메일 정리', done: true, createdAt: now - 4000000, deletedAt: now - 300000, reason: '원인 모름' } };
    const tj = (c) => todoWin.webContents.executeJavaScript(c);
    await tj(`window.__todoroomDebug.p6(${JSON.stringify({ users, online: { f1: { char: 'hamster' }, f2: { char: 'squirrel', dnd: { until: null } } }, mail, trash, items })}); window.__todoroomDebug.askDel('c')`);
    await wait(500); await shot(todoWin, 'p6_rows');
    await tj("window.__todoroomDebug.openNote('f1')"); await wait(400); await shot(todoWin, 'p6_note');
    await tj("window.__todoroomDebug.openTrash()"); await wait(400); await shot(todoWin, 'p6_trash');
    await tj("window.__todoroomDebug.openDnd()"); await wait(400); await shot(todoWin, 'p6_dnd');
    await tj("window.__todoroomDebug.openMail()"); await wait(400); await shot(todoWin, 'p6_mail');
    await tj("window.__todoroomDebug.openSettings()"); await wait(600); await shot(todoWin, 'p6_settings');
    await petWin.webContents.executeJavaScript("window.__todoroomDebug.setup(); window.__todoroomDebug.note()");
    await wait(1200); await shot(petWin, 'p6_pet_note');
    await petWin.webContents.executeJavaScript("document.querySelector('.mega.note .reply').click()");
    await wait(300); await petWin.webContents.executeJavaScript("document.querySelector('.rin').value='응 좋아! 9시에 보자 ㅎㅎ'");
    await wait(700); await shot(petWin, 'p6_pet_reply');
    await petWin.webContents.executeJavaScript("window.__todoroomDebug.dndPop()");
    await wait(600); await shot(petWin, 'p6_pet_pop');
  } else if (process.env.TODOROOM_P5) {
    const now = Date.now();
    const items = [
      { id: 'a', text: '웹소설 3화 원고 쓰기', done: false, createdAt: now - 3600000, elapsed: 2537000, runningSince: now - 61000 },
      { id: 'b', text: '이력서 고치기', done: true, createdAt: now - 7200000, elapsed: 1500000 },
      { id: 'c', text: '빨래 개기', done: false, createdAt: now - 3000000, elapsed: 600000 },
    ];
    const tj = (c) => todoWin.webContents.executeJavaScript(c);
    await tj(`window.__todoroomDebug.show(${JSON.stringify(items)}, {}); window.__todoroomDebug.handoff(true, {mode:'focus', endsAt: Date.now()+754000, todoId:'a'})`);
    await wait(600); await shot(todoWin, 'p5_handoff');
    await tj("window.__todoroomDebug.handoff(false); document.getElementById('settings').click(); const p=document.getElementById('panel'); p.scrollTop = p.scrollHeight");
    await wait(500); await shot(todoWin, 'p5_settings');
    if (setupWin) { const sj = (c) => setupWin.webContents.executeJavaScript(c);
      await sj('window.__todoroomDebug.p5()'); await wait(500); await shot(setupWin, 'p5_login');
      await sj('window.__todoroomDebug.p5b()'); await wait(400); await shot(setupWin, 'p5_notlinked'); }
  } else if (process.env.TODOROOM_TREAT && petWin) {
    const pj = (c) => petWin.webContents.executeJavaScript(c);
    await pj("window.__todoroomDebug.setup(); window.__todoroomDebug.treatAll()");
    for (const t of [300, 1500, 1500, 1300, 500, 450, 900]) { await wait(t); await shot(petWin, 'treat_' + Date.now()); }
  } else if (process.env.TODOROOM_P4) {
    const now = Date.now(), mk = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
    const data = {
      users: { me: { name: '하경', char: 'black_cat' }, u1: { name: '민지', char: 'hamster' }, u2: { name: '수아', char: 'chick' }, u3: { name: '다은', char: 'squirrel' } },
      rewards: { me: { [mk]: 7 }, u1: { [mk]: 12 }, u2: { [mk]: 3 }, u3: { [mk]: 0 } },
      gifts: { g1: { item: 'cake', month: '2026-10', ts: now - 9e8 }, g2: { item: 'sock', month: '2026-09', ts: now - 3e9 }, g3: { item: 'flowers', month: '2026-08', ts: now - 6e9 } },
      mail: {
        a: { type: 'megaphone', from: 'u1', name: '민지', char: 'hamster', text: '다들 점심 먹었어??', ts: now - 600000, read: false },
        b: { type: 'throw', from: 'u2', name: '수아', char: 'chick', item: 'banana', ts: now - 3600000, read: false },
        c: { type: 'cheer', from: 'u3', name: '다은', char: 'squirrel', phrase: '수고했어!', todoText: '이력서 고치기', ts: now - 90000000, read: true },
        d: { type: 'megaphone', from: 'me', name: '하경', char: 'black_cat', text: '오늘 마감 끝!!', ts: now - 200000000, read: true },
      },
      pomoState: { mode: 'focus', todoId: 'a', endsAt: now + 18 * 60000 + 32000, cycle: 1 },
      items: [
        { id: 'a', text: '웹소설 3화 원고 쓰기', done: false, createdAt: now - 3600000, elapsed: 2537000, runningSince: now - 61000 },
        { id: 'b', text: '이력서 고치기', done: true, createdAt: now - 7200000, elapsed: 1500000, cheers: { u1: 1 } },
        { id: 'c', text: '빨래 개기', done: false, createdAt: now - 3000000, elapsed: 600000 },
      ],
    };
    const tj = (c) => todoWin.webContents.executeJavaScript(c);
    await tj(`window.__todoroomDebug.p4(${JSON.stringify(data)})`);
    await wait(800); await shot(todoWin, 'todo_pomo');
    await tj("document.getElementById('giftBtn').click()"); await wait(500); await shot(todoWin, 'todo_gift');
    await tj("document.body.click(); document.getElementById('mailBtn').click()"); await wait(500); await shot(todoWin, 'todo_mail');
    await tj("document.body.click(); document.getElementById('settings').click(); document.getElementById('panel').scrollTop = 200"); await wait(500); await shot(todoWin, 'todo_settings');
    const pj = (c) => petWin.webContents.executeJavaScript(c);
    await pj("window.__todoroomDebug.setup(); window.__todoroomDebug.p4a()");
    await wait(700); await shot(petWin, 'pet_p4a');
    await wait(5200); await shot(petWin, 'pet_card');
    await pj("window.__todoroomDebug.p4b()"); await wait(700); await shot(petWin, 'pet_ask');
    await pj("window.__todoroomDebug.p4c()"); await wait(1400); await shot(petWin, 'pet_box');
    await pj("window.__todoroomDebug.p4open()"); await wait(1200); await shot(petWin, 'pet_box_shake');
    await wait(2400); await shot(petWin, 'pet_box_open');
  } else if (process.env.TODOROOM_P3) {
    const now = Date.now(), D = 86400000;
    const items = [
      { id: 'a', text: '웹소설 3화 원고 쓰기', done: false, createdAt: now - 3600000, elapsed: 2537000, runningSince: now - 61000 },
      { id: 'b', text: '이력서 고치기', done: true, createdAt: now - 7200000, elapsed: 1500000, cheers: { u1: 1, u2: 1 } },
      { id: 'c', text: '빨래 개기', done: false, createdAt: now - 3000000, elapsed: 600000 },
      { id: 'd', text: '산책 30분', done: false, createdAt: now - 1000000 },
    ];
    const users = { u1: { name: '민지', char: 'hamster' }, u2: { name: '수아', char: 'chick' } };
    await todoWin.webContents.executeJavaScript(`window.__todoroomDebug.show(${JSON.stringify(items)}, ${JSON.stringify(users)})`);
    await wait(1200); await shot(todoWin, 'todo_timer');
    await todoWin.webContents.executeJavaScript("document.getElementById('color').click()");
    await wait(600); await shot(todoWin, 'todo_look');
    await todoWin.webContents.executeJavaScript("document.body.click(); window.__todoroomDebug.setConfig({shortcuts:['웹소설 원고 쓰기','운동 30분','메일 확인','공모전 자료 찾기']}); document.getElementById('scBtn').click()");
    await wait(600); await shot(todoWin, 'todo_sc');
    createReport(true); await wait(2500);
    const todos = {};
    for (let i = 0; i < 17; i++) for (let k = 0; k < (i % 4) + 1; k++) todos[`t${i}_${k}`] = { text: ['원고 쓰기', '자료 조사', '운동', '메일 정리'][k], done: (i + k) % 3 !== 0, createdAt: now - i * D - k * 1000, elapsed: ((i * 7 + k * 13) % 50) * 60000, cheers: k === 0 && i % 2 ? { u1: 1 } : undefined };
    await reportWin.webContents.executeJavaScript(`window.__todoroomDebug.render(${JSON.stringify(todos)}, ${JSON.stringify(users)})`);
    await wait(500); await shot(reportWin, 'report');
    await petWin.webContents.executeJavaScript("window.__todoroomDebug.setup(); window.__todoroomDebug.work('f1', true); window.__todoroomDebug.work('me', true)");
    await wait(1200); await shot(petWin, 'pet_work');
  } else {
    if (process.env.TODOROOM_PANEL && todoWin) await todoWin.webContents.executeJavaScript(process.env.TODOROOM_PANEL);
    await wait(800);
    await shot(setupWin, 'setup'); await shot(petWin, 'pet'); await shot(todoWin, 'todo');
  }
  quitting = true; app.quit();
}

// ---------- IPC ----------
ipcMain.handle('config:get', () => config);
ipcMain.handle('config:set', (_e, partial) => {
  if (partial && typeof partial === 'object') {
    for (const k of ['uid', 'char', 'name', 'color', 'pinned', 'sound', 'hide', 'mood', 'font', 'fontSize', 'shortcuts', 'lastReport', 'pomo', 'pomoState', 'seenGiftMonth', 'autoStart', 'monitor', 'dnd', 'gpu', 'freeze']) if (k in partial) config[k] = partial[k];
    saveConfig(); broadcastConfig();
    if ('hide' in partial || 'dnd' in partial || 'freeze' in partial) refreshTrayMenu();
    if ('freeze' in partial) logLine('app', `그대로 멈춰라 ${partial.freeze ? '켬' : '끔'} (할 일 창)`);
    if ('autoStart' in partial) applyAutoStart();
    if ('monitor' in partial) fitPet('monitor');
  }
  return config;
});
ipcMain.handle('screen:get', () => screenInfo());
ipcMain.handle('screen:list', () => {
  const prim = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({ id: d.id, n: i + 1, w: d.bounds.width, h: d.bounds.height, primary: d.id === prim }));
});
ipcMain.on('log:write', (e, src, msg) => logLine(String(src || 'app').slice(0, 20), msg));
ipcMain.on('log:open', () => { try { if (!fs.existsSync(LOG_PATH())) logLine('app', '기록 파일 열기'); shell.showItemInFolder(LOG_PATH()); } catch (e) { console.error(e); } });
ipcMain.on('pet:alive', () => { petAliveAt = Date.now(); });
ipcMain.on('pet:focus', () => { try { if (petWin && !petWin.isDestroyed()) { petWin.setIgnoreMouseEvents(false); petWin.focus(); petWin.webContents.focus(); } } catch {} });
ipcMain.on('pet:yielded', (_e, v) => { petYielded = !!v; });
ipcMain.on('note:compose', (_e, to) => { createTodo(); if (todoWin) setTimeout(() => { if (todoWin) todoWin.webContents.send('note:compose', to); }, 300); });
ipcMain.on('pet:ignore', (_e, ignore) => {
  if (petWin) petWin.setIgnoreMouseEvents(!!ignore, { forward: true });
});
ipcMain.on('todo:show', () => createTodo());
ipcMain.on('todo:hide', () => { if (todoWin) todoWin.minimize(); });
ipcMain.on('todo:minimize', () => { if (todoWin) todoWin.minimize(); });
ipcMain.handle('todo:togglePin', () => {
  config.pinned = !(config.pinned !== false);
  saveConfig();
  if (todoWin) todoWin.setAlwaysOnTop(config.pinned);
  return config.pinned;
});
ipcMain.on('setup:done', () => {
  if (setupWin) { const w = setupWin; setupWin = null; w.close(); }
  if (petWin) petWin.webContents.send('profile:changed');
  if (todoWin) todoWin.webContents.send('profile:changed');
  startMain();
});
ipcMain.on('setup:cancel', () => {
  if (setupWin) setupWin.close();
  if (!config.char) { quitting = true; app.quit(); }
});
ipcMain.on('pomo:cmd', (_e, cmd) => sendPet('pomo:cmd', cmd));
ipcMain.on('report:open', (_e, auto) => createReport(!!auto));
ipcMain.on('quiz:open', () => createQuiz());
ipcMain.on('report:close', () => { if (reportWin) reportWin.close(); });
ipcMain.on('app:quit', () => { quitting = true; app.quit(); });
ipcMain.on('pet:menu', () => {
  if (!petWin) return;
  Menu.buildFromTemplate(appMenuTemplate()).popup({ window: petWin });
});
