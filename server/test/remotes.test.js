import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetch as gitFetch, pull, push } from '../src/git/remotes.js';
import { makeRepo, commitFile, run, cleanup } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

test('push and fetch against a local bare remote succeed', async () => {
  const bare = await mkdtemp(join(tmpdir(), 'gwc-bare-'));
  repos.push(bare);
  await run(bare, ['init', '--bare', '-b', 'main']);

  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  await run(dir, ['remote', 'add', 'origin', bare]);

  const p = await push(dir, 'origin');
  assert.equal(p.ok, true);
  const f = await gitFetch(dir, 'origin');
  assert.equal(f.ok, true);
});

// An `ext::` remote runs a command as the transport; one that only sleeps is a
// server that accepted the connection and then went silent.
async function stalledRemoteRepo() {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  await run(dir, ['config', 'protocol.ext.allow', 'always']);
  await run(dir, ['remote', 'add', 'origin', 'ext::sleep 30']);
  return dir;
}

test('a fetch from a stalled remote times out instead of hanging', async () => {
  const dir = await stalledRemoteRepo();
  const f = await gitFetch(dir, 'origin', { timeout: 300 });
  assert.equal(f.ok, false);
  assert.match(f.stderr, /timed out/);
});

test('pull and push against a stalled remote time out too', async () => {
  const dir = await stalledRemoteRepo();
  for (const op of [pull, push]) {
    const r = await op(dir, 'origin', { timeout: 300 });
    assert.equal(r.ok, false);
    assert.match(r.stderr, /timed out/);
  }
});
