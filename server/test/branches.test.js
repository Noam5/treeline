import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getBranches } from '../src/git/branches.js';
import { makeRepo, commitFile, run, cleanup } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

test('getBranches lists local branches and current', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  await run(dir, ['branch', 'feature/login']);
  const b = await getBranches(dir);
  assert.equal(b.current, 'main');
  assert.ok(b.local.includes('main'));
  assert.ok(b.local.includes('feature/login'));
});

test('getBranches ignores the detached-HEAD pseudo-entry', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'first');
  await commitFile(dir, 'a.txt', 'v2', 'second');
  const head = (await run(dir, ['rev-parse', 'HEAD~1'])).trim();
  await run(dir, ['checkout', head]); // detach HEAD
  const b = await getBranches(dir);
  assert.equal(b.current, null);
  assert.ok(b.local.includes('main'));
  assert.ok(!b.local.some((x) => x.startsWith('(')));
});

// A clone of a bare remote, on main, tracking origin/main.
async function tracked() {
  const bare = await mkdtemp(join(tmpdir(), 'gwc-bare-')); repos.push(bare);
  await run(bare, ['init', '--bare', '-b', 'main']);
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await run(dir, ['remote', 'add', 'origin', bare]);
  await run(dir, ['push', '-u', 'origin', 'main']);
  return { dir, bare };
}

test('getBranches reports no upstream for a branch that tracks nothing', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  assert.equal((await getBranches(dir)).upstream, null);
});

test('getBranches reports no upstream with HEAD detached', async () => {
  const { dir } = await tracked();
  await run(dir, ['checkout', '--detach']);
  assert.equal((await getBranches(dir)).upstream, null);
});

test('getBranches counts commits ahead of and behind the upstream', async () => {
  const { dir, bare } = await tracked();
  // Someone else pushes two commits; we make one of our own.
  const other = await mkdtemp(join(tmpdir(), 'gwc-other-')); repos.push(other);
  await run(other, ['clone', '-q', bare, '.']);
  await run(other, ['config', 'user.email', 'o@example.com']);
  await run(other, ['config', 'user.name', 'Other']);
  await commitFile(other, 'b.txt', '1', 'theirs 1');
  await commitFile(other, 'b.txt', '2', 'theirs 2');
  await run(other, ['push', '-q', 'origin', 'main']);
  await commitFile(dir, 'c.txt', 'x', 'ours');
  await run(dir, ['fetch', '-q', 'origin']);

  assert.deepEqual((await getBranches(dir)).upstream, { name: 'origin/main', ahead: 1, behind: 2 });
});
