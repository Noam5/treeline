import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { buildTabMenuTemplate, focusExistingWindow, pickRepoDir, resolveWebDist, startServer, startupNotices } from './runtime.js';

const isDev = !app.isPackaged;
const VITE_URL = 'http://127.0.0.1:5173';
const PRELOAD = fileURLToPath(new URL('preload.cjs', import.meta.url));

// Only one copy of the app runs at a time. A second launch used to find the
// usual port taken, fall back to an ephemeral one and open a window with an
// empty localStorage — a session that looks wiped. Electron's lock is held by
// the first instance, so the second one quits here and the first hears
// 'second-instance' below and surfaces the window the user already had.
//
// The doomed instance still runs the registrations below, which is harmless:
// it quits without ever reaching whenReady, so it opens no window and binds
// no port.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit();

app.on('second-instance', () => {
  focusExistingWindow(BrowserWindow.getAllWindows()[0]);
});

// Anything start() wants the window to say. Filled in on startup and read by
// the renderer when it mounts, rather than pushed at it: a send would race the
// page load and the message would be lost.
let notices = [];

// Registered once here rather than inside start(), which the 'activate' event
// can run again — ipcMain.handle throws on a duplicate channel.
ipcMain.handle('app:notices', () => notices);
ipcMain.handle('repo:pick', (_event, startIn) => pickRepoDir({
  dialog,
  parent: BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
  defaultPath: startIn,
}));

// Packaged builds bind this exact port, because the window's origin
// (http://127.0.0.1:<port>) is what keys localStorage — where every UI setting
// lives: theme, last-opened repo, diff pane height, graph column widths. An
// ephemeral port changes the origin each launch and hands the app an empty
// settings bucket every time.
//
// Chosen below 32768, the floor of Linux's ip_local_port_range, so the kernel
// can never hand this port to some other process's outgoing connection.
// A fixed port does reintroduce the collisions an ephemeral one ruled out, so
// startServer falls back to an ephemeral port rather than refusing to start —
// that run just doesn't see the saved settings. Since the single-instance lock
// above, the collision can only come from some unrelated process holding the
// port, never from a second copy of this app.
const PACKAGED_PORT = 26542;

// In dev, Vite serves the frontend and proxies /api to port 4000, so Express
// must bind that exact port (see web/vite.config.js) and must not fall back
// elsewhere. When packaged, Express serves the frontend itself.
async function start() {
  const staticDir = isDev
    ? undefined
    : resolveWebDist({
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
      });

  const requestedPort = isDev ? 4000 : PACKAGED_PORT;
  const { port, fellBack } = await startServer({
    port: requestedPort,
    fallbackToEphemeral: !isDev,
    staticDir,
  });
  notices = startupNotices({ fellBack, port, requestedPort });

  // Tab accelerators live in the menu, so they work regardless of what has
  // focus, and Ctrl+W reaches the tabs instead of closing the window.
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTabMenuTemplate((channel, command) => {
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    target?.webContents.send(channel, command);
  })));

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Treeline',
    backgroundColor: '#181a1f',
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: PRELOAD },
  });

  // Anything trying to open a new window goes to the real browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await win.loadURL(isDev ? VITE_URL : `http://127.0.0.1:${port}`);
}

if (isPrimaryInstance) {
  app.whenReady().then(start).catch((err) => {
    console.error('Failed to start:', err);
    app.quit();
  });
}

app.on('window-all-closed', () => app.quit());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) start();
});
