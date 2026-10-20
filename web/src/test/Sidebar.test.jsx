import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Sidebar from '../components/Sidebar.jsx';

const branches = { current: 'main', local: ['main', 'feature'], remote: [] };

function renderSidebar(handlers = {}) {
  const props = {
    branches, stashes: [], tags: [], view: 'history',
    onView: () => {}, onCheckout: () => {}, onSelectBranch: () => {}, onApplyStash: () => {},
    onMergeBranch: () => {}, onRenameBranch: () => {}, onDeleteBranch: () => {},
    onPopStash: () => {}, onDropStash: () => {}, onShowStashDiff: () => {},
    onDeleteTag: () => {}, onSelectTag: () => {},
    ...handlers,
  };
  return render(<Sidebar {...props} />);
}

const stashes = [{ ref: 'stash@{0}', message: 'WIP on main: my work' }];

describe('Sidebar branch context menu', () => {
  it('shows checkout/merge/rename/delete for a non-current branch', () => {
    renderSidebar();
    fireEvent.contextMenu(screen.getByText(/feature/));
    expect(screen.getByText('Checkout')).toBeTruthy();
    expect(screen.getByText('Merge into main')).toBeTruthy();
    expect(screen.getByText('Rename…')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('offers only rename for the current branch', () => {
    renderSidebar();
    fireEvent.contextMenu(screen.getByText(/main/));
    expect(screen.getByText('Rename…')).toBeTruthy();
    expect(screen.queryByText('Checkout')).toBeNull();
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('checks out the right-clicked branch from the menu', () => {
    const onCheckout = vi.fn();
    renderSidebar({ onCheckout });
    fireEvent.contextMenu(screen.getByText(/feature/));
    fireEvent.click(screen.getByText('Checkout'));
    expect(onCheckout).toHaveBeenCalledWith('feature');
  });

  it('selects (without checking out) a branch on single click', () => {
    const onSelectBranch = vi.fn();
    const onCheckout = vi.fn();
    renderSidebar({ onSelectBranch, onCheckout });
    fireEvent.click(screen.getByText(/feature/));
    expect(onSelectBranch).toHaveBeenCalledWith('feature');
    expect(onCheckout).not.toHaveBeenCalled();
  });

  it('highlights the selected branch', () => {
    renderSidebar({ selectedBranch: 'feature' });
    expect(screen.getByText(/feature/).className).toContain('selected-branch');
  });

  it('deletes the right-clicked branch from the menu', () => {
    const onDeleteBranch = vi.fn();
    renderSidebar({ onDeleteBranch });
    fireEvent.contextMenu(screen.getByText(/feature/));
    fireEvent.click(screen.getByText('Delete'));
    expect(onDeleteBranch).toHaveBeenCalledWith('feature');
  });
});

describe('Sidebar stash context menu', () => {
  it('shows apply/pop/view-diff/drop for a stash', () => {
    renderSidebar({ stashes });
    fireEvent.contextMenu(screen.getByText(/my work/));
    expect(screen.getByText('Apply')).toBeTruthy();
    expect(screen.getByText('Pop')).toBeTruthy();
    expect(screen.getByText('View diff')).toBeTruthy();
    expect(screen.getByText('Drop')).toBeTruthy();
  });

  it('pops the right-clicked stash from the menu', () => {
    const onPopStash = vi.fn();
    renderSidebar({ stashes, onPopStash });
    fireEvent.contextMenu(screen.getByText(/my work/));
    fireEvent.click(screen.getByText('Pop'));
    expect(onPopStash).toHaveBeenCalledWith('stash@{0}');
  });

  it('drops the right-clicked stash from the menu', () => {
    const onDropStash = vi.fn();
    renderSidebar({ stashes, onDropStash });
    fireEvent.contextMenu(screen.getByText(/my work/));
    fireEvent.click(screen.getByText('Drop'));
    expect(onDropStash).toHaveBeenCalledWith('stash@{0}');
  });
});

describe('Sidebar tags', () => {
  const tags = ['v2.0', 'v1.0'];

  it('lists every tag', () => {
    renderSidebar({ tags });
    expect(screen.getByText(/v2\.0/)).toBeTruthy();
    expect(screen.getByText(/v1\.0/)).toBeTruthy();
  });

  it('says so when there are no tags', () => {
    renderSidebar({ tags: [] });
    expect(screen.getByText('No tags')).toBeTruthy();
  });

  it('keeps the order it was given, so the newest tag stays on top', () => {
    // By class rather than by title: the branch rows' title also mentions
    // checking out, so a title match would pick them up too.
    const { container } = renderSidebar({ tags });
    const shown = [...container.querySelectorAll('.tag-row')].map((el) => el.textContent);
    expect(shown).toEqual(['🏷 v2.0', '🏷 v1.0']);
  });

  it('offers checkout and delete for a tag', () => {
    renderSidebar({ tags });
    fireEvent.contextMenu(screen.getByText(/v1\.0/));
    expect(screen.getByText('Checkout')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('does not offer branch-only actions for a tag', () => {
    renderSidebar({ tags });
    fireEvent.contextMenu(screen.getByText(/v1\.0/));
    expect(screen.queryByText('Rename…')).toBeNull();
    expect(screen.queryByText(/Merge into/)).toBeNull();
  });

  it('checks out the right-clicked tag from the menu', () => {
    const onCheckout = vi.fn();
    renderSidebar({ tags, onCheckout });
    fireEvent.contextMenu(screen.getByText(/v1\.0/));
    fireEvent.click(screen.getByText('Checkout'));
    expect(onCheckout).toHaveBeenCalledWith('v1.0');
  });

  it('deletes the right-clicked tag from the menu', () => {
    const onDeleteTag = vi.fn();
    renderSidebar({ tags, onDeleteTag });
    fireEvent.contextMenu(screen.getByText(/v1\.0/));
    fireEvent.click(screen.getByText('Delete'));
    expect(onDeleteTag).toHaveBeenCalledWith('v1.0');
  });

  it('selects (without checking out) a tag on single click', () => {
    const onSelectTag = vi.fn();
    const onCheckout = vi.fn();
    renderSidebar({ tags, onSelectTag, onCheckout });
    fireEvent.click(screen.getByText(/v1\.0/));
    expect(onSelectTag).toHaveBeenCalledWith('v1.0');
    expect(onCheckout).not.toHaveBeenCalled();
  });

  it('highlights the selected tag', () => {
    renderSidebar({ tags, selectedTag: 'v1.0' });
    expect(screen.getByText(/v1\.0/).className).toContain('selected-tag');
    expect(screen.getByText(/v2\.0/).className).not.toContain('selected-tag');
  });

  it('checks out a tag on double-click', () => {
    const onCheckout = vi.fn();
    renderSidebar({ tags, onCheckout });
    fireEvent.doubleClick(screen.getByText(/v1\.0/));
    expect(onCheckout).toHaveBeenCalledWith('v1.0');
  });
});
