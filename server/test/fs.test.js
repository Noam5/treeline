import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { cleanup } from './helpers/repo.js';

const dirs = [];
after(async () => { for (const d of dirs) await cleanup(d); });

async function scratch() {
  const d = await mkdtemp(join(tmpdir(), 'gwc-fs-'));
  dirs.push(d);
  return d;
}

const list = (query) => request(buildApp()).get('/api/fs/list').query(query);
const names = (body) => body.entries.map((e) => e.name);
const entry = (body, name) => body.entries.find((e) => e.name === name);

test('GET /api/fs/list lists directories and skips files', async () => {
  const base = await scratch();
  await mkdir(join(base, 'alpha'));
  await writeFile(join(base, 'notes.txt'), 'x');

  const res = await list({ path: base });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.path, base);
  assert.deepEqual(names(res.body), ['alpha']);
});

test('GET /api/fs/list marks a directory holding .git as a repo', async () => {
  const base = await scratch();
  await mkdir(join(base, 'plain'));
  await mkdir(join(base, 'repo'));
  await mkdir(join(base, 'repo', '.git'));

  const { body } = await list({ path: base });

  assert.equal(entry(body, 'repo').isRepo, true);
  assert.equal(entry(body, 'plain').isRepo, false);
  assert.equal(entry(body, 'repo').path, join(base, 'repo'));
});

test('GET /api/fs/list marks a .git file as a repo (worktrees, submodules)', async () => {
  const base = await scratch();
  await mkdir(join(base, 'worktree'));
  await writeFile(join(base, 'worktree', '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');

  const { body } = await list({ path: base });

  assert.equal(entry(body, 'worktree').isRepo, true);
});

test('GET /api/fs/list skips dot-directories', async () => {
  const base = await scratch();
  await mkdir(join(base, '.hidden'));
  await mkdir(join(base, 'shown'));

  const { body } = await list({ path: base });

  assert.deepEqual(names(body), ['shown']);
});

test('GET /api/fs/list follows a symlink to a directory', async () => {
  const base = await scratch();
  const target = await scratch();
  await mkdir(join(target, '.git'));
  await symlink(target, join(base, 'linked-repo'));

  const { body } = await list({ path: base });

  assert.deepEqual(names(body), ['linked-repo']);
  assert.equal(entry(body, 'linked-repo').isRepo, true);
});

test('GET /api/fs/list sorts case-insensitively', async () => {
  const base = await scratch();
  for (const n of ['Zebra', 'apple', 'Mango']) await mkdir(join(base, n));

  const { body } = await list({ path: base });

  assert.deepEqual(names(body), ['apple', 'Mango', 'Zebra']);
});

test('GET /api/fs/list reports the parent directory', async () => {
  const base = await scratch();
  const { body } = await list({ path: base });
  assert.equal(body.parent, dirname(base));
});

test('GET /api/fs/list reports no parent at the filesystem root', async () => {
  const { body } = await list({ path: '/' });
  assert.equal(body.parent, null);
});

test('GET /api/fs/list defaults to the home directory', async () => {
  const { body } = await list({});
  assert.equal(body.path, homedir());
});

test('GET /api/fs/list rejects a path that does not exist', async () => {
  const res = await list({ path: '/definitely/not/here' });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.ok(res.body.error);
});

test('GET /api/fs/list rejects a path that is a file', async () => {
  const base = await scratch();
  const file = join(base, 'notes.txt');
  await writeFile(file, 'x');

  const res = await list({ path: file });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('GET /api/fs/list expands a leading ~ to the home directory', async () => {
  // The picker lets a path be typed, and only the server knows where home is.
  const res = await list({ path: '~' });

  assert.equal(res.status, 200);
  assert.equal(res.body.path, homedir());
});

test('GET /api/fs/list expands ~/ in front of a relative path', async () => {
  const res = await list({ path: '~/' });

  assert.equal(res.status, 200);
  assert.equal(res.body.path, homedir());
});

test('GET /api/fs/list leaves a ~ inside a path alone', async () => {
  // Only a leading ~ is a home reference; "~" is a legal directory name.
  const base = await scratch();
  await mkdir(join(base, 'has~tilde'));

  const { body } = await list({ path: join(base, 'has~tilde') });

  assert.equal(body.path, join(base, 'has~tilde'));
});
