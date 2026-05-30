const path = require('path');
const rcedit = require('rcedit');

/**
 * Embeds the app icon into the Windows executable.
 * Required when signAndEditExecutable is false (local builds without code signing).
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(
    context.packager.projectDir,
    'assets',
    'icons',
    'ai-workspace.ico'
  );

  await rcedit(exePath, { icon: iconPath });
};
