import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CommitBox from '../components/CommitBox.jsx';

const stubClient = (result = { ok: true }, last = { ok: true, message: 'Last subject\n\nLast body', pushed: null }) => ({
  commit: vi.fn().mockResolvedValue(result),
  getLastCommit: vi.fn().mockResolvedValue(last),
});

describe('CommitBox', () => {
  it('commits the typed message and refreshes', async () => {
    const client = stubClient();
    const onRefresh = vi.fn();
    render(<CommitBox client={client} onRefresh={onRefresh} />);

    fireEvent.change(screen.getByPlaceholderText('Commit message'), { target: { value: 'msg' } });
    fireEvent.click(screen.getByText('Commit'));

    await waitFor(() => expect(client.commit).toHaveBeenCalledWith('msg', { amend: false }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('clears the box only once the commit succeeded', async () => {
    const client = stubClient({ ok: false, error: 'nothing to commit' });
    render(<CommitBox client={client} onRefresh={() => {}} />);
    const box = screen.getByPlaceholderText('Commit message');

    fireEvent.change(box, { target: { value: 'keep me' } });
    fireEvent.click(screen.getByText('Commit'));

    await waitFor(() => expect(client.commit).toHaveBeenCalled());
    expect(box.value).toBe('keep me');
  });

  it('ignores an empty message', () => {
    const client = stubClient();
    render(<CommitBox client={client} onRefresh={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Commit message'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Commit'));
    expect(client.commit).not.toHaveBeenCalled();
  });

  it('prefills the merge message while merging', () => {
    render(<CommitBox client={stubClient()} onRefresh={() => {}} mergeMessage="Merge branch 'feat'" />);
    expect(screen.getByPlaceholderText('Commit message').value).toBe("Merge branch 'feat'");
  });

  it('prefills the merge message once a merge starts, but never over typed text', () => {
    const client = stubClient();
    const { rerender } = render(<CommitBox client={client} onRefresh={() => {}} />);
    const box = screen.getByPlaceholderText('Commit message');
    rerender(<CommitBox client={client} onRefresh={() => {}} mergeMessage="Merge branch 'a'" />);
    expect(box.value).toBe("Merge branch 'a'");
    fireEvent.change(box, { target: { value: 'my own words' } });
    rerender(<CommitBox client={client} onRefresh={() => {}} mergeMessage="Merge branch 'b'" />);
    expect(box.value).toBe('my own words');
  });

  it('reports a failed commit instead of failing silently', async () => {
    const client = stubClient({ ok: false, error: 'Committing is not possible because you have unmerged files.' });
    const onError = vi.fn();
    render(<CommitBox client={client} onRefresh={() => {}} onError={onError} />);
    fireEvent.change(screen.getByPlaceholderText('Commit message'), { target: { value: 'm' } });
    fireEvent.click(screen.getByText('Commit'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Committing is not possible because you have unmerged files.'));
  });

  it('drops the merge message once the merge is over, unless the user edited it', () => {
    const client = stubClient();
    const { rerender } = render(<CommitBox client={client} onRefresh={() => {}} mergeMessage="Merge branch 'a'" />);
    const box = screen.getByPlaceholderText('Commit message');
    rerender(<CommitBox client={client} onRefresh={() => {}} />);
    expect(box.value).toBe('');

    rerender(<CommitBox client={client} onRefresh={() => {}} mergeMessage="Merge branch 'b'" />);
    fireEvent.change(box, { target: { value: "Merge branch 'b', by hand" } });
    rerender(<CommitBox client={client} onRefresh={() => {}} />);
    expect(box.value).toBe("Merge branch 'b', by hand");
  });

  describe('keyboard', () => {
    it('commits with Ctrl+Enter', async () => {
      const client = stubClient();
      render(<CommitBox client={client} onRefresh={() => {}} />);
      const box = screen.getByPlaceholderText('Commit message');
      fireEvent.change(box, { target: { value: 'quick' } });
      fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
      await waitFor(() => expect(client.commit).toHaveBeenCalledWith('quick', { amend: false }));
    });

    it('commits with Cmd+Enter', async () => {
      const client = stubClient();
      render(<CommitBox client={client} onRefresh={() => {}} />);
      const box = screen.getByPlaceholderText('Commit message');
      fireEvent.change(box, { target: { value: 'quick' } });
      fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
      await waitFor(() => expect(client.commit).toHaveBeenCalled());
    });

    it('leaves a plain Enter to start a new line', () => {
      const client = stubClient();
      render(<CommitBox client={client} onRefresh={() => {}} />);
      const box = screen.getByPlaceholderText('Commit message');
      fireEvent.change(box, { target: { value: 'subject' } });
      fireEvent.keyDown(box, { key: 'Enter' });
      expect(client.commit).not.toHaveBeenCalled();
    });
  });

  describe('amend', () => {
    const amendBox = () => screen.getByLabelText('Amend last commit');

    it('loads the last commit message into an empty box', async () => {
      const client = stubClient();
      render(<CommitBox client={client} onRefresh={() => {}} />);
      fireEvent.click(amendBox());
      await waitFor(() => expect(screen.getByPlaceholderText('Commit message').value).toBe('Last subject\n\nLast body'));
    });

    it('keeps text the user already typed', async () => {
      const client = stubClient();
      render(<CommitBox client={client} onRefresh={() => {}} />);
      const box = screen.getByPlaceholderText('Commit message');
      fireEvent.change(box, { target: { value: 'better words' } });
      fireEvent.click(amendBox());
      await waitFor(() => expect(client.getLastCommit).toHaveBeenCalled());
      expect(box.value).toBe('better words');
    });

    it('amends, then goes back to plain commits', async () => {
      const client = stubClient();
      const onRefresh = vi.fn();
      render(<CommitBox client={client} onRefresh={onRefresh} />);
      fireEvent.click(amendBox());
      await waitFor(() => expect(screen.getByPlaceholderText('Commit message').value).not.toBe(''));
      fireEvent.click(screen.getByRole('button', { name: 'Amend' }));
      await waitFor(() => expect(client.commit).toHaveBeenCalledWith('Last subject\n\nLast body', { amend: true }));
      await waitFor(() => expect(onRefresh).toHaveBeenCalled());
      expect(amendBox().checked).toBe(false);
      expect(screen.getByPlaceholderText('Commit message').value).toBe('');
    });

    it('takes the loaded message back out when unticked unedited', async () => {
      render(<CommitBox client={stubClient()} onRefresh={() => {}} />);
      const box = screen.getByPlaceholderText('Commit message');
      fireEvent.click(amendBox());
      await waitFor(() => expect(box.value).not.toBe(''));
      fireEvent.click(amendBox());
      expect(box.value).toBe('');
    });

    it('refuses to amend a commit that is already pushed, and says why', async () => {
      const client = stubClient({ ok: true }, { ok: true, message: 'Shared', pushed: 'origin/main' });
      render(<CommitBox client={client} onRefresh={() => {}} />);
      fireEvent.click(amendBox());
      await waitFor(() => expect(screen.getByText(/already pushed to origin\/main/)).toBeTruthy());
      expect(screen.getByRole('button', { name: 'Amend' }).disabled).toBe(true);
    });

    it('reports when there is nothing to amend', async () => {
      const client = stubClient({ ok: true }, { ok: false, error: 'There are no commits to amend yet' });
      const onError = vi.fn();
      render(<CommitBox client={client} onRefresh={() => {}} onError={onError} />);
      fireEvent.click(amendBox());
      await waitFor(() => expect(onError).toHaveBeenCalledWith('There are no commits to amend yet'));
      expect(amendBox().checked).toBe(false);
    });
  });

  describe('subject length', () => {
    const type = (text) => {
      render(<CommitBox client={stubClient()} onRefresh={() => {}} />);
      fireEvent.change(screen.getByPlaceholderText('Commit message'), { target: { value: text } });
      return document.querySelector('.commit-subject-len');
    };

    it('counts the first line only', () => {
      expect(type('12345\nmore text on a second line').textContent).toBe('5');
    });

    it('is quiet up to 50 characters', () => {
      expect(type('x'.repeat(50)).className).toBe('commit-subject-len');
    });

    it('warns past 50 characters', () => {
      expect(type('x'.repeat(51)).className).toBe('commit-subject-len long');
    });

    it('warns harder past 72 characters', () => {
      expect(type('x'.repeat(73)).className).toBe('commit-subject-len too-long');
    });

    it('is hidden while the box is empty', () => {
      expect(type('')).toBeNull();
    });
  });
});
