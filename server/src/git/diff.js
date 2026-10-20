import { runGit } from './runner.js';

// Paths are file names, not pathspecs: `--literal-pathspecs` keeps a name
// such as "[ab].txt" from also matching a.txt and b.txt.
const LITERAL = '--literal-pathspecs';

// `origPath` is a rename's original path, as getStatus reports it. Passing
// both endpoints yields a proper rename patch rather than an add or a delete.
export async function getDiff(cwd, { path, origPath, staged, commit, stash } = {}) {
  // A stash needs `stash show -p` to get a plain `diff --git` patch; `git show`
  // on a stash ref yields a combined diff the UI can't render.
  if (stash) {
    const { stdout } = await runGit(['stash', 'show', '-p', '--end-of-options', stash], cwd);
    return { patch: stdout };
  }
  let args;
  // --end-of-options keeps a "commit" such as --output=<file> from being read
  // as git's option to write the diff to that file.
  if (commit) args = ['show', '--end-of-options', commit];
  else if (staged) args = ['diff', '--cached'];
  // A path still in conflict diffs as a combined (`diff --cc`) patch, which
  // the UI cannot render. Against HEAD it is an ordinary patch whose added
  // lines are the conflict markers and their side of each conflict.
  else if (path && (await runGit(['ls-files', '-u', '--', path], cwd)).stdout) args = ['diff', 'HEAD'];
  else args = ['diff'];
  if (path) args = [LITERAL, ...args, '--', ...(origPath ? [origPath] : []), path];
  const { stdout } = await runGit(args, cwd);

  // For working-tree diffs with a path: if the patch is empty, check if the
  // file is untracked and fall back to --no-index to produce an all-additions patch.
  if (!commit && !staged && path && stdout === '') {
    const { ok } = await runGit([LITERAL, 'ls-files', '--error-unmatch', '--', path], cwd);
    if (!ok) {
      // File is untracked — git diff --no-index exits 1 when files differ, which is normal.
      const { stdout: fallbackPatch } = await runGit(
        ['diff', '--no-index', '--', '/dev/null', path],
        cwd,
      );
      return { patch: fallbackPatch };
    }
  }

  return { patch: stdout };
}
