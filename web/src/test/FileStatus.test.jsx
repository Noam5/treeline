import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FileStatus from '../components/FileStatus.jsx';

// FileStatus acts on whichever repository its client is bound to (one per tab),
// so the client is injected rather than imported.
const stubClient = () => ({
  stage: vi.fn().mockResolvedValue({ ok: true }),
  unstage: vi.fn().mockResolvedValue({ ok: true }),
  commit: vi.fn().mockResolvedValue({ ok: true }),
});

const status = {
  staged: [{ path: 'a.txt', status: 'A' }],
  unstaged: [{ path: 'b.txt', status: 'M' }],
  untracked: ['c.txt']
};

beforeEach(() => { vi.clearAllMocks(); });

describe('FileStatus', () => {
  it('lists staged, unstaged, and untracked files', () => {
    render(<FileStatus status={status} onRefresh={() => {}} onSelectFile={() => {}} />);
    expect(screen.getByText('a.txt')).toBeTruthy();
    expect(screen.getByText('b.txt')).toBeTruthy();
    expect(screen.getByText('c.txt')).toBeTruthy();
  });

  it('highlights the selected file row, matching path and staged side', () => {
    render(<FileStatus status={status} onRefresh={() => {}} onSelectFile={() => {}}
      selected={{ path: 'b.txt', staged: false }} />);
    const selRow = screen.getByText('b.txt').closest('.fs-row');
    const stagedRow = screen.getByText('a.txt').closest('.fs-row');
    expect(selRow.className).toContain('selected');
    expect(stagedRow.className).not.toContain('selected'); // same-name guard isn't relevant here; staged a.txt stays unselected
  });

  it('stages an unstaged file and refreshes', async () => {
    const client = stubClient();
    const onRefresh = vi.fn();
    render(<FileStatus client={client} status={status} onRefresh={onRefresh} onSelectFile={() => {}} />);
    fireEvent.click(screen.getByLabelText('stage b.txt'));
    await waitFor(() => expect(client.stage).toHaveBeenCalledWith(['b.txt']));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('opens a context menu on right-click of an unstaged file', () => {
    render(<FileStatus status={status} onRefresh={() => {}} onSelectFile={() => {}}
      onDiscardFile={() => {}} onDeleteFile={() => {}} onIgnoreFile={() => {}} />);
    fireEvent.contextMenu(screen.getByText('b.txt'));
    expect(screen.getByText('Discard changes')).toBeTruthy();
    expect(screen.getByText('Stage')).toBeTruthy();
  });

  it('right-clicking an untracked file offers delete and ignore', () => {
    render(<FileStatus status={status} onRefresh={() => {}} onSelectFile={() => {}}
      onDiscardFile={() => {}} onDeleteFile={() => {}} onIgnoreFile={() => {}} />);
    fireEvent.contextMenu(screen.getByText('c.txt'));
    expect(screen.getByText('Delete file')).toBeTruthy();
    expect(screen.getByText('Add to .gitignore')).toBeTruthy();
  });

  it('carries the commit box by default', () => {
    render(<FileStatus status={status} onRefresh={() => {}} onSelectFile={() => {}} />);
    expect(screen.getByPlaceholderText('Commit message')).toBeTruthy();
  });

  it('omits the commit box when the panel places it elsewhere', () => {
    render(<FileStatus showCommit={false} status={status} onRefresh={() => {}} onSelectFile={() => {}} />);
    expect(screen.queryByPlaceholderText('Commit message')).toBeNull();
  });

  describe('a staged rename', () => {
    const renamed = {
      staged: [{ path: 'x -> y.txt', origPath: 'café old.txt', status: 'R' }],
      unstaged: [], untracked: [],
    };

    it('names both ends of the rename', () => {
      render(<FileStatus status={renamed} onRefresh={() => {}} onSelectFile={() => {}} />);
      const row = screen.getByText('x -> y.txt').closest('.fs-row');
      expect(row.querySelector('.fs-orig').textContent).toBe('← café old.txt');
      expect(row.querySelector('.fs-path').title).toBe('café old.txt → x -> y.txt');
    });

    it('opens its diff with both paths', () => {
      const onSelectFile = vi.fn();
      render(<FileStatus status={renamed} onRefresh={() => {}} onSelectFile={onSelectFile} />);
      fireEvent.click(screen.getByText('x -> y.txt'));
      expect(onSelectFile).toHaveBeenCalledWith({ path: 'x -> y.txt', origPath: 'café old.txt' }, true);
    });

    it('unstages both paths, so the original is not left deleted in the index', async () => {
      const client = stubClient();
      render(<FileStatus client={client} status={renamed} onRefresh={() => {}} onSelectFile={() => {}} />);
      fireEvent.click(screen.getByLabelText('unstage x -> y.txt'));
      await waitFor(() => expect(client.unstage).toHaveBeenCalledWith(['x -> y.txt', 'café old.txt']));
    });
  });

  describe('while merging', () => {
    const merging = {
      ...status,
      conflicted: [{ path: 'both.txt', status: 'UU' }, { path: 'gone.txt', status: 'DU' }],
      merge: { message: "Merge branch 'feat'" },
    };
    const mount = (props = {}) => render(<FileStatus status={merging} onRefresh={() => {}}
      onSelectFile={() => {}} onResolveFile={() => {}} onMarkResolved={() => {}} {...props} />);

    it('lists conflicted files in a pane of their own', () => {
      mount();
      const pane = document.querySelector('.fs-conflicted');
      expect(pane.textContent).toContain('Conflicts (2)');
      expect(pane.textContent).toContain('both.txt');
      expect(pane.textContent).toContain('gone.txt');
    });

    it('says how each file conflicts', () => {
      mount();
      expect(screen.getByText('both.txt').closest('.fs-row').title).toBe('Both modified');
      expect(screen.getByText('gone.txt').closest('.fs-row').title).toBe('Deleted by us');
    });

    it('opens a conflicted file\'s diff on click', () => {
      const onSelectFile = vi.fn();
      mount({ onSelectFile });
      fireEvent.click(screen.getByText('both.txt'));
      expect(onSelectFile).toHaveBeenCalledWith({ path: 'both.txt' }, false);
    });

    it('resolves a file to either side from its context menu', () => {
      const onResolveFile = vi.fn();
      mount({ onResolveFile });
      fireEvent.contextMenu(screen.getByText('both.txt'));
      fireEvent.click(screen.getByText('Resolve using mine'));
      expect(onResolveFile).toHaveBeenCalledWith('both.txt', 'ours');
      fireEvent.contextMenu(screen.getByText('gone.txt'));
      fireEvent.click(screen.getByText('Resolve using theirs'));
      expect(onResolveFile).toHaveBeenCalledWith('gone.txt', 'theirs');
    });

    it('marks a file resolved from its context menu or its button', () => {
      const onMarkResolved = vi.fn();
      mount({ onMarkResolved });
      fireEvent.contextMenu(screen.getByText('both.txt'));
      fireEvent.click(screen.getByText('Mark resolved'));
      expect(onMarkResolved).toHaveBeenCalledWith('both.txt');
      fireEvent.click(screen.getByLabelText('mark gone.txt resolved'));
      expect(onMarkResolved).toHaveBeenCalledWith('gone.txt');
    });

    it('prefills the commit box with the merge message', () => {
      mount();
      expect(screen.getByPlaceholderText('Commit message').value).toBe("Merge branch 'feat'");
    });
  });

  it('has no conflicts pane outside a merge', () => {
    render(<FileStatus status={status} onRefresh={() => {}} onSelectFile={() => {}} />);
    expect(document.querySelector('.fs-conflicted')).toBeNull();
  });

  describe('file names', () => {
    const nested = {
      staged: [], untracked: [],
      unstaged: [{ path: 'src/components/App.jsx', status: 'M' }],
    };

    it('shows the name apart from its directory, with the full path on hover', () => {
      render(<FileStatus status={nested} onRefresh={() => {}} onSelectFile={() => {}} />);
      const row = screen.getByText('App.jsx').closest('.fs-row');
      expect(screen.getByText('App.jsx').className).toBe('fs-name');
      expect(row.querySelector('.fs-dir').textContent).toBe('src/components');
      expect(row.querySelector('.fs-path').title).toBe('src/components/App.jsx');
    });

    it('shows no directory for a file at the top level', () => {
      render(<FileStatus status={status} onRefresh={() => {}} onSelectFile={() => {}} />);
      expect(screen.getByText('b.txt').closest('.fs-row').querySelector('.fs-dir')).toBeNull();
    });
  });

  describe('stage all / unstage all', () => {
    const many = {
      staged: [{ path: 'a.txt', status: 'A' }, { path: 'new.txt', origPath: 'old.txt', status: 'R' }],
      unstaged: [{ path: 'b.txt', status: 'M' }, { path: 'n.txt', origPath: 'o.txt', status: 'R' }],
      untracked: ['c.txt'],
      conflicted: [{ path: 'both.txt', status: 'UU' }],
    };

    it('stages every unstaged and untracked file, both ends of a rename, and no conflict', async () => {
      const client = stubClient();
      const onRefresh = vi.fn();
      render(<FileStatus client={client} status={many} onRefresh={onRefresh} onSelectFile={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Stage all' }));
      await waitFor(() => expect(client.stage).toHaveBeenCalledWith(['b.txt', 'n.txt', 'o.txt', 'c.txt']));
      await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    });

    it('unstages every staged file, both ends of a rename', async () => {
      const client = stubClient();
      render(<FileStatus client={client} status={many} onRefresh={() => {}} onSelectFile={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Unstage all' }));
      await waitFor(() => expect(client.unstage).toHaveBeenCalledWith(['a.txt', 'new.txt', 'old.txt']));
    });

    it('is disabled on an empty pane', () => {
      render(<FileStatus client={stubClient()} status={{ staged: [], unstaged: [], untracked: [] }}
        onRefresh={() => {}} onSelectFile={() => {}} />);
      expect(screen.getByRole('button', { name: 'Stage all' }).disabled).toBe(true);
      expect(screen.getByRole('button', { name: 'Unstage all' }).disabled).toBe(true);
    });
  });

  describe('keyboard', () => {
    const mount = (props = {}) => {
      const client = stubClient();
      const onSelectFile = vi.fn();
      const onRefresh = vi.fn();
      render(<FileStatus client={client} status={status} onRefresh={onRefresh}
        onSelectFile={onSelectFile} {...props} />);
      const key = (k, target = document.querySelector('.file-status')) => fireEvent.keyDown(target, { key: k });
      return { client, onSelectFile, onRefresh, key };
    };

    it('can take focus', () => {
      mount();
      expect(document.querySelector('.file-status').tabIndex).toBe(0);
    });

    it('moves the selection down through the panes, opening each diff', () => {
      const { onSelectFile, key } = mount({ selected: { path: 'a.txt', staged: true } });
      key('ArrowDown');
      expect(onSelectFile).toHaveBeenCalledWith({ path: 'b.txt' }, false);
    });

    it('moves the selection up across panes', () => {
      const { onSelectFile, key } = mount({ selected: { path: 'b.txt', staged: false } });
      key('ArrowUp');
      expect(onSelectFile).toHaveBeenCalledWith({ path: 'a.txt' }, true);
    });

    it('starts at the first file when nothing is selected', () => {
      const { onSelectFile, key } = mount();
      key('ArrowDown');
      expect(onSelectFile).toHaveBeenCalledWith({ path: 'a.txt' }, true);
    });

    it('stays put at the end of the list', () => {
      const { onSelectFile, key } = mount({ selected: { path: 'c.txt', staged: false } });
      key('ArrowDown');
      expect(onSelectFile).not.toHaveBeenCalled();
    });

    it('stages the selected file with Space, and moves to the next one in its pane', async () => {
      const { client, onSelectFile, onRefresh, key } = mount({ selected: { path: 'b.txt', staged: false } });
      key(' ');
      await waitFor(() => expect(client.stage).toHaveBeenCalledWith(['b.txt']));
      await waitFor(() => expect(onRefresh).toHaveBeenCalled());
      expect(onSelectFile).toHaveBeenCalledWith({ path: 'c.txt' }, false);
    });

    it('unstages the selected staged file with Space', async () => {
      const { client, key } = mount({ selected: { path: 'a.txt', staged: true } });
      key(' ');
      await waitFor(() => expect(client.unstage).toHaveBeenCalledWith(['a.txt']));
    });

    it('leaves Space alone while typing a commit message', () => {
      const { client, key } = mount({ selected: { path: 'b.txt', staged: false } });
      key(' ', screen.getByPlaceholderText('Commit message'));
      key('ArrowDown', screen.getByPlaceholderText('Commit message'));
      expect(client.stage).not.toHaveBeenCalled();
    });

    it('does not stage a conflicted file with Space', () => {
      const { client, key } = mount({
        status: { ...status, conflicted: [{ path: 'both.txt', status: 'UU' }] },
        selected: { path: 'both.txt', staged: false },
      });
      key(' ');
      expect(client.stage).not.toHaveBeenCalled();
    });
  });
});
