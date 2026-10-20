import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runGit, LOCAL_TIMEOUT_MS, REMOTE_TIMEOUT_MS } from '../src/git/runner.js';
import { makeRepo, commitFile, cleanup } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

test('runGit returns ok with stdout on success', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'hello', 'first');
  const res = await runGit(['log', '--oneline'], dir);
  assert.equal(res.ok, true);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /first/);
});

test('runGit returns ok=false on failure without throwing', async () => {
  const dir = await makeRepo(); repos.push(dir);
  const res = await runGit(['cat-file', '-p', 'deadbeef'], dir);
  assert.equal(res.ok, false);
  assert.notEqual(res.code, 0);
  assert.ok(res.stderr.length > 0);
});

test('runGit feeds `input` to git on stdin', async () => {
  const dir = await makeRepo(); repos.push(dir);
  const res = await runGit(['hash-object', '-w', '--stdin'], dir, { input: 'hello\n' });
  assert.equal(res.ok, true);
  // The hash of the blob "hello\n" is stable across git versions.
  assert.equal(res.stdout.trim(), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

// A blob bigger than the cap stands in for a command with a lot to say.
async function repoWithBlob(text) {
  const dir = await makeRepo(); repos.push(dir);
  const res = await runGit(['hash-object', '-w', '--stdin'], dir, { input: text });
  return { dir, hash: res.stdout.trim() };
}

test('runGit fails a command whose output passes maxBuffer, rather than cutting it short', async () => {
  const { dir, hash } = await repoWithBlob('x'.repeat(5000));
  const res = await runGit(['cat-file', '-p', hash], dir, { maxBuffer: 1000 });
  assert.equal(res.ok, false);
  assert.match(res.stderr, /git cat-file: output too large/);
});

// A caller that reads output as it comes holds none of it in runGit, so no
// cap applies: the whole of it arrives however big it is.
test('runGit hands stdout to onStdout as it arrives, past any maxBuffer', async () => {
  const text = 'x'.repeat(5000);
  const { dir, hash } = await repoWithBlob(text);
  const chunks = [];
  const res = await runGit(['cat-file', '-p', hash], dir,
    { maxBuffer: 1000, onStdout: (chunk) => chunks.push(chunk) });
  assert.equal(res.ok, true);
  assert.equal(Buffer.concat(chunks).toString(), text);
  assert.equal(res.stdout, '');
});

// A git alias starting with `!` runs a shell command, which stands in for a
// git process that stalls (a fetch waiting on a dead server). The alias writes
// its own pid first, so the test can tell whether the stalled grandchild was
// killed along with git or left running.
const hangArgs = ['-c', 'alias.hang=!echo $$ > hang.pid && exec sleep 30', 'hang'];
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('runGit gives up on a command that outlives its timeout', async () => {
  const dir = await makeRepo(); repos.push(dir);
  const started = Date.now();
  const res = await runGit(hangArgs, dir, { timeout: 300 });
  assert.ok(Date.now() - started < 5000, 'resolved promptly instead of waiting for the command');
  assert.equal(res.ok, false);
  assert.equal(res.timedOut, true);
  assert.match(res.stderr, /timed out/);
});

test('runGit kills the whole stalled process tree on timeout, not just git', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await runGit(hangArgs, dir, { timeout: 300 });
  const pid = Number((await readFile(join(dir, 'hang.pid'), 'utf8')).trim());
  // The kill is a signal; give the kernel a moment to deliver it.
  for (let i = 0; i < 20 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(alive(pid), false);
});

test('runGit applies a default timeout when none is given', () => {
  assert.ok(LOCAL_TIMEOUT_MS > 0);
  assert.ok(REMOTE_TIMEOUT_MS > LOCAL_TIMEOUT_MS, 'network ops get more time than local ones');
});

test('runGit reports a git that cannot be started instead of hanging', async () => {
  const res = await runGit(['status'], '/nonexistent-dir-for-runner-test');
  assert.equal(res.ok, false);
  assert.ok(res.stderr.length > 0);
});

test('runGit reports an argument list too long to spawn instead of rejecting', async () => {
  const dir = await makeRepo(); repos.push(dir);
  // Past ARG_MAX on any platform (and past Linux's per-argument limit), so
  // spawn throws E2BIG synchronously rather than emitting 'error'.
  const huge = 'x'.repeat(4 * 1024 * 1024);
  const res = await runGit(['log', '--', huge], dir);
  assert.equal(res.ok, false);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /E2BIG/);
});
