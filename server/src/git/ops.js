import { runGit } from './runner.js';

// Placed before every name or ref the client supplies, so git takes it as
// that name even when it starts with a dash. Without it, a "branch" of
// --orphan=x or a "stash" of --index is an option and git acts on it.
const EOO = '--end-of-options';

async function wrap(cwd, args, input) {
  const r = await runGit(args, cwd, { input });
  return { ok: r.ok, stdout: r.stdout, stderr: r.stderr };
}

// Create and check out a new branch, optionally at a given ref (else HEAD).
export const createBranch = (cwd, name, ref) =>
  wrap(cwd, ['checkout', '-b', name, ...(ref ? [EOO, ref] : [])]);

// Check out an existing branch.
export const checkout = (cwd, branch) => wrap(cwd, ['checkout', EOO, branch]);

// Merge the given branch into the current branch (no editor prompt).
export const merge = (cwd, branch) => wrap(cwd, ['merge', '--no-edit', EOO, branch]);

// Stash the working-tree changes.
export const stash = (cwd) => wrap(cwd, ['stash', 'push']);

// Discard uncommitted changes to tracked files in the working tree.
export const discard = (cwd) => wrap(cwd, ['checkout', '--', '.']);

// Create a lightweight tag, optionally at a given ref (else HEAD).
export const tag = (cwd, name, ref) => wrap(cwd, ['tag', EOO, name, ...(ref ? [ref] : [])]);

// Apply a stash to the working tree (restored as unstaged; keeps the stash).
export const applyStash = (cwd, ref) => wrap(cwd, ['stash', 'apply', EOO, ref]);

// Apply a stash and remove it from the stash list.
export const popStash = (cwd, ref) => wrap(cwd, ['stash', 'pop', EOO, ref]);

// Remove a stash without applying it.
export const dropStash = (cwd, ref) => wrap(cwd, ['stash', 'drop', EOO, ref]);

// Discard working-tree changes to a single tracked file. The path is a file
// name, not a pattern: "[ab].txt" must not also restore a.txt and b.txt.
export const discardFile = (cwd, path) =>
  wrap(cwd, ['--literal-pathspecs', 'checkout', '--', path]);

// Delete a single untracked file/dir from the working tree (a literal path,
// as above).
export const deleteFile = (cwd, path) =>
  wrap(cwd, ['--literal-pathspecs', 'clean', '-fd', '--', path]);

// Delete a branch. Safe delete (-d) refuses unmerged branches; force (-D) removes regardless.
export const deleteBranch = (cwd, name, force) =>
  wrap(cwd, ['branch', force ? '-D' : '-d', EOO, name]);

// Delete a tag. Unlike a branch this needs no force flag — a tag holds no
// commits of its own, so removing it can never orphan unmerged work.
export const deleteTag = (cwd, name) => wrap(cwd, ['tag', '-d', EOO, name]);

// Rename a branch from one name to another.
export const renameBranch = (cwd, from, to) => wrap(cwd, ['branch', '-m', EOO, from, to]);

// Apply a patch the caller supplies — in practice a single hunk lifted out of
// a file's diff. The three hunk actions are the three flag combinations:
// stage = cached, unstage = cached + reverse, discard = reverse (working tree
// only, so a file's staged part is left alone). The trailing newline is
// git's requirement, not the caller's problem.
export const applyPatch = (cwd, patch, { cached = false, reverse = false } = {}) =>
  wrap(cwd, ['apply', ...(cached ? ['--cached'] : []), ...(reverse ? ['--reverse'] : []), '-'],
    patch.endsWith('\n') ? patch : patch + '\n');
