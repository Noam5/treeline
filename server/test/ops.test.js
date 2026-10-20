import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createBranch, checkout, merge, stash, discard, tag, applyStash, discardFile, deleteFile, deleteBranch, deleteTag, renameBranch, popStash, dropStash, applyPatch } from '../src/git/ops.js';
import { makeRepo, commitFile, run, cleanup } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

test('createBranch creates and checks out a new branch', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  const res = await createBranch(dir, 'feature/x');
  assert.equal(res.ok, true);
  const cur = (await run(dir, ['branch', '--show-current'])).trim();
  assert.equal(cur, 'feature/x');
});

test('createBranch at a ref creates the branch at that commit', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'first');
  const first = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  await commitFile(dir, 'a.txt', 'a\nb\n', 'second');
  const res = await createBranch(dir, 'fromfirst', first);
  assert.equal(res.ok, true);
  assert.equal((await run(dir, ['rev-parse', 'HEAD'])).trim(), first);
  assert.equal((await run(dir, ['branch', '--show-current'])).trim(), 'fromfirst');
});

test('tag at a ref tags that commit', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'first');
  const first = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  await commitFile(dir, 'a.txt', 'a\nb\n', 'second');
  const res = await tag(dir, 'v0', first);
  assert.equal(res.ok, true);
  assert.equal((await run(dir, ['rev-list', '-n1', 'v0'])).trim(), first);
});

test('checkout switches to an existing branch', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  await run(dir, ['branch', 'develop']);
  const res = await checkout(dir, 'develop');
  assert.equal(res.ok, true);
  assert.equal((await run(dir, ['branch', '--show-current'])).trim(), 'develop');
});

test('tag creates a tag at HEAD', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  const res = await tag(dir, 'v1.0.0');
  assert.equal(res.ok, true);
  assert.match(await run(dir, ['tag']), /v1\.0\.0/);
});

test('stash clears working-tree changes', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await writeFile(join(dir, 'a.txt'), 'v2');
  const res = await stash(dir);
  assert.equal(res.ok, true);
  assert.equal((await run(dir, ['status', '--porcelain'])).trim(), '');
});

test('discard reverts uncommitted changes to tracked files', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await writeFile(join(dir, 'a.txt'), 'v2');
  const res = await discard(dir);
  assert.equal(res.ok, true);
  assert.equal((await run(dir, ['status', '--porcelain'])).trim(), '');
});

test('applyStash restores stashed changes to the working tree', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await writeFile(join(dir, 'a.txt'), 'v2');
  await stash(dir);
  // working tree is clean after stashing
  assert.equal((await run(dir, ['status', '--porcelain'])).trim(), '');
  const res = await applyStash(dir, 'stash@{0}');
  assert.equal(res.ok, true);
  // the change is back (unstaged)
  assert.match(await run(dir, ['diff']), /v2/);
});

test('popStash applies the stash and removes it from the list', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await writeFile(join(dir, 'a.txt'), 'v2');
  await stash(dir);
  const res = await popStash(dir, 'stash@{0}');
  assert.equal(res.ok, true);
  assert.match(await run(dir, ['diff']), /v2/);          // change restored
  assert.equal((await run(dir, ['stash', 'list'])).trim(), ''); // stash gone
});

test('dropStash removes a stash without touching the working tree', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'init');
  await writeFile(join(dir, 'a.txt'), 'v2');
  await stash(dir);
  const res = await dropStash(dir, 'stash@{0}');
  assert.equal(res.ok, true);
  assert.equal((await run(dir, ['stash', 'list'])).trim(), '');   // stash gone
  assert.equal((await run(dir, ['status', '--porcelain'])).trim(), ''); // tree still clean
});

test('discardFile reverts working-tree changes to one tracked file', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1\n', 'init');
  await writeFile(join(dir, 'a.txt'), 'v2\n');
  const res = await discardFile(dir, 'a.txt');
  assert.equal(res.ok, true);
  assert.equal((await run(dir, ['status', '--porcelain'])).trim(), '');
});

test('deleteFile removes a single untracked file', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  await writeFile(join(dir, 'junk.txt'), 'temp');
  const res = await deleteFile(dir, 'junk.txt');
  assert.equal(res.ok, true);
  assert.equal((await run(dir, ['status', '--porcelain'])).trim(), '');
});

test('merge brings another branch into the current branch', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'base.txt', 'b', 'base');
  await run(dir, ['checkout', '-b', 'feature']);
  await commitFile(dir, 'f.txt', 'f', 'feature work');
  await run(dir, ['checkout', 'main']);
  const res = await merge(dir, 'feature');
  assert.equal(res.ok, true);
  assert.match(await run(dir, ['log', '--oneline']), /feature work/);
});

test('deleteBranch removes a merged branch', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'init');
  await run(dir, ['branch', 'feature']);
  const r = await deleteBranch(dir, 'feature', false);
  assert.equal(r.ok, true);
  const names = (await run(dir, ['branch', '--format=%(refname:short)'])).split('\n');
  assert.ok(!names.includes('feature'));
});

test('deleteBranch refuses an unmerged branch without force', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'init');
  await run(dir, ['checkout', '-b', 'feature']);
  await commitFile(dir, 'b.txt', 'b\n', 'work on feature');
  await run(dir, ['checkout', 'main']);
  const r = await deleteBranch(dir, 'feature', false);
  assert.equal(r.ok, false);
});

test('deleteBranch force-removes an unmerged branch', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'init');
  await run(dir, ['checkout', '-b', 'feature']);
  await commitFile(dir, 'b.txt', 'b\n', 'work on feature');
  await run(dir, ['checkout', 'main']);
  const r = await deleteBranch(dir, 'feature', true);
  assert.equal(r.ok, true);
});

test('renameBranch renames a branch', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'a\n', 'init');
  await run(dir, ['branch', 'old']);
  const r = await renameBranch(dir, 'old', 'fresh');
  assert.equal(r.ok, true);
  const names = (await run(dir, ['branch', '--format=%(refname:short)'])).split('\n').map(s => s.trim());
  assert.ok(names.includes('fresh'));
  assert.ok(!names.includes('old'));
});

// --- applyPatch: staging, unstaging and discarding a single hunk.

const TEN_LINES = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n') + '\n';
const EDITED = TEN_LINES.replace('l1\n', 'L1\n').replace('l10\n', 'L10\n');

// Everything up to (not including) the second hunk header: the file's diff
// headers plus its first hunk — the shape the UI sends for one hunk.
function firstHunkOf(patch) {
  const lines = patch.split('\n');
  const first = lines.findIndex((l) => l.startsWith('@@'));
  const second = lines.findIndex((l, i) => i > first && l.startsWith('@@'));
  return lines.slice(0, second).join('\n') + '\n';
}

// A repo whose a.txt has two independent unstaged hunks.
async function repoWithTwoHunks() {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', TEN_LINES, 'init');
  await writeFile(join(dir, 'a.txt'), EDITED);
  return dir;
}

test('applyPatch with cached stages just the hunk it is given', async () => {
  const dir = await repoWithTwoHunks();
  const patch = firstHunkOf(await run(dir, ['diff', '--', 'a.txt']));

  const res = await applyPatch(dir, patch, { cached: true });

  assert.equal(res.ok, true);
  const staged = await run(dir, ['diff', '--cached']);
  assert.match(staged, /^\+L1$/m);
  assert.doesNotMatch(staged, /^\+L10$/m);
  // The second hunk is untouched and still waiting in the working tree.
  assert.match(await run(dir, ['diff']), /^\+L10$/m);
});

test('applyPatch with cached and reverse unstages just that hunk', async () => {
  const dir = await repoWithTwoHunks();
  await run(dir, ['add', 'a.txt']);
  const patch = firstHunkOf(await run(dir, ['diff', '--cached', '--', 'a.txt']));

  const res = await applyPatch(dir, patch, { cached: true, reverse: true });

  assert.equal(res.ok, true);
  const staged = await run(dir, ['diff', '--cached']);
  assert.doesNotMatch(staged, /^\+L1$/m);
  assert.match(staged, /^\+L10$/m);
});

test('applyPatch with reverse discards that hunk from the working tree', async () => {
  const dir = await repoWithTwoHunks();
  const patch = firstHunkOf(await run(dir, ['diff', '--', 'a.txt']));

  const res = await applyPatch(dir, patch, { reverse: true });

  assert.equal(res.ok, true);
  const worktree = await readFile(join(dir, 'a.txt'), 'utf8');
  assert.match(worktree, /^l1$/m);
  assert.match(worktree, /^L10$/m);
});

test('applyPatch reports git\'s error when the patch does not apply', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', TEN_LINES, 'init');
  // A hunk whose context does not match the file it claims to patch.
  const patch = [
    'diff --git a/a.txt b/a.txt',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1,2 +1,2 @@',
    '-nothing like this',
    '+replacement',
    ' neither is this',
    '',
  ].join('\n');

  const res = await applyPatch(dir, patch, { cached: true });

  assert.equal(res.ok, false);
  assert.match(res.stderr, /does not apply|patch failed/i);
});

test('applyPatch tolerates a patch with no trailing newline', async () => {
  const dir = await repoWithTwoHunks();
  // `git apply` rejects a patch whose last line is unterminated, and a patch
  // rebuilt from rendered lines in the UI can easily arrive that way.
  const patch = firstHunkOf(await run(dir, ['diff', '--', 'a.txt'])).replace(/\n+$/, '');

  const res = await applyPatch(dir, patch, { cached: true });

  assert.equal(res.ok, true);
  assert.match(await run(dir, ['diff', '--cached']), /^\+L1$/m);
});

test('deleteTag removes the tag', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  await run(dir, ['tag', 'v1.0']);
  const res = await deleteTag(dir, 'v1.0');
  assert.equal(res.ok, true);
  assert.equal((await run(dir, ['tag', '--list'])).trim(), '');
});

test('deleteTag leaves the tagged commit alone', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  const head = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  await run(dir, ['tag', 'v1.0']);
  await deleteTag(dir, 'v1.0');
  assert.equal((await run(dir, ['rev-parse', 'HEAD'])).trim(), head);
});

test('deleteTag reports failure for a tag that does not exist', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  const res = await deleteTag(dir, 'nope');
  assert.equal(res.ok, false);
  assert.match(res.stderr, /not found/i);
});
