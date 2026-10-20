import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getTags } from '../src/git/tags.js';
import { makeRepo, commitFile, run, cleanup } from './helpers/repo.js';

const exec = promisify(execFile);
const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

// A commit with an explicit date. Two commits made in the same second would
// leave newest-first ordering ambiguous, and a lightweight tag borrows the
// date of the commit it points at.
async function commitAt(dir, name, content, message, date) {
  await writeFile(join(dir, name), content);
  await run(dir, ['add', name]);
  await exec('git', ['commit', '-m', message], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

test('getTags lists the repository tags', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  await run(dir, ['tag', 'v1.0']);
  await run(dir, ['tag', 'v1.1']);
  const { tags } = await getTags(dir);
  assert.deepEqual([...tags].sort(), ['v1.0', 'v1.1']);
});

test('getTags returns an empty list when the repository has no tags', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  assert.deepEqual(await getTags(dir), { tags: [] });
});

test('getTags puts the newest tag first', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitAt(dir, 'a.txt', 'a\n', 'first', '2020-01-01T00:00:00Z');
  await run(dir, ['tag', 'v-old']);
  await commitAt(dir, 'a.txt', 'a\nb\n', 'second', '2024-06-01T00:00:00Z');
  await run(dir, ['tag', 'v-new']);
  const { tags } = await getTags(dir);
  assert.deepEqual(tags, ['v-new', 'v-old']);
});

test('getTags finds an annotated tag as well as a lightweight one', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'x', 'init');
  await run(dir, ['tag', 'light']);
  await run(dir, ['tag', '-a', 'heavy', '-m', 'a release']);
  const { tags } = await getTags(dir);
  assert.deepEqual([...tags].sort(), ['heavy', 'light']);
});
