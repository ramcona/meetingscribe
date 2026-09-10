const { app, BrowserWindow, globalShortcut, Tray, Menu, session, systemPreferences, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

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

// Determine if we are in development mode
const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === 'true';

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


// Set application name for desktop OS integrations
app.setName('MeetingScribe');

function createWindow() {
  const iconPath = path.join(__dirname, 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'MeetingScribe',
    icon: iconPath,
    backgroundColor: '#0A0A0B',
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create the macOS Menu Bar Tray Icon
function createTray() {
  const iconPath = path.join(__dirname, 'iconTemplate.png');
  
  // Write a simple black microphone silhouette as a base64 template image if it doesn't exist
  if (!fs.existsSync(iconPath)) {
    const iconBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAZklEQVR42t2SAQ4AIAgD7f+f7R5Gg5wzdIYg0BqKiMhr6U0F4Cq4zK64DIBN2A34hH2An1ACeP4kMBKQA3bAGbAD1sAFSAOugBkwBy7AGpCDW4AEpID/X2R1f6q6F9W9VvW32i/YAH9bT29qLAAAAABJRU5ErkJggg==';
    try {
      fs.writeFileSync(iconPath, Buffer.from(iconBase64, 'base64'));
      console.log('[Electron] Created tray template icon file');
    } catch (err) {
      console.error('[Electron] Failed to write tray icon:', err);
    }
  }

  try {
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'MeetingScribe', enabled: false },
      { type: 'separator' },
      { 
        label: 'Show Application Window', 
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      },
      { 
        label: 'Quick Record / Toggle', 
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send('global-shortcut-record');
          }
        }
      },
      { type: 'separator' },
      { 
        label: 'Quit', 
        click: () => {
          app.quit();
        }
      }
    ]);

    tray.setToolTip('MeetingScribe - Local-First Audio Recorder');
    tray.setContextMenu(contextMenu);
    console.log('[Electron] macOS Menu Bar Tray initialized');
  } catch (err) {
    console.error('[Electron] Failed to initialize Tray:', err);
  }
}

// Boot setup
app.whenReady().then(async () => {
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

  await startBackend();
  createWindow();
  createTray();

  // Register Global Keyboard Shortcut (Cmd+Shift+R or Ctrl+Shift+R)
  const shortcut = process.platform === 'darwin' ? 'Command+Shift+R' : 'Control+Shift+R';
  globalShortcut.register(shortcut, () => {
    console.log('[Electron] Global shortcut triggered!');
    if (mainWindow) {
      mainWindow.webContents.send('global-shortcut-record');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up background subprocesses on quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
