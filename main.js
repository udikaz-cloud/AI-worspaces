const { app, BrowserWindow, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const iconDir = path.join(__dirname, 'assets', 'icons');
const appIconPath = path.join(
  iconDir,
  process.platform === 'darwin' ? 'ai-workspace-256.png' : 'ai-workspace.ico'
);

function loadAppIcon() {
  if (!fs.existsSync(appIconPath)) {
    return null;
  }

  const image = nativeImage.createFromPath(appIconPath);
  return image.isEmpty() ? null : image;
}
const userDataPath = path.join(app.getPath('appData'), 'AI Workspace');

app.setName('AI Workspace');
app.setAppUserModelId('com.kramer.aiworkspace');
app.setPath('userData', userDataPath);

function createWindow() {
  const appIcon = loadAppIcon();
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: app.getName(),
    backgroundColor: '#111113',
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setMenu(null);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    const appIcon = loadAppIcon();
    if (appIcon) {
      app.dock.setIcon(appIcon);
    }
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
