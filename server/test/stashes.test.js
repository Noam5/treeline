import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listStashes } from '../src/git/stashes.js';
import { makeRepo, commitFile, run, cleanup } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

test('listStashes returns an entry per stash', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await writeFile(join(dir, 'a.txt'), 'v2');
  await run(dir, ['stash', 'push', '-m', 'my work']);
  const stashes = await listStashes(dir);
  assert.equal(stashes.length, 1);
  assert.equal(stashes[0].ref, 'stash@{0}');
  assert.match(stashes[0].message, /my work/);
});

test('listStashes is empty when there are no stashes', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  assert.deepEqual(await listStashes(dir), []);
});
