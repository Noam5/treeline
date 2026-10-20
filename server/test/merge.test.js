import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { getStatus } from '../src/git/status.js';
import { getDiff } from '../src/git/diff.js';
import { getMergeState, abortMerge, continueMerge, resolveConflict } from '../src/git/merge.js';
import { makeRepo, makeConflict, commitFile, run, cleanup } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });
const conflict = async () => { const d = await makeConflict(); repos.push(d); return d; };
const exists = (p) => access(p).then(() => true, () => false);
const parents = async (dir) => (await run(dir, ['rev-list', '--parents', '-n1', 'HEAD'])).trim().split(' ').length - 1;

test('getMergeState is null outside a merge', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x\n', 'init');
  assert.equal(await getMergeState(dir), null);
});

test('getMergeState reports the pending message without git\'s comment lines', async () => {
  const dir = await conflict();
  const m = await getMergeState(dir);
  assert.equal(m.message, "Merge branch 'feat'");
});

test('getStatus lists unmerged files as conflicted, and nowhere else', async () => {
  const dir = await conflict();
  const s = await getStatus(dir);
  assert.deepEqual(s.conflicted, [
    { path: 'both.txt', status: 'UU' },
    { path: 'gone.txt', status: 'DU' },
  ]);
  const paths = [...s.staged, ...s.unstaged].map((f) => f.path);
  assert.ok(!paths.includes('both.txt') && !paths.includes('gone.txt'));
});

test('getStatus has an empty conflicted list outside a merge', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x\n', 'init');
  assert.deepEqual((await getStatus(dir)).conflicted, []);
});

test('a conflicted file diffs against HEAD, showing the conflict markers', async () => {
  const dir = await conflict();
  const { patch } = await getDiff(dir, { path: 'both.txt' });
  assert.match(patch, /^diff --git a\/both\.txt b\/both\.txt$/m);
  assert.match(patch, /^\+<<<<<<< HEAD$/m);
  assert.match(patch, /^\+=======$/m);
  assert.match(patch, /^\+>>>>>>> feat$/m);
});

test('resolveConflict with ours keeps our side and stages it', async () => {
  const dir = await conflict();
  const r = await resolveConflict(dir, 'both.txt', 'ours');
  assert.equal(r.ok, true);
  assert.equal(await readFile(join(dir, 'both.txt'), 'utf8'), 'ours\n');
  const s = await getStatus(dir);
  assert.ok(!s.conflicted.some((f) => f.path === 'both.txt'));
});

test('resolveConflict with theirs keeps their side and stages it', async () => {
  const dir = await conflict();
  const r = await resolveConflict(dir, 'both.txt', 'theirs');
  assert.equal(r.ok, true);
  assert.equal(await readFile(join(dir, 'both.txt'), 'utf8'), 'theirs\n');
  assert.ok(!(await getStatus(dir)).conflicted.some((f) => f.path === 'both.txt'));
});

test('resolving to the side that deleted a file removes it', async () => {
  const dir = await conflict();
  const r = await resolveConflict(dir, 'gone.txt', 'ours');
  assert.equal(r.ok, true);
  assert.equal(await exists(join(dir, 'gone.txt')), false);
  const s = await getStatus(dir);
  assert.ok(!s.conflicted.some((f) => f.path === 'gone.txt'));
});

test('resolving to the side that kept a deleted file keeps it', async () => {
  const dir = await conflict();
  const r = await resolveConflict(dir, 'gone.txt', 'theirs');
  assert.equal(r.ok, true);
  assert.equal(await readFile(join(dir, 'gone.txt'), 'utf8'), 'theirs\n');
  assert.ok((await getStatus(dir)).staged.some((f) => f.path === 'gone.txt'));
});

test('resolveConflict rejects a side other than ours or theirs', async () => {
  const dir = await conflict();
  const r = await resolveConflict(dir, 'both.txt', '--force');
  assert.equal(r.ok, false);
});

test('resolveConflict treats a path that looks like an option as a path', async () => {
  const dir = await conflict();
  const r = await resolveConflict(dir, '--all', 'ours');
  assert.equal(r.ok, false);
  assert.equal((await getStatus(dir)).conflicted.length, 2);
});

test('abortMerge restores the pre-merge state', async () => {
  const dir = await conflict();
  const before = (await run(dir, ['rev-parse', 'ORIG_HEAD'])).trim();
  const r = await abortMerge(dir);
  assert.equal(r.ok, true);
  assert.equal(await getMergeState(dir), null);
  assert.equal((await run(dir, ['rev-parse', 'HEAD'])).trim(), before);
  assert.equal((await run(dir, ['status', '--porcelain'])).trim(), '');
});

test('continueMerge refuses while conflicts remain', async () => {
  const dir = await conflict();
  const r = await continueMerge(dir);
  assert.equal(r.ok, false);
  assert.notEqual(await getMergeState(dir), null);
});

test('continueMerge commits a two-parent merge with the merge message', async () => {
  const dir = await conflict();
  await resolveConflict(dir, 'both.txt', 'theirs');
  await resolveConflict(dir, 'gone.txt', 'ours');
  const r = await continueMerge(dir);
  assert.equal(r.ok, true, r.stderr);
  assert.equal(await getMergeState(dir), null);
  assert.equal(await parents(dir), 2);
  assert.equal((await run(dir, ['log', '-1', '--format=%B'])).trim(), "Merge branch 'feat'");
});

// --- Routes

test('GET /api/status carries the merge state alongside the file lists', async () => {
  const dir = await conflict();
  const res = await request(buildApp()).get('/api/status').query({ repo: dir });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.merge, { message: "Merge branch 'feat'" });
  assert.equal(res.body.conflicted.length, 2);
});

test('GET /api/status reports no merge outside one', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x\n', 'init');
  const res = await request(buildApp()).get('/api/status').query({ repo: dir });
  assert.equal(res.body.merge, null);
});

test('POST /api/merge/resolve resolves one file to a side', async () => {
  const dir = await conflict();
  const res = await request(buildApp()).post('/api/merge/resolve')
    .send({ repo: dir, path: 'both.txt', side: 'theirs' });
  assert.equal(res.status, 200);
  assert.equal(await readFile(join(dir, 'both.txt'), 'utf8'), 'theirs\n');
});

test('POST /api/merge/resolve requires a path and a known side', async () => {
  const dir = await conflict();
  const app = buildApp();
  let res = await request(app).post('/api/merge/resolve').send({ repo: dir, side: 'ours' });
  assert.equal(res.status, 400);
  res = await request(app).post('/api/merge/resolve').send({ repo: dir, path: 'both.txt', side: 'mine' });
  assert.equal(res.status, 400);
});

test('POST /api/merge/abort aborts the merge', async () => {
  const dir = await conflict();
  const res = await request(buildApp()).post('/api/merge/abort').send({ repo: dir });
  assert.equal(res.status, 200);
  assert.equal(await getMergeState(dir), null);
});

test('POST /api/merge/continue commits once everything is resolved', async () => {
  const dir = await conflict();
  const app = buildApp();
  let res = await request(app).post('/api/merge/continue').send({ repo: dir });
  assert.equal(res.status, 500);
  assert.equal(res.body.ok, false);
  await resolveConflict(dir, 'both.txt', 'ours');
  // "Mark resolved" is an ordinary stage, after an edit made outside the app.
  await writeFile(join(dir, 'gone.txt'), 'edited by hand\n');
  await request(app).post('/api/stage').send({ repo: dir, paths: ['gone.txt'] });
  res = await request(app).post('/api/merge/continue').send({ repo: dir });
  assert.equal(res.status, 200);
  assert.equal(await parents(dir), 2);
});

test('GET /api/log counts a conflicted tree as uncommitted changes', async () => {
  const dir = await conflict();
  const res = await request(buildApp()).get('/api/log').query({ repo: dir });
  assert.equal(res.body.commits[0].hash, 'WORKING');
});

test('POST /api/merge that stops on conflicts says so, not just that it failed', async () => {
  const dir = await conflict();
  await abortMerge(dir);
  const res = await request(buildApp()).post('/api/merge').send({ repo: dir, branch: 'feat' });
  assert.equal(res.body.ok, false);
  // git prints its conflict report on stdout, leaving stderr empty.
  assert.match(res.body.error, /CONFLICT \(content\): Merge conflict in both\.txt/);
});

// A conflicted file's name is a name, not a pattern: "*.txt" must not drag
// every other conflicted .txt file along with it.
test('resolveConflict takes a name with glob characters literally', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, '*.txt', 'base\n', 'init');
  await commitFile(dir, 'plain.txt', 'base\n', 'second');
  await run(dir, ['checkout', '-b', 'feat']);
  await writeFile(join(dir, '*.txt'), 'theirs\n');
  await writeFile(join(dir, 'plain.txt'), 'theirs\n');
  await run(dir, ['commit', '-am', 'theirs']);
  await run(dir, ['checkout', 'main']);
  await writeFile(join(dir, '*.txt'), 'ours\n');
  await writeFile(join(dir, 'plain.txt'), 'ours\n');
  await run(dir, ['commit', '-am', 'ours']);
  await run(dir, ['merge', 'feat']).catch(() => {}); // conflicts, exits non-zero

  const r = await resolveConflict(dir, '*.txt', 'ours');
  assert.equal(r.ok, true);
  const s = await getStatus(dir);
  assert.deepEqual(s.conflicted, [{ path: 'plain.txt', status: 'UU' }]);
  assert.match(await readFile(join(dir, 'plain.txt'), 'utf8'), /^<<<<<<< /);
});
