import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { searchCommits } from '../src/git/log.js';
import { makeRepo, commitFile, run, cleanup } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

async function sampleRepo() {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'hello world\n', 'add greeting');
  await writeFile(join(dir, 'a.txt'), 'hello world\nBANANA_TOKEN=1\n');
  await run(dir, ['add', 'a.txt']);
  await run(dir, ['-c', 'user.name=Dana', '-c', 'user.email=dana@x.com', 'commit', '-m', 'introduce banana token']);
  return dir;
}

test('search by description matches the commit message', async () => {
  const dir = await sampleRepo();
  const r = await searchCommits(dir, 'description', 'banana');
  assert.ok(r.some(c => c.subject === 'introduce banana token'));
  assert.ok(!r.some(c => c.subject === 'add greeting'));
});

test('search by author matches the author name', async () => {
  const dir = await sampleRepo();
  const r = await searchCommits(dir, 'author', 'Dana');
  assert.ok(r.some(c => c.subject === 'introduce banana token'));
});

test('search by code (pickaxe) finds the commit that added the line', async () => {
  const dir = await sampleRepo();
  const r = await searchCommits(dir, 'code', 'BANANA_TOKEN');
  assert.ok(r.some(c => c.subject === 'introduce banana token'));
});

test('search by commit id matches a hash prefix', async () => {
  const dir = await sampleRepo();
  const all = await searchCommits(dir, 'description', 'greeting');
  const prefix = all[0].hash.slice(0, 6);
  const r = await searchCommits(dir, 'commit', prefix);
  assert.ok(r.some(c => c.hash.startsWith(prefix)));
});

test('empty query returns no results', async () => {
  const dir = await sampleRepo();
  assert.deepEqual(await searchCommits(dir, 'description', '  '), []);
});
