import { StringDecoder } from 'node:string_decoder';
import { runGit } from './runner.js';

const PALETTE = ['#4c8dff', '#3fb950', '#e3963e', '#c678dd', '#56b6c2', '#e06c75'];
const NO_BRANCH = '#8b949e'; // neutral color for commits not owned by any branch
const US = '\x1f', RS = '\x1e';
const FORMAT = ['%H', '%P', '%s', '%an', '%ae', '%ad', '%D'].join(US) + RS;

const DATE_FMT = '--date=format:%Y-%m-%d %H:%M';

// One %x1f-delimited `git log` record as a commit object; null for the
// empty one after the last separator.
function parseRecord(rec) {
  rec = rec.replace(/^\n/, '');
  if (!rec) return null;
  const [hash, parents, subject, author, email, date, refs] = rec.split(US);
  return {
    hash, subject, author, email, date,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    refs: refs ? refs.split(',').map(s => s.trim()).filter(Boolean) : []
  };
}

// Parse the %x1e-separated `git log` records into commit objects.
function parseRecords(stdout) {
  return stdout.split(RS).map(parseRecord).filter(Boolean);
}

// Splits git's output on `sep` as it arrives and hands over each piece, so
// none of it has to sit in one buffer: a deep history's log is more than
// runGit holds (130k commits came to 53 MB). `end` flushes the last piece.
function splitter(sep, onPiece) {
  const decoder = new StringDecoder('utf8');
  let rest = '';
  const take = (text) => {
    if (!text.includes(sep)) { rest += text; return; }
    const pieces = (rest + text).split(sep);
    rest = pieces.pop();
    pieces.forEach(onPiece);
  };
  return {
    write: (chunk) => take(decoder.write(chunk)),
    end: () => { take(decoder.end()); if (rest) onPiece(rest); rest = ''; },
  };
}

// A failed git command as an error. Output read before the failure is not
// the history, so callers never get to treat it as the whole of it.
function gitFailure(cmd, r) {
  const msg = r.stderr.trim() || `exited with code ${r.code}`;
  return new Error(msg.startsWith(`git ${cmd}`) ? msg : `git ${cmd}: ${msg}`);
}

// --branches/--remotes/--tags + HEAD covers all real history but excludes
// refs/stash, so stash commits never appear as graph nodes (--all would).
// HEAD is there for a detached HEAD no ref points at; while it names no
// commit (a new repository, an unborn branch) it is left out, as git would
// refuse the whole command over it.
// --date-order still sorts newest first, but never lists a parent before
// one of its children, which assignLanes depends on: plain date order
// breaks that whenever a commit's clock ran behind its parent's.
async function history(cwd) {
  const head = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], cwd);
  return ['--branches', '--remotes', '--tags', ...(head.ok ? ['HEAD'] : []), '--date-order'];
}

// The newest `limit` commits (all of them when omitted). Throws if git
// fails, rather than returning the commits read before it did.
export async function parseLog(cwd, { limit } = {}) {
  const commits = [];
  const records = splitter(RS, (rec) => { const c = parseRecord(rec); if (c) commits.push(c); });
  const r = await runGit(['log', ...await history(cwd), ...(limit ? ['-n', String(limit)] : []),
    DATE_FMT, `--pretty=format:${FORMAT}`], cwd, { onStdout: records.write });
  if (!r.ok) throw gitFailure('log', r);
  records.end();
  return commits;
}

// How many of parseLog's commits it takes to reach every one of `hashes`
// that is in the history at all. Hashes alone, so even a huge history is a
// fraction of the cost of formatting it.
export async function logDepth(cwd, hashes) {
  const wanted = new Set(hashes);
  let n = 0, depth = 0;
  const lines = splitter('\n', (hash) => { n++; if (wanted.has(hash)) depth = n; });
  const r = await runGit(['rev-list', ...await history(cwd)], cwd, { onStdout: lines.write });
  if (!r.ok) throw gitFailure('rev-list', r);
  lines.end();
  return depth;
}

// Search commits by 'commit' (hash prefix), 'author', 'description' (message),
// or 'code' (pickaxe over diffs). Results are capped to keep responses bounded.
export async function searchCommits(cwd, type, q) {
  if (!q || !q.trim()) return [];
  const base = ['log', '--all', DATE_FMT, `--pretty=format:${FORMAT}`, '-n', '300'];
  let args;
  if (type === 'author') args = [...base, '-i', `--author=${q}`];
  else if (type === 'description') args = [...base, '-i', `--grep=${q}`];
  else if (type === 'code') args = [...base, '-G', q];
  else args = base; // 'commit' — filter by hash prefix below
  const { stdout } = await runGit(args, cwd);
  let commits = parseRecords(stdout);
  if (type === 'commit') {
    const ql = q.trim().toLowerCase();
    commits = commits.filter(c => c.hash.toLowerCase().startsWith(ql));
  }
  return commits;
}

export function assignLanes(commits) {
  // activeLanes[i] = hash expected to appear next in lane i (or null/free)
  const activeLanes = [];

  const findFree = () => {
    const i = activeLanes.indexOf(null);
    return i === -1 ? activeLanes.length : i;
  };

  for (const commit of commits) {
    // The commit's lane: a lane already expecting this hash, else a new/free lane.
    let lane = activeLanes.indexOf(commit.hash);
    if (lane === -1) { lane = findFree(); }
    commit.lane = lane;
    commit.color = PALETTE[lane % PALETTE.length];

    // Free every lane that was waiting for this commit (branches converging here).
    for (let i = 0; i < activeLanes.length; i++) {
      if (activeLanes[i] === commit.hash) activeLanes[i] = null;
    }

    // Place parents into lanes and record connectors from this commit to each.
    commit.connectors = [];
    commit.parents.forEach((parent, idx) => {
      let target = activeLanes.indexOf(parent);
      let type;
      if (idx === 0) {
        // first parent continues this commit's lane
        target = lane;
        type = activeLanes[lane] && activeLanes[lane] !== parent ? 'fork' : 'straight';
        activeLanes[lane] = parent;
      } else if (target !== -1) {
        type = 'merge';
      } else {
        target = findFree();
        activeLanes[target] = parent;
        type = 'merge';
      }
      commit.connectors.push({ fromLane: lane, toLane: target, type });
    });

    // trim trailing free lanes
    while (activeLanes.length && activeLanes[activeLanes.length - 1] === null) activeLanes.pop();
  }
  return commits;
}

// Color each commit by the branch it belongs to: a commit takes the color of
// the nearest descendant branch tip reached via first-parent links. Branch tips
// always show their own branch's color; the shared trunk takes the color of the
// branch that owns it. Commits owned by no branch (e.g. the synthetic WORKING
// node) inherit their first parent's color, falling back to a neutral gray.
export function colorByBranch(commits, branchNames) {
  const branches = new Set(branchNames || []);
  const isBranch = (r) => branches.has(r.replace(/^HEAD -> /, ''));
  const isTip = (c) => (c.refs || []).some(isBranch);
  const isHead = (c) => (c.refs || []).some((r) => /^HEAD( ->|$)/.test(r));
  const firstParent = new Map(commits.map((c) => [c.hash, c.parents && c.parents[0]]));

  // Tips in priority order: the current branch (HEAD) first so it owns the
  // trunk, then the rest in the order they appear (newest first). Order only
  // matters for commits two tips both reach; a tip always keeps its own segment.
  const tips = commits.filter(isTip);
  tips.sort((a, b) => (isHead(b) ? 1 : 0) - (isHead(a) ? 1 : 0));

  // Assign each tip a palette color and claim commits from the tip downward
  // along first-parent, stopping at the next tip or an already-claimed commit.
  const tipHashes = new Set(tips.map((c) => c.hash));
  const owner = new Map();
  let n = 0;
  for (const tip of tips) {
    const color = PALETTE[n++ % PALETTE.length];
    owner.set(tip.hash, color); // the tip itself, even if it sits on another's line
    let h = firstParent.get(tip.hash);
    while (h && !owner.has(h) && !tipHashes.has(h)) {
      owner.set(h, color);
      h = firstParent.get(h);
    }
  }

  // Apply, with a fallback for commits no branch owns (e.g. the WORKING node):
  // inherit the first parent's color, else a neutral gray.
  for (const c of commits) c.color = owner.get(c.hash) || null;
  for (const c of commits) {
    if (c.color) continue;
    c.color = owner.get(firstParent.get(c.hash)) || NO_BRANCH;
  }

  return commits;
}
