import { useState, useEffect, useCallback } from 'react';
import * as api from './api.js';
import { startHeightDrag } from './resize.js';
import RepoWorkspace from './components/RepoWorkspace.jsx';
import RepoPicker from './components/RepoPicker.jsx';
import TabStrip from './components/TabStrip.jsx';
import './app.css';

// '/home/user/projects/repo' -> '/home/user/projects'; undefined when no
// repo is open, which lets the server default to the home directory.
const parentOf = (p) => (p ? p.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/' : undefined);

// The window: which repositories are open in tabs, plus the furniture shared
// across them (theme, diff pane height). Everything scoped to one repository
// lives in RepoWorkspace — one mounted per tab.
//
// A tab is identified by its repository path. Opening a repository that is
// already open activates its tab instead of duplicating it, which keeps those
// paths unique and lets them serve as both React key and active-tab marker.
export default function App() {
  const [tabs, setTabs] = useState([]); // repo paths, in strip order
  const [activeRepo, setActiveRepo] = useState(null);
  const [restored, setRestored] = useState(false); // don't persist before the session loads
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState(''); // failures to open a repo at all
  const [notice, setNotice] = useState('')
  const [diffHeight, setDiffHeight] = useState(() => Number(localStorage.getItem('diffHeight')) || 240);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  // Drag the splitter to resize the top area (files/commit or graph) vs the diff pane.
  const startDrag = (e) => startHeightDrag(e, {
    from: diffHeight,
    onSize: setDiffHeight,
    onCommit: (h) => localStorage.setItem('diffHeight', String(h)),
  });

  useEffect(() => {
    document.body.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Validate the path, then show it in a tab. The server keeps no "current
  // repo", so this only decides what this window shows.
  const onOpen = useCallback(async (path) => {
    const r = await api.openRepo(path);
    if (!r.ok) { setError(r.error || 'Failed to open'); return; }
    setError('');
    setTabs((prev) => (prev.includes(r.path) ? prev : [...prev, r.path]));
    setActiveRepo(r.path);
  }, []);

  const closeTab = (repo) => {
    const i = tabs.indexOf(repo);
    const next = tabs.filter((p) => p !== repo);
    setTabs(next);
    // Fall to the tab that took its place, or the last one if it was rightmost.
    if (activeRepo === repo) setActiveRepo(next[Math.min(i, next.length - 1)] ?? null);
  };

  // Reorder the strip. Identifying tabs by path means the active tab needs no
  // adjustment, and the persistence effect below stores the new order.
  const moveTab = (repo, to) => setTabs((prev) => {
    const from = prev.indexOf(repo);
    if (from < 0 || to < 0 || to >= prev.length || from === to) return prev;
    const next = [...prev];
    next.splice(to, 0, ...next.splice(from, 1));
    return next;
  });

  // Tab commands come from two places: the Electron application menu, which
  // owns the accelerators a page cannot intercept (Ctrl+W above all), and plain
  // key presses for the browser-based dev case. Both land here.
  const runTabCommand = useCallback((command) => {
    if (command === 'new') { setPickerOpen(true); return; }
    if (command === 'close') { if (activeRepo) closeTab(activeRepo); return; }
    if (command === 'next' || command === 'prev') {
      if (tabs.length < 2) return;
      const step = command === 'next' ? 1 : -1;
      const i = tabs.indexOf(activeRepo);
      setActiveRepo(tabs[(i + step + tabs.length) % tabs.length]); // wraps, like a browser
      return;
    }
    if (command === 'move-left' || command === 'move-right') {
      if (!activeRepo) return;
      // Moving does not wrap: a tab at either end simply stays put.
      moveTab(activeRepo, tabs.indexOf(activeRepo) + (command === 'move-right' ? 1 : -1));
    }
  }, [tabs, activeRepo]); // eslint-disable-line react-hooks/exhaustive-deps -- closeTab closes over these

  useEffect(() => window.gitClient?.onTabCommand?.(runTabCommand), [runTabCommand]);

  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      // Ctrl+Tab is a menu accelerator under Electron; handling it here too
      // would advance two tabs at once, so the page only takes it in a browser.
      if (e.key === 'Tab') {
        if (window.gitClient?.onTabCommand) return;
        e.preventDefault();
        runTabCommand(e.shiftKey ? 'prev' : 'next');
        return;
      }
      // Same guard as Ctrl+Tab: under Electron the menu owns these.
      if (e.shiftKey && (e.key === 'PageUp' || e.key === 'PageDown')) {
        if (window.gitClient?.onTabCommand) return;
        e.preventDefault();
        runTabCommand(e.key === 'PageUp' ? 'move-left' : 'move-right');
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < tabs.length) { e.preventDefault(); setActiveRepo(tabs[i]); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runTabCommand, tabs]);

  // Restore the session: validate every stored path, keep the ones that are
  // still repositories, and say which were dropped. One stale path must not
  // stop the rest of the session from coming back.
  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = JSON.parse(localStorage.getItem('tabs') || 'null');
      const legacy = localStorage.getItem('repoPath'); // pre-tabs single repo
      const paths = stored?.length ? stored : (legacy ? [legacy] : []);

      const checked = await Promise.all(
        paths.map(async (p) => ({ path: p, ok: (await api.openRepo(p)).ok })));
      if (!alive) return;

      const good = checked.filter((c) => c.ok).map((c) => c.path);
      const gone = checked.filter((c) => !c.ok).map((c) => c.path);
      setTabs(good);

      // The stored index points into the list as saved; if the tab it named is
      // gone, fall back to the same position among the survivors.
      const wanted = Number(localStorage.getItem('activeTab') || 0);
      const named = paths[wanted];
      setActiveRepo(good.includes(named) ? named
        : good[Math.min(Math.max(wanted, 0), good.length - 1)] ?? null);

      if (gone.length) {
        setNotice(`Closed ${gone.length === 1 ? 'a repository' : 'repositories'} that ${
          gone.length === 1 ? 'is' : 'are'} no longer there: ${gone.join(', ')}`);
      }
      if (legacy) localStorage.removeItem('repoPath');

      // Whatever the main process wants said about this launch — a fallback
      // port, say. Appended, so it never silently replaces the line above.
      const startup = (await window.gitClient?.getStartupNotices?.()) ?? [];
      if (alive && startup.length) setNotice((n) => [n, ...startup].filter(Boolean).join(' '));

      setRestored(true);
    })();
    return () => { alive = false; };
  }, []);

  // Persist the strip. Guarded on `restored` so the empty initial state never
  // overwrites a stored session before it has loaded.
  useEffect(() => {
    if (!restored) return;
    localStorage.setItem('tabs', JSON.stringify(tabs));
    const i = tabs.indexOf(activeRepo);
    localStorage.setItem('activeTab', String(i < 0 ? 0 : i));
  }, [restored, tabs, activeRepo]);

  return (
    <div className="app">
      {tabs.length > 0 && (
        <TabStrip tabs={tabs} activeRepo={activeRepo} onActivate={setActiveRepo}
          onClose={closeTab} onNew={() => setPickerOpen(true)} onMove={moveTab} />
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
      {/* Every tab stays mounted so it keeps its place; only the active one is
          visible, and only it refreshes. */}
      {tabs.map((repo) => (
        <RepoWorkspace
          key={repo}
          repo={repo}
          active={repo === activeRepo}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          diffHeight={diffHeight}
          onSplitterDrag={startDrag}
        />
      ))}
      {tabs.length === 0 && (
        <div className="no-repo">
          <p>No repository open.</p>
          <button className="repo-browse" onClick={() => setPickerOpen(true)}
            title="Choose a repository folder">📂 Choose a repository…</button>
        </div>
      )}
      {pickerOpen && (
        <RepoPicker
          // Start beside the active repo, where sibling projects live.
          startPath={parentOf(activeRepo)}
          onPick={(p) => { setPickerOpen(false); onOpen(p); }}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
