import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommit, lastCommit } from '../src/git/commit.js';
import { makeRepo, commitFile, run, cleanup } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

test('createCommit commits staged changes', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await writeFile(join(dir, 'a.txt'), 'hi');
  await run(dir, ['add', 'a.txt']);
  const res = await createCommit(dir, 'my message');
  assert.equal(res.ok, true);
  const log = await run(dir, ['log', '--oneline']);
  assert.match(log, /my message/);
});

test('createCommit fails cleanly with nothing staged', async () => {
  const dir = await makeRepo(); repos.push(dir);
  const res = await createCommit(dir, 'empty');
  assert.equal(res.ok, false);
});

const count = async (dir) => Number((await run(dir, ['rev-list', '--count', 'HEAD'])).trim());

test('lastCommit gives the full message of HEAD, and that it is unpushed', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await writeFile(join(dir, 'a.txt'), 'hi');
  await run(dir, ['add', 'a.txt']);
  await run(dir, ['commit', '-q', '-m', 'Subject line', '-m', 'Body text.']);
  assert.deepEqual(await lastCommit(dir), { message: 'Subject line\n\nBody text.', pushed: null });
});

test('lastCommit is null before the first commit', async () => {
  const dir = await makeRepo(); repos.push(dir);
  assert.equal(await lastCommit(dir), null);
});

test('amending rewrites the last commit with the new message and the staged changes', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'first');
  await commitFile(dir, 'a.txt', 'v2', 'secnd');
  await writeFile(join(dir, 'b.txt'), 'forgotten');
  await run(dir, ['add', 'b.txt']);

  const res = await createCommit(dir, 'second', { amend: true });
  assert.equal(res.ok, true, res.stderr);
  assert.equal(await count(dir), 2);
  assert.equal((await run(dir, ['log', '-1', '--format=%s'])).trim(), 'second');
  assert.match(await run(dir, ['show', '--name-only', '--format=', 'HEAD']), /b\.txt/);
});

// A clone of a bare remote whose HEAD is already pushed to origin/main.
async function pushedRepo() {
  const bare = await mkdtemp(join(tmpdir(), 'gwc-bare-')); repos.push(bare);
  await run(bare, ['init', '--bare', '-b', 'main']);
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await run(dir, ['remote', 'add', 'origin', bare]);
  await run(dir, ['push', '-q', '-u', 'origin', 'main']);
  return dir;
}

test('lastCommit names the remote branch that already has HEAD', async () => {
  const dir = await pushedRepo();
  assert.equal((await lastCommit(dir)).pushed, 'origin/main');
});

test('amending a pushed commit is refused, and HEAD is left alone', async () => {
  const dir = await pushedRepo();
  const before = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  const res = await createCommit(dir, 'rewritten', { amend: true });
  assert.equal(res.ok, false);
  assert.match(res.stderr, /already been pushed to origin\/main/);
  assert.equal((await run(dir, ['rev-parse', 'HEAD'])).trim(), before);
});

test('a new commit on top of a pushed one can be amended', async () => {
  const dir = await pushedRepo();
  await commitFile(dir, 'a.txt', 'v2', 'local');
  assert.equal((await lastCommit(dir)).pushed, null);
  const res = await createCommit(dir, 'local, amended', { amend: true });
  assert.equal(res.ok, true, res.stderr);
});
