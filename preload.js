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
  // Activity Logs & System Diagnostics IPC methods
  getActivityLogs: () => ipcRenderer.invoke('get-activity-logs'),
  clearActivityLogs: () => ipcRenderer.invoke('clear-activity-logs'),
  addClientLog: (level, source, message, details) => ipcRenderer.invoke('add-client-log', { level, source, message, details }),
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
  getSystemStatus: () => ipcRenderer.invoke('get-system-status'),
  nativeConfirm: (message) => ipcRenderer.sendSync('show-confirm', message)
});

