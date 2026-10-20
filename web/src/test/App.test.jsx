import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '../api.js';
import App from '../App.jsx';

vi.mock('../api.js');

const commitsFor = (repo) => [
  { hash: 'h' + repo.slice(-1), parents: [], subject: `commit in ${repo}`, author: 'a',
    email: 'a@b', date: '2026-01-01', refs: [], lane: 0, connectors: [], color: '#000' },
];

function stubClient(repo) {
  return {
    repo,
    getLog: vi.fn().mockResolvedValue({ commits: commitsFor(repo) }),
    getStatus: vi.fn().mockResolvedValue({ staged: [], unstaged: [], untracked: [] }),
    getBranches: vi.fn().mockResolvedValue({ current: 'main', local: ['main'], remote: [] }),
    getStashes: vi.fn().mockResolvedValue({ stashes: [] }),
    getTags: vi.fn().mockResolvedValue({ tags: [] }),
    getDiff: vi.fn().mockResolvedValue({ patch: `diff --git a/${repo} b/${repo}\n+x` }),
  };
}

// The workspace that is on screen; hidden tabs keep their DOM, so assertions
// have to be scoped to the visible one.
const visible = () => document.querySelector('.workspace:not([hidden])');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  delete window.gitClient; // no Electron bridge unless a test adds one
  const clients = {};
  api.bindRepo.mockImplementation((repo) => (clients[repo] ??= stubClient(repo)));
  api.openRepo.mockImplementation(async (path) => ({ ok: true, path }));
  api.listDir.mockResolvedValue({ ok: true, path: '/home', parent: null, entries: [] });
});

describe('App tab session', () => {
  it('restores the open tabs and the active one', async () => {
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha', '/r/beta']));
    localStorage.setItem('activeTab', '1');

    render(<App />);

    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());
    expect(screen.getByText('beta')).toBeTruthy();
    expect(screen.getByText('beta').closest('.tab').className).toContain('active');
    await waitFor(() => expect(visible().textContent).toContain('commit in /r/beta'));
  });

  it('migrates a single saved repoPath into the first tab', async () => {
    localStorage.setItem('repoPath', '/r/legacy');

    render(<App />);

    await waitFor(() => expect(screen.getByText('legacy')).toBeTruthy());
    // Persistence is a side effect of the restore, so wait for it rather than
    // assuming it landed in the same commit as the label.
    await waitFor(() => expect(JSON.parse(localStorage.getItem('tabs'))).toEqual(['/r/legacy']));
    expect(localStorage.getItem('repoPath')).toBeNull();
  });

  it('drops a stored path that is no longer a repository, and says so', async () => {
    localStorage.setItem('tabs', JSON.stringify(['/r/gone', '/r/alpha']));
    api.openRepo.mockImplementation(async (path) =>
      path === '/r/gone' ? { ok: false, error: 'Not a git repository' } : { ok: true, path });

    render(<App />);

    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());
    expect(screen.queryByText('gone')).toBeNull();
    expect(screen.getByText(/\/r\/gone/)).toBeTruthy(); // named in the notice
    await waitFor(() => expect(JSON.parse(localStorage.getItem('tabs'))).toEqual(['/r/alpha']));
  });

  it('keeps each tab on its own selection across a switch', async () => {
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha', '/r/beta']));
    localStorage.setItem('activeTab', '0');
    render(<App />);

    // Select a commit in alpha, so its diff pane is filled.
    const row = await screen.findByText('commit in /r/alpha');
    fireEvent.click(row);
    await waitFor(() => expect(visible().textContent).toContain('+x'));

    // Beta has its own empty selection.
    fireEvent.click(screen.getByText('beta'));
    await waitFor(() => expect(visible().textContent)
      .toContain('Select a commit or file to see its diff.'));

    // Back to alpha: its diff is still there.
    fireEvent.click(screen.getByText('alpha'));
    await waitFor(() => expect(visible().textContent).toContain('+x'));
  });

  it('closes a tab and activates a neighbour', async () => {
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha', '/r/beta']));
    localStorage.setItem('activeTab', '0');
    render(<App />);
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());

    fireEvent.click(screen.getByTitle('Close alpha'));

    await waitFor(() => expect(screen.queryByText('alpha')).toBeNull());
    expect(screen.getByText('beta').closest('.tab').className).toContain('active');
    await waitFor(() => expect(JSON.parse(localStorage.getItem('tabs'))).toEqual(['/r/beta']));
  });

  it('shows an empty state once the last tab is closed', async () => {
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha']));
    render(<App />);
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());

    fireEvent.click(screen.getByTitle('Close alpha'));

    await waitFor(() => expect(screen.getByText(/no repository open/i)).toBeTruthy());
  });

  it('reuses the existing tab when the same repo is picked again', async () => {
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha', '/r/beta']));
    localStorage.setItem('activeTab', '1');
    api.listDir.mockResolvedValue({
      ok: true, path: '/r', parent: null,
      entries: [{ name: 'alpha', path: '/r/alpha', isRepo: true }],
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());

    // The only way in is the + tab and the picker behind it.
    fireEvent.click(screen.getByTitle(/open a repository folder/i));
    fireEvent.click(await screen.findByTitle('Open alpha'));

    await waitFor(() => expect(screen.getByText('alpha').closest('.tab').className)
      .toContain('active'));
    expect(screen.getAllByText('alpha')).toHaveLength(1); // one tab, not two
  });
});

describe('App tab shortcuts', () => {
  it('cycles with Ctrl+Tab and jumps with Ctrl+<n>', async () => {
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha', '/r/beta', '/r/gamma']));
    localStorage.setItem('activeTab', '0');
    render(<App />);
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
    await waitFor(() => expect(screen.getByText('beta').closest('.tab').className).toContain('active'));

    fireEvent.keyDown(window, { key: '3', ctrlKey: true });
    await waitFor(() => expect(screen.getByText('gamma').closest('.tab').className).toContain('active'));

    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByText('beta').closest('.tab').className).toContain('active'));

    // Wraps around, like a browser.
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByText('alpha').closest('.tab').className).toContain('active'));
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByText('gamma').closest('.tab').className).toContain('active'));
  });

  it('obeys tab commands sent from the Electron menu', async () => {
    let handler;
    window.gitClient = { onTabCommand: (cb) => { handler = cb; return () => {}; } };
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha', '/r/beta']));
    localStorage.setItem('activeTab', '0');
    render(<App />);
    await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());
    expect(typeof handler).toBe('function');

    handler('next');
    await waitFor(() => expect(screen.getByText('beta').closest('.tab').className).toContain('active'));

    handler('new');
    await waitFor(() => expect(screen.getByText('Open a repository')).toBeTruthy());
    fireEvent.click(screen.getByText('Cancel'));

    handler('close');
    await waitFor(() => expect(screen.queryByText('beta')).toBeNull());
    expect(screen.getByText('alpha').closest('.tab').className).toContain('active');

    delete window.gitClient;
  });
});

describe('App tab reordering', () => {
  const order = () => [...document.querySelectorAll('.tab-label')].map((e) => e.textContent);

  it('moves the active tab with the menu commands, and remembers the order', async () => {
    let handler;
    window.gitClient = { onTabCommand: (cb) => { handler = cb; return () => {}; } };
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha', '/r/beta', '/r/gamma']));
    localStorage.setItem('activeTab', '1'); // beta
    render(<App />);
    await waitFor(() => expect(order()).toEqual(['alpha', 'beta', 'gamma']));

    handler('move-left');
    await waitFor(() => expect(order()).toEqual(['beta', 'alpha', 'gamma']));
    // The moved tab stays the active one, and the new order is persisted.
    expect(screen.getByText('beta').closest('.tab').className).toContain('active');
    await waitFor(() => expect(JSON.parse(localStorage.getItem('tabs')))
      .toEqual(['/r/beta', '/r/alpha', '/r/gamma']));
    expect(localStorage.getItem('activeTab')).toBe('0');

    handler('move-right');
    await waitFor(() => expect(order()).toEqual(['alpha', 'beta', 'gamma']));

    delete window.gitClient;
  });

  it('does not move the first tab further left', async () => {
    let handler;
    window.gitClient = { onTabCommand: (cb) => { handler = cb; return () => {}; } };
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha', '/r/beta']));
    localStorage.setItem('activeTab', '0');
    render(<App />);
    await waitFor(() => expect(order()).toEqual(['alpha', 'beta']));

    handler('move-left');
    await waitFor(() => expect(order()).toEqual(['alpha', 'beta'])); // unchanged, no wrap

    delete window.gitClient;
  });

  it('moves a tab from the keyboard when there is no menu', async () => {
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha', '/r/beta']));
    localStorage.setItem('activeTab', '0');
    render(<App />);
    await waitFor(() => expect(order()).toEqual(['alpha', 'beta']));

    fireEvent.keyDown(window, { key: 'PageDown', ctrlKey: true, shiftKey: true });

    await waitFor(() => expect(order()).toEqual(['beta', 'alpha']));
  });

  it('reorders by dragging one tab onto another', async () => {
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha', '/r/beta']));
    render(<App />);
    await waitFor(() => expect(order()).toEqual(['alpha', 'beta']));

    const dt = { setData: () => {}, effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(screen.getByText('beta').closest('.tab'), { dataTransfer: dt });
    fireEvent.dragOver(screen.getByText('alpha').closest('.tab'), { dataTransfer: dt });

    await waitFor(() => expect(order()).toEqual(['beta', 'alpha']));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('tabs')))
      .toEqual(['/r/beta', '/r/alpha']));
  });
});

describe('App startup notices from the main process', () => {
  it('shows a notice the Electron bridge reports, such as a fallback port', async () => {
    const msg = 'Port 26542 was busy, so this window is on port 45678 instead.';
    window.gitClient = {
      onTabCommand: () => () => {},
      getStartupNotices: vi.fn().mockResolvedValue([msg]),
    };
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha']));

    render(<App />);

    expect(await screen.findByText(msg)).toBeTruthy();
    expect(window.gitClient.getStartupNotices).toHaveBeenCalled();
    delete window.gitClient;
  });

  it('says nothing when the main process reports nothing', async () => {
    window.gitClient = { onTabCommand: () => () => {}, getStartupNotices: vi.fn().mockResolvedValue([]) };
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha']));

    render(<App />);

    await waitFor(() => expect(window.gitClient.getStartupNotices).toHaveBeenCalled());
    expect(document.querySelector('.notice-bar')).toBeNull();
    delete window.gitClient;
  });

  it('still restores tabs in a browser tab, where there is no bridge to ask', async () => {
    localStorage.setItem('tabs', JSON.stringify(['/r/alpha']));

    render(<App />);

    expect(await screen.findByText('commit in /r/alpha')).toBeTruthy();
    expect(document.querySelector('.notice-bar')).toBeNull();
  });
});
