const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const appIconPath = path.join(__dirname, 'assets', 'icons', 'ai-workspace.ico');
const userDataPath = path.join(app.getPath('appData'), 'AI Workspace');

app.setName('AI Workspace');
app.setAppUserModelId('com.kramer.aiworkspace');
app.setPath('userData', userDataPath);

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: app.getName(),
    backgroundColor: '#111113',
    icon: appIconPath,
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
    app.dock.setIcon(appIconPath);
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
