const { app, BrowserWindow, globalShortcut, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

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
let backendProcess = null;
let tray = null;

// Determine if we are in development mode
const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === 'true';

// Start the Express backend if we are in production
function startBackend() {
  if (isDev) {
    console.log('[Electron] Running in development mode. Skipping native backend spawning...');
    return;
  }

  console.log('[Electron] Starting Express Backend natively...');
  const serverPath = path.join(__dirname, 'server/src/index.js');
  
  backendProcess = spawn('node', [serverPath], {
    cwd: path.join(__dirname, 'server'),
    env: { ...process.env, NODE_ENV: 'production' }
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[Backend stdout]: ${data.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[Backend stderr]: ${data.toString().trim()}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`[Backend] Process exited with code ${code}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: process.env.APP_NAME || 'MeetingScribe',
    backgroundColor: '#0A0A0B',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

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
app.whenReady().then(() => {
  startBackend();
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
  if (backendProcess) {
    console.log('[Electron] Killing background Express Backend process...');
    backendProcess.kill();
  }
});
