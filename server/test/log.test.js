import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parseLog, logDepth, assignLanes, colorByBranch } from '../src/git/log.js';
import { makeRepo, commitFile, run, cleanup, makeBigHistory } from './helpers/repo.js';

const repos = [];
after(async () => { for (const r of repos) await cleanup(r); });

test('parseLog returns commits newest-first with parents', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', '1', 'first');
  await commitFile(dir, 'a.txt', '2', 'second');
  const commits = await parseLog(dir);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].subject, 'second');
  assert.equal(commits[1].subject, 'first');
  assert.equal(commits[0].parents.length, 1);
  assert.equal(commits[0].parents[0], commits[1].hash);
  assert.equal(commits[1].parents.length, 0);
});

test('assignLanes keeps a linear history in one lane', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', '1', 'c1');
  await commitFile(dir, 'a.txt', '2', 'c2');
  const commits = assignLanes(await parseLog(dir));
  assert.equal(commits[0].lane, 0);
  assert.equal(commits[1].lane, 0);
  assert.equal(commits[0].color, commits[1].color);
});

test('colorByBranch gives colinear branches distinct colors, trunk owned by main', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', '1', 'c1');
  await commitFile(dir, 'a.txt', '2', 'c2');
  await commitFile(dir, 'a.txt', '3', 'c3');
  await run(dir, ['branch', 'lo']);          // lo -> c3
  await commitFile(dir, 'a.txt', '4', 'c4');
  await commitFile(dir, 'a.txt', '5', 'c5'); // main -> c5
  const commits = colorByBranch(assignLanes(await parseLog(dir)), ['main', 'lo']);
  const by = (s) => commits.find(c => c.subject === s);
  // main owns its tip + the trunk above the lo tip
  assert.equal(by('c5').color, by('c4').color);
  // lo owns its tip + the trunk below it
  assert.equal(by('c3').color, by('c2').color);
  assert.equal(by('c3').color, by('c1').color);
  // the two branches are different colors
  assert.notEqual(by('c5').color, by('c3').color);
});

test('colorByBranch colors feature-unique commits, trunk stays main color', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'base.txt', 'b', 'base');
  await run(dir, ['checkout', '-b', 'feature']);
  await commitFile(dir, 'f.txt', 'f', 'feature work');
  await run(dir, ['checkout', 'main']);
  await commitFile(dir, 'm.txt', 'm', 'main work');
  await run(dir, ['merge', '--no-ff', 'feature', '-m', 'merge feature']);
  const commits = colorByBranch(assignLanes(await parseLog(dir)), ['main', 'feature']);
  const by = (s) => commits.find(c => c.subject === s);
  assert.notEqual(by('feature work').color, by('merge feature').color);
  assert.equal(by('merge feature').color, by('main work').color);
  assert.equal(by('merge feature').color, by('base').color);
});

test('colorByBranch keeps a single-branch linear history one color', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', '1', 'c1');
  await commitFile(dir, 'a.txt', '2', 'c2');
  const commits = colorByBranch(assignLanes(await parseLog(dir)), ['main']);
  assert.equal(commits[0].color, commits[1].color);
});

test('colorByBranch assigns a color to every commit even with no branches', () => {
  const commits = colorByBranch(assignLanes([
    { hash: 'b', parents: ['a'], refs: [] },
    { hash: 'a', parents: [], refs: [] },
  ]), []);
  for (const c of commits) assert.equal(typeof c.color, 'string');
});

test('colorByBranch gives the WORKING node its current branch color', () => {
  const commits = colorByBranch(assignLanes([
    { hash: 'WORKING', parents: ['h2'], refs: [], working: true },
    { hash: 'h2', parents: ['h1'], refs: ['main'] },
    { hash: 'h1', parents: [], refs: [] },
  ]), ['main']);
  const working = commits.find(c => c.hash === 'WORKING');
  const head = commits.find(c => c.hash === 'h2');
  assert.equal(working.color, head.color);
});

test('assignLanes puts a merge across two lanes', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'base.txt', 'b', 'base');
  await run(dir, ['checkout', '-b', 'feature']);
  await commitFile(dir, 'f.txt', 'f', 'feature work');
  await run(dir, ['checkout', 'main']);
  await commitFile(dir, 'm.txt', 'm', 'main work');
  await run(dir, ['merge', '--no-ff', 'feature', '-m', 'merge feature']);

  const commits = assignLanes(await parseLog(dir));
  const merge = commits.find(c => c.subject === 'merge feature');
  assert.equal(merge.parents.length, 2);
  // a merge commit emits a connector that introduces a second lane
  assert.ok(merge.connectors.some(c => c.type === 'merge'));
  // at least two distinct lanes are used across the graph
  assert.ok(new Set(commits.map(c => c.lane)).size >= 2);
});

test('parseLog excludes stash commits from the graph', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', 'v1', 'real commit');
  await writeFile(join(dir, 'a.txt'), 'v2');
  await run(dir, ['stash', 'push', '-m', 'stashed work']);
  const commits = await parseLog(dir);
  assert.ok(commits.some((c) => c.subject === 'real commit'));
  assert.ok(!commits.some((c) => /WIP on|stashed work/.test(c.subject)));
});

test('parseLog stops at the requested limit', async () => {
  const dir = await makeRepo(); repos.push(dir);
  for (let i = 1; i <= 5; i++) await commitFile(dir, 'a.txt', String(i), `c${i}`);
  const commits = await parseLog(dir, { limit: 3 });
  assert.deepEqual(commits.map((c) => c.subject), ['c5', 'c4', 'c3']);
});

// Lanes are assigned in one pass that expects every child before its parents.
// Plain `git log` orders by commit date alone, so a branch committed with an
// older clock than its base would list the base first.
test('parseLog lists every child before its parent, even with a skewed clock', async () => {
  const dir = await makeRepo(); repos.push(dir);
  const at = (date) => ({ ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date });
  const { execFile } = await import('node:child_process');
  const git = (args, date) => new Promise((res, rej) =>
    execFile('git', args, { cwd: dir, env: at(date) }, (e) => (e ? rej(e) : res())));
  await git(['commit', '--allow-empty', '-m', 'base'], '2015-01-01T00:00:00');
  await git(['checkout', '-b', 'skewed'], '2015-01-01T00:00:00');
  await git(['commit', '--allow-empty', '-m', 'skewed child'], '2014-01-01T00:00:00');
  await git(['checkout', 'main'], '2015-01-01T00:00:00');
  await git(['commit', '--allow-empty', '-m', 'main tip'], '2016-01-01T00:00:00');
  const subjects = (await parseLog(dir)).map((c) => c.subject);
  assert.ok(subjects.indexOf('skewed child') < subjects.indexOf('base'), subjects.join(', '));
});

// runGit holds at most 50 MB of a command's output. A deep history formats to
// more than that (130k commits came to 53 MB), and the commits past the cap
// must still arrive: a tag on the root commit has to be reachable.
test('parseLog reads a history whose log is bigger than git output may be buffered', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await makeBigHistory(dir, { count: 30, subjectBytes: 2 * 1024 * 1024 }); // ~60 MB of log
  const commits = await parseLog(dir);
  assert.equal(commits.length, 30);
  assert.match(commits[0].subject, /^30 x+$/);
  const root = commits.at(-1);
  assert.equal(root.subject.length, '1 '.length + 2 * 1024 * 1024);
  assert.deepEqual(root.parents, []);
  assert.ok(root.refs.includes('tag: root'), root.refs.join(', '));
  assert.equal(await logDepth(dir, [root.hash]), 30);
});

// A commit object that cannot be read stands in for any git failure partway
// through (a timeout, a broken pack): whatever arrived before it is not the
// history, and must not be passed off as all of it.
async function repoWithMissingRoot() {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', '1', 'root');
  const root = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  await commitFile(dir, 'a.txt', '2', 'second');
  await commitFile(dir, 'a.txt', '3', 'third');
  await rm(join(dir, '.git', 'objects', root.slice(0, 2), root.slice(2)));
  return dir;
}

test('parseLog fails when git log fails, rather than returning what it read', async () => {
  const dir = await repoWithMissingRoot();
  await assert.rejects(parseLog(dir), /git log/);
  await assert.rejects(parseLog(dir, { limit: 2 }), /git log/);
});

test('logDepth fails when git rev-list fails, rather than guessing a depth', async () => {
  const dir = await repoWithMissingRoot();
  const head = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  await assert.rejects(logDepth(dir, [head]), /git rev-list/);
});

test('parseLog returns no commits for a repository with none', async () => {
  const dir = await makeRepo(); repos.push(dir);
  assert.deepEqual(await parseLog(dir), []);
  assert.equal(await logDepth(dir, []), 0);
});

// An unborn branch (a fresh `checkout --orphan`) leaves HEAD naming no
// commit; the other branches' history is still there to show.
test('parseLog lists the branches while HEAD is on an unborn branch', async () => {
  const dir = await makeRepo(); repos.push(dir);
  await commitFile(dir, 'a.txt', '1', 'on main');
  await run(dir, ['checkout', '--orphan', 'fresh']);
  assert.deepEqual((await parseLog(dir)).map((c) => c.subject), ['on main']);
});
