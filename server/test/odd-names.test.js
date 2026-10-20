import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { makeRepo, commitFile, run, cleanup } from './helpers/repo.js';

// File names that git C-quotes in its plain output, that read like its own
// "old -> new" rename form, or that are glob patterns as a pathspec. Every
// path here goes through the API the way the UI sends it: taken verbatim from
// /api/status and handed back to the other endpoints.
const ODD = ['with space.txt', 'say "hi".txt', 'café.txt', 'a -> b.txt', '[ab].txt'];

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

const app = buildApp();
const status = async (dir) => (await request(app).get('/api/status').query({ repo: dir })).body;
const diff = async (dir, q) => (await request(app).get('/api/diff').query({ repo: dir, ...q })).body.patch;
const post = (url, body) => request(app).post(url).send(body);

async function repoWithOddFiles() {
  const dir = await makeRepo(); repos.push(dir);
  for (const name of [...ODD, 'a.txt', 'b.txt']) await writeFile(join(dir, name), 'one\n');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-m', 'init']);
  return dir;
}

for (const name of ODD) {
  test(`a modified "${name}" can be diffed, staged and unstaged`, async () => {
    const dir = await repoWithOddFiles();
    await writeFile(join(dir, name), 'one\ntwo\n');
    await writeFile(join(dir, 'a.txt'), 'bystander\n');

    const file = (await status(dir)).unstaged.find((f) => f.path !== 'a.txt');
    assert.equal(file.path, name);
    assert.match(await diff(dir, { path: file.path }), /^\+two$/m);

    assert.equal((await post('/api/stage', { repo: dir, paths: [file.path] })).body.ok, true);
    let s = await status(dir);
    // Only this file: "[ab].txt" as a glob would also have taken a.txt and b.txt.
    assert.deepEqual(s.staged, [{ path: name, status: 'M' }]);
    assert.deepEqual(s.unstaged, [{ path: 'a.txt', status: 'M' }]);
    assert.match(await diff(dir, { path: name, staged: 'true' }), /^\+two$/m);

    assert.equal((await post('/api/unstage', { repo: dir, paths: [name] })).body.ok, true);
    s = await status(dir);
    assert.deepEqual(s.staged, []);
    assert.deepEqual(s.unstaged.map((f) => f.path).sort(), ['a.txt', name].sort());
  });

  test(`a hunk of "${name}" can be staged from the diff the API returned`, async () => {
    const dir = await repoWithOddFiles();
    await writeFile(join(dir, name), 'one\ntwo\n');
    const patch = await diff(dir, { path: name });

    const res = await post('/api/hunk', { repo: dir, patch, cached: true });

    assert.equal(res.body.ok, true, res.body.error);
    assert.deepEqual((await status(dir)).staged, [{ path: name, status: 'M' }]);
  });

  test(`changes to "${name}" can be discarded`, async () => {
    const dir = await repoWithOddFiles();
    await writeFile(join(dir, name), 'changed\n');
    await writeFile(join(dir, 'a.txt'), 'changed\n');

    const res = await post('/api/discard-file', { repo: dir, path: name });

    assert.equal(res.body.ok, true, res.body.error);
    assert.equal(await readFile(join(dir, name), 'utf8'), 'one\n');
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'changed\n');
  });

  test(`an untracked "${name}" can be diffed and deleted`, async () => {
    const dir = await makeRepo(); repos.push(dir);
    await commitFile(dir, 'seed.txt', 'x', 'init');
    await writeFile(join(dir, name), 'brand new\n');
    await writeFile(join(dir, 'a.txt'), 'keep me\n');

    const s = await status(dir);
    assert.ok(s.untracked.includes(name));
    assert.match(await diff(dir, { path: name }), /^\+brand new$/m);

    const res = await post('/api/delete-file', { repo: dir, path: name });
    assert.equal(res.body.ok, true, res.body.error);
    await assert.rejects(access(join(dir, name)));
    await access(join(dir, 'a.txt'));
  });
}

test('a staged rename between odd names diffs and unstages through both paths', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'café old.txt', 'content\n', 'init');
  await run(dir, ['mv', 'café old.txt', 'x -> y.txt']);

  const [file] = (await status(dir)).staged;
  assert.deepEqual(file, { path: 'x -> y.txt', origPath: 'café old.txt', status: 'R' });

  const patch = await diff(dir, { path: file.path, origPath: file.origPath, staged: 'true' });
  assert.match(patch, /^rename from /m);
  assert.match(patch, /^rename to /m);

  const res = await post('/api/unstage', { repo: dir, paths: [file.path, file.origPath] });
  assert.equal(res.body.ok, true, res.body.error);
  const s = await status(dir);
  assert.deepEqual(s.staged, []);
  assert.deepEqual(s.unstaged, [{ path: 'café old.txt', status: 'D' }]);
  assert.deepEqual(s.untracked, ['x -> y.txt']);
});
