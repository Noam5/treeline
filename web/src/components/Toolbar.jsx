import { useState } from 'react';
import Icon from './icons.jsx';

function TbButton({ icon, label, badge, title, danger, busy, disabled, onClick }) {
  const cls = `tb-btn${danger ? ' danger' : ''}${busy ? ' busy' : ''}`;
  return (
    <button className={cls} onClick={onClick} title={title} disabled={disabled}
      aria-busy={busy || undefined}>
      <span className="tb-icon"><Icon name={icon} /></span>
      <span className="tb-label">{label}</span>
      {badge > 0 && <span className="tb-badge">{badge}</span>}
    </button>
  );
}

const commits = (n) => `${n} commit${n === 1 ? '' : 's'}`;

// `upstream` is { name, ahead, behind } for the current branch, or null when
// it tracks nothing: Pull counts what is waiting there, Push what is not yet.
export default function Toolbar({ repoPath, currentBranch, changeCount, upstream, theme, onToggleTheme,
  onCommit, onFetch, onPull, onPush, onBranch, onMerge, onStash, onDiscard, onTag }) {
  // The remote operation running from here, if any. Fetch, pull and push can
  // take minutes; while one runs it shows as busy, and none of the three can
  // be started again — a second would only queue behind it on the server.
  const [busy, setBusy] = useState(null);
  const remote = (name, handler) => async () => {
    if (busy) return;
    setBusy(name);
    try {
      await handler();
    } catch {
      // The handler reports its own failures; this only has to end the busy state.
    } finally {
      setBusy(null);
    }
  };
  const remoteProps = (name, handler) => ({
    busy: busy === name, disabled: !!busy, onClick: remote(name, handler),
  });

  const behind = upstream?.behind || 0;
  const ahead = upstream?.ahead || 0;
  const pullTitle = !upstream ? 'Pull (this branch has no upstream)'
    : behind ? `Pull ${commits(behind)} from ${upstream.name}` : `Up to date with ${upstream.name}`;
  const pushTitle = !upstream ? 'Push (this branch has no upstream)'
    : ahead ? `Push ${commits(ahead)} to ${upstream.name}` : `Nothing to push to ${upstream.name}`;

  return (
    <div className="toolbar">
      <div className="tb-actions">
        <TbButton icon="commit" label="Commit" badge={changeCount} onClick={onCommit} />
        <TbButton icon="pull" label="Pull" badge={behind} title={pullTitle} {...remoteProps('pull', onPull)} />
        <TbButton icon="push" label="Push" badge={ahead} title={pushTitle} {...remoteProps('push', onPush)} />
        <TbButton icon="fetch" label="Fetch" title="Fetch from origin" {...remoteProps('fetch', onFetch)} />
        <span className="tb-sep" />
        <TbButton icon="branch" label="Branch" onClick={onBranch} />
        <TbButton icon="merge" label="Merge" onClick={onMerge} />
        <TbButton icon="stash" label="Stash" onClick={onStash} />
        <TbButton icon="discard" label="Discard" danger title="Discard all uncommitted changes" onClick={onDiscard} />
        <TbButton icon="tag" label="Tag" onClick={onTag} />
      </div>
      <div className="tb-right">
        <button className="tb-theme" onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>
        {repoPath && (
          <span className="current-branch-chip" title="Current branch / HEAD">
            <Icon name={currentBranch ? 'branch' : 'warning'} size={13} />
            {currentBranch || 'Detached HEAD'}
          </span>
        )}
        {/* Which repository this tab is on. Read-only: repositories are opened
            and switched through the tab strip, not by editing a path here. */}
        {repoPath && (
          <span className="repo-path" title={repoPath}><span>{repoPath}</span></span>
        )}
      </div>
    </div>
  );
}
