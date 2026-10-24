const { app, BrowserWindow, session, shell, nativeImage, ipcMain, dialog } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const aiPartitions = ['persist:chatgpt', 'persist:claude', 'persist:gemini'];
const webviewPreloadPath = path.join(__dirname, 'scripts', 'webview-preload.js');
const appPreloadPath = path.join(__dirname, 'scripts', 'app-preload.js');

// The AI sites get the same identity as desktop Chrome: in request headers here,
// and in navigator via webview-preload.js, which receives it as an argument.
const chromeIdentity = (() => {
  const chromeVersion = process.versions.chrome;
  const platforms = {
    win32: { token: 'Windows NT 10.0; Win64; x64', name: 'Windows' },
    linux: { token: 'X11; Linux x86_64', name: 'Linux' },
    darwin: { token: 'Macintosh; Intel Mac OS X 10_15_7', name: 'macOS' }
  };
  const platform = platforms[process.platform] || platforms.darwin;

  return {
    chromeVersion,
    chromeMajor: chromeVersion.split('.')[0],
    platformName: platform.name,
    architecture: process.arch === 'arm64' ? 'arm' : 'x86',
    userAgent: `Mozilla/5.0 (${platform.token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  };
})();

function applyChromeIdentity(browserSession) {
  const { userAgent, chromeMajor, platformName } = chromeIdentity;

  browserSession.setUserAgent(userAgent);
  browserSession.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
    const requestHeaders = details.requestHeaders;

    for (const name of Object.keys(requestHeaders)) {
      if (name.toLowerCase().startsWith('sec-ch-ua')) {
        delete requestHeaders[name];
      }
    }

    requestHeaders['sec-ch-ua'] = `"Google Chrome";v="${chromeMajor}", "Chromium";v="${chromeMajor}", "Not_A Brand";v="24"`;
    requestHeaders['sec-ch-ua-mobile'] = '?0';
    requestHeaders['sec-ch-ua-platform'] = `"${platformName}"`;
    callback({ requestHeaders });
  });
}

app.commandLine.appendSwitch('disable-quic');

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

// --- External links -----------------------------------------------------------
// Links clicked inside the AI tabs open in Chrome. Sign-in pages stay in the app,
// otherwise the login would land in Chrome instead of the tab's session.

const signInHostSuffixes = [
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.microsoft.com',
  'login.live.com',
  'auth.openai.com',
  'okta.com',
  'auth0.com',
  'onelogin.com'
];

const internalHostSuffixes = [
  ...signInHostSuffixes,
  'chatgpt.com',
  'openai.com',
  'claude.ai',
  'claude.com',
  'anthropic.com',
  'google.com'
];

// Company SSO often runs on its own domain (sso.company.com, Duo, Ping, SAML
// endpoints), so anything that looks like a sign-in step stays in the app too.
const signInPathPattern = /(^|[\/._-])(login|log-in|signin|sign-in|logon|sso|saml|oauth2?|openid|oidc|authorize|auth|adfs|idp|mfa|2fa)([\/._?=-]|$)/i;

function hostMatches(url, suffixes) {
  try {
    const { protocol, hostname } = new URL(url);
    return /^https?:$/.test(protocol)
      && suffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

function looksLikeSignIn(url) {
  try {
    const { hostname, pathname, search } = new URL(url);
    return hostMatches(url, signInHostSuffixes)
      || signInPathPattern.test(pathname)
      || signInPathPattern.test(search)
      || /^(sso|login|auth|signin|idp|adfs)\./i.test(hostname);
  } catch {
    return false;
  }
}

function extraInternalHosts() {
  const hosts = readSettings().internalHosts;
  return Array.isArray(hosts) ? hosts : [];
}

// Whether a navigation from currentUrl to url should stay inside the tab.
function staysInApp(currentUrl, url) {
  return /^(blob|data|about):/i.test(url)
    || hostMatches(url, internalHostSuffixes)
    || hostMatches(url, extraInternalHosts())
    || looksLikeSignIn(url)
    || looksLikeSignIn(currentUrl);
}

function chromePath() {
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app';
  }

  if (process.platform === 'win32') {
    return [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean)
      .map((base) => path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      .find((candidate) => fs.existsSync(candidate));
  }

  return 'google-chrome';
}

function openInChrome(url) {
  if (!/^(https?|mailto):/i.test(url)) {
    return;
  }

  const chrome = chromePath();
  const fallback = (error) => {
    if (error) {
      shell.openExternal(url);
    }
  };

  if (/^mailto:/i.test(url) || !chrome) {
    shell.openExternal(url);
  } else if (process.platform === 'darwin') {
    execFile('open', ['-a', chrome, url], fallback);
  } else {
    execFile(chrome, [url], fallback);
  }
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') {
    return;
  }

  contents.setWindowOpenHandler(({ url }) => {
    // blank windows get pointed somewhere by the page; blob:/data: are generated
    // files and previews that Chrome can't open from here.
    if (url === 'about:blank' || /^(blob|data):/i.test(url) || looksLikeSignIn(url)) {
      return { action: 'allow' };
    }

    openInChrome(url);
    return { action: 'deny' };
  });

  contents.on('did-create-window', (popup) => {
    popup.webContents.on('will-navigate', (details) => {
      if (details.isMainFrame && !staysInApp(popup.webContents.getURL(), details.url)) {
        details.preventDefault();
        openInChrome(details.url);
        if (/^(about:blank)?$/.test(popup.webContents.getURL())) {
          popup.close();
        }
      }
    });
  });

  contents.on('will-navigate', (details) => {
    if (details.isMainFrame && !staysInApp(contents.getURL(), details.url)) {
      details.preventDefault();
      openInChrome(details.url);
    }
  });
});

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
      preload: appPreloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true
    }
  });

  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences) => {
    webPreferences.preload = webviewPreloadPath;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.backgroundThrottling = false;
    webPreferences.additionalArguments = [`--aiw-chrome-identity=${JSON.stringify(chromeIdentity)}`];
  });

  // The window hosts app-preload.js (shell access), so it must never load
  // anything but index.html — e.g. a link dragged onto the tab bar.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setMenu(null);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openInChrome(url);
    return { action: 'deny' };
  });
}

// --- Claude Code terminal ---------------------------------------------------
// claude.ai can't launch local processes, so the Claude Code tab runs the real
// `claude` CLI in a pseudo-terminal owned by this process.

const settingsPath = path.join(userDataPath, 'settings.json');
const appPageUrl = require('url').pathToFileURL(path.join(__dirname, 'index.html')).href;
const terminals = new Map();
const watchedOwners = new WeakSet();
let nextTerminalId = 1;

// Shell access is only for the app's own page, never for anything it embeds.
function isAppPage(event) {
  return event.senderFrame?.url === appPageUrl;
}

function handleFromApp(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isAppPage(event)) {
      throw new Error(`${channel} is not allowed from ${event.senderFrame?.url}`);
    }
    return handler(event, ...args);
  });
}

function onFromApp(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    if (isAppPage(event)) {
      handler(event, ...args);
    }
  });
}

// Processes belong to the page that started them; a reload, crash or close of
// that page ends them, since the new page has no way to reach them.
function stopProcessesOwnedBy(owner) {
  for (const [id, entry] of terminals) {
    if (entry.owner === owner) {
      terminals.delete(id);
      entry.term.kill();
    }
  }

  if (localSession?.owner === owner) {
    stopLocalSession();
  }
}

function watchOwner(owner) {
  if (watchedOwners.has(owner)) {
    return;
  }

  watchedOwners.add(owner);
  owner.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      stopProcessesOwnedBy(owner);
    }
  });
  owner.on('render-process-gone', () => stopProcessesOwnedBy(owner));
  owner.once('destroyed', () => stopProcessesOwnedBy(owner));
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const settings = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function loadPty() {
  const pty = require('node-pty');

  // npm may skip node-pty's postinstall, leaving spawn-helper non-executable.
  if (process.platform === 'darwin') {
    const helper = path
      .join(path.dirname(require.resolve('node-pty')), '..', 'prebuilds', `darwin-${process.arch}`, 'spawn-helper')
      .replace('app.asar', 'app.asar.unpacked');
    try {
      fs.accessSync(helper, fs.constants.X_OK);
    } catch {
      try {
        fs.chmodSync(helper, 0o755);
      } catch {}
    }
  }

  return pty;
}

function claudeShellCommand() {
  if (process.platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoExit',
        '-Command',
        "if (Get-Command claude -ErrorAction SilentlyContinue) { claude } else { Write-Host \"`n  Claude Code CLI not found. Install it with:`n    irm https://claude.ai/install.ps1 | iex`n  then run: claude`n\" }"
      ]
    };
  }

  // Login + interactive so the user's PATH (nvm, ~/.local/bin, Homebrew) is loaded
  // even when the app is launched from Finder. Drops to a shell when claude exits.
  const shellPath = process.env.SHELL || '/bin/zsh';
  return {
    file: shellPath,
    args: [
      '-l',
      '-i',
      '-c',
      'if command -v claude >/dev/null 2>&1; then claude; else printf "\\n  Claude Code CLI not found. Install it with:\\n    curl -fsSL https://claude.ai/install.sh | bash\\n  then run: claude\\n\\n"; fi; exec "$SHELL" -l -i'
    ]
  };
}

handleFromApp('claude-code:get-folder', () => {
  const folder = readSettings().claudeCodeFolder;
  return folder && fs.existsSync(folder) ? folder : app.getPath('home');
});

handleFromApp('claude-code:pick-folder', async (event) => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Choose a project folder for Claude Code',
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  writeSettings({ claudeCodeFolder: result.filePaths[0] });
  return result.filePaths[0];
});

handleFromApp('claude-code:start', (event, { cwd, cols, rows }) => {
  if (!cwd || !fs.existsSync(cwd)) {
    throw new Error(`Folder not found: ${cwd}`);
  }

  const pty = loadPty();
  const { file, args } = claudeShellCommand();
  const id = nextTerminalId++;
  const owner = event.sender;
  const term = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
  });

  terminals.set(id, { term, owner });
  watchOwner(owner);
  term.onData((data) => {
    if (!owner.isDestroyed()) {
      owner.send('claude-code:data', id, data);
    }
  });
  term.onExit(({ exitCode }) => {
    terminals.delete(id);
    if (!owner.isDestroyed()) {
      owner.send('claude-code:exit', id, exitCode);
    }
  });

  return id;
});

onFromApp('claude-code:write', (_event, id, data) => {
  terminals.get(id)?.term.write(data);
});

onFromApp('claude-code:resize', (_event, id, cols, rows) => {
  terminals.get(id)?.term.resize(cols, rows);
});

onFromApp('claude-code:stop', (_event, id) => {
  const entry = terminals.get(id);
  if (entry) {
    terminals.delete(id);
    entry.term.kill();
  }
});

// --- Local sessions for claude.ai/code -------------------------------------
// claude.ai/code only offers "Local" inside Anthropic's desktop app. Running
// `claude remote-control` in a folder registers it with claude.ai, so the
// session can be driven from the Claude tab while working on local files.

let localSession = null;
const localSessionTimeoutMs = 90 * 1000;
// A URL only counts once something follows it, so a link split across two
// output chunks is never used half-received.
const sessionUrlPattern = /https:\/\/claude\.ai\/code[^\s'"<>)]*(?=[\s'"<>)])/;

function stripAnsi(text) {
  return text
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\r/g, '\n');
}

function sendLocalStatus(sender, status) {
  if (!sender.isDestroyed()) {
    sender.send('local-session:status', status);
  }
}

function stopLocalSession() {
  if (localSession) {
    const { term, timeout } = localSession;
    localSession = null;
    clearTimeout(timeout);
    term.kill();
  }
}

function lastLines(output, count) {
  return output
    .trim()
    .split('\n')
    .filter((line) => line.trim() && !/^[yn]$/i.test(line.trim()))
    .slice(-count)
    .join('\n');
}

async function answerLocalPrompt(session, promptText) {
  const result = await dialog.showMessageBox(BrowserWindow.fromWebContents(session.owner), {
    type: 'question',
    buttons: ['Yes', 'No'],
    defaultId: 1,
    cancelId: 1,
    message: 'Claude Code asks:',
    detail: promptText
  });

  // The session may have been stopped or replaced while the dialog was open.
  if (localSession === session) {
    try {
      session.term.write(result.response === 0 ? 'y\r' : 'n\r');
    } catch {}
  }
}

handleFromApp('local-session:start', (event, folder) => {
  stopLocalSession();

  if (!folder || !fs.existsSync(folder)) {
    throw new Error(`Folder not found: ${folder}`);
  }

  const pty = loadPty();
  const sender = event.sender;
  const sessionName = `${path.basename(folder)} (AI Workspace)`;
  const env = { ...process.env, TERM: 'xterm-256color', AIW_SESSION_NAME: sessionName };
  const command = process.platform === 'win32'
    ? { file: 'powershell.exe', args: ['-NoLogo', '-Command', 'claude remote-control --name $env:AIW_SESSION_NAME'] }
    : { file: process.env.SHELL || '/bin/zsh', args: ['-l', '-i', '-c', 'claude remote-control --name "$AIW_SESSION_NAME"'] };
  const term = pty.spawn(command.file, command.args, { name: 'xterm-256color', cols: 120, rows: 40, cwd: folder, env });
  const current = { term, folder, owner: sender, output: '', url: null, prompting: false, timeout: null };
  localSession = current;
  watchOwner(sender);

  // Remote Control may stop on a question this app doesn't recognize. Rather
  // than "Connecting…" forever, stop and show what it was waiting on.
  const armTimeout = () => {
    clearTimeout(current.timeout);
    current.timeout = setTimeout(() => {
      if (localSession === current && !current.url && !current.prompting) {
        const message = `Remote Control didn't connect. Its last output was:\n\n${lastLines(current.output, 6)}`;
        stopLocalSession();
        sendLocalStatus(sender, { state: 'stopped', folder, message });
      }
    }, localSessionTimeoutMs);
  };
  armTimeout();

  sendLocalStatus(sender, { state: 'starting', folder });

  term.onData((data) => {
    if (localSession !== current) {
      return;
    }

    current.output = (current.output + stripAnsi(data)).slice(-8000);

    const url = current.output.match(sessionUrlPattern);
    if (url && url[0] !== current.url) {
      current.url = url[0];
      clearTimeout(current.timeout);
      sendLocalStatus(sender, { state: 'connected', folder, url: current.url });
    }

    // Surface yes/no questions (folder trust, first-run consent) as a dialog.
    const lines = current.output.trimEnd().split('\n').filter((line) => line.trim());
    const lastLine = lines[lines.length - 1] || '';
    if (!current.prompting && /(\[y\/N\]|\[Y\/n\]|\(y\/n\))\s*$/i.test(lastLine)) {
      current.prompting = true;
      current.output = '';
      answerLocalPrompt(current, lines.slice(-6).join('\n')).finally(() => {
        current.prompting = false;
        armTimeout();
      });
    }
  });

  term.onExit(({ exitCode }) => {
    if (localSession !== current) {
      return;
    }

    localSession = null;
    clearTimeout(current.timeout);
    sendLocalStatus(sender, { state: 'stopped', folder, exitCode, message: exitCode ? lastLines(current.output, 4) : '' });
  });
});

handleFromApp('local-session:stop', () => {
  stopLocalSession();
});

app.on('before-quit', stopLocalSession);

app.whenReady().then(() => {
  for (const partition of aiPartitions) {
    applyChromeIdentity(session.fromPartition(partition));
  }

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
