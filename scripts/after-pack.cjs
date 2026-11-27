// electron-builder afterPack hook: put our icon and names into TodoRoom.exe (works without Wine).
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const PELibrary = await import('pe-library');
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const exe = PELibrary.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = PELibrary.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'assets/ui/app_icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const ids = groups.length ? groups.map((g) => [g.id, g.lang]) : [[1, 1033]];
  for (const [id, lang] of ids) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, iconFile.icons.map((i) => i.data));
  }

  const vis = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  for (const vi of vis) {
    for (const lang of vi.getAllLanguagesForStringValues()) {
      vi.setStringValues(lang, {
        FileDescription: '꼬물이 마을',
        ProductName: '꼬물이 마을',
        InternalName: 'TodoRoom',
        OriginalFilename: 'TodoRoom.exe',
        CompanyName: 'TodoRoom',
      });
    }
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('  • icon and names set on', path.basename(exePath));
};
