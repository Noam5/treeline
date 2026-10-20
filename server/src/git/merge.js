import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runGit } from './runner.js';

// The merge in progress, if any: `{ message }` while MERGE_HEAD exists, else
// null. The message is git's own MERGE_MSG with its comment lines (the
// "# Conflicts:" list) dropped — the text the merge commit should carry.
export async function getMergeState(cwd) {
  const head = await runGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], cwd);
  if (!head.ok) return null;
  const msgPath = await runGit(['rev-parse', '--git-path', 'MERGE_MSG'], cwd);
  let raw = '';
  try { raw = await readFile(resolve(cwd, msgPath.stdout.trim()), 'utf8'); } catch { /* no message saved */ }
  const message = raw.split('\n').filter((l) => !l.startsWith('#')).join('\n').trim();
  return { message };
}

// Throw away the merge in progress and put back the pre-merge state.
export async function abortMerge(cwd) {
  const r = await runGit(['merge', '--abort'], cwd);
  return { ok: r.ok, stdout: r.stdout, stderr: r.stderr };
}

// Conclude the merge: commit what is staged, with the merge message. Git
// itself refuses while any path is still unmerged.
export async function continueMerge(cwd) {
  const state = await getMergeState(cwd);
  if (!state) return { ok: false, stdout: '', stderr: 'No merge in progress' };
  const r = await runGit(['commit', '-m', state.message || 'Merge'], cwd);
  return { ok: r.ok, stdout: r.stdout, stderr: r.stderr };
}

const STAGE = { ours: '2', theirs: '3' };
// The path is a file name, not a pathspec: without this, a file called
// "*.txt" would resolve every conflicted .txt file at once.
const LITERAL = '--literal-pathspecs';

// Resolve one conflicted path wholesale to one side and stage the result.
// Where that side deleted the file there is no version to check out, so
// taking it means deleting the file too.
export async function resolveConflict(cwd, path, side) {
  if (!STAGE[side]) return { ok: false, stdout: '', stderr: `Unknown side "${side}"` };
  const ls = await runGit([LITERAL, 'ls-files', '-u', '--', path], cwd);
  const stages = ls.stdout.split('\n').filter(Boolean).map((l) => l.split('\t')[0].split(' ')[2]);
  if (!stages.length) return { ok: false, stdout: '', stderr: `${path} is not in conflict` };
  const steps = stages.includes(STAGE[side])
    ? [[LITERAL, 'checkout', `--${side}`, '--', path], [LITERAL, 'add', '--', path]]
    : [[LITERAL, 'rm', '-q', '--', path]];
  for (const args of steps) {
    const r = await runGit(args, cwd);
    if (!r.ok) return { ok: false, stdout: r.stdout, stderr: r.stderr };
  }
  return { ok: true, stdout: '', stderr: '' };
}
