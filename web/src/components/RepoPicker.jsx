import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api.js';

// What the search box holds is a destination rather than a filter when it
// starts like a path. A leading ~ is left for the server to expand, since only
// it knows where home is (see /api/fs/list).
const isPath = (q) => q.startsWith('/') || q.startsWith('~');

// Folder browser for choosing a repository. Git repos are marked and get an
// explicit Open; every row navigates, since repos can contain repos.
export default function RepoPicker({ startPath, onPick, onCancel }) {
  const [dir, setDir] = useState(null); // the last listing that loaded
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  const load = useCallback(async (path) => {
    const r = await api.listDir(path);
    // A failed jump keeps the text, so a typo can be corrected rather than
    // retyped from scratch.
    if (!r.ok) { setError(r.error || 'Cannot read that folder'); return; }
    setError(''); setDir(r); setQuery('');
  }, []);

  useEffect(() => { load(startPath); }, [load, startPath]);
  // Focus the box, not the list: the dialog opens ready to be typed into.
  useEffect(() => { searchRef.current?.focus(); }, []);

  const needle = query.trim().toLowerCase();
  const filtering = needle !== '' && !isPath(query);
  const entries = dir?.entries ?? [];
  const shown = filtering
    ? entries.filter((e) => e.name.toLowerCase().includes(needle))
    : entries;

  const onSearchKey = (e) => {
    if (e.key === 'Escape' && query) {
      e.stopPropagation(); // clearing the box is not a reason to close the dialog
      setQuery('');
      return;
    }
    if (e.key !== 'Enter') return;
    const q = query.trim();
    if (isPath(q)) { load(q); return; }
    // One match left is unambiguous; several would be a guess, so Enter waits.
    if (filtering && shown.length === 1) load(shown[0].path);
  };

  // Present only under Electron (electron/preload.cjs) — an escape hatch to the
  // OS dialog for bookmarks and recent places.
  const pickRepo = window.gitClient?.pickRepo;
  const useSystemDialog = async () => {
    const picked = await pickRepo(dir?.path);
    if (picked) onPick(picked);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Open a repository</div>
        {dir && <div className="picker-path" title={dir.path}><span>{dir.path}</span></div>}
        <input
          ref={searchRef}
          className="picker-search"
          value={query}
          placeholder="Filter this folder, or type a path"
          aria-label="Filter this folder, or type a path"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
        />
        {error && <div className="picker-error">{error}</div>}
        <div className="modal-list">
          {/* Not a match, so it has no place among filtered results. */}
          {dir?.parent && !filtering && (
            <div className="modal-item picker-row" title={`Go up to ${dir.parent}`}
              onClick={() => load(dir.parent)}>
              <span className="picker-icon">↑</span>..
            </div>
          )}
          {dir && entries.length === 0 && !filtering && (
            <div className="modal-empty">No folders here.</div>
          )}
          {filtering && shown.length === 0 && (
            <div className="modal-empty">No folders match “{query.trim()}”.</div>
          )}
          {shown.map((e) => (
            <div key={e.path} className="modal-item picker-row" onClick={() => load(e.path)}>
              <span className={`picker-icon${e.isRepo ? ' is-repo' : ''}`}>{e.isRepo ? '⑂' : '▸'}</span>
              <span className="picker-name">{e.name}</span>
              {e.isRepo && (
                <button className="picker-open" title={`Open ${e.name}`}
                  onClick={(ev) => { ev.stopPropagation(); onPick(e.path); }}>Open</button>
              )}
            </div>
          ))}
        </div>
        {/* Only while filtering: otherwise the list speaks for itself. */}
        {filtering && (
          <div className="picker-count">{shown.length} of {entries.length} folders</div>
        )}
        <div className="modal-actions picker-actions">
          {pickRepo && (
            <button className="picker-system" title="Use the system folder dialog"
              onClick={useSystemDialog}>System…</button>
          )}
          <span className="picker-spacer" />
          <button onClick={onCancel}>Cancel</button>
          <button disabled={!dir} title="Open this folder"
            onClick={() => onPick(dir.path)}>Open</button>
        </div>
      </div>
    </div>
  );
}
