async function jget(url) { const r = await fetch(url); return r.json(); }
async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
  return r.json();
}

// --- Not repo-scoped: these are how a repository gets chosen in the first place.

// Validates that a path is a git repository. The server holds no "current
// repo", so this selects nothing — the caller decides what to do with the path.
export const openRepo = (path) => jpost('/api/repo/open', { path });
// Folder listing for the repo picker; omit `path` to start in the home dir.
export const listDir = (path) => jget('/api/fs/list' + (path ? '?' + new URLSearchParams({ path }) : ''));

// --- Repo-scoped calls.
//
// Every one of these names its repository, so several can be in flight against
// different repositories at once (one per open tab). `bindRepo` is the only
// place that knows how the repository reaches the server: callers hold a bound
// client and call it as if there were just one repo.
export function bindRepo(repo) {
  const q = (extra = {}) => '?' + new URLSearchParams({ repo, ...extra });
  return {
    repo,
    // The newest `limit` commits; the reply's `hasMore` says if older ones exist.
    // `include` names a ref whose commit the reply must reach, however old.
    getLog: (limit, include) => jget('/api/log' + q({
      ...(limit ? { limit } : {}), ...(include ? { include } : {}) })),
    getStatus: () => jget('/api/status' + q()),
    getBranches: () => jget('/api/branches' + q()),
    getStashes: () => jget('/api/stashes' + q()),
    getTags: () => jget('/api/tags' + q()),
    // HEAD's message and where it has been pushed: what an amend starts from.
    getLastCommit: () => jget('/api/commit/last' + q()),
    search: (type, text) => jget('/api/search' + q({ type, q: text })),
    // `origPath` is a rename's original path, as getStatus reports it.
    getDiff: ({ path, origPath, staged, commit, stash } = {}) => {
      const extra = {};
      if (path) extra.path = path;
      if (origPath) extra.origPath = origPath;
      if (staged) extra.staged = 'true';
      if (commit) extra.commit = commit;
      if (stash) extra.stash = stash;
      return jget('/api/diff' + q(extra));
    },

    // Stage, unstage or discard a single hunk. `patch` is that hunk alone, as
    // the diff pane rendered it: `cached` targets the index, `reverse` undoes.
    applyHunk: ({ patch, cached = false, reverse = false }) =>
      jpost('/api/hunk', { repo, patch, cached, reverse }),
    stage: (paths) => jpost('/api/stage', { repo, paths }),
    unstage: (paths) => jpost('/api/unstage', { repo, paths }),
    // `amend` replaces the last commit; the server refuses one already pushed.
    commit: (message, { amend = false } = {}) => jpost('/api/commit', { repo, message, amend }),
    applyStash: (ref) => jpost('/api/stash/apply', { repo, ref }),
    popStash: (ref) => jpost('/api/stash/pop', { repo, ref }),
    dropStash: (ref) => jpost('/api/stash/drop', { repo, ref }),
    discardFile: (path) => jpost('/api/discard-file', { repo, path }),
    deleteFile: (path) => jpost('/api/delete-file', { repo, path }),
    ignoreFile: (path) => jpost('/api/ignore', { repo, path }),
    fetchRemote: (remote) => jpost('/api/fetch', { repo, remote }),
    pull: (remote) => jpost('/api/pull', { repo, remote }),
    push: (remote) => jpost('/api/push', { repo, remote }),
    createBranch: (name, ref) => jpost('/api/branch', { repo, name, ref }),
    checkout: (branch) => jpost('/api/checkout', { repo, branch }),
    merge: (branch) => jpost('/api/merge', { repo, branch }),
    // A merge stopped on conflicts: give up, conclude, or take one side of a
    // single file (`side` is 'ours' or 'theirs').
    abortMerge: () => jpost('/api/merge/abort', { repo }),
    continueMerge: () => jpost('/api/merge/continue', { repo }),
    resolveConflict: (path, side) => jpost('/api/merge/resolve', { repo, path, side }),
    tag: (name, ref) => jpost('/api/tag', { repo, name, ref }),
    deleteTag: (name) => jpost('/api/tag/delete', { repo, name }),
    deleteBranch: (name, force) => jpost('/api/branch/delete', { repo, name, force }),
    renameBranch: (from, to) => jpost('/api/branch/rename', { repo, from, to }),
    stash: () => jpost('/api/stash', { repo }),
    discard: () => jpost('/api/discard', { repo }),
  };
}
