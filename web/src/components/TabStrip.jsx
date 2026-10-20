import { useState } from 'react';

// Folder names are what you recognise a repository by, but two checkouts can
// share one ('client', 'web'), so a name held by more than one open tab gets
// its parent folder prefixed. Labels only change when a collision appears.
export function tabLabels(tabs) {
  const parts = (p) => p.replace(/\/+$/, '').split('/');
  const base = (p) => parts(p).at(-1) || p;
  const seen = {};
  for (const repo of tabs) seen[base(repo)] = (seen[base(repo)] || 0) + 1;
  return tabs.map((repo) => {
    const name = base(repo);
    if (seen[name] < 2) return name;
    const parent = parts(repo).at(-2);
    return parent ? `${parent}/${name}` : name;
  });
}

export default function TabStrip({ tabs, activeRepo, onActivate, onClose, onNew, onMove }) {
  const labels = tabLabels(tabs);
  // The repo being dragged. Held here rather than read back from dataTransfer,
  // which browsers only allow on drop — reordering has to happen on dragover.
  const [dragging, setDragging] = useState(null);
  return (
    <div className="tab-strip">
      {tabs.map((repo, i) => (
        <div key={repo} title={repo}
          className={`tab${repo === activeRepo ? ' active' : ''}${repo === dragging ? ' dragging' : ''}`}
          draggable
          onDragStart={(e) => {
            setDragging(repo);
            // Chromium refuses to start a drag with no payload.
            e.dataTransfer.setData('text/plain', repo);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => setDragging(null)}
          // Reorder as the cursor crosses a tab, so the strip follows the drag
          // instead of showing a drop marker.
          onDragOver={(e) => {
            if (!dragging || dragging === repo) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            onMove(dragging, i);
          }}
          onClick={() => onActivate(repo)}
          // Middle-click closes, as in a browser; button 1 only, so a
          // right-click context menu never closes a tab.
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(repo); } }}>
          <span className="tab-label">{labels[i]}</span>
          <button className="tab-close" title={`Close ${labels[i]}`}
            onClick={(e) => { e.stopPropagation(); onClose(repo); }}>✕</button>
        </div>
      ))}
      {/* The only way to open a repository: a tab-shaped + at the end of the
          strip, which opens the folder picker. */}
      <button className="tab tab-new" title="Open a repository folder" onClick={onNew}>+</button>
    </div>
  );
}
