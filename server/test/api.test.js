import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { makeRepo, commitFile, run, cleanup, makeBigHistory } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

test('POST /api/repo/open accepts a valid git repo', async () => {
  const dir = await makeRepo(); repos.push(dir);
  const res = await request(buildApp()).post('/api/repo/open').send({ path: dir });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.path, dir);
});

test('POST /api/repo/open rejects a non-repo path', async () => {
  const res = await request(buildApp()).post('/api/repo/open').send({ path: '/definitely/not/here' });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('GET /api/status reflects the working tree', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  const app = buildApp();
  const res = await request(app).get('/api/status').query({ repo: dir });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.staged));
});

test('stage then unstage moves a file in and out of the index', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await writeFile(join(dir, 'b.txt'), 'new');
  const app = buildApp();

  await request(app).post('/api/stage').send({ repo: dir, paths: ['b.txt'] });
  let s = (await request(app).get('/api/status').query({ repo: dir })).body;
  assert.ok(s.staged.some(f => f.path === 'b.txt'));

  await request(app).post('/api/unstage').send({ repo: dir, paths: ['b.txt'] });
  s = (await request(app).get('/api/status').query({ repo: dir })).body;
  assert.ok(!s.staged.some(f => f.path === 'b.txt'));
});

test('GET /api/log prepends an Uncommitted changes node when dirty', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await writeFile(join(dir, 'a.txt'), 'v2'); // make the tree dirty
  const app = buildApp();
  const res = await request(app).get('/api/log').query({ repo: dir });
  assert.equal(res.status, 200);
  const top = res.body.commits[0];
  assert.equal(top.working, true);
  assert.equal(top.subject, 'Uncommitted changes');
  assert.ok(top.connectors.length >= 1); // connected to HEAD
});

test('GET /api/log has no working node when clean', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  const app = buildApp();
  const res = await request(app).get('/api/log').query({ repo: dir });
  assert.ok(!res.body.commits.some((c) => c.working));
});

test('POST /api/branch/delete removes a branch', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'init');
  await run(dir, ['branch', 'feature']);
  const app = buildApp();
  const res = await request(app).post('/api/branch/delete').send({ repo: dir, name: 'feature', force: false });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('POST /api/branch/delete requires a name', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'init');
  const app = buildApp();
  const res = await request(app).post('/api/branch/delete').send({ repo: dir, force: false });
  assert.equal(res.status, 400);
});

test('POST /api/branch/rename renames a branch', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'init');
  await run(dir, ['branch', 'old']);
  const app = buildApp();
  const res = await request(app).post('/api/branch/rename').send({ repo: dir, from: 'old', to: 'fresh' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('POST /api/branch/rename requires both names', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'init');
  const app = buildApp();
  const res = await request(app).post('/api/branch/rename').send({ repo: dir, from: 'old' });
  assert.equal(res.status, 400);
});

test('POST /api/branch creates a branch at a given ref', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'first');
  const first = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  await commitFile(dir, 'a.txt', 'a\nb\n', 'second');
  const app = buildApp();
  const res = await request(app).post('/api/branch').send({ repo: dir, name: 'fromfirst', ref: first });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal((await run(dir, ['rev-parse', 'fromfirst'])).trim(), first);
});

test('POST /api/branch still creates at HEAD without a ref', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'init');
  const head = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  const app = buildApp();
  const res = await request(app).post('/api/branch').send({ repo: dir, name: 'athead' });
  assert.equal(res.status, 200);
  assert.equal((await run(dir, ['rev-parse', 'athead'])).trim(), head);
});

test('POST /api/tag tags a given ref', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'first');
  const first = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  await commitFile(dir, 'a.txt', 'a\nb\n', 'second');
  const app = buildApp();
  const res = await request(app).post('/api/tag').send({ repo: dir, name: 'v0', ref: first });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal((await run(dir, ['rev-list', '-n1', 'v0'])).trim(), first);
});

test('POST /api/branch requires a name', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'init');
  const app = buildApp();
  const res = await request(app).post('/api/branch').send({ repo: dir, ref: 'HEAD' });
  assert.equal(res.status, 400);
});

test('POST /api/stash/pop applies and removes a stash', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await writeFile(join(dir, 'a.txt'), 'v2');
  await run(dir, ['stash', 'push']);
  const app = buildApp();
  const res = await request(app).post('/api/stash/pop').send({ repo: dir }).send({ ref: 'stash@{0}' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal((await run(dir, ['stash', 'list'])).trim(), '');
});

test('POST /api/stash/drop removes a stash', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await writeFile(join(dir, 'a.txt'), 'v2');
  await run(dir, ['stash', 'push']);
  const app = buildApp();
  const res = await request(app).post('/api/stash/drop').send({ repo: dir }).send({ ref: 'stash@{0}' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal((await run(dir, ['stash', 'list'])).trim(), '');
});

test('GET /api/diff?stash returns the stash patch', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'line1\n', 'init');
  await writeFile(join(dir, 'a.txt'), 'line1\nstashed\n');
  await run(dir, ['stash', 'push']);
  const app = buildApp();
  const res = await request(app).get('/api/diff').query({ repo: dir }).query({ stash: 'stash@{0}' });
  assert.equal(res.status, 200);
  assert.match(res.body.patch, /\+stashed/);
});

test('POST /api/hunk stages only the patch it is given', async () => {
  const dir = await makeRepo(); repos.push(dir);
  const ten = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n') + '\n';
  await commitFile(dir, 'a.txt', ten, 'init');
  await writeFile(join(dir, 'a.txt'), ten.replace('l1\n', 'L1\n').replace('l10\n', 'L10\n'));
  const full = (await run(dir, ['diff', '--', 'a.txt'])).split('\n');
  const second = full.findIndex((l, i) => l.startsWith('@@') && full.slice(0, i).some((p) => p.startsWith('@@')));
  const patch = full.slice(0, second).join('\n') + '\n';

  const res = await request(buildApp()).post('/api/hunk').send({ repo: dir, patch, cached: true });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const staged = await run(dir, ['diff', '--cached']);
  assert.match(staged, /^\+L1$/m);
  assert.doesNotMatch(staged, /^\+L10$/m);
});

test('POST /api/hunk reports a patch that does not apply', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1\n', 'init');
  const patch = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-nope\n+yes\n';

  const res = await request(buildApp()).post('/api/hunk').send({ repo: dir, patch, cached: true });

  assert.equal(res.status, 500);
  assert.equal(res.body.ok, false);
  assert.ok(res.body.error.length > 0);
});

test('POST /api/hunk requires a patch', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1\n', 'init');

  const res = await request(buildApp()).post('/api/hunk').send({ repo: dir });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('POST /api/hunk accepts a hunk larger than express\'s default body limit', async () => {
  const dir = await makeRepo(); repos.push(dir);
  // One very long line, as in a committed minified bundle: its hunk is twice
  // the line's length, well past the 100kb express allows by default.
  const long = 'x'.repeat(120 * 1024);
  await commitFile(dir, 'bundle.js', long + '\n', 'init');
  await writeFile(join(dir, 'bundle.js'), long + 'y\n');
  const patch = await run(dir, ['diff', '--', 'bundle.js']);
  assert.ok(patch.length > 200 * 1024);

  const res = await request(buildApp()).post('/api/hunk').send({ repo: dir, patch, cached: true });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.match(await run(dir, ['diff', '--cached', '--stat']), /bundle\.js/);
});

test('GET /api/tags lists the repository tags', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  await run(dir, ['tag', 'v1.0']);
  const res = await request(buildApp()).get('/api/tags').query({ repo: dir });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.tags, ['v1.0']);
});

test('POST /api/tag/delete removes the tag', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  await run(dir, ['tag', 'v1.0']);
  const res = await request(buildApp()).post('/api/tag/delete').send({ repo: dir, name: 'v1.0' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal((await run(dir, ['tag', '--list'])).trim(), '');
});

test('POST /api/tag/delete requires a name', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  const res = await request(buildApp()).post('/api/tag/delete').send({ repo: dir });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('POST /api/checkout accepts a tag, leaving HEAD detached', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'first');
  const first = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  await run(dir, ['tag', 'v1.0', first]);
  await commitFile(dir, 'a.txt', 'a\nb\n', 'second');
  const res = await request(buildApp()).post('/api/checkout').send({ repo: dir, branch: 'v1.0' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal((await run(dir, ['rev-parse', 'HEAD'])).trim(), first);
  assert.equal((await run(dir, ['branch', '--show-current'])).trim(), '');
});

test('GET /api/log returns at most `limit` commits and says when there are more', async () => {
  const dir = await makeRepo(); repos.push(dir);
  for (let i = 1; i <= 4; i++) await commitFile(dir, 'a.txt', String(i), `c${i}`);
  const app = buildApp();
  const some = (await request(app).get('/api/log').query({ repo: dir, limit: 3 })).body;
  assert.equal(some.commits.length, 3);
  assert.equal(some.hasMore, true);
  const all = (await request(app).get('/api/log').query({ repo: dir, limit: 4 })).body;
  assert.equal(all.commits.length, 4);
  assert.equal(all.hasMore, false);
});

// Other branches can move on far past the checked-out commit; the graph opens
// scrolled to HEAD, so the page must reach it however far down it sits.
test('GET /api/log extends the page to include HEAD', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', '0', 'old head');
  await run(dir, ['branch', 'old']);
  for (let i = 1; i <= 6; i++) await commitFile(dir, 'a.txt', String(i), `newer ${i}`);
  await run(dir, ['checkout', 'old']);
  const res = await request(buildApp()).get('/api/log').query({ repo: dir, limit: 2 });
  assert.ok(res.body.commits.some((c) => c.subject === 'old head'));
});

// A ref picked in the sidebar may sit far below the first page; naming it as
// `include` extends the page down to its commit, the same way as for HEAD.
async function repoWithOldTag() {
  const dir = await makeRepo(); repos.push(dir);
  for (let i = 1; i <= 4; i++) await commitFile(dir, 'a.txt', `o${i}`, `older ${i}`);
  await commitFile(dir, 'a.txt', 't', 'tagged');
  await run(dir, ['tag', 'light']);
  await run(dir, ['tag', '-a', 'annotated', '-m', 'an annotated tag']);
  for (let i = 1; i <= 6; i++) await commitFile(dir, 'a.txt', String(i), `newer ${i}`);
  return dir;
}

test('GET /api/log extends the page to include a named ref', async () => {
  const dir = await repoWithOldTag();
  const res = await request(buildApp()).get('/api/log')
    .query({ repo: dir, limit: 2, include: 'refs/tags/light' });
  assert.equal(res.status, 200);
  assert.ok(res.body.commits.some((c) => c.subject === 'tagged'));
});

test('GET /api/log follows an annotated tag to its commit', async () => {
  const dir = await repoWithOldTag();
  const res = await request(buildApp()).get('/api/log')
    .query({ repo: dir, limit: 2, include: 'refs/tags/annotated' });
  assert.ok(res.body.commits.some((c) => c.subject === 'tagged'));
});

test('GET /api/log rejects an include that names no commit', async () => {
  const dir = await repoWithOldTag();
  const res = await request(buildApp()).get('/api/log')
    .query({ repo: dir, limit: 2, include: 'refs/tags/nope' });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

// The formatted log of a deep history is bigger than git output may be
// buffered; a tag on its root commit must still be reachable, and a page
// short of the root must still say there is more.
test('GET /api/log reaches a tag on the root of a history bigger than the output cap', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await makeBigHistory(dir, { count: 30, subjectBytes: 2 * 1024 * 1024 }); // ~60 MB of log
  const app = buildApp();
  const first = (await request(app).get('/api/log').query({ repo: dir, limit: 5 })).body;
  assert.equal(first.commits.length, 5);
  assert.equal(first.hasMore, true);
  const res = await request(app).get('/api/log').query({ repo: dir, limit: 5, include: 'refs/tags/root' });
  assert.equal(res.status, 200);
  assert.equal(res.body.commits.length, 30);
  assert.ok(res.body.commits.at(-1).refs.includes('tag: root'));
  assert.equal(res.body.hasMore, false);
});

// Whatever git printed before it failed is not the history; a page of it
// would claim the history ends there (hasMore false).
test('GET /api/log reports a git log that fails instead of serving what it read', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', '1', 'root');
  const root = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  await commitFile(dir, 'a.txt', '2', 'second');
  await rm(join(dir, '.git', 'objects', root.slice(0, 2), root.slice(2)));
  const res = await request(buildApp()).get('/api/log').query({ repo: dir });
  assert.equal(res.status, 500);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /git log/);
  assert.equal(res.body.commits, undefined);
});

// Doubling would overshoot by up to the whole page again — on a big history
// that is tens of thousands of commits nobody asked for. The page runs one
// page past the furthest commit it has to reach, so that commit is not the
// last row (which would ask for more history the moment it is shown).
test('GET /api/log extends the page one page past the named ref', async () => {
  const dir = await repoWithOldTag();
  const res = await request(buildApp()).get('/api/log')
    .query({ repo: dir, limit: 2, include: 'refs/tags/light' });
  const at = res.body.commits.findIndex((c) => c.subject === 'tagged');
  assert.notEqual(at, -1);
  assert.equal(res.body.commits.length, at + 1 + 2);
  assert.equal(res.body.hasMore, true);
});

// "Stage all" sends every listed path at once; with enough of them the list
// is longer than an exec argument list can be.
test('stage and unstage take a path list too long for the command line', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  const paths = Array.from({ length: 12000 }, (_, i) => `${String(i).padStart(5, '0')}-${'x'.repeat(200)}.txt`);
  for (let i = 0; i < paths.length; i += 500) {
    await Promise.all(paths.slice(i, i + 500).map((p) => writeFile(join(dir, p), '')));
  }
  const app = buildApp();

  const staged = await request(app).post('/api/stage').send({ repo: dir, paths });
  assert.equal(staged.status, 200, staged.body.error);
  // Counted by git: the names themselves overflow the helper's exec buffer.
  const count = async () => Number((await run(dir, ['diff', '--cached', '--shortstat'])).match(/(\d+) files? changed/)?.[1] ?? 0);
  assert.equal(await count(), 12000);

  const unstaged = await request(app).post('/api/unstage').send({ repo: dir, paths });
  assert.equal(unstaged.status, 200, unstaged.body.error);
  assert.equal(await count(), 0);
});

test('GET /api/commit/last returns the message to amend', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'the last one');
  const res = await request(buildApp()).get('/api/commit/last').query({ repo: dir });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, message: 'the last one', pushed: null });
});

test('GET /api/commit/last says when there is nothing to amend', async () => {
  const dir = await makeRepo(); repos.push(dir);
  const res = await request(buildApp()).get('/api/commit/last').query({ repo: dir });
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /no commits/i);
});

test('POST /api/commit with amend replaces the last commit', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await commitFile(dir, 'a.txt', 'v2', 'tpyo');
  const res = await request(buildApp()).post('/api/commit').send({ repo: dir, message: 'typo', amend: true });
  assert.equal(res.status, 200, res.body.error);
  assert.equal((await run(dir, ['log', '--format=%s'])).trim(), 'typo\ninit');
});
