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
  }
});
