const { app, BrowserWindow, globalShortcut, Tray, Menu, session, systemPreferences, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { pathToFileURL } = require('url');

// Explicitly set application name immediately at startup
app.setName('MeetingScribe');

// Load environment variables in Electron main process from server/.env if available
const envPath = path.join(__dirname, 'server/.env');
if (fs.existsSync(envPath)) {
  try {
    require(path.join(__dirname, 'server/node_modules/dotenv')).config({ path: envPath });
  } catch (e) {
    console.log('[Electron] dotenv could not be loaded in main process, skipping...');
  }
}

let mainWindow;
let tray = null;
let loggerModule = null;
let backendStarted = false;
let backendError = null;
let isRecordingActive = false; // Tracks recording state for tray UI updates

// Determine if we are in development mode
const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === 'true';

// ─── Custom native App Menu (removes "Electron" branding) ────────────────────
function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const appName = 'MeetingScribe';
  const iconPath = path.join(__dirname, 'icon.png');

  const template = [
    ...(isMac ? [{
      label: appName,
      submenu: [
        {
          label: `About ${appName}`,
          click: () => {
            dialog.showMessageBox(mainWindow || null, {
              type: 'info',
              title: `About ${appName}`,
              message: appName,
              detail: `Versi 1.0.0\nAI Meeting Recorder, Transcriber & Summarizer\n\n© 2025 MeetingScribe · powered by technice.id`,
              icon: fs.existsSync(iconPath) ? iconPath : undefined,
              buttons: ['Tutup']
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Preferences…',
          accelerator: 'Command+,',
          click: () => {
            if (mainWindow) { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('navigate-to', 'settings'); }
          }
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${appName}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${appName}` }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Meeting',
          accelerator: isMac ? 'Command+N' : 'Ctrl+N',
          click: () => {
            if (mainWindow) { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('navigate-to', 'new-meeting'); }
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' }] : []),
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

// ─── Backend readiness check (poll /api/ping before showing window) ───────────
function waitForBackend(maxAttempts = 30, intervalMs = 500) {
  return new Promise((resolve) => {
    if (isDev) return resolve(); // Dev backend is started separately
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.get('http://localhost:3001/api/ping', (res) => {
        if (res.statusCode === 200) { console.log('[Electron] Backend is ready.'); resolve(); }
        else retry();
        res.resume();
      });
      req.on('error', retry);
      req.setTimeout(400, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (attempts >= maxAttempts) { console.warn('[Electron] Backend timeout, showing window anyway.'); resolve(); }
      else setTimeout(check, intervalMs);
    };
    check();
  });
}

// Start the Express backend if we are in production
async function startBackend() {
  const userDataPath = app.getPath('userData');
  const dataDir = path.join(userDataPath, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  process.env.DATA_DIR = dataDir;

  // Dynamically load logger module
  try {
    let loggerPath = path.join(__dirname, 'server/src/logger.js');
    if (loggerPath.includes('app.asar') && !fs.existsSync(loggerPath)) {
      const unpackedLogger = loggerPath.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(unpackedLogger)) loggerPath = unpackedLogger;
    }
    loggerModule = await import(pathToFileURL(loggerPath).href);
    if (loggerModule && loggerModule.initLogger) {
      loggerModule.initLogger(dataDir);
      loggerModule.addLog('INFO', 'Electron', `MeetingScribe starting... (isDev=${isDev})`);
      loggerModule.addLog('INFO', 'System', `OS: ${process.platform} ${process.arch}, Node: ${process.versions.node}, Electron: ${process.versions.electron}`);
    }
  } catch (err) {
    console.error('[Electron] Failed to load logger in main process:', err);
  }

  if (isDev) {
    console.log('[Electron] Running in development mode. Skipping native backend startup...');
    backendStarted = true;
    return;
  }

  console.log('[Electron] Starting Express Backend in main process...');
  try {
    let serverPath = path.join(__dirname, 'server/src/index.js');
    if (serverPath.includes('app.asar') && !fs.existsSync(serverPath)) {
      const unpackedServer = serverPath.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(unpackedServer)) serverPath = unpackedServer;
    }
    await import(pathToFileURL(serverPath).href);
    backendStarted = true;
    console.log('[Electron] Express Backend started successfully');
    if (loggerModule) loggerModule.addLog('SUCCESS', 'Server', 'Express Backend started successfully on port 3001');
  } catch (err) {
    backendError = err.stack || err.message || String(err);
    console.error('[Electron] Failed to start Express Backend:', err);
    if (loggerModule) loggerModule.addLog('ERROR', 'Server', `Failed to start Express Backend: ${backendError}`);
  }
}

// IPC Handlers for Activity Logs and System Diagnostics
ipcMain.handle('get-activity-logs', async () => {
  if (loggerModule && loggerModule.logger) {
    return loggerModule.logger.getLogs();
  }
  return [];
});

ipcMain.handle('clear-activity-logs', async () => {
  if (loggerModule && loggerModule.logger) {
    loggerModule.logger.clearLogs();
  }
  return true;
});

ipcMain.handle('add-client-log', async (_event, { level, source, message, details }) => {
  if (loggerModule && loggerModule.addLog) {
    loggerModule.addLog(level, source || 'Client', message, details);
  }
  return true;
});

ipcMain.handle('toggle-devtools', async () => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.toggleDevTools();
    return true;
  }
  return false;
});

ipcMain.handle('get-system-status', async () => {
  return {
    backendStarted,
    backendError,
    version: app.getVersion ? app.getVersion() : '1.0.0',
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userDataPath: app.getPath('userData'),
    isDev
  };
});

ipcMain.on('show-confirm', (event, message) => {
  const result = dialog.showMessageBoxSync(mainWindow, {
    type: 'question',
    buttons: ['Ya, Lanjutkan', 'Batal'],
    defaultId: 0,
    cancelId: 1,
    title: 'Konfirmasi MeetingScribe',
    message: message,
    icon: path.join(__dirname, 'icon.png')
  });
  event.returnValue = result === 0; // true if 'Ya', false if 'Batal'
});

// Renderer notifies main when recording starts/stops → update tray tooltip & menu
ipcMain.on('recording-state-changed', (_event, recording) => {
  isRecordingActive = !!recording;
  rebuildTrayMenu();
});

function createWindow() {
  const iconPath = path.join(__dirname, 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    title: 'MeetingScribe',
    icon: iconPath,
    backgroundColor: '#0A0A0B',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 20 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Set dock icon on macOS if available
  if (process.platform === 'darwin' && app.dock && fs.existsSync(iconPath)) {
    try {
      app.dock.setIcon(iconPath);
    } catch (err) {
      console.error('[Electron] Failed to set macOS dock icon:', err);
    }
  }

  if (isDev) {
    // In development, load Vite local server
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built index.html from dist
    const htmlPath = path.join(__dirname, 'client/dist/index.html');
    mainWindow.loadFile(htmlPath);
  }

  // On macOS: hide to tray instead of quitting when window X is clicked
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      rebuildTrayMenu();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create the macOS Menu Bar Tray Icon
function rebuildTrayMenu() {
  if (!tray) return;

  const isVisible = mainWindow && mainWindow.isVisible();
  const recordingLabel = isRecordingActive ? '🔴 Recording in progress...' : '⏺  Quick Record (Cmd+Shift+R)';

  const contextMenu = Menu.buildFromTemplate([
    { label: 'MeetingScribe', enabled: false },
    { type: 'separator' },
    {
      label: isVisible ? 'Hide Window' : 'Show Window',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible() && mainWindow.isFocused()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        } else {
          createWindow();
        }
      }
    },
    { type: 'separator' },
    {
      label: recordingLabel,
      enabled: !isRecordingActive,
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('global-shortcut-record');
        } else {
          createWindow();
        }
      }
    },
    {
      label: 'Meetings Dashboard',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('navigate-to', 'dashboard'); }
        else createWindow();
      }
    },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('navigate-to', 'settings'); }
        else createWindow();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit MeetingScribe',
      accelerator: process.platform === 'darwin' ? 'Command+Q' : 'Alt+F4',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(isRecordingActive ? 'MeetingScribe — 🔴 Recording active' : 'MeetingScribe — Click to show');
}

function createTray() {
  const templateIconPath = path.join(__dirname, 'iconTemplate.png');

  // Write the template icon if it doesn't exist
  if (!fs.existsSync(templateIconPath)) {
    const iconBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAZklEQVR42t2SAQ4AIAgD7f+f7R5Gg5wzdIYg0BqKiMhr6U0F4Cq4zK64DIBN2A34hH2An1ACeP4kMBKQA3bAGbAD1sAFSAOugBkwBy7AGpCDW4AEpID/X2R1f6q6F9W9VvW32i/YAH9bT29qLAAAAABJRU5ErkJggg==';
    try {
      fs.writeFileSync(templateIconPath, Buffer.from(iconBase64, 'base64'));
      console.log('[Electron] Created tray template icon file');
    } catch (err) {
      console.error('[Electron] Failed to write tray icon:', err);
    }
  }

  const iconPath = fs.existsSync(templateIconPath) ? templateIconPath : path.join(__dirname, 'icon.png');

  try {
    tray = new Tray(iconPath);

    // Single click → toggle window visibility
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible() && mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      } else {
        createWindow();
      }
    });

    rebuildTrayMenu();
    console.log('[Electron] macOS Menu Bar Tray initialized');
  } catch (err) {
    console.error('[Electron] Failed to initialize Tray:', err);
  }
}

// Boot setup
app.whenReady().then(async () => {
  // Set About panel details (replaces "Electron" in the About dialog)
  app.setAboutPanelOptions({
    applicationName: 'MeetingScribe',
    applicationVersion: app.getVersion() || '1.0.0',
    version: `Electron ${process.versions.electron} · Node ${process.versions.node}`,
    copyright: '© 2025 MeetingScribe · powered by technice.id',
    iconPath: path.join(__dirname, 'icon.png')
  });

  // Install custom app menu (removes default "Electron" menu)
  Menu.setApplicationMenu(buildAppMenu());

  if (session && session.defaultSession) {
    // Whitelist only the permissions MeetingScribe legitimately needs:
    // - 'media' / 'microphone': getUserMedia for mic recording
    // - 'display-capture': getDisplayMedia for system audio (tab/screen capture)
    // - 'mediaKeySystem': required by some audio APIs
    const ALLOWED_PERMISSIONS = new Set([
      'media',
      'microphone',
      'camera',
      'display-capture',
      'mediaKeySystem',
      'notifications',
    ]);
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      if (ALLOWED_PERMISSIONS.has(permission)) {
        callback(true);
      } else {
        console.warn(`[Electron] Denied unexpected permission request: "${permission}"`);
        callback(false);
      }
    });
  }

  // Request macOS system microphone access on initial app launch
  if (process.platform === 'darwin' && systemPreferences && systemPreferences.askForMediaAccess) {
    try {
      const micStatus = systemPreferences.getMediaAccessStatus('microphone');
      if (micStatus !== 'granted') {
        systemPreferences.askForMediaAccess('microphone').then(granted => {
          console.log('[Electron] macOS Microphone access requested on launch:', granted);
        }).catch(err => {
          console.error('[Electron] Error requesting macOS microphone access:', err);
        });
      }
    } catch (err) {
      console.error('[Electron] Failed to check macOS media access:', err);
    }
  }

  // Start backend, wait until it responds, THEN show window (fixes blank/broken UI on launch)
  await startBackend();
  await waitForBackend();

  createWindow();
  createTray();

  // Register Global Keyboard Shortcut (Cmd+Shift+R or Ctrl+Shift+R)
  const shortcut = process.platform === 'darwin' ? 'Command+Shift+R' : 'Control+Shift+R';
  globalShortcut.register(shortcut, () => {
    console.log('[Electron] Global shortcut triggered!');
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('global-shortcut-record');
    }
  });

  // macOS: clicking the dock icon should re-show the window if hidden
  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
});

// On macOS the app stays running when all windows are closed (lives in menu bar tray)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up on quit
app.on('will-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
});

