import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDiff } from '../src/git/diff.js';
import { makeRepo, commitFile, cleanup, run } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

test('getDiff returns working-tree patch for a modified file', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'line1\n', 'init');
  await writeFile(join(dir, 'a.txt'), 'line1\nline2\n');
  const { patch } = await getDiff(dir, { path: 'a.txt' });
  assert.match(patch, /\+line2/);
});

test('getDiff returns commit patch via commit option', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'hello\n', 'add a');
  const { patch } = await getDiff(dir, { commit: 'HEAD' });
  assert.match(patch, /\+hello/);
});

test('getDiff returns all-additions patch for an untracked file', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'existing.txt', 'existing\n', 'init');
  await writeFile(join(dir, 'untracked.txt'), 'hello from new file\n');
  const { patch } = await getDiff(dir, { path: 'untracked.txt' });
  assert.match(patch, /\+hello from new file/);
});

test('getDiff returns a stash patch via the stash option', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'line1\n', 'init');
  await writeFile(join(dir, 'a.txt'), 'line1\nstashed\n');
  await run(dir, ['stash', 'push']);
  const { patch } = await getDiff(dir, { stash: 'stash@{0}' });
  assert.match(patch, /^diff --git/m);
  assert.match(patch, /\+stashed/);
});

test('getDiff returns the rename patch for a staged rename', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'old.txt', 'content\n', 'init');
  await run(dir, ['mv', 'old.txt', 'new.txt']);
  // status reports a staged rename as the new path plus the original one.
  const { patch } = await getDiff(dir, { path: 'new.txt', origPath: 'old.txt', staged: true });
  assert.match(patch, /rename from old\.txt/);
  assert.match(patch, /rename to new\.txt/);
});

test('getDiff takes a path containing " -> " as one file name', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a -> b.txt', 'line1\n', 'init');
  await commitFile(dir, 'b.txt', 'other\n', 'second');
  await writeFile(join(dir, 'a -> b.txt'), 'line1\nline2\n');
  await writeFile(join(dir, 'b.txt'), 'other\nchanged\n');
  const { patch } = await getDiff(dir, { path: 'a -> b.txt' });
  assert.match(patch, /\+line2/);
  assert.doesNotMatch(patch, /\+changed/);
});
