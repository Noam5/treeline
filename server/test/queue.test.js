import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { runExclusive } from '../src/api/queue.js';
import { makeRepo, commitFile, cleanup } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('runExclusive runs jobs on the same key one at a time, in order', async () => {
  const events = [];
  const job = (name) => async () => { events.push(`${name} start`); await tick(30); events.push(`${name} end`); };
  await Promise.all([runExclusive('k', job('a')), runExclusive('k', job('b'))]);
  assert.deepEqual(events, ['a start', 'a end', 'b start', 'b end']);
});

test('runExclusive runs jobs on different keys side by side', async () => {
  const events = [];
  const job = (name) => async () => { events.push(`${name} start`); await tick(30); events.push(`${name} end`); };
  await Promise.all([runExclusive('x', job('a')), runExclusive('y', job('b'))]);
  assert.deepEqual(events.slice(0, 2).sort(), ['a start', 'b start']);
});

test('a failed job does not block the next one on its key', async () => {
  const failed = runExclusive('f', async () => { throw new Error('boom'); });
  const next = runExclusive('f', async () => 'ran');
  await assert.rejects(failed, /boom/);
  assert.equal(await next, 'ran');
});

// A repository whose commits take a while: its pre-commit hook sleeps.
async function slowCommitRepo() {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  const hook = join(dir, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nsleep 1\n');
  await chmod(hook, 0o755);
  await writeFile(join(dir, 'a.txt'), 'v2');
  await request(buildApp()).post('/api/stage').send({ repo: dir, paths: ['a.txt'] });
  return dir;
}

// Resolves with the time each request finished, to compare orderings.
const timed = (req) => req.then((res) => ({ res, at: Date.now() }));

test('a second change to the same repo waits for the first to finish', async () => {
  const dir = await slowCommitRepo();
  await writeFile(join(dir, 'b.txt'), 'new');
  const app = buildApp();
  const commit = timed(request(app).post('/api/commit').send({ repo: dir, message: 'slow' }));
  await tick(100); // let the commit get going
  const stage = timed(request(app).post('/api/stage').send({ repo: dir, paths: ['b.txt'] }));
  const [c, s] = await Promise.all([commit, stage]);
  assert.equal(c.res.body.ok, true);
  assert.equal(s.res.body.ok, true, s.res.body.error);
  assert.ok(s.at >= c.at, 'the stage ran after the commit, not alongside it');
});

test('reads are not held up behind a change in progress', async () => {
  const dir = await slowCommitRepo();
  const app = buildApp();
  const commit = timed(request(app).post('/api/commit').send({ repo: dir, message: 'slow' }));
  await tick(100);
  const read = timed(request(app).get('/api/branches').query({ repo: dir }));
  const [c, r] = await Promise.all([commit, read]);
  assert.equal(r.res.status, 200);
  assert.ok(r.at < c.at, 'the read answered while the commit was still running');
});

test('a change to another repo is not held up either', async () => {
  const slow = await slowCommitRepo();
  const other = await makeRepo(); repos.push(other);
  await commitFile(other, 'a.txt', 'v1', 'init');
  await writeFile(join(other, 'b.txt'), 'new');
  const app = buildApp();
  const commit = timed(request(app).post('/api/commit').send({ repo: slow, message: 'slow' }));
  await tick(100);
  const stage = timed(request(app).post('/api/stage').send({ repo: other, paths: ['b.txt'] }));
  const [c, s] = await Promise.all([commit, stage]);
  assert.equal(s.res.body.ok, true);
  assert.ok(s.at < c.at);
});
