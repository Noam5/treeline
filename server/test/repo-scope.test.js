import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { makeRepo, commitFile, cleanup } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

async function repo(file, subject) {
  const dir = await makeRepo();
  repos.push(dir);
  await commitFile(dir, file, 'v1', subject);
  return dir;
}

test('serves two repositories side by side, with no shared cursor', async () => {
  const a = await repo('a.txt', 'alpha commit');
  const b = await repo('b.txt', 'beta commit');
  const app = buildApp();

  // Interleaved deliberately: with a single server-side repoPath, whichever
  // request set it last would decide what all three of these returned.
  const [logA, logB, logAgain] = await Promise.all([
    request(app).get('/api/log').query({ repo: a }),
    request(app).get('/api/log').query({ repo: b }),
    request(app).get('/api/log').query({ repo: a }),
  ]);

  assert.equal(logA.body.commits.at(-1).subject, 'alpha commit');
  assert.equal(logB.body.commits.at(-1).subject, 'beta commit');
  assert.equal(logAgain.body.commits.at(-1).subject, 'alpha commit');
});

test('a write in one repository leaves the other untouched', async () => {
  const a = await repo('a.txt', 'init a');
  const b = await repo('b.txt', 'init b');
  const app = buildApp();

  await writeFile(join(a, 'new.txt'), 'x');
  const staged = await request(app).post('/api/stage').send({ repo: a, paths: ['new.txt'] });
  assert.equal(staged.status, 200);

  const [sa, sb] = await Promise.all([
    request(app).get('/api/status').query({ repo: a }),
    request(app).get('/api/status').query({ repo: b }),
  ]);
  assert.deepEqual(sa.body.staged.map((f) => f.path), ['new.txt']);
  assert.deepEqual(sb.body.staged, []);
  assert.deepEqual(sb.body.untracked, []);
});

test('a GET without a repo is rejected', async () => {
  const res = await request(buildApp()).get('/api/status');
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /required/i);
});

test('a POST without a repo is rejected', async () => {
  const res = await request(buildApp()).post('/api/stage').send({ paths: ['x'] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /required/i);
});

test('a path that is not a repository is rejected', async () => {
  const app = buildApp();
  const get = await request(app).get('/api/status').query({ repo: '/definitely/not/here' });
  const post = await request(app).post('/api/stage').send({ repo: '/definitely/not/here', paths: [] });

  assert.equal(get.status, 400);
  assert.match(get.body.error, /not a git repository/i);
  assert.equal(post.status, 400);
});

test('POST /api/repo/open validates a path without steering later requests', async () => {
  const a = await repo('a.txt', 'alpha commit');
  const app = buildApp();

  const opened = await request(app).post('/api/repo/open').send({ path: a });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.ok, true);
  assert.equal(opened.body.path, a);

  // Opening must not make `a` an implicit default for anything afterwards.
  const after = await request(app).get('/api/status');
  assert.equal(after.status, 400);
});
