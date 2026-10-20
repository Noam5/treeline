import { join } from 'node:path';
import { buildApp } from '../server/src/app.js';

// Where the built frontend lives. When packaged, `web/dist` is pulled out of
// the asar archive (see `asarUnpack` in electron-builder.yml), so it sits
// beside app.asar rather than inside it.
export function resolveWebDist({ isPackaged, appPath, resourcesPath }) {
  return isPackaged
    ? join(resourcesPath, 'app.asar.unpacked', 'web', 'dist')
    : join(appPath, 'web', 'dist');
}

// Binds the Express app on loopback. Pass port 0 to let the kernel pick one;
// the resolved `port` is always the port actually bound.
//
// `fallbackToEphemeral` retries on port 0 when the requested port is taken,
// trading a stable port for starting at all. It is opt-in because a silent
// fallback is wrong in dev: Vite proxies /api to port 4000 specifically
// (see web/vite.config.js), so a server that landed anywhere else would leave
// the UI talking to nothing.
// `fellBack` tells the caller the port is not the one it asked for, which
// matters to the UI: the window origin keys localStorage, so a fallback port
// means an empty settings bucket for that run.
export function startServer({ port = 0, staticDir, fallbackToEphemeral = false } = {}) {
  return new Promise((resolve, reject) => {
    const server = buildApp({ staticDir }).listen(port, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, fellBack: false });
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && fallbackToEphemeral && port !== 0) {
        console.warn(`port ${port} is in use — starting on an ephemeral port instead; ` +
          'saved UI settings will not be visible this run');
        startServer({ port: 0, staticDir })
          .then((r) => resolve({ ...r, fellBack: true }), reject);
        return;
      }
      reject(err);
    });
  });
}

// Messages the window should show once it loads. The console warning above is
// invisible to anyone launching from a desktop icon, and the consequence — a
// session that looks wiped — is alarming enough to deserve saying out loud.
export function startupNotices({ fellBack, port, requestedPort } = {}) {
  if (!fellBack) return [];
  return [`Port ${requestedPort} was busy, so this window is on port ${port} instead. ` +
    'Your saved tabs and settings belong to the usual port and are not visible ' +
    'this run; they will come back next time that port is free.'];
}

// Brings an already-running window back to the user. Called when a second
// launch is attempted: Electron's single-instance lock makes that second process
// quit, and this is what the surviving one does instead of opening a window.
//
// A minimized window must be restored before focus(), which on its own would
// mark the taskbar entry as demanding attention without unfolding the window.
// Returns whether there was a live window to focus, so the caller can tell the
// difference between "focused it" and "nothing there to focus".
export function focusExistingWindow(win) {
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

// Opens the OS folder chooser and returns the chosen absolute path, or null if
// the user dismissed it. `dialog` is injected — Electron's dialog module in
// main.js, a stub in tests — so this is testable without booting Electron.
export async function pickRepoDir({ dialog, parent = null, defaultPath } = {}) {
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    title: 'Choose a git repository',
    properties: ['openDirectory'],
    defaultPath,
  });
  return canceled || !filePaths?.length ? null : filePaths[0];
}

// The application menu. Tab items carry the accelerators the renderer cannot
// claim for itself — Ctrl+W in particular would otherwise close the window —
// and each one sends a single command over `tab:command`.
//
// `send` is injected so this stays a pure template builder, testable without
// launching Electron. Note that setting an application menu REPLACES Electron's
// default one, so the standard roles are rebuilt here or they would be lost.
export function buildTabMenuTemplate(send) {
  const tabItem = (label, accelerator, command) => ({
    label, accelerator, click: () => send('tab:command', command),
  });
  return [
    {
      label: 'File',
      submenu: [
        tabItem('New Tab', 'CmdOrCtrl+T', 'new'),
        tabItem('Close Tab', 'CmdOrCtrl+W', 'close'),
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        tabItem('Next Tab', 'Control+Tab', 'next'),
        tabItem('Previous Tab', 'Control+Shift+Tab', 'prev'),
        { type: 'separator' },
        tabItem('Move Tab Left', 'CmdOrCtrl+Shift+PageUp', 'move-left'),
        tabItem('Move Tab Right', 'CmdOrCtrl+Shift+PageDown', 'move-right'),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
}
