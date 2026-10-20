import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from '../api.js';
import RepoPicker from '../components/RepoPicker.jsx';

vi.mock('../api.js');

const listing = {
  ok: true,
  path: '/home/user/projects',
  parent: '/home/user',
  entries: [
    { name: 'myapp', path: '/home/user/projects/myapp', isRepo: true },
    { name: 'notes', path: '/home/user/projects/notes', isRepo: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listDir.mockResolvedValue(listing);
});
afterEach(() => { delete window.gitClient; });

const bigListing = {
  ok: true,
  path: '/home/user/projects',
  parent: '/home/user',
  entries: [
    { name: 'binder', path: '/home/user/projects/binder', isRepo: true },
    { name: 'bindings', path: '/home/user/projects/bindings', isRepo: false },
    { name: 'myapp', path: '/home/user/projects/myapp', isRepo: true },
    { name: 'notes', path: '/home/user/projects/notes', isRepo: false },
  ],
};

const search = () => screen.getByPlaceholderText(/filter|search/i);
const rowNames = () => [...document.querySelectorAll('.picker-name')].map((e) => e.textContent);

function open(props = {}) {
  return render(<RepoPicker startPath="/home/user/projects" onPick={() => {}} onCancel={() => {}} {...props} />);
}

describe('RepoPicker', () => {
  it('lists the starting folder and shows where it is', async () => {
    open();
    await waitFor(() => expect(api.listDir).toHaveBeenCalledWith('/home/user/projects'));
    expect(screen.getByText('/home/user/projects')).toBeTruthy();
    expect(screen.getByText('myapp')).toBeTruthy();
    expect(screen.getByText('notes')).toBeTruthy();
  });

  it('offers Open only for git repositories', async () => {
    open();
    await waitFor(() => expect(screen.getByText('myapp')).toBeTruthy());
    expect(screen.getByTitle('Open myapp')).toBeTruthy();
    expect(screen.queryByTitle('Open notes')).toBeNull();
  });

  it('navigates into a plain folder on click', async () => {
    open();
    await waitFor(() => expect(screen.getByText('notes')).toBeTruthy());
    fireEvent.click(screen.getByText('notes'));
    await waitFor(() => expect(api.listDir).toHaveBeenCalledWith('/home/user/projects/notes'));
  });

  it('navigates into a repository too, since repos nest', async () => {
    open();
    await waitFor(() => expect(screen.getByText('myapp')).toBeTruthy());
    fireEvent.click(screen.getByText('myapp'));
    await waitFor(() => expect(api.listDir).toHaveBeenCalledWith('/home/user/projects/myapp'));
  });

  it('goes up to the parent folder', async () => {
    open();
    await waitFor(() => expect(screen.getByTitle('Go up to /home/user')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Go up to /home/user'));
    await waitFor(() => expect(api.listDir).toHaveBeenCalledWith('/home/user'));
  });

  it("picks a repository from its row's Open button", async () => {
    const onPick = vi.fn();
    open({ onPick });
    await waitFor(() => expect(screen.getByTitle('Open myapp')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Open myapp'));
    expect(onPick).toHaveBeenCalledWith('/home/user/projects/myapp');
  });

  it('picks the folder it is currently showing', async () => {
    const onPick = vi.fn();
    open({ onPick });
    await waitFor(() => expect(screen.getByTitle('Open this folder')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Open this folder'));
    expect(onPick).toHaveBeenCalledWith('/home/user/projects');
  });

  it('surfaces a listing error', async () => {
    api.listDir.mockResolvedValue({ ok: false, error: 'Permission denied' });
    open();
    await waitFor(() => expect(screen.getByText('Permission denied')).toBeTruthy());
  });

  it('hides the system dialog button without the Electron bridge', async () => {
    open();
    await waitFor(() => expect(screen.getByText('myapp')).toBeTruthy());
    expect(screen.queryByTitle(/system folder dialog/i)).toBeNull();
  });

  it('hands off to the native dialog when the bridge is there', async () => {
    const pickRepo = vi.fn().mockResolvedValue('/picked/elsewhere');
    window.gitClient = { pickRepo };
    const onPick = vi.fn();

    open({ onPick });
    await waitFor(() => expect(screen.getByTitle(/system folder dialog/i)).toBeTruthy());
    fireEvent.click(screen.getByTitle(/system folder dialog/i));

    await waitFor(() => expect(onPick).toHaveBeenCalledWith('/picked/elsewhere'));
    expect(pickRepo).toHaveBeenCalledWith('/home/user/projects');
  });
});

describe('RepoPicker search', () => {
  const openBig = async (props = {}) => {
    api.listDir.mockResolvedValue(bigListing);
    open(props);
    await waitFor(() => expect(screen.getByText('notes')).toBeTruthy());
  };

  it('narrows the list to names containing what was typed', async () => {
    await openBig();

    fireEvent.change(search(), { target: { value: 'bin' } });

    expect(rowNames()).toEqual(['binder', 'bindings']);
  });

  it('matches without regard to case', async () => {
    await openBig();

    fireEvent.change(search(), { target: { value: 'BINDER' } });

    expect(rowNames()).toEqual(['binder']);
  });

  it('keeps a matched repository openable from its row', async () => {
    const onPick = vi.fn();
    await openBig({ onPick });

    fireEvent.change(search(), { target: { value: 'binder' } });
    fireEvent.click(screen.getByTitle('Open binder'));

    expect(onPick).toHaveBeenCalledWith('/home/user/projects/binder');
  });

  it('says how much of the folder is showing while filtering', async () => {
    await openBig();

    fireEvent.change(search(), { target: { value: 'bin' } });

    expect(screen.getByText('2 of 4 folders')).toBeTruthy();
  });

  it('counts nothing when nothing is showing, and says so distinctly', async () => {
    await openBig();

    fireEvent.change(search(), { target: { value: 'zzzz' } });

    expect(rowNames()).toEqual([]);
    // Not the same message as a folder that simply has no subfolders.
    expect(screen.getByText(/no folders match/i)).toBeTruthy();
    expect(screen.queryByText('No folders here.')).toBeNull();
  });

  it('hides the go-up row while filtering, since it is not a match', async () => {
    await openBig();
    expect(screen.getByTitle('Go up to /home/user')).toBeTruthy();

    fireEvent.change(search(), { target: { value: 'bin' } });

    expect(screen.queryByTitle('Go up to /home/user')).toBeNull();
  });

  it('clears the filter after navigating, so the new folder is not hidden by it', async () => {
    await openBig();
    fireEvent.change(search(), { target: { value: 'notes' } });

    fireEvent.click(screen.getByText('notes'));

    await waitFor(() => expect(api.listDir).toHaveBeenCalledWith('/home/user/projects/notes'));
    await waitFor(() => expect(search().value).toBe(''));
  });

  it('navigates to an absolute path on Enter instead of filtering by it', async () => {
    await openBig();

    fireEvent.change(search(), { target: { value: '/etc/apt' } });
    fireEvent.keyDown(search(), { key: 'Enter' });

    await waitFor(() => expect(api.listDir).toHaveBeenCalledWith('/etc/apt'));
  });

  it('navigates to a ~ path on Enter, leaving home to the server', async () => {
    await openBig();

    fireEvent.change(search(), { target: { value: '~/projects' } });
    fireEvent.keyDown(search(), { key: 'Enter' });

    await waitFor(() => expect(api.listDir).toHaveBeenCalledWith('~/projects'));
  });

  it('enters the only match on Enter when a filter leaves exactly one', async () => {
    await openBig();

    fireEvent.change(search(), { target: { value: 'binder' } });
    fireEvent.keyDown(search(), { key: 'Enter' });

    await waitFor(() => expect(api.listDir).toHaveBeenCalledWith('/home/user/projects/binder'));
  });

  it('does nothing on Enter while several rows still match', async () => {
    await openBig();
    const before = api.listDir.mock.calls.length;

    fireEvent.change(search(), { target: { value: 'bin' } });
    fireEvent.keyDown(search(), { key: 'Enter' });

    expect(api.listDir.mock.calls.length).toBe(before);
  });

  it('clears a filter on Escape', async () => {
    await openBig();
    fireEvent.change(search(), { target: { value: 'bin' } });

    fireEvent.keyDown(search(), { key: 'Escape' });

    expect(search().value).toBe('');
    expect(rowNames()).toEqual(['binder', 'bindings', 'myapp', 'notes']);
  });

  it('takes focus when the dialog opens, so typing filters straight away', async () => {
    await openBig();
    expect(document.activeElement).toBe(search());
  });
});
