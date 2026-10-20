import { useState, useEffect, useRef } from 'react';
import ContextMenu from './ContextMenu.jsx';
import CommitBox from './CommitBox.jsx';

// How each unmerged XY pair reads to a person: who changed or removed what.
const CONFLICT_KIND = {
  UU: 'Both modified', AA: 'Both added', DD: 'Both deleted',
  AU: 'Added by us', UA: 'Added by them', DU: 'Deleted by us', UD: 'Deleted by them',
};

// `showCommit` is false where the panel puts the commit box below both panes
// instead of at the foot of this column.
export default function FileStatus({ client, status, onRefresh, onSelectFile, onDiscardFile, onDeleteFile, onIgnoreFile,
  onResolveFile, onMarkResolved, onCommitError, selected, showCommit = true }) {
  const [menu, setMenu] = useState(null);
  const s = status || { staged: [], unstaged: [], untracked: [] };
  const conflicted = s.conflicted || [];
  // A file can appear both staged and unstaged, so match on path AND side.
  const isSel = (path, staged) => selected && selected.path === path && selected.staged === staged;

  // A rename is staged or unstaged as a pair: unstaging only the new path
  // would leave the original path deleted in the index.
  const pathsOf = (f) => (f.origPath ? [f.path, f.origPath] : [f.path]);
  const doStage = async (f) => { await client.stage(pathsOf(f)); onRefresh(); };
  const doUnstage = async (f) => { await client.unstage(pathsOf(f)); onRefresh(); };
  // What onSelectFile needs to ask for the diff: the path, plus a rename's original.
  const target = (f) => (f.origPath ? { path: f.path, origPath: f.origPath } : { path: f.path });
  const label = (f) => (f.origPath ? `${f.origPath} → ${f.path}` : f.path);
  const unstagedAll = [
    ...s.unstaged.map(f => ({ ...f })),
    ...s.untracked.map(p => ({ path: p, status: '?' }))
  ];
  // Conflicts are left out of "Stage all": staging one marks it resolved,
  // which should be a deliberate act on that file alone.
  const stageAll = async () => { await client.stage(unstagedAll.flatMap(pathsOf)); onRefresh(); };
  const unstageAll = async () => { await client.unstage(s.staged.flatMap(pathsOf)); onRefresh(); };

  // Every row in screen order, for the arrow keys.
  const rows = [
    ...conflicted.map((f) => ({ f: { ...f, conflict: true }, staged: false, list: conflicted })),
    ...s.staged.map((f) => ({ f, staged: true, list: s.staged })),
    ...unstagedAll.map((f) => ({ f, staged: false, list: unstagedAll })),
  ];
  const current = selected ? rows.findIndex((r) => isSel(r.f.path, r.staged)) : -1;

  // Up/Down move the selection (and so the diff); Space stages or unstages
  // the selected file, then selects the next one in the same pane, so a run
  // of Spaces works down the list. Keys typed into the commit box are its own.
  const onKeyDown = (e) => {
    const tag = e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = current === -1 ? 0 : current + (e.key === 'ArrowDown' ? 1 : -1);
      if (next !== current && rows[next]) onSelectFile(target(rows[next].f), rows[next].staged);
    } else if (e.key === ' ' && tag !== 'BUTTON') {
      e.preventDefault();
      const row = rows[current];
      if (!row || row.f.conflict) return;
      const i = row.list.indexOf(row.f);
      const after = row.list[i + 1] || row.list[i - 1];
      (async () => {
        await (row.staged ? client.unstage : client.stage)(pathsOf(row.f));
        // With the pane emptied, follow the file to the side it moved to.
        if (after) onSelectFile(target(after), row.staged);
        else onSelectFile(target(row.f), !row.staged);
        onRefresh();
      })();
    }
  };

  // Keep a row moved to with the keys in view.
  const root = useRef(null);
  useEffect(() => {
    root.current?.querySelector('.fs-row.selected')?.scrollIntoView?.({ block: 'nearest' });
  }, [selected?.path, selected?.staged]);

  // The name is what tells files apart; the directory is context, dimmed.
  const pathCell = (f, staged) => {
    const cut = f.path.lastIndexOf('/');
    return (
      <span className="fs-path" title={label(f)} onClick={() => onSelectFile(target(f), staged)}>
        <span className="fs-name">{f.path.slice(cut + 1)}</span>
        {cut > 0 && <span className="fs-dir">{f.path.slice(0, cut)}</span>}
        {f.origPath && <span className="fs-orig">← {f.origPath}</span>}
      </span>
    );
  };

  const openMenu = (e, f) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, file: f });
  };

  const conflictMenuItems = (f) => [
    { label: 'Resolve using mine', onClick: () => onResolveFile(f.path, 'ours') },
    { label: 'Resolve using theirs', onClick: () => onResolveFile(f.path, 'theirs') },
    { label: 'Mark resolved', onClick: () => onMarkResolved(f.path) },
    { label: 'View diff', onClick: () => onSelectFile(target(f), false) },
  ];

  const menuItems = (f) => {
    if (f.conflict) return conflictMenuItems(f);
    const items = [
      { label: 'Stage', onClick: () => doStage(f) },
      { label: 'View diff', onClick: () => onSelectFile(target(f), false) },
      { label: 'Add to .gitignore', onClick: () => onIgnoreFile(f.path) },
    ];
    if (f.status === '?') {
      items.push({ label: 'Delete file', danger: true, onClick: () => onDeleteFile(f.path) });
    } else {
      items.push({ label: 'Discard changes', danger: true, onClick: () => onDiscardFile(f.path) });
    }
    return items;
  };

  return (
    <div className="file-status" tabIndex={0} ref={root} onKeyDown={onKeyDown}>
      {conflicted.length > 0 && (
        <div className="fs-pane fs-conflicted">
          <div className="fs-pane-title">Conflicts ({conflicted.length})</div>
          {conflicted.map(f => (
            <div key={f.path} title={CONFLICT_KIND[f.status] || 'Conflicted'}
              className={`fs-row${isSel(f.path, false) ? ' selected' : ''}`}
              onContextMenu={(e) => openMenu(e, { ...f, conflict: true })}>
              <span className="fs-code">{f.status}</span>
              {pathCell(f, false)}
              <button aria-label={`mark ${f.path} resolved`} title="Mark resolved"
                onClick={() => onMarkResolved(f.path)}>✓</button>
            </div>
          ))}
        </div>
      )}
      <div className="fs-pane fs-staged">
        <div className="fs-pane-title">
          <span>Staged ({s.staged.length})</span>
          <button className="fs-bulk" onClick={unstageAll} disabled={s.staged.length === 0}>Unstage all</button>
        </div>
        {s.staged.length === 0 && <div className="fs-empty">No staged changes</div>}
        {s.staged.map(f => (
          <div key={f.path} className={`fs-row${isSel(f.path, true) ? ' selected' : ''}`}>
            <span className="fs-code">{f.status}</span>
            {pathCell(f, true)}
            <button aria-label={`unstage ${f.path}`} onClick={() => doUnstage(f)}>−</button>
          </div>
        ))}
      </div>
      <div className="fs-pane fs-unstaged">
        <div className="fs-pane-title">
          <span>Unstaged ({unstagedAll.length})</span>
          <button className="fs-bulk" onClick={stageAll} disabled={unstagedAll.length === 0}>Stage all</button>
        </div>
        {unstagedAll.length === 0 && <div className="fs-empty">No unstaged changes</div>}
        {unstagedAll.map(f => (
          <div key={f.path} className={`fs-row${isSel(f.path, false) ? ' selected' : ''}`}
            onContextMenu={(e) => openMenu(e, f)}>
            <span className="fs-code">{f.status}</span>
            {pathCell(f, false)}
            <button aria-label={`stage ${f.path}`} onClick={() => doStage(f)}>＋</button>
          </div>
        ))}
      </div>
      {showCommit && <CommitBox client={client} onRefresh={onRefresh}
        mergeMessage={s.merge?.message} onError={onCommitError} />}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.file)} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
