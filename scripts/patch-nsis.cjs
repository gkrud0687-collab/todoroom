// Building the Windows installer on Linux/macOS normally needs Wine just to pull the uninstaller out of a
// temporary setup.exe. electron-builder already has a Wine-free reader for that (used on macOS Catalina+);
// this makes it use that reader on every non-Windows machine. Does nothing on Windows.
const fs = require('fs');
const path = require('path');
if (process.platform === 'win32') process.exit(0);
const f = path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'out', 'targets', 'nsis', 'NsisTarget.js');
if (!fs.existsSync(f)) { console.log('patch-nsis: electron-builder not installed yet'); process.exit(0); }
let s = fs.readFileSync(f, 'utf8');
const from = 'if ((0, macosVersion_1.isMacOsCatalina)()) {';
if (s.includes('/* todoroom: no wine */')) process.exit(0);
if (!s.includes(from)) { console.log('patch-nsis: pattern not found (electron-builder changed?) — Wine will be needed'); process.exit(0); }
s = s.replace(from, 'if (/* todoroom: no wine */ true) {');
fs.writeFileSync(f, s);
console.log('patch-nsis: installer can be built without Wine');
