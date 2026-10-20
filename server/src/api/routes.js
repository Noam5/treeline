import { stat, readdir, appendFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { getStatus } from '../git/status.js';
import { getDiff } from '../git/diff.js';
import { runGit } from '../git/runner.js';
import { createCommit, lastCommit } from '../git/commit.js';
import { getBranches, getLocalBranches } from '../git/branches.js';
import { getTags } from '../git/tags.js';
import { parseLog, logDepth, assignLanes, colorByBranch, searchCommits } from '../git/log.js';
import { fetch as gitFetch, pull, push } from '../git/remotes.js';
import * as ops from '../git/ops.js';
import { listStashes } from '../git/stashes.js';
import { serialized } from './queue.js';
import { getMergeState, abortMerge, continueMerge, resolveConflict } from '../git/merge.js';

async function isGitRepo(p) {
  try {
    const s = await stat(p);
    if (!s.isDirectory()) return false;
    const g = await stat(join(p, '.git'));
    return g.isDirectory() || g.isFile();
  } catch { return false; }
}

// Every repo-scoped request names its own repository — query string on GETs,
// body on POSTs — so the server holds no "current repo" between requests and
// several repositories can be worked on at once (one per UI tab).
async function resolveRepo(req, res) {
  const repo = (req.method === 'GET' ? req.query.repo : req.body?.repo) ?? '';
  if (!repo) {
    res.status(400).json({ ok: false, error: 'Repository required' });
    return null;
  }
  if (!(await isGitRepo(repo))) {
    res.status(400).json({ ok: false, error: 'Not a git repository' });
    return null;
  }
  return repo;
}

// How much history /api/log returns when the client names no limit.
const DEFAULT_LOG_LIMIT = 1000;

export function registerRoutes(app) {
  // Every repo-scoped POST changes the repository, so each waits for any
  // change already running against the same repo (see queue.js). GETs only
  // read, and stay concurrent.
  const post = (path, handler) => app.post(path, serialized(handler));

  // Path validator, not a mode switch: the client calls this before turning a
  // path into a tab, and for each stored path when restoring a session.
  app.post('/api/repo/open', async (req, res) => {
    const { path } = req.body ?? {};
    if (!path || !(await isGitRepo(path))) {
      return res.status(400).json({ ok: false, error: 'Not a git repository' });
    }
    res.json({ ok: true, path });
  });

  // Directory listing for the repo picker: folders only, each flagged with
  // whether it is a git repo so the UI can mark it. Not path-jailed — the
  // server already runs git against arbitrary local paths and only listens on
  // loopback, so this grants no access the client did not already have.
  // A leading ~ means the home directory — the picker accepts a typed path and
  // only the server knows where home is. Anywhere else a ~ is an ordinary
  // character in a directory name and is left alone.
  const expandHome = (p) =>
    p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p;

  app.get('/api/fs/list', async (req, res) => {
    const target = resolve(expandHome(req.query.path || homedir()));

    try {
      if (!(await stat(target)).isDirectory()) {
        return res.status(400).json({ ok: false, error: 'Not a folder' });
      }
    } catch {
      return res.status(400).json({ ok: false, error: 'No such folder' });
    }

    let found;
    try {
      found = await readdir(target, { withFileTypes: true });
    } catch (e) {
      return res.status(400).json({
        ok: false,
        error: e.code === 'EACCES' ? 'Permission denied' : 'Cannot read that folder',
      });
    }

    // Symlinks are kept as candidates and resolved below — a symlinked project
    // directory is a normal thing to browse into.
    const candidates = found
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !d.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const entries = (await Promise.all(candidates.map(async (d) => {
      const path = join(target, d.name);
      if (!d.isDirectory()) {
        try { if (!(await stat(path)).isDirectory()) return null; } catch { return null; }
      }
      return { name: d.name, path, isRepo: await isGitRepo(path) };
    }))).filter(Boolean);

    const parent = dirname(target);
    res.json({ ok: true, path: target, parent: parent === target ? null : parent, entries });
  });

  app.get('/api/status', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    // `merge` is the merge in progress (or null), so one refresh tells the UI
    // both what changed and whether it is mid-merge.
    res.json({ ...(await getStatus(repo)), merge: await getMergeState(repo) });
  });

  // File names from getStatus, not patterns — see getDiff. They go to git on
  // stdin, NUL-separated: "Stage all" can name more files than fit on a
  // command line.
  const withPaths = (args) => async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    const paths = req.body?.paths ?? [];
    if (paths.length === 0) return res.json({ ok: true });
    const r = await runGit(['--literal-pathspecs', ...args, '--pathspec-from-file=-', '--pathspec-file-nul'],
      repo, { input: paths.join('\0') });
    res.status(r.ok ? 200 : 500).json({ ok: r.ok, error: r.ok ? undefined : r.stderr });
  };
  post('/api/stage', withPaths(['add']));
  post('/api/unstage', withPaths(['reset', '-q', 'HEAD']));

  app.get('/api/diff', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    const { path, origPath, staged, commit, stash } = req.query;
    res.json(await getDiff(repo, { path, origPath, staged: staged === 'true', commit, stash }));
  });

  post('/api/commit', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    const message = (req.body?.message ?? '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'Commit message required' });
    const r = await createCommit(repo, message, { amend: req.body?.amend === true });
    res.status(r.ok ? 200 : 500).json({ ok: r.ok, error: r.ok ? undefined : r.stderr });
  });

  // What "Amend last commit" starts from: HEAD's message, and the remote
  // branch that already has it (amending is refused then).
  app.get('/api/commit/last', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    const last = await lastCommit(repo);
    if (!last) return res.json({ ok: false, error: 'There are no commits to amend yet' });
    res.json({ ok: true, ...last });
  });

  app.get('/api/branches', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    res.json(await getBranches(repo));
  });

  app.get('/api/tags', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    res.json(await getTags(repo));
  });

  app.get('/api/stashes', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    res.json({ stashes: await listStashes(repo) });
  });

  // The newest `limit` commits, so a huge history is not read and drawn all
  // at once. The client asks again with a larger limit as the user scrolls;
  // lanes are assigned in a single newest-first pass, so a longer prefix
  // never changes how the commits already shown were laid out.
  //
  // `include` names a ref (e.g. a tag picked in the sidebar) whose commit the
  // page must reach, however old; one that names no commit is refused.
  app.get('/api/log', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    let limit = Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LOG_LIMIT);
    const head = await runGit(['rev-parse', 'HEAD'], repo);
    const headHash = head.ok ? head.stdout.trim() : '';
    const targets = headHash ? [headHash] : [];
    const { include } = req.query;
    if (include !== undefined) {
      const ref = await runGit(['rev-parse', '--verify', '--quiet', '--end-of-options',
        `${include}^{commit}`], repo);
      if (!ref.ok) return res.status(400).json({ ok: false, error: `Unknown ref: ${include}` });
      targets.push(ref.stdout.trim());
    }
    // One extra, to learn whether anything is left without counting it all.
    // A git that fails partway is an error, not a shorter history: a page of
    // what it printed would say the history ends there.
    let commits;
    try {
      commits = await parseLog(repo, { limit: limit + 1 });
      // The graph opens scrolled to HEAD, but other branches may have moved on
      // far past it. Extend the page down to HEAD (and the `include` commit),
      // and a page beyond, so it is not the last row; the reply can hold more
      // than `limit` commits.
      const reached = targets.every((t) => commits.some((c) => c.hash === t));
      if (commits.length > limit && !reached) {
        const depth = await logDepth(repo, targets);
        if (depth > limit) {
          limit += depth;
          commits = await parseLog(repo, { limit: limit + 1 });
        }
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
    const hasMore = commits.length > limit;
    if (hasMore) commits.length = limit;
    // Prepend a synthetic "Uncommitted changes" node when the working tree is
    // dirty, parented to HEAD so the lane algorithm connects it to the graph.
    const status = await getStatus(repo);
    const dirty = status.staged.length + status.unstaged.length + status.untracked.length
      + status.conflicted.length > 0;
    if (dirty) {
      if (headHash) {
        commits.unshift({
          hash: 'WORKING', parents: [headHash],
          subject: 'Uncommitted changes', author: '', email: '', date: '',
          refs: [], working: true,
        });
      }
    }
    assignLanes(commits);
    colorByBranch(commits, await getLocalBranches(repo));
    res.json({ commits, hasMore });
  });

  app.get('/api/search', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    const { type, q } = req.query;
    res.json({ commits: await searchCommits(repo, type || 'description', q || '') });
  });

  const remoteRoute = (fn) => async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    const r = await fn(repo, req.body?.remote || 'origin');
    // A pull is a merge too: when it stops on conflicts, the report is on stdout.
    res.status(r.ok ? 200 : 500).json({ ok: r.ok, output: r.stdout + r.stderr,
      error: r.ok ? undefined : (r.stderr || r.stdout) });
  };
  post('/api/fetch', remoteRoute(gitFetch));
  post('/api/pull', remoteRoute(pull));
  post('/api/push', remoteRoute(push));

  // Branch / merge / stash / discard / tag. `field` (when set) is a required,
  // trimmed body parameter passed to the op; ops without a field take none.
  const opRoute = (fn, field) => async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    let arg;
    if (field) {
      arg = (req.body?.[field] ?? '').trim();
      if (!arg) return res.status(400).json({ ok: false, error: `${field} required` });
    }
    const r = field ? await fn(repo, arg) : await fn(repo);
    // A merge that stops on conflicts reports them on stdout, not stderr.
    res.status(r.ok ? 200 : 500).json({ ok: r.ok, output: (r.stdout || '') + (r.stderr || ''),
      error: r.ok ? undefined : (r.stderr || r.stdout) });
  };
  // Create a branch/tag by `name`, optionally at a `ref` commit (else HEAD).
  const nameRefRoute = (fn) => async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    const name = (req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    const ref = (req.body?.ref ?? '').trim() || undefined;
    const r = await fn(repo, name, ref);
    res.status(r.ok ? 200 : 500).json({ ok: r.ok, output: (r.stdout || '') + (r.stderr || ''),
      error: r.ok ? undefined : r.stderr });
  };
  post('/api/branch', nameRefRoute(ops.createBranch));
  post('/api/branch/delete', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    const name = (req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    const r = await ops.deleteBranch(repo, name, req.body?.force === true);
    res.status(r.ok ? 200 : 500).json({ ok: r.ok, output: (r.stdout || '') + (r.stderr || ''),
      error: r.ok ? undefined : r.stderr });
  });
  post('/api/branch/rename', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    const from = (req.body?.from ?? '').trim();
    const to = (req.body?.to ?? '').trim();
    if (!from || !to) return res.status(400).json({ ok: false, error: 'from and to required' });
    const r = await ops.renameBranch(repo, from, to);
    res.status(r.ok ? 200 : 500).json({ ok: r.ok, output: (r.stdout || '') + (r.stderr || ''),
      error: r.ok ? undefined : r.stderr });
  });
  post('/api/checkout', opRoute(ops.checkout, 'branch'));
  post('/api/merge', opRoute(ops.merge, 'branch'));
  // A merge stopped on conflicts: give up on it, conclude it, or settle one
  // conflicted path by taking one side whole. Settling a path by hand is an
  // ordinary /api/stage once the user has edited it.
  post('/api/merge/abort', opRoute(abortMerge));
  post('/api/merge/continue', opRoute(continueMerge));
  post('/api/merge/resolve', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    const path = req.body?.path ?? '';
    const side = req.body?.side;
    if (!path) return res.status(400).json({ ok: false, error: 'path required' });
    if (side !== 'ours' && side !== 'theirs') {
      return res.status(400).json({ ok: false, error: 'side must be "ours" or "theirs"' });
    }
    const r = await resolveConflict(repo, path, side);
    res.status(r.ok ? 200 : 500).json({ ok: r.ok, output: (r.stdout || '') + (r.stderr || ''),
      error: r.ok ? undefined : r.stderr });
  });
  post('/api/tag', nameRefRoute(ops.tag));
  post('/api/tag/delete', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    const name = (req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    const r = await ops.deleteTag(repo, name);
    res.status(r.ok ? 200 : 500).json({ ok: r.ok, output: (r.stdout || '') + (r.stderr || ''),
      error: r.ok ? undefined : r.stderr });
  });
  post('/api/stash', opRoute(ops.stash));
  post('/api/stash/apply', opRoute(ops.applyStash, 'ref'));
  post('/api/stash/pop', opRoute(ops.popStash, 'ref'));
  post('/api/stash/drop', opRoute(ops.dropStash, 'ref'));
  post('/api/discard-file', opRoute(ops.discardFile, 'path'));
  post('/api/delete-file', opRoute(ops.deleteFile, 'path'));

  // Stage, unstage or discard one hunk. The client sends back exactly the
  // patch text it rendered, so git applies what the user actually saw; a patch
  // that no longer fits the file is refused by git rather than guessed at.
  post('/api/hunk', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    const patch = req.body?.patch ?? '';
    if (!patch.trim()) return res.status(400).json({ ok: false, error: 'patch required' });
    const r = await ops.applyPatch(repo, patch, {
      cached: req.body?.cached === true,
      reverse: req.body?.reverse === true,
    });
    res.status(r.ok ? 200 : 500).json({ ok: r.ok, output: (r.stdout || '') + (r.stderr || ''),
      error: r.ok ? undefined : r.stderr });
  });

  post('/api/ignore', async (req, res) => {
    const repo = await resolveRepo(req, res); if (!repo) return;
    const p = (req.body?.path ?? '').trim();
    if (!p) return res.status(400).json({ ok: false, error: 'path required' });
    try {
      await appendFile(join(repo, '.gitignore'), p + '\n');
      res.json({ ok: true, output: `Added "${p}" to .gitignore` });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
  post('/api/discard', opRoute(ops.discard));
}
