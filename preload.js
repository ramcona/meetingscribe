const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to the React frontend process
contextBridge.exposeInMainWorld('electronAPI', {
  // Listen for the global shortcut record trigger
  onGlobalShortcutRecord: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('global-shortcut-record', subscription);
    
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener('global-shortcut-record', subscription);
    };
  },
  // Listen for navigate-to events from tray/menu (e.g. 'settings', 'dashboard', 'new-meeting')
  onNavigateTo: (callback) => {
    const subscription = (_event, page) => callback(page);
    ipcRenderer.on('navigate-to', subscription);
    return () => ipcRenderer.removeListener('navigate-to', subscription);
  },
  // Notify main process when recording starts/stops (updates tray tooltip and menu)
  notifyRecordingState: (isRecording) => {
    ipcRenderer.send('recording-state-changed', isRecording);
  },
  // Activity Logs & System Diagnostics IPC methods
  getActivityLogs: () => ipcRenderer.invoke('get-activity-logs'),
  clearActivityLogs: () => ipcRenderer.invoke('clear-activity-logs'),
  addClientLog: (level, source, message, details) => ipcRenderer.invoke('add-client-log', { level, source, message, details }),
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
  getSystemStatus: () => ipcRenderer.invoke('get-system-status'),
  nativeConfirm: (message) => ipcRenderer.sendSync('show-confirm', message)
});


