import { useState } from 'react';
import ContextMenu from './ContextMenu.jsx';

export default function Sidebar({ branches, stashes, tags, view, onView, onCheckout, onSelectBranch, selectedBranch,
  onSelectTag, selectedTag,
  onApplyStash, onMergeBranch, onRenameBranch, onDeleteBranch, onDeleteTag, onPopStash, onDropStash, onShowStashDiff }) {
  const b = branches || { current: null, local: [], remote: [] };
  const stashList = stashes || [];
  // Already newest-first from the server; the order is not re-derived here.
  const tagList = tags || [];
  // A single context menu serves both branches and stashes; it stores the
  // already-built items so the trigger decides what actions to show.
  const [menu, setMenu] = useState(null);

  const openMenu = (e, items) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // Actions for the right-clicked branch. The current branch can only be
  // renamed — checkout/merge/delete are nonsensical against itself.
  const branchItems = (name) => {
    const current = name === b.current;
    const items = [];
    if (!current) items.push({ label: 'Checkout', onClick: () => onCheckout(name) });
    if (!current) items.push({ label: `Merge into ${b.current}`, onClick: () => onMergeBranch(name) });
    items.push({ label: 'Rename…', onClick: () => onRenameBranch(name) });
    if (!current) items.push({ label: 'Delete', danger: true, onClick: () => onDeleteBranch(name) });
    return items;
  };

  // A tag names a commit and nothing else: there is no branch to merge and
  // renaming would mean deleting and recreating it, so neither is offered.
  const tagItems = (name) => [
    { label: 'Checkout', onClick: () => onCheckout(name) },
    { label: 'Delete', danger: true, onClick: () => onDeleteTag(name) },
  ];

  const stashItems = (ref) => [
    { label: 'Apply', onClick: () => onApplyStash(ref) },
    { label: 'Pop', onClick: () => onPopStash(ref) },
    { label: 'View diff', onClick: () => onShowStashDiff(ref) },
    { label: 'Drop', danger: true, onClick: () => onDropStash(ref) },
  ];

  return (
    <div className="sidebar">
      <div className="label">Workspace</div>
      <div className={view === 'status' ? 'active' : ''} onClick={() => onView('status')}>File Status</div>
      <div className={view === 'history' ? 'active' : ''} onClick={() => onView('history')}>History</div>
      <div className={view === 'search' ? 'active' : ''} onClick={() => onView('search')}>Search</div>
      <div className="label">Branches</div>
      {[...b.local]
        .sort((a, c) => (a === b.current ? -1 : c === b.current ? 1 : 0))
        .map((name) => (
        <div key={name}
          className={`${name === b.current ? 'current-branch' : ''}${name === selectedBranch ? ' selected-branch' : ''}`}
          title="Click to select · double-click to check out · right-click for actions"
          onClick={() => onSelectBranch(name)}
          onContextMenu={(e) => openMenu(e, branchItems(name))}
          onDoubleClick={() => name !== b.current && onCheckout(name)}>
          {name === b.current ? '● ' : '⑂ '}{name}
        </div>
      ))}
      <div className="label">Remotes</div>
      {b.remote.map((name) => <div key={name}>☁ {name}</div>)}
      <div className="label">Tags</div>
      {tagList.length === 0
        ? <div className="sidebar-empty">No tags</div>
        : tagList.map((name) => (
            <div key={name}
              className={`tag-row${name === selectedTag ? ' selected-tag' : ''}`}
              title={`Click to select · double-click to check out · right-click for actions`}
              onClick={() => onSelectTag(name)}
              onDoubleClick={() => onCheckout(name)}
              onContextMenu={(e) => openMenu(e, tagItems(name))}>
              🏷 {name}
            </div>
          ))}
      <div className="label">Stashes</div>
      {stashList.length === 0
        ? <div className="sidebar-empty">No stashes</div>
        : stashList.map((s) => (
            <div key={s.ref} title={`Click to apply ${s.ref} · right-click for actions`}
              onClick={() => onApplyStash(s.ref)}
              onContextMenu={(e) => openMenu(e, stashItems(s.ref))}>
              📦 {s.message || s.ref}
            </div>
          ))}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
