import { runGit } from './runner.js';

// Real branch names can't start with "(" — drop git's detached-HEAD pseudo-line
// (e.g. "(HEAD detached at 7985879)").
const lines = (s) => s.split('\n').map(x => x.trim()).filter(x => x && !x.startsWith('('));

// Local branch names alone — cheap even where remote branches run to the
// hundred thousand, which listing them all is not.
export async function getLocalBranches(cwd) {
  return lines((await runGit(['branch', '--format=%(refname:short)'], cwd)).stdout);
}

// The current branch's upstream and how far apart the two are, for the
// Pull/Push counts: { name, ahead, behind }, or null when the branch tracks
// nothing (or HEAD is detached, or the upstream ref is gone).
export async function getUpstream(cwd) {
  const name = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], cwd);
  if (!name.ok) return null;
  // Left is the upstream, right is HEAD: "<behind>\t<ahead>".
  const counts = await runGit(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], cwd);
  if (!counts.ok) return null;
  const [behind, ahead] = counts.stdout.trim().split(/\s+/).map(Number);
  return { name: name.stdout.trim(), ahead, behind };
}

export async function getBranches(cwd) {
  const local = await getLocalBranches(cwd);
  const remote = await runGit(['branch', '-r', '--format=%(refname:short)'], cwd);
  const cur = await runGit(['branch', '--show-current'], cwd);
  return {
    current: cur.stdout.trim() || null,
    local,
    remote: lines(remote.stdout),
    upstream: await getUpstream(cwd),
  };
}
