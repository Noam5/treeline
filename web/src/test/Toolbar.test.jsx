import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import Toolbar from '../components/Toolbar.jsx';

function renderToolbar(props = {}) {
  const all = {
    repoPath: '/repo/one', currentBranch: 'main', changeCount: 0,
    theme: 'light', onToggleTheme: () => {}, onOpen: () => {},
    onCommit: () => {}, onFetch: () => {}, onPull: () => {}, onPush: () => {},
    onBranch: () => {}, onMerge: () => {}, onStash: () => {}, onDiscard: () => {}, onTag: () => {},
    ...props,
  };
  return render(<Toolbar {...all} />);
}

// The bridge only exists under Electron (electron/preload.cjs).
function stubBridge(pickRepo) {
  window.gitClient = { pickRepo };
}

afterEach(() => { delete window.gitClient; });

describe('Toolbar repo path', () => {
  it('shows the active repository path, read-only', () => {
    renderToolbar({ repoPath: '/repos/one' });
    expect(screen.getByTitle('/repos/one').textContent).toBe('/repos/one');
  });

  it('offers no way to type or browse for a path — tabs do that now', () => {
    renderToolbar();
    expect(screen.queryByPlaceholderText('/path/to/repo')).toBeNull();
    expect(screen.queryByTitle(/choose a repository/i)).toBeNull();
    expect(document.querySelector('input')).toBeNull();
  });

  it('shows nothing where the path goes when no repo is open', () => {
    renderToolbar({ repoPath: null });
    expect(document.querySelector('.repo-path')).toBeNull();
  });
});

const button = (label) => screen.getByText(label).closest('button');

describe('Toolbar icons', () => {
  it('draws every action and the theme toggle as an inline SVG, with no glyph text', () => {
    renderToolbar();
    const icons = document.querySelectorAll('.tb-icon');
    expect(icons.length).toBe(9);
    for (const icon of icons) {
      expect(icon.querySelector('svg')).toBeTruthy();
      expect(icon.textContent).toBe('');
    }
    expect(document.querySelector('.tb-theme svg')).toBeTruthy();
    expect(document.querySelector('.tb-theme').textContent).toBe('');
  });

  it('marks Discard as dangerous, unlike Stash', () => {
    renderToolbar();
    expect(button('Discard').className).toContain('danger');
    expect(button('Stash').className).not.toContain('danger');
  });
});

describe('Toolbar ahead/behind', () => {
  it('counts commits to pull on Pull and commits to push on Push', () => {
    renderToolbar({ upstream: { name: 'origin/main', ahead: 2, behind: 3 } });
    expect(button('Pull').querySelector('.tb-badge').textContent).toBe('3');
    expect(button('Push').querySelector('.tb-badge').textContent).toBe('2');
    expect(button('Pull').title).toBe('Pull 3 commits from origin/main');
    expect(button('Push').title).toBe('Push 2 commits to origin/main');
  });

  it('shows no count when level with the upstream', () => {
    renderToolbar({ upstream: { name: 'origin/main', ahead: 0, behind: 0 } });
    expect(button('Pull').querySelector('.tb-badge')).toBeNull();
    expect(button('Push').querySelector('.tb-badge')).toBeNull();
  });

  it('shows no count without an upstream', () => {
    renderToolbar({ upstream: null });
    expect(button('Pull').querySelector('.tb-badge')).toBeNull();
    expect(button('Push').querySelector('.tb-badge')).toBeNull();
    expect(button('Push').title).toBe('Push (this branch has no upstream)');
  });
});

describe('Toolbar remote operations', () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
  };

  it('shows the running operation as busy and disables Fetch, Pull and Push until it ends', async () => {
    const op = deferred();
    const onFetch = vi.fn(() => op.promise);
    renderToolbar({ onFetch });
    fireEvent.click(button('Fetch'));

    expect(button('Fetch').getAttribute('aria-busy')).toBe('true');
    expect(button('Fetch').className).toContain('busy');
    for (const name of ['Fetch', 'Pull', 'Push']) expect(button(name).disabled).toBe(true);
    expect(button('Commit').disabled).toBe(false);

    fireEvent.click(button('Fetch'));
    expect(onFetch).toHaveBeenCalledTimes(1);

    op.resolve();
    await waitFor(() => expect(button('Fetch').disabled).toBe(false));
    expect(button('Fetch').getAttribute('aria-busy')).toBeNull();
  });

  it('ends the busy state when the operation fails', async () => {
    renderToolbar({ onPush: () => Promise.reject(new Error('network down')) });
    fireEvent.click(button('Push'));
    await waitFor(() => expect(button('Push').disabled).toBe(false));
  });
});
