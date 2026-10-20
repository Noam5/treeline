import { runGit } from './runner.js';

// The first remote-tracking branch that already contains HEAD, or null.
// Symbolic refs (origin/HEAD) are skipped: they only repeat a real branch.
async function pushedTo(cwd) {
  const r = await runGit(['for-each-ref', '--contains', 'HEAD',
    '--format=%(symref)%00%(refname:short)', 'refs/remotes'], cwd);
  if (!r.ok) return null;
  const line = r.stdout.split('\n').find((l) => l.startsWith('\0'));
  return line ? line.slice(1) : null;
}

// HEAD's full message, for the commit box to edit when amending, and where it
// has been pushed already. Null before the first commit.
export async function lastCommit(cwd) {
  const r = await runGit(['log', '-1', '--format=%B'], cwd);
  if (!r.ok) return null;
  return { message: r.stdout.trim(), pushed: await pushedTo(cwd) };
}

// `amend` replaces HEAD instead of adding to it. A commit that is already on a
// remote is refused: rewriting it would make the next push diverge from
// history other people may have.
export async function createCommit(cwd, message, { amend = false } = {}) {
  if (amend) {
    const remote = await pushedTo(cwd);
    if (remote) {
      return { ok: false, stderr: `The last commit has already been pushed to ${remote}. `
        + 'Amending it would rewrite published history, so it was left alone.' };
    }
  }
  const r = await runGit(['commit', ...(amend ? ['--amend'] : []), '-m', message], cwd);
  return { ok: r.ok, stderr: r.stderr };
}
