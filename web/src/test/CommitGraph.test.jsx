import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CommitGraph from '../components/CommitGraph.jsx';

const ROW = 44; // one graph row, in px (the default, comfortable density)

// Density is remembered across renders; every test starts from the default.
beforeEach(() => localStorage.clear());

const commits = [
  { hash: 'aaa', subject: 'second', author: 'me', date: '2026-06-01', refs: ['main'],
    lane: 0, color: '#4c8dff', connectors: [{ fromLane: 0, toLane: 0, type: 'straight' }] },
  { hash: 'bbb', subject: 'first', author: 'me', date: '2026-05-31', refs: [],
    lane: 0, color: '#4c8dff', connectors: [] }
];

describe('CommitGraph HEAD on top', () => {
  const withHead = [
    { hash: 'aaa', subject: 'tip', author: 'me', date: 'd', refs: ['gas-x'],
      lane: 0, color: '#4c8dff', connectors: [] },
    { hash: 'bbb', subject: 'head here', author: 'me', date: 'd', refs: ['HEAD -> main', 'main'],
      lane: 0, color: '#4c8dff', connectors: [] },
  ];

  it('marks the HEAD commit row with a head class', () => {
    const { container } = render(<CommitGraph commits={withHead} onSelect={() => {}} />);
    const headRow = screen.getByText('head here').closest('.graph-row');
    const otherRow = screen.getByText('tip').closest('.graph-row');
    expect(headRow.className).toContain('head');
    expect(otherRow.className).not.toContain('head');
  });

  it('leaves the scroll alone when HEAD is already on screen, keeping the rows above it in view', () => {
    const withWorking = [
      { hash: 'WORKING', working: true, subject: 'Uncommitted changes', author: '', date: '',
        refs: [], lane: 0, color: '#4c8dff', connectors: [] },
      ...withHead,
    ];
    const { container } = render(<CommitGraph commits={withWorking} onSelect={() => {}} />);
    expect(container.querySelector('.commit-graph').scrollTop).toBe(0);
    expect(screen.getByText(/Uncommitted changes/)).toBeTruthy();
  });

  it('scrolls HEAD to the top when it moves off screen', () => {
    const page = history(5000);
    const { container, rerender } = render(<CommitGraph commits={page} onSelect={() => {}} />);
    const scroller = container.querySelector('.commit-graph');
    expect(scroller.scrollTop).toBe(0);
    const moved = page.map((c, i) => (i === 3000 ? { ...c, refs: ['HEAD -> main', 'main'] } : c));
    rerender(<CommitGraph commits={moved} onSelect={() => {}} />);
    expect(scroller.scrollTop).toBe(3000 * ROW);
  });

  it('does not scroll when HEAD moves to a row that is already on screen', () => {
    const page = history(5000);
    const at = (i) => page.map((c, j) => (j === i ? { ...c, refs: ['HEAD -> main'] } : c));
    const { container, rerender } = render(<CommitGraph commits={at(3)} onSelect={() => {}} />);
    rerender(<CommitGraph commits={at(5)} onSelect={() => {}} />);
    expect(container.querySelector('.commit-graph').scrollTop).toBe(0);
  });
});

describe('CommitGraph density', () => {
  const COMPACT = 30;

  it('starts comfortable, with full-height rows', () => {
    const { container } = render(<CommitGraph commits={commits} onSelect={() => {}} />);
    expect(container.querySelector('.graph-row').style.height).toBe(`${ROW}px`);
  });

  it('switches to compact rows from the header, and remembers it', () => {
    const { container } = render(<CommitGraph commits={history(50)} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /compact rows/i }));
    expect(container.querySelector('.graph-row').style.height).toBe(`${COMPACT}px`);
    expect(container.querySelector('.graph-svg').getAttribute('height')).toBe(String(50 * COMPACT));
    expect(localStorage.getItem('graphDensity')).toBe('compact');
  });

  it('starts from the remembered density', () => {
    localStorage.setItem('graphDensity', 'compact');
    const { container } = render(<CommitGraph commits={history(50)} onSelect={() => {}} />);
    expect(container.querySelector('.graph-row').style.height).toBe(`${COMPACT}px`);
    expect(screen.getByRole('button', { name: /comfortable rows/i })).toBeTruthy();
  });

  it('keeps the same commit at the top when the density changes', () => {
    const { container } = render(<CommitGraph commits={history(5000)} onSelect={() => {}} />);
    const scroller = container.querySelector('.commit-graph');
    scroller.scrollTop = 3000 * ROW;
    fireEvent.scroll(scroller);
    fireEvent.click(screen.getByRole('button', { name: /compact rows/i }));
    expect(scroller.scrollTop).toBe(3000 * COMPACT);
    expect(screen.getByText('commit 3000')).toBeTruthy();
  });

  it('pins an off-screen HEAD using the compact row height', () => {
    localStorage.setItem('graphDensity', 'compact');
    const page = history(5000);
    const { container, rerender } = render(<CommitGraph commits={page} onSelect={() => {}} />);
    const moved = page.map((c, i) => (i === 3000 ? { ...c, refs: ['HEAD -> main'] } : c));
    rerender(<CommitGraph commits={moved} onSelect={() => {}} />);
    expect(container.querySelector('.commit-graph').scrollTop).toBe(3000 * COMPACT);
  });
});

describe('CommitGraph', () => {
  it('renders a row per commit with its subject', () => {
    render(<CommitGraph commits={commits} onSelect={() => {}} />);
    expect(screen.getByText('second')).toBeTruthy();
    expect(screen.getByText('first')).toBeTruthy();
  });

  it('renders ref pills', () => {
    render(<CommitGraph commits={commits} onSelect={() => {}} />);
    expect(screen.getByText('main')).toBeTruthy();
  });

  it('shows column headers and the short commit id', () => {
    const longHash = [
      { hash: '1234567890abcdef', subject: 'x', author: 'me', date: '2026-06-01 10:00', refs: [],
        lane: 0, color: '#4c8dff', connectors: [] },
    ];
    render(<CommitGraph commits={longHash} onSelect={() => {}} />);
    expect(screen.getByText('Commit')).toBeTruthy();
    expect(screen.getByText('Description')).toBeTruthy();
    expect(screen.getByText('1234567')).toBeTruthy(); // short hash (7 chars)
  });

  it('calls onSelect with the hash when a row is clicked', () => {
    const onSelect = vi.fn();
    render(<CommitGraph commits={commits} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('second'));
    expect(onSelect).toHaveBeenCalledWith('aaa');
  });

  it('marks the selected commit row with the selected class', () => {
    const { container } = render(
      <CommitGraph commits={commits} onSelect={() => {}} selected="bbb" />
    );
    const rows = container.querySelectorAll('.graph-row');
    // commits[1] is 'bbb' ('first') — it should be selected, commits[0] not.
    expect(rows[0].className).not.toContain('selected');
    expect(rows[1].className).toContain('selected');
  });

  it('calls onCheckout with the hash when a row is double-clicked', () => {
    const onCheckout = vi.fn();
    render(<CommitGraph commits={commits} onSelect={() => {}} onCheckout={onCheckout} />);
    fireEvent.doubleClick(screen.getByText('second'));
    expect(onCheckout).toHaveBeenCalledWith('aaa');
  });

  it('shows a context menu with commit actions on right-click', () => {
    render(<CommitGraph commits={commits} onSelect={() => {}} />);
    fireEvent.contextMenu(screen.getByText('second'));
    expect(screen.getByText('Checkout commit')).toBeTruthy();
    expect(screen.getByText('Create branch here…')).toBeTruthy();
    expect(screen.getByText('Create tag here…')).toBeTruthy();
    expect(screen.getByText('Copy SHA')).toBeTruthy();
  });

  it('offers Checkout <branch> for a commit that is a local branch tip', () => {
    const onCheckout = vi.fn();
    const withBranch = [
      { hash: 'aaa', subject: 'tip', author: 'me', date: 'd', refs: ['feature-x', 'origin/feature-x', 'tag: v1'],
        lane: 0, color: '#4c8dff', connectors: [] },
    ];
    render(<CommitGraph commits={withBranch} onSelect={() => {}} onCheckout={onCheckout}
      localBranches={['feature-x']} currentBranch={null} />);
    fireEvent.contextMenu(screen.getByText('tip'));
    fireEvent.click(screen.getByText('Checkout feature-x'));
    expect(onCheckout).toHaveBeenCalledWith('feature-x');
  });

  it('does not offer Checkout <branch> for the current branch (no-op)', () => {
    const withBranch = [
      { hash: 'aaa', subject: 'tip', author: 'me', date: 'd', refs: ['HEAD -> main', 'main'],
        lane: 0, color: '#4c8dff', connectors: [] },
    ];
    render(<CommitGraph commits={withBranch} onSelect={() => {}}
      localBranches={['main']} currentBranch="main" />);
    fireEvent.contextMenu(screen.getByText('tip'));
    expect(screen.queryByText('Checkout main')).toBeNull();
    expect(screen.getByText('Checkout commit')).toBeTruthy(); // detached option still there
  });

  it('checks out the right-clicked commit from the menu', () => {
    const onCheckout = vi.fn();
    render(<CommitGraph commits={commits} onSelect={() => {}} onCheckout={onCheckout} />);
    fireEvent.contextMenu(screen.getByText('second'));
    fireEvent.click(screen.getByText('Checkout commit'));
    expect(onCheckout).toHaveBeenCalledWith('aaa');
  });

  it('calls onCreateBranchAt for the right-clicked commit', () => {
    const onCreateBranchAt = vi.fn();
    render(<CommitGraph commits={commits} onSelect={() => {}} onCreateBranchAt={onCreateBranchAt} />);
    fireEvent.contextMenu(screen.getByText('second'));
    fireEvent.click(screen.getByText('Create branch here…'));
    expect(onCreateBranchAt).toHaveBeenCalledWith('aaa');
  });

  it('does not show a context menu for the working row', () => {
    const working = [
      { hash: 'WORKING', working: true, subject: 'Uncommitted changes', author: '', date: '',
        refs: [], lane: 0, color: '#4c8dff', connectors: [] },
    ];
    render(<CommitGraph commits={working} onSelect={() => {}} />);
    fireEvent.contextMenu(screen.getByText(/Uncommitted changes/));
    expect(screen.queryByText('Checkout commit')).toBeNull();
  });

  it('draws the connector to the parent node\'s actual lane, not the connector toLane', () => {
    // child is on lane 1; its connector mislabels toLane as 1, but the parent
    // node actually lives on lane 0 (x=12). The line must reach x=12.
    const forked = [
      { hash: 'child', subject: 'child', author: 'me', date: 'd', refs: [],
        lane: 1, color: '#fff', parents: ['par'], connectors: [{ fromLane: 1, toLane: 1, type: 'straight' }] },
      { hash: 'par', subject: 'par', author: 'me', date: 'd', refs: [],
        lane: 0, color: '#fff', parents: [], connectors: [] },
    ];
    const { container } = render(<CommitGraph commits={forked} onSelect={() => {}} />);
    const d = container.querySelector('path').getAttribute('d');
    expect(d).toMatch(/12,/); // ends at laneX(0) = 12, the parent's real lane
  });
});

// A long linear history: commit i's parent is commit i + 1.
const history = (n) => Array.from({ length: n }, (_, i) => ({
  hash: `h${i}`, parents: i + 1 < n ? [`h${i + 1}`] : [], subject: `commit ${i}`, author: 'me',
  date: 'd', refs: [], lane: 0, color: '#4c8dff',
  connectors: i + 1 < n ? [{ fromLane: 0, toLane: 0, type: 'straight' }] : [],
}));

describe('CommitGraph with a long history', () => {
  it('renders only the rows near the viewport', () => {
    const { container } = render(<CommitGraph commits={history(5000)} onSelect={() => {}} />);
    expect(screen.getByText('commit 0')).toBeTruthy();
    expect(screen.queryByText('commit 4999')).toBeNull();
    expect(container.querySelectorAll('.graph-row').length).toBeLessThan(200);
    expect(container.querySelectorAll('.graph-node').length).toBeLessThan(200);
  });

  it('keeps the full scroll height, so the scrollbar reflects the whole history', () => {
    const { container } = render(<CommitGraph commits={history(5000)} onSelect={() => {}} />);
    expect(container.querySelector('.graph-svg').getAttribute('height')).toBe(String(5000 * ROW));
  });

  it('renders the rows scrolled to', () => {
    const { container } = render(<CommitGraph commits={history(5000)} onSelect={() => {}} />);
    const scroller = container.querySelector('.commit-graph');
    scroller.scrollTop = 3000 * ROW;
    fireEvent.scroll(scroller);
    expect(screen.getByText('commit 3000')).toBeTruthy();
    expect(screen.queryByText('commit 0')).toBeNull();
  });

  it('draws an edge that passes through the viewport from a row above it', () => {
    const merge = history(5000);
    // h0 also has h4000 as a second parent: a long edge crossing the middle.
    merge[0] = { ...merge[0], parents: ['h1', 'h4000'],
      connectors: [...merge[0].connectors, { fromLane: 0, toLane: 1, type: 'merge' }] };
    merge[4000] = { ...merge[4000], lane: 1 };
    const { container } = render(<CommitGraph commits={merge} onSelect={() => {}} />);
    const scroller = container.querySelector('.commit-graph');
    scroller.scrollTop = 2000 * ROW;
    fireEvent.scroll(scroller);
    const ds = [...container.querySelectorAll('.graph-svg path')].map((p) => p.getAttribute('d'));
    expect(ds.some((d) => d.startsWith(`M12,${ROW / 2} `))).toBe(true);
  });

  it('asks for more history when the end is near', () => {
    const onLoadMore = vi.fn();
    render(<CommitGraph commits={history(10)} hasMore onLoadMore={onLoadMore} onSelect={() => {}} />);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not ask for more history when there is none', () => {
    const onLoadMore = vi.fn();
    render(<CommitGraph commits={history(10)} hasMore={false} onLoadMore={onLoadMore} onSelect={() => {}} />);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('asks only once for the same history, however often it re-renders', () => {
    const onLoadMore = vi.fn();
    const { container } = render(
      <CommitGraph commits={history(10)} hasMore onLoadMore={onLoadMore} onSelect={() => {}} />);
    fireEvent.scroll(container.querySelector('.commit-graph'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('draws an edge to a parent not loaded yet down to the bottom of the graph', () => {
    const page = history(3);
    page[2] = { ...page[2], parents: ['unloaded'], connectors: [{ fromLane: 0, toLane: 0, type: 'straight' }] };
    const { container } = render(<CommitGraph commits={page} onSelect={() => {}} />);
    const ds = [...container.querySelectorAll('.graph-svg path')].map((p) => p.getAttribute('d'));
    expect(ds).toContain(`M12,${2 * ROW + ROW / 2} L12,${3 * ROW}`);
  });
});

describe('CommitGraph selection out of view', () => {
  it('scrolls a selected row that is out of view to the top', () => {
    const page = history(5000);
    const { container, rerender } = render(<CommitGraph commits={page} onSelect={() => {}} />);
    rerender(<CommitGraph commits={page} onSelect={() => {}} selected="h3000" />);
    expect(container.querySelector('.commit-graph').scrollTop).toBe(3000 * ROW);
    expect(screen.getByText('commit 3000').closest('.graph-row').className).toContain('selected');
  });

  it('leaves the scroll alone when the selected row is already in view', () => {
    const page = history(5000);
    const { container, rerender } = render(<CommitGraph commits={page} onSelect={() => {}} />);
    rerender(<CommitGraph commits={page} onSelect={() => {}} selected="h5" />);
    expect(container.querySelector('.commit-graph').scrollTop).toBe(0);
  });
});

describe('CommitGraph columns', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the author name with an initials avatar, and the email on hover', () => {
    const one = [{ hash: 'a1', subject: 's', author: 'Ada Lovelace', email: 'ada@example.com',
      date: '2026-06-01 10:00', refs: [], lane: 0, color: '#4c8dff', connectors: [] }];
    const { container } = render(<CommitGraph commits={one} onSelect={() => {}} />);
    const cell = container.querySelector('.graph-row .col-author');
    expect(cell.textContent).toBe('ALAda Lovelace');
    expect(cell.textContent).not.toMatch(/example\.com/);
    expect(cell.title).toBe('Ada Lovelace <ada@example.com>');
    expect(cell.querySelector('.avatar').textContent).toBe('AL');
  });

  it('shows how long ago a commit was made, with the date on hover', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 19, 14, 0));
    const one = [{ hash: 'a1', subject: 's', author: 'me', date: '2026-10-19 12:00',
      refs: [], lane: 0, color: '#4c8dff', connectors: [] }];
    const { container } = render(<CommitGraph commits={one} onSelect={() => {}} />);
    const cell = container.querySelector('.graph-row .col-date');
    expect(cell.textContent).toBe('2 h ago');
    expect(cell.title).toBe('2026-10-19 12:00');
  });

  it('gives each kind of ref its own pill, named on hover', () => {
    const one = [{ hash: 'a1', subject: 's', author: 'me', date: 'd',
      refs: ['HEAD -> main', 'origin/main', 'feature', 'tag: v1'],
      lane: 0, color: '#4c8dff', connectors: [] }];
    const { container } = render(<CommitGraph commits={one} onSelect={() => {}}
      localBranches={['main', 'feature']} />);
    const pills = [...container.querySelectorAll('.ref-pill')]
      .map((p) => [p.className.replace('ref-pill ', ''), p.textContent, p.title]);
    expect(pills).toEqual([
      ['ref-head', 'main', 'HEAD → main (checked out)'],
      ['ref-remote', 'origin/main', 'Remote branch origin/main'],
      ['ref-local', 'feature', 'Local branch feature'],
      ['ref-tag', 'v1', 'Tag v1'],
    ]);
    // each kind carries its own icon, not just a color
    expect(container.querySelectorAll('.ref-pill svg.ref-icon')).toHaveLength(4);
  });
});
