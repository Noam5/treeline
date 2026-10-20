import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { bindRepo } from '../api.js';
import { startWidthDrag } from '../resize.js';
import CommitBox from './CommitBox.jsx';
import Toolbar from './Toolbar.jsx';
import Sidebar from './Sidebar.jsx';
import CommitGraph from './CommitGraph.jsx';
import FileStatus from './FileStatus.jsx';
import DiffPane from './DiffPane.jsx';
import Search from './Search.jsx';
import BranchPicker from './BranchPicker.jsx';
import MergeBanner from './MergeBanner.jsx';
import Dialog from './Dialog.jsx';
import { refNameError } from '../refname.js';

// How many commits of history to load at a time. The graph asks for the next
// page as it is scrolled near the end of what it has.
const LOG_PAGE = 1000;

// One repository's entire UI and state — one of these per open tab. Everything
// here is scoped to `repo`: the API client, the loaded history, the selection,
// and this tab's own error/notice bars. Window-level furniture (theme, diff
// pane height) is owned by App and passed in.
//
// Inactive tabs stay mounted so their state and scroll positions survive a
// switch; they load on first activation rather than on mount, so restoring a
// session does not fan out git calls across every tab at once.
export default function RepoWorkspace({
  repo, active = true, theme, onToggleTheme, diffHeight, onSplitterDrag,
}) {
  const client = useMemo(() => bindRepo(repo), [repo]);

  const [commits, setCommits] = useState([]);
  const [logLimit, setLogLimit] = useState(LOG_PAGE);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState(null);
  const [branches, setBranches] = useState(null);
  const [stashes, setStashes] = useState([]);
  const [tags, setTags] = useState([]);
  const [diff, setDiff] = useState('');
  const [selected, setSelected] = useState(null); // selected graph entry (hash or 'WORKING')
  const [selectedBranch, setSelectedBranch] = useState(null); // branch highlighted in the sidebar (select without checkout)
  const [selectedTag, setSelectedTag] = useState(null); // tag highlighted in the sidebar, the same way
  const [selectedFile, setSelectedFile] = useState(null); // { path, origPath?, staged } of the open file diff
  const [view, setView] = useState('history');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // the open Dialog's props, while a question is up
  // Width of the file lists in the uncommitted-changes panel. Shared across
  // tabs via localStorage, like the diff pane's file list.
  const [filesWidth, setFilesWidth] = useState(
    () => Number(localStorage.getItem('uncommittedWidth')) || 420);

  // How deep a ref selected below the page took the history (see
  // selectRefCommit). A re-read asks for at least that much, so it keeps the
  // ref's commit, but reaching it does not itself trigger one.
  const reached = useRef(0);

  // Each refresh asks for everything at once, and applies the answers together
  // only if no newer refresh has started meanwhile: refreshes overlap (an op
  // finishing as the tab is re-activated), and a slow, older one landing last
  // would otherwise put stale history back on screen.
  const refreshSeq = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const [log, nextStatus, nextBranches, stashList, tagList] = await Promise.all([
      client.getLog(Math.max(logLimit, reached.current)), client.getStatus(), client.getBranches(),
      client.getStashes(), client.getTags(),
    ]);
    if (seq !== refreshSeq.current) return;
    // A history git failed to read comes back as an error, with no commits:
    // keep the graph as it was rather than show an empty or cut-short one.
    if (log.ok === false) setError(log.error || 'Could not read the history');
    else {
      setCommits(log.commits || []);
      setHasMore(!!log.hasMore);
    }
    setStatus(nextStatus);
    setBranches(nextBranches);
    setStashes(stashList.stashes || []);
    setTags(tagList.tags || []);
  }, [client, logLimit]);

  // Load on first activation, and again whenever this tab is re-activated: the
  // repository may have changed on disk while the tab sat in the background.
  // A bigger log limit also lands here, through refresh's identity.
  useEffect(() => { if (active) refresh(); }, [active, refresh]);

  // Coming back to the window is the usual moment after committing, pulling
  // or switching branches in a terminal; only the visible tab re-reads.
  useEffect(() => {
    if (!active) return undefined;
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [active, refresh]);

  // A merge (or a pull) that stops on conflicts leaves the user with files to
  // resolve, so bring the file status view forward the moment one begins —
  // including when a repository is opened mid-merge.
  const merging = !!status?.merge;
  const wasMerging = useRef(false);
  useEffect(() => {
    if (merging && !wasMerging.current) setView('status');
    wasMerging.current = merging;
  }, [merging]);

  // Counts commit selections, so a commit's diff that answers after another
  // row was picked is dropped rather than shown under the wrong selection.
  const commitDiffSeq = useRef(0);
  const showCommitDiff = async (hash) => {
    const seq = ++commitDiffSeq.current;
    setSelected(hash);
    setSelectedBranch(null); // clicking a commit clears any ref highlight
    setSelectedTag(null);
    setSelectedFile(null);
    // The bottom panel shows the staged/unstaged files instead; its diff stays
    // empty until one of them is clicked.
    if (hash === 'WORKING') { setDiff(''); return; }
    const { patch } = await client.getDiff({ commit: hash });
    if (seq === commitDiffSeq.current) setDiff(patch);
  };
  // Move the graph cursor to the commit a ref points at, showing its diff.
  // The ref is matched against the decorations git already put on each commit.
  // A ref older than the loaded history is fetched by its full name: the
  // server extends the page down to its commit.
  const selectRefCommit = async (matches, fullRef) => {
    const find = (list) => list.find((c) => (c.refs || []).some(matches));
    let target = find(commits);
    if (!target && hasMore) {
      const log = await client.getLog(logLimit, fullRef);
      if (log.ok === false) { setError(log.error || 'Could not read the history'); return; }
      const loaded = log.commits || [];
      target = find(loaded);
      if (target) {
        setCommits(loaded);
        setHasMore(!!log.hasMore);
        reached.current = loaded.filter((c) => !c.working).length;
      }
    }
    if (!target) { setSelected(null); return; }
    setSelected(target.hash);
    setSelectedFile(null);
    setDiff((await client.getDiff({ commit: target.hash })).patch);
  };
  // Select a branch or a tag without checking it out: highlight it in the
  // sidebar and move the cursor to its commit. The graph has one cursor, so
  // the two highlights are mutually exclusive.
  const onSelectBranch = async (name) => {
    setSelectedTag(null);
    setSelectedBranch(name);
    await selectRefCommit((r) => r.replace(/^HEAD -> /, '') === name, `refs/heads/${name}`);
  };
  const onSelectTag = async (name) => {
    setSelectedBranch(null);
    setSelectedTag(name);
    // git decorates a tagged commit as "tag: <name>", both kinds alike.
    await selectRefCommit((r) => r === `tag: ${name}`, `refs/tags/${name}`);
  };
  // `file` is { path } or, for a rename, { path, origPath }.
  const showFileDiff = async (file, staged) => {
    setSelectedFile({ ...file, staged });
    setDiff((await client.getDiff({ ...file, staged })).patch);
  };

  const remote = async (fn) => { const r = await fn(); if (!r.ok) setError(r.error || 'Remote op failed'); await refresh(); };

  // Run an op, then surface git's result (error OR success output) so an action
  // is never silent — e.g. stash with nothing to save shows "No local changes to save".
  const op = async (fn) => {
    const r = await fn();
    if (!r.ok) { setError(r.error || 'Operation failed'); setNotice(''); }
    else { setError(''); setNotice((r.output || '').trim() || 'Done.'); }
    await refresh();
  };

  // Ask through the in-app Dialog (Electron has no prompt()). Resolves
  // to the name, or true for a confirmation, or null if the user backs out.
  const ask = (props) => new Promise((resolve) => {
    setDialog({ ...props, onDone: (answer) => { setDialog(null); resolve(answer); } });
  });
  const askName = (title, message, props) =>
    ask({ title, message, input: true, validate: refNameError, ...props });
  // The action button is the destructive one, and never the default.
  const confirmDanger = (title, message, confirmLabel) =>
    ask({ title, message, confirmLabel, danger: true });

  const onBranch = async () => {
    const name = await askName('New branch', `Branches from ${branches?.current || 'HEAD'} and checks the new branch out.`,
      { confirmLabel: 'Create branch' });
    if (name) op(() => client.createBranch(name));
  };
  const onMerge = () => setMergeOpen(true);
  const doMerge = (branch) => { setMergeOpen(false); op(() => client.merge(branch)); };
  // Branch context-menu actions (right-click a branch in the sidebar).
  const onMergeBranch = (name) => op(() => client.merge(name));
  const onRenameBranch = async (name) => {
    const to = await askName(`Rename branch "${name}"`, null, { initial: name, confirmLabel: 'Rename' });
    if (to && to !== name) op(() => client.renameBranch(name, to));
  };
  // Try a safe delete; if git refuses (e.g. unmerged), offer a force-delete.
  const onDeleteBranch = (name) => op(async () => {
    const r = await client.deleteBranch(name, false);
    if (!r.ok && await confirmDanger('Force-delete branch',
      `Branch "${name}" is not fully merged. Force-delete it? This cannot be undone.`, 'Force delete')) {
      return client.deleteBranch(name, true);
    }
    return r;
  });
  // Deleting a tag cannot be undone — the same confirmation a stash drop gets.
  const onDeleteTag = async (name) => {
    if (await confirmDanger('Delete tag', `Delete tag "${name}"? This cannot be undone.`, 'Delete tag')) {
      op(() => client.deleteTag(name));
    }
  };
  const onTag = async () => {
    const name = await askName('New tag', `Tags HEAD${branches?.current ? ` (${branches.current})` : ''}.`,
      { confirmLabel: 'Create tag' });
    if (name) op(() => client.tag(name));
  };
  // Commit context-menu actions (right-click a commit in the history graph).
  const onCreateBranchAt = async (hash) => {
    const name = await askName('New branch', `Branches from commit ${hash.slice(0, 7)} and checks the new branch out.`,
      { confirmLabel: 'Create branch' });
    if (name) op(() => client.createBranch(name, hash));
  };
  const onTagAt = async (hash) => {
    const name = await askName('New tag', `Tags commit ${hash.slice(0, 7)}.`, { confirmLabel: 'Create tag' });
    if (name) op(() => client.tag(name, hash));
  };
  const onStash = () => op(() => client.stash());
  const onCheckout = (branch) => op(() => client.checkout(branch));
  const onApplyStash = (ref) => op(() => client.applyStash(ref));
  const onPopStash = (ref) => op(() => client.popStash(ref));
  const onDropStash = async (ref) => {
    if (await confirmDanger('Drop stash', `Drop ${ref}? This cannot be undone.`, 'Drop stash')) {
      op(() => client.dropStash(ref));
    }
  };
  // Clears the file selection as well as the graph's: a stash patch is not
  // the working tree, so it must not inherit the open file's hunk actions.
  const onShowStashDiff = async (ref) => {
    setSelected(null);
    setSelectedFile(null);
    setDiff((await client.getDiff({ stash: ref })).patch);
  };
  const onDiscardFile = async (path) => {
    if (await confirmDanger('Discard changes', `Discard changes to ${path}? This cannot be undone.`, 'Discard changes')) {
      op(() => client.discardFile(path));
    }
  };
  const onDeleteFile = async (path) => {
    if (await confirmDanger('Delete file', `Delete untracked ${path}? This cannot be undone.`, 'Delete file')) {
      op(() => client.deleteFile(path));
    }
  };
  const onIgnoreFile = (path) => op(() => client.ignoreFile(path));
  // Conflict resolution. Taking one side replaces the whole file; marking it
  // resolved stages whatever the user made of it in their own editor.
  // Either way the file leaves the conflicts for the staged list, so if its
  // diff is open, show what was staged: the conflict diff would be stale, and
  // would offer hunk buttons for a patch that no longer applies.
  const resolve = async (path, fn, done) => {
    const file = selectedFile;
    let ok = false;
    await op(async () => {
      const r = await fn();
      ok = r.ok;
      return r.ok ? { ...r, output: done } : r;
    });
    if (ok && file?.path === path) await showFileDiff({ path }, true);
  };
  const onResolveFile = (path, side) => resolve(path, () => client.resolveConflict(path, side),
    `Resolved ${path} using ${side === 'ours' ? 'mine' : 'theirs'}.`);
  const onMarkResolved = (path) => resolve(path, () => client.stage([path]), `Marked ${path} resolved.`);
  // Ending the merge either way changes every file it touched, so whatever
  // file diff was open no longer describes the working tree.
  const endMerge = async (fn, done) => {
    let ok = false;
    await op(async () => {
      const r = await fn();
      ok = r.ok;
      return r.ok && done ? { ...r, output: done } : r;
    });
    if (ok) { setSelectedFile(null); setDiff(''); }
  };
  const onAbortMerge = async () => {
    if (await confirmDanger('Abort merge',
      'Abort the merge? Every change it brought in, and any conflict you have resolved, will be lost.', 'Abort merge')) {
      endMerge(() => client.abortMerge(), 'Merge aborted.');
    }
  };
  const onContinueMerge = () => endMerge(() => client.continueMerge());
  // Stage, unstage or discard one hunk of the open file. The patch is the one
  // the diff pane rendered, so git applies exactly what was on screen — and
  // refuses outright if the file has moved on since it was shown.
  const onHunk = async (action, patch) => {
    if (action === 'discard'
      && !await confirmDanger('Discard hunk', 'Discard this hunk? This cannot be undone.', 'Discard hunk')) return;
    const file = selectedFile;
    await op(() => client.applyHunk({ patch, cached: action !== 'discard', reverse: action !== 'stage' }));
    // The hunk has left this side of the index, so re-read the diff: otherwise
    // it stays on screen still offering a button that would now fail.
    if (file) setDiff((await client.getDiff(file)).patch);
  };
  const onDiscard = async () => {
    if (await confirmDanger('Discard all changes',
      'Discard ALL uncommitted changes to tracked files? This cannot be undone.', 'Discard all')) {
      op(() => client.discard());
    }
  };

  // Hunk actions need a file open on a known side of the index. Untracked
  // files are the exception: their diff comes from `--no-index` against
  // /dev/null, which is not a patch the index can take — they stage whole.
  // So are conflicted ones, whose diff is against HEAD and which can only be
  // resolved as a whole.
  const untracked = !!selectedFile && (status?.untracked || []).includes(selectedFile.path);
  const conflicted = status?.conflicted || [];
  const inConflict = !!selectedFile && conflicted.some((f) => f.path === selectedFile.path);
  const hunkProps = selectedFile && !untracked && !inConflict ? { staged: selectedFile.staged, onHunk } : {};

  const changeCount = status
    ? status.staged.length + status.unstaged.length + status.untracked.length + conflicted.length
    : 0;
  // What FileStatus needs beyond the file lists, the same in both places it is shown.
  const fileStatusProps = {
    client, status, onRefresh: refresh, onSelectFile: showFileDiff, selected: selectedFile,
    onDiscardFile, onDeleteFile, onIgnoreFile, onResolveFile, onMarkResolved, onCommitError: setError,
  };

  return (
    <div className="workspace" hidden={!active}>
      <Toolbar repoPath={repo} currentBranch={branches?.current} changeCount={changeCount}
        upstream={branches?.upstream ?? null}
        theme={theme} onToggleTheme={onToggleTheme}
        onCommit={() => setView('status')}
        onBranch={onBranch}
        onMerge={onMerge}
        onStash={onStash}
        onDiscard={onDiscard}
        onTag={onTag}
        onFetch={() => remote(() => client.fetchRemote('origin'))}
        onPull={() => remote(() => client.pull('origin'))}
        onPush={() => remote(() => client.push('origin'))} />
      {merging && (
        <MergeBanner merge={status.merge} conflicts={conflicted.length}
          onContinue={onContinueMerge} onAbort={onAbortMerge} />
      )}
      {error && (
        <div className="error-bar">
          <span className="bar-msg">{error}</span>
          <button className="bar-close" onClick={() => setError('')} aria-label="Dismiss" title="Dismiss">✕</button>
        </div>
      )}
      {notice && (
        <div className="notice-bar">
          <span className="bar-msg">{notice}</span>
          <button className="bar-close" onClick={() => setNotice('')} aria-label="Dismiss" title="Dismiss">✕</button>
        </div>
      )}
      <div className="body">
        <Sidebar branches={branches} stashes={stashes} view={view} onView={setView}
          onCheckout={onCheckout} onSelectBranch={onSelectBranch} selectedBranch={selectedBranch}
          onApplyStash={onApplyStash}
          onMergeBranch={onMergeBranch} onRenameBranch={onRenameBranch} onDeleteBranch={onDeleteBranch}
          onPopStash={onPopStash} onDropStash={onDropStash} onShowStashDiff={onShowStashDiff}
          tags={tags} onDeleteTag={onDeleteTag} onSelectTag={onSelectTag} selectedTag={selectedTag} />
        <div className="main">
          <div className="main-top">
            {view === 'history' && <CommitGraph commits={commits} onSelect={showCommitDiff} onCheckout={onCheckout}
              hasMore={hasMore}
              // From what arrived, not what was asked for: the server sends
              // more than the limit when it has to, to reach HEAD.
              onLoadMore={() => setLogLimit((n) => Math.max(n, commits.length) + LOG_PAGE)}
              onCreateBranchAt={onCreateBranchAt} onTagAt={onTagAt} selected={selected}
              localBranches={branches?.local || []} currentBranch={branches?.current || null} />}
            {view === 'search' && <Search client={client} onSelect={showCommitDiff} />}
            {view === 'status' && <FileStatus {...fileStatusProps} />}
          </div>
          <div className="row-splitter" onMouseDown={onSplitterDrag} title="Drag to resize" />
          <div className="diff-wrap" style={{ flex: `0 0 ${diffHeight}px`, height: diffHeight }}>
            {view === 'history' && selected === 'WORKING' ? (
              <div className="uncommitted-panel">
                <div className="uncommitted-row">
                <div className="uncommitted-files" style={{ flex: `0 0 ${filesWidth}px`, width: filesWidth }}>
                  <FileStatus {...fileStatusProps} showCommit={false} />
                </div>
                <div className="col-splitter" title="Drag to resize"
                  onMouseDown={(e) => startWidthDrag(e, {
                    from: filesWidth, min: 160, max: 1200,
                    onSize: setFilesWidth,
                    onCommit: (w) => localStorage.setItem('uncommittedWidth', String(w)),
                  })} />
                <div className="uncommitted-diff">
                  <DiffPane patch={diff} showFileList={false} {...hunkProps} />
                </div>
                </div>
                {/* Below both panes, so it spans the full width of the panel. */}
                <CommitBox client={client} onRefresh={refresh}
                  mergeMessage={status?.merge?.message} onError={setError} />
              </div>
            ) : (
              <DiffPane patch={diff} {...hunkProps}
                commit={commits.find((c) => c.hash === selected)} onSelectCommit={showCommitDiff}
                localBranches={branches?.local || []} />
            )}
          </div>
        </div>
      </div>
      {mergeOpen && (
        <BranchPicker
          title={`Merge a branch into ${branches?.current || 'the current branch'}`}
          branches={(branches?.local || []).filter((b) => b !== branches?.current)}
          onPick={doMerge}
          onCancel={() => setMergeOpen(false)}
        />
      )}
      {dialog && <Dialog {...dialog} />}
    </div>
  );
}
