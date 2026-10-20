import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolveWebDist, startServer, pickRepoDir, buildTabMenuTemplate, startupNotices, focusExistingWindow } from '../runtime.js';

test('resolveWebDist in dev points at the repo web/dist', () => {
  assert.equal(
    resolveWebDist({ isPackaged: false, appPath: '/repo', resourcesPath: '/ignored' }),
    join('/repo', 'web', 'dist'));
});

test('resolveWebDist when packaged points into app.asar.unpacked', () => {
  assert.equal(
    resolveWebDist({
      isPackaged: true,
      appPath: '/app/resources/app.asar',
      resourcesPath: '/app/resources',
    }),
    join('/app/resources', 'app.asar.unpacked', 'web', 'dist'));
});

test('startServer with port 0 binds a real ephemeral port', async () => {
  const { server, port } = await startServer({ port: 0 });
  assert.equal(typeof port, 'number');
  assert.ok(port > 0, `expected a bound port, got ${port}`);
  await new Promise((r) => server.close(r));
});

test('startServer honors an explicitly requested port', async () => {
  // Borrow a free port from the kernel, release it, then ask for it by number.
  const probe = await startServer({ port: 0 });
  const wanted = probe.port;
  await new Promise((r) => probe.server.close(r));

  const { server, port } = await startServer({ port: wanted });
  assert.equal(port, wanted);
  await new Promise((r) => server.close(r));
});

test('startServer rejects when the port is already taken', async () => {
  const first = await startServer({ port: 0 });
  await assert.rejects(() => startServer({ port: first.port }), /EADDRINUSE/);
  await new Promise((r) => first.server.close(r));
});

test('startServer falls back to an ephemeral port when the requested one is taken', async () => {
  const close = (s) => new Promise((r) => s.close(r));
  const squatter = await startServer({ port: 0 });
  // Always release the squatted port: an open handle here would keep the test
  // runner's event loop alive and hang the whole run on failure.
  try {
    const { server, port } = await startServer({ port: squatter.port, fallbackToEphemeral: true });
    try {
      assert.notEqual(port, squatter.port);
      assert.ok(port > 0, `expected a bound fallback port, got ${port}`);
      // The fallback must be a working server, not just a bound socket.
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.deepEqual(await res.json(), { ok: true });
    } finally {
      await close(server);
    }
  } finally {
    await close(squatter.server);
  }
});

test('startServer with the fallback enabled still prefers the requested port', async () => {
  const close = (s) => new Promise((r) => s.close(r));
  const probe = await startServer({ port: 0 });
  const wanted = probe.port;
  await close(probe.server);

  const { server, port } = await startServer({ port: wanted, fallbackToEphemeral: true });
  try {
    assert.equal(port, wanted);
  } finally {
    await close(server);
  }
});

// A stand-in for Electron's dialog module: records the request, replies with
// whatever the test wants showOpenDialog to have returned.
function fakeDialog(result) {
  const calls = [];
  return { calls, showOpenDialog: async (parent, opts) => { calls.push({ parent, opts }); return result; } };
}

test('pickRepoDir asks for a directory and returns the chosen path', async () => {
  const dialog = fakeDialog({ canceled: false, filePaths: ['/home/user/repo'] });
  const parent = { id: 'win' };

  const picked = await pickRepoDir({ dialog, parent, defaultPath: '/home/user/old' });

  assert.equal(picked, '/home/user/repo');
  assert.equal(dialog.calls.length, 1);
  assert.equal(dialog.calls[0].parent, parent);
  assert.deepEqual(dialog.calls[0].opts.properties, ['openDirectory']);
  assert.equal(dialog.calls[0].opts.defaultPath, '/home/user/old');
});

test('pickRepoDir returns null when the dialog is canceled', async () => {
  const dialog = fakeDialog({ canceled: true, filePaths: [] });
  assert.equal(await pickRepoDir({ dialog }), null);
});

test('pickRepoDir returns null when the dialog yields no path', async () => {
  // Electron reports canceled:false with an empty list in some edge cases.
  const dialog = fakeDialog({ canceled: false, filePaths: [] });
  assert.equal(await pickRepoDir({ dialog }), null);
});

// --- Application menu -------------------------------------------------------

function menuFixture() {
  const sent = [];
  const template = buildTabMenuTemplate((channel, command) => sent.push({ channel, command }));
  const items = {};
  const walk = (entries) => {
    for (const e of entries) {
      if (e.submenu) walk(e.submenu);
      if (e.label) items[e.label] = e;
    }
  };
  walk(template);
  return { template, items, sent };
}

test('buildTabMenuTemplate binds the tab accelerators', () => {
  const { items } = menuFixture();
  assert.equal(items['New Tab'].accelerator, 'CmdOrCtrl+T');
  assert.equal(items['Close Tab'].accelerator, 'CmdOrCtrl+W');
  assert.equal(items['Next Tab'].accelerator, 'Control+Tab');
  assert.equal(items['Previous Tab'].accelerator, 'Control+Shift+Tab');
});

test('buildTabMenuTemplate sends one command per tab item', () => {
  const { items, sent } = menuFixture();
  for (const label of ['New Tab', 'Close Tab', 'Next Tab', 'Previous Tab']) items[label].click();
  assert.deepEqual(sent, [
    { channel: 'tab:command', command: 'new' },
    { channel: 'tab:command', command: 'close' },
    { channel: 'tab:command', command: 'next' },
    { channel: 'tab:command', command: 'prev' },
  ]);
});

test('buildTabMenuTemplate keeps the default menu roles it replaces', () => {
  const { template } = menuFixture();
  const roles = [];
  const walk = (entries) => {
    for (const e of entries) {
      if (e.role) roles.push(e.role);
      if (e.submenu) walk(e.submenu);
    }
  };
  walk(template);
  // Setting an application menu removes Electron's default one, so reload,
  // devtools, zoom and quit have to be provided here or they are simply lost.
  for (const role of ['reload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut', 'quit']) {
    assert.ok(roles.includes(role), `expected a "${role}" role in the menu`);
  }
});

test('buildTabMenuTemplate binds the move-tab accelerators', () => {
  const { items } = menuFixture();
  assert.equal(items['Move Tab Left'].accelerator, 'CmdOrCtrl+Shift+PageUp');
  assert.equal(items['Move Tab Right'].accelerator, 'CmdOrCtrl+Shift+PageDown');
});

test('buildTabMenuTemplate sends the move commands', () => {
  const { items, sent } = menuFixture();
  items['Move Tab Left'].click();
  items['Move Tab Right'].click();
  assert.deepEqual(sent, [
    { channel: 'tab:command', command: 'move-left' },
    { channel: 'tab:command', command: 'move-right' },
  ]);
});

test('startServer reports that it took the port it was asked for', async () => {
  const { server, port, fellBack } = await startServer({ port: 0 });
  assert.equal(fellBack, false);
  assert.ok(port > 0);
  await new Promise((r) => server.close(r));
});

test('startServer reports when it landed somewhere other than the requested port', async () => {
  const close = (s) => new Promise((r) => s.close(r));
  const squatter = await startServer({ port: 0 });
  try {
    const { server, fellBack } = await startServer({ port: squatter.port, fallbackToEphemeral: true });
    try {
      // This is what the UI needs to know: the origin is not the usual one, so
      // localStorage — theme, tabs, pane sizes — is a different, empty bucket.
      assert.equal(fellBack, true);
    } finally {
      await close(server);
    }
  } finally {
    await close(squatter.server);
  }
});

test('startupNotices says nothing when the server took its usual port', () => {
  assert.deepEqual(startupNotices({ fellBack: false, port: 26542 }), []);
});

test('startupNotices explains a fallback port in terms of what the user lost', () => {
  const [msg] = startupNotices({ fellBack: true, port: 45678, requestedPort: 26542 });
  assert.match(msg, /26542/);
  assert.match(msg, /settings|tabs/i);
});

// A stand-in for a BrowserWindow that records the calls made on it, so the
// focus sequence can be asserted without launching Electron.
function stubWindow({ minimized = false, destroyed = false } = {}) {
  const calls = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
}

test('focusExistingWindow un-minimizes a minimized window before focusing it', () => {
  const win = stubWindow({ minimized: true });
  assert.equal(focusExistingWindow(win), true);
  assert.deepEqual(win.calls, ['restore', 'show', 'focus']);
});

test('focusExistingWindow leaves an un-minimized window where it is', () => {
  const win = stubWindow();
  assert.equal(focusExistingWindow(win), true);
  assert.deepEqual(win.calls, ['show', 'focus']);
});

test('focusExistingWindow reports failure for a missing window', () => {
  assert.equal(focusExistingWindow(undefined), false);
  assert.equal(focusExistingWindow(null), false);
});

test('focusExistingWindow does not touch a destroyed window', () => {
  const win = stubWindow({ destroyed: true });
  assert.equal(focusExistingWindow(win), false);
  assert.deepEqual(win.calls, []);
});
