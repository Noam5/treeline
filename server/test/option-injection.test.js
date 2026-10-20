import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import * as ops from '../src/git/ops.js';
import { fetch as gitFetch, pull, push } from '../src/git/remotes.js';
import { getDiff } from '../src/git/diff.js';
import { makeRepo, commitFile, run, cleanup } from './helpers/repo.js';

// Branch, tag, ref, stash and remote names arrive from the client and are
// passed to git as arguments. Whatever they contain, git must take them as
// names — never as options.

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

async function repoWithStash() {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await writeFile(join(dir, 'a.txt'), 'v2');
  await run(dir, ['stash']);
  return dir;
}

const exists = (p) => access(p).then(() => true, () => false);

// git's own words when it parses an argument as an option it does not know.
const PARSED_AS_OPTION = /unknown option|unrecognized argument/;
const BOGUS = '--bogus-option';

const calls = {
  checkout: (d) => ops.checkout(d, BOGUS),
  merge: (d) => ops.merge(d, BOGUS),
  'createBranch ref': (d) => ops.createBranch(d, 'nb', BOGUS),
  tag: (d) => ops.tag(d, BOGUS),
  'tag ref': (d) => ops.tag(d, 'tt', BOGUS),
  deleteTag: (d) => ops.deleteTag(d, BOGUS),
  deleteBranch: (d) => ops.deleteBranch(d, BOGUS, false),
  'renameBranch from': (d) => ops.renameBranch(d, BOGUS, 'x'),
  'renameBranch to': (d) => ops.renameBranch(d, 'main', BOGUS),
  applyStash: (d) => ops.applyStash(d, BOGUS),
  popStash: (d) => ops.popStash(d, BOGUS),
  dropStash: (d) => ops.dropStash(d, BOGUS),
  fetch: (d) => gitFetch(d, BOGUS),
  pull: (d) => pull(d, BOGUS),
  push: (d) => push(d, BOGUS),
};

for (const [name, call] of Object.entries(calls)) {
  test(`${name} never reads its argument as an option`, async () => {
    const dir = await repoWithStash();
    const r = await call(dir);
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.stderr, PARSED_AS_OPTION);
  });
}

test('a commit of --output=<file> cannot write a file through the diff endpoint', async () => {
  const dir = await repoWithStash();
  const target = join(dir, 'clobbered.txt');
  await request(buildApp()).get('/api/diff').query({ repo: dir, commit: `--output=${target}` });
  assert.equal(await exists(target), false);
});

test('a stash of --output=<file> cannot write a file', async () => {
  const dir = await repoWithStash();
  const target = join(dir, 'clobbered.txt');
  await getDiff(dir, { stash: `--output=${target}` });
  assert.equal(await exists(target), false);
});

test('a stash ref of --index does not apply the latest stash', async () => {
  const dir = await repoWithStash();
  const r = await ops.applyStash(dir, '--index');
  assert.equal(r.ok, false);
  assert.equal((await run(dir, ['status', '--porcelain'])).trim(), '');
});

test('a branch of --orphan=<name> does not create an orphan branch', async () => {
  const dir = await repoWithStash();
  await ops.checkout(dir, '--orphan=evil');
  assert.equal((await run(dir, ['branch', '--show-current'])).trim(), 'main');
});

test('an include of --output=<file> cannot write a file through the log endpoint', async () => {
  const dir = await repoWithStash();
  const target = join(dir, 'clobbered.txt');
  const res = await request(buildApp()).get('/api/log').query({ repo: dir, include: `--output=${target}` });
  assert.equal(res.status, 400);
  assert.equal(await exists(target), false);
});
