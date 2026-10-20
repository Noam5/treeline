import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import ContextMenu from './ContextMenu.jsx';
import RefPill from './RefPill.jsx';
import { relativeDate, initials, parseRefs, avatarColor } from '../format.js';

// The commit HEAD points at: decorated as "HEAD" (detached) or "HEAD -> branch".
const isHeadRef = (r) => /^HEAD($| -> )/.test(r);

// Row height and node radius per density. Only the rows near the viewport are
// rendered, so a history of any length costs about the same to draw. Rows have
// a fixed height, so which ones are visible follows from the scroll offset alone.
const DENSITY = { comfortable: { row: 44, r: 6 }, compact: { row: 30, r: 5 } };
const loadDensity = () => {
  try { return localStorage.getItem('graphDensity') === 'compact' ? 'compact' : 'comfortable'; }
  catch { return 'comfortable'; }
};
const HEAD_H = 28; // the sticky column header, scrolled with the rows
const OVERSCAN = 20; // extra rows rendered past each edge of the viewport
const UNMEASURED_ROWS = 40; // viewport height, in rows, to assume until layout measures one
const LOAD_AHEAD = 100; // ask for more history once the end is this many rows away
const laneX = (lane) => 12 + lane * 18;
const shortHash = (h) => (h || '').slice(0, 7);

const DEFAULT_WIDTHS = { commit: 84, author: 200, date: 132 };
function loadWidths() {
  try { return { ...DEFAULT_WIDTHS, ...JSON.parse(localStorage.getItem('colWidths') || '{}') }; }
  catch { return { ...DEFAULT_WIDTHS }; }
}

// Build the SVG path connecting a child commit's node down to one parent's node.
function edgePath(x1, y1, x2, y2) {
  if (x1 === x2) return `M${x1},${y1} L${x2},${y2}`;
  const midY = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
}

// `hasMore` says the server holds older history than `commits`; the graph
// calls `onLoadMore` once per length of `commits` when scrolled near its end.
export default function CommitGraph({ commits, onSelect, onCheckout, onCreateBranchAt, onTagAt, selected,
  localBranches = [], currentBranch = null, hasMore = false, onLoadMore }) {
  const [w, setW] = useState(loadWidths);
  const [menu, setMenu] = useState(null);
  const [density, setDensity] = useState(loadDensity);
  const { row: ROW, r: R } = DENSITY[density];
  const UNMEASURED_H = UNMEASURED_ROWS * ROW;
  const yCenter = (i) => i * ROW + ROW / 2;

  // The graph is its own scroll container. Its offset and height decide which
  // rows are rendered, so both are mirrored into state on scroll and resize.
  const scrollRef = useRef(null);
  const [view, setView] = useState({ top: 0, height: 0 });
  const measure = () => {
    const el = scrollRef.current;
    if (el) setView({ top: el.scrollTop, height: el.clientHeight });
  };
  useEffect(() => {
    // Absent in jsdom; a hidden tab also measures 0 until it is shown.
    if (typeof ResizeObserver === 'undefined' || !scrollRef.current) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, []);

  // Whether row `i` is wholly on screen, below the sticky header.
  const inView = (el, i) => {
    const top = i * ROW;
    const height = el.clientHeight || UNMEASURED_H;
    return top >= el.scrollTop && top + ROW + HEAD_H <= el.scrollTop + height;
  };

  // Switching density keeps the commit at the top of the screen where it was.
  // The new offset is set once the rows have their new height, so a taller
  // graph is not clamped to the old one's scroll range.
  const anchorRow = useRef(null);
  const toggleDensity = () => {
    const next = density === 'compact' ? 'comfortable' : 'compact';
    anchorRow.current = scrollRef.current ? scrollRef.current.scrollTop / ROW : 0;
    setDensity(next);
    try { localStorage.setItem('graphDensity', next); } catch { /* not persisted */ }
  };
  useLayoutEffect(() => {
    if (anchorRow.current === null || !scrollRef.current) return;
    scrollRef.current.scrollTop = Math.round(anchorRow.current * ROW);
    anchorRow.current = null;
    measure();
  }, [ROW]);

  // Bring HEAD into view when the checked-out commit changes (branch or commit
  // switch), pinned just under the sticky header — but only when it is off
  // screen, so a HEAD near the top leaves the working row and newer tips above
  // it in view. The row may not be rendered yet, so this scrolls by offset
  // rather than by element.
  const headIndex = commits.findIndex((c) => (c.refs || []).some(isHeadRef));
  const headHash = headIndex === -1 ? undefined : commits[headIndex].hash;
  useEffect(() => {
    const el = scrollRef.current;
    if (headIndex === -1 || !el || inView(el, headIndex)) return;
    el.scrollTop = headIndex * ROW;
    measure();
  }, [headHash]);

  // Bring a newly selected row into view, pinned to the top like HEAD: a ref
  // picked in the sidebar can point far below the screen. Once per selection,
  // so a re-read that shifts the rows (e.g. the working node coming or going)
  // does not pull the user back to it.
  const selectedIndex = selected ? commits.findIndex((c) => c.hash === selected) : -1;
  const scrolledTo = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (selected === scrolledTo.current || selectedIndex === -1 || !el) return;
    scrolledTo.current = selected;
    if (inView(el, selectedIndex)) return;
    el.scrollTop = selectedIndex * ROW;
    measure();
  }, [selected, selectedIndex]);

  // The rendered window: rows [first, last], both inclusive.
  const viewH = view.height || UNMEASURED_H;
  const first = Math.max(0, Math.floor((view.top - HEAD_H) / ROW) - OVERSCAN);
  const last = Math.min(commits.length - 1, Math.ceil((view.top + viewH - HEAD_H) / ROW) + OVERSCAN);

  // Ask for older history as the window nears the end of what is loaded —
  // once per length, so re-renders and repeated scroll events don't pile up
  // requests for the same page.
  const askedAt = useRef(null);
  useEffect(() => {
    if (!hasMore || !onLoadMore || last < commits.length - 1 - LOAD_AHEAD) return;
    if (askedAt.current === commits.length) return;
    askedAt.current = commits.length;
    onLoadMore();
  });

  const openMenu = (e, commit) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, commit });
  };

  // Local branches that point at this commit (excluding the current branch,
  // which is already checked out). Lets you attach to the branch rather than
  // detaching at the commit.
  const branchesAt = (commit) => (commit.refs || [])
    .map((r) => r.replace(/^HEAD -> /, ''))
    .filter((r) => localBranches.includes(r) && r !== currentBranch);

  const menuItems = (commit) => [
    ...branchesAt(commit).map((b) => ({ label: `Checkout ${b}`, onClick: () => onCheckout && onCheckout(b) })),
    { label: 'Checkout commit', onClick: () => onCheckout && onCheckout(commit.hash) },
    { label: 'Create branch here…', onClick: () => onCreateBranchAt && onCreateBranchAt(commit.hash) },
    { label: 'Create tag here…', onClick: () => onTagAt && onTagAt(commit.hash) },
    { label: 'Copy SHA', onClick: () => navigator.clipboard?.writeText(commit.hash) },
  ];
  const rowOf = new Map(commits.map((c, i) => [c.hash, i]));
  const maxLane = commits.reduce(
    (m, c) => Math.max(m, c.lane, ...c.connectors.map((k) => k.toLane)),
    0
  );
  const graphWidth = laneX(maxLane) + 24;
  const graphHeight = Math.max(commits.length * ROW, ROW);

  // Every edge is checked, since one from far above can cross the window;
  // only those that do are drawn. Collected into a flat list of just those:
  // a child per commit, mostly empty, makes React walk all of them for each
  // edge it inserts — tens of seconds after jumping deep into a big history.
  const edges = [];
  for (let i = 0; i <= last; i++) {
    const c = commits[i];
    c.connectors.forEach((k, ki) => {
      const parentHash = c.parents ? c.parents[ki] : undefined;
      // A parent that is not loaded yet sits below everything shown:
      // the edge runs off the bottom in the lane it is headed for.
      const unloaded = c.parents && !rowOf.has(parentHash);
      const target = unloaded ? commits.length : (rowOf.get(parentHash) ?? i + 1);
      if (target < first) return;
      if (!unloaded && target >= commits.length) return;
      const [x2, y2] = unloaded
        ? [laneX(k.toLane), graphHeight]
        : [laneX(commits[target].lane), yCenter(target)];
      edges.push(
        <path
          key={`${c.hash}-${ki}`}
          d={edgePath(laneX(c.lane), yCenter(i), x2, y2)}
          stroke={c.color}
          strokeWidth="2"
          fill="none"
        />
      );
    });
  }

  const cw = (key) => ({ flex: `0 0 ${w[key]}px`, width: w[key] });

  // Drag a column's right edge to resize it; Description (flex) absorbs the change.
  const startResize = (key) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = w[key];
    let latest = startW;
    const onMove = (ev) => {
      latest = Math.max(50, startW + (ev.clientX - startX));
      setW((prev) => ({ ...prev, [key]: latest }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      localStorage.setItem('colWidths', JSON.stringify({ ...w, [key]: latest }));
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const Handle = ({ col }) => (
    <span className="col-resize" onMouseDown={startResize(col)} />
  );

  return (
    <div className="commit-graph" ref={scrollRef} onScroll={measure}>
      <div className="graph-head">
        <span className="graph-head-graph" style={{ flex: `0 0 ${graphWidth}px` }}>Graph</span>
        <span className="col-commit" style={cw('commit')}>Commit<Handle col="commit" /></span>
        <span className="col-author" style={cw('author')}>Author<Handle col="author" /></span>
        <span className="col-desc">Description</span>
        <span className="col-date" style={cw('date')}>Date<Handle col="date" /></span>
        <button className="graph-density" onClick={toggleDensity}
          aria-label={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}
          title={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}>
          {density === 'compact' ? '☰' : '≡'}
        </button>
      </div>

      <div className="graph-body">
        <svg
          className="graph-svg"
          width={graphWidth}
          height={graphHeight}
          style={{ flex: `0 0 ${graphWidth}px` }}
        >
          {edges}
          {commits.slice(first, last + 1).map((c, j) => (
            <circle
              key={c.hash}
              className="graph-node"
              cx={laneX(c.lane)}
              cy={yCenter(first + j)}
              r={R}
              fill={c.working ? undefined : c.color}
              style={c.working ? { fill: 'var(--bg)', stroke: c.color, strokeWidth: 2 } : undefined}
            />
          ))}
        </svg>

        <div className="graph-rows" style={{ height: graphHeight, paddingTop: first * ROW }}>
          {commits.slice(first, last + 1).map((c) => { const when = relativeDate(c.date); return (
            <div
              key={c.hash}
              className={`graph-row${c.working ? ' working' : ''}${c.hash === selected ? ' selected' : ''}${c.hash === headHash ? ' head' : ''}`}
              style={{ height: ROW }}
              title={c.working ? 'View uncommitted changes' : 'Double-click to check out · right-click for actions'}
              onClick={() => onSelect(c.hash)}
              onDoubleClick={() => !c.working && onCheckout && onCheckout(c.hash)}
              onContextMenu={(e) => !c.working && openMenu(e, c)}
            >
              <div className="col-commit mono" style={cw('commit')}>{c.working ? '' : shortHash(c.hash)}</div>
              <div className="col-author" style={cw('author')}
                title={c.email ? `${c.author} <${c.email}>` : c.author}>
                {!c.working && (
                  <span className="avatar" style={{ background: avatarColor(c.email || c.author) }}>
                    {initials(c.author)}
                  </span>
                )}
                <span className="author-name">{c.author}</span>
              </div>
              <div className="col-desc">
                {c.working
                  ? <span className="working-label">✎ {c.subject}</span>
                  : <>
                      {parseRefs(c.refs, localBranches).map((r) => (
                        <RefPill key={`${r.kind}:${r.name}`} kind={r.kind} name={r.name} color={c.color} />
                      ))}
                      {c.subject}
                    </>}
              </div>
              <div className="col-date" style={cw('date')} title={when.title}>{when.text}</div>
            </div>
          ); })}
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.commit)} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
