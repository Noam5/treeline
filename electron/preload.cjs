// The renderer's only bridge to the main process. CommonJS on purpose: the
// root package.json sets "type": "module", and an ESM preload would need the
// sandbox disabled plus an .mjs extension.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitClient', {
  // Opens the native folder chooser. Resolves to an absolute path, or null if
  // dismissed. Absent in a browser tab, which is how the UI detects Electron.
  pickRepo: (startIn) => ipcRenderer.invoke('repo:pick', startIn),

  // Messages the main process wants the window to show once it is up — a
  // fallback port, for instance. Resolves to an array of strings.
  getStartupNotices: () => ipcRenderer.invoke('app:notices'),

  // Tab commands from the application menu: 'new' | 'close' | 'next' | 'prev'.
  // Returns an unsubscribe function so the renderer can clean up.
  onTabCommand: (cb) => {
    const handler = (_event, command) => cb(command);
    ipcRenderer.on('tab:command', handler);
    return () => ipcRenderer.off('tab:command', handler);
  },
});
