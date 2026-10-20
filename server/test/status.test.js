import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getStatus } from '../src/git/status.js';
import { makeRepo, commitFile, run, cleanup } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

test('getStatus separates staged, unstaged, untracked', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'tracked.txt', 'v1', 'init');
  await writeFile(join(dir, 'tracked.txt'), 'v2');        // unstaged modify
  await writeFile(join(dir, 'staged.txt'), 'new');
  await run(dir, ['add', 'staged.txt']);                  // staged add
  await writeFile(join(dir, 'fresh.txt'), 'x');           // untracked

  const s = await getStatus(dir);
  assert.ok(s.staged.some(f => f.path === 'staged.txt' && f.status === 'A'));
  assert.ok(s.unstaged.some(f => f.path === 'tracked.txt' && f.status === 'M'));
  assert.deepEqual(s.untracked, ['fresh.txt']);
});

// Names git would C-quote, or that look like its own "old -> new" rename form.
const ODD = ['with space.txt', 'say "hi".txt', 'café.txt', 'a -> b.txt'];

test('getStatus reports odd file names as they are on disk', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'seed.txt', 'x', 'init');
  for (const name of ODD) await writeFile(join(dir, name), 'x');
  const s = await getStatus(dir);
  assert.deepEqual([...s.untracked].sort(), [...ODD].sort());

  await run(dir, ['add', '--', ...ODD]);
  const staged = await getStatus(dir);
  assert.deepEqual(staged.staged.map(f => f.path).sort(), [...ODD].sort());
  assert.ok(staged.staged.every(f => f.status === 'A' && !('origPath' in f)));
});

test('getStatus reports a staged rename as path plus origPath', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'café old.txt', 'content\n', 'init');
  await run(dir, ['mv', 'café old.txt', 'x -> y.txt']);
  const s = await getStatus(dir);
  assert.deepEqual(s.staged, [{ path: 'x -> y.txt', origPath: 'café old.txt', status: 'R' }]);
  assert.deepEqual(s.unstaged, []);
});

test('getStatus keeps the rename on the staged side when the new file is also edited', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'old.txt', 'content\n', 'init');
  await run(dir, ['mv', 'old.txt', 'new.txt']);
  await writeFile(join(dir, 'new.txt'), 'content\nmore\n');
  const s = await getStatus(dir);
  assert.deepEqual(s.staged, [{ path: 'new.txt', origPath: 'old.txt', status: 'R' }]);
  assert.deepEqual(s.unstaged, [{ path: 'new.txt', status: 'M' }]);
});

// Unmerged paths have their own list (the merge-conflict view); the name
// has a space in it so the -z parsing of "u" records is covered too.
test('getStatus lists an unmerged file as conflicted, on neither side', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'clash me.txt', 'base\n', 'init');
  await run(dir, ['checkout', '-b', 'other']);
  await commitFile(dir, 'clash me.txt', 'theirs\n', 'theirs');
  await run(dir, ['checkout', 'main']);
  await commitFile(dir, 'clash me.txt', 'ours\n', 'ours');
  await run(dir, ['merge', 'other']).catch(() => {}); // conflicts, exits non-zero
  const s = await getStatus(dir);
  assert.deepEqual(s.conflicted, [{ path: 'clash me.txt', status: 'UU' }]);
  assert.deepEqual(s.staged, []);
  assert.deepEqual(s.unstaged, []);
});
