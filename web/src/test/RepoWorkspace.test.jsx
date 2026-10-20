import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from '../api.js';
import RepoWorkspace from '../components/RepoWorkspace.jsx';

vi.mock('../api.js');

const commits = [
  { hash: 'WORKING', parents: ['aaaaaaa1'], subject: 'Uncommitted changes', author: '',
    email: '', date: '', refs: [], working: true, lane: 0, connectors: [], color: '#000' },
  { hash: 'aaaaaaa1', parents: [], subject: 'first commit', author: 'a', email: 'a@b',
    date: '2026-01-01', refs: ['HEAD -> main'], lane: 0, connectors: [], color: '#000' },
];

function stubClient(repo) {
  return {
    repo,
    getLog: vi.fn().mockResolvedValue({ commits }),
    getStatus: vi.fn().mockResolvedValue({ staged: [], unstaged: [], untracked: [] }),
    getBranches: vi.fn().mockResolvedValue({ current: 'main', local: ['main'], remote: [] }),
    getStashes: vi.fn().mockResolvedValue({ stashes: [] }),
    getTags: vi.fn().mockResolvedValue({ tags: ['v2.0', 'v1.0'] }),
    deleteTag: vi.fn().mockResolvedValue({ ok: true }),
    getDiff: vi.fn().mockResolvedValue({ patch: 'diff --git a/x b/x\n+hello' }),
  };
}

let clients;
beforeEach(() => {
  vi.clearAllMocks();
  clients = {};
  api.bindRepo.mockImplementation((repo) => (clients[repo] ??= stubClient(repo)));
});

// The packaged app runs in Electron, which throws on prompt(); jsdom quietly
// stubs it, so make both browser dialogs fail here the way they would there.
window.prompt = () => { throw new Error('prompt() is not supported.'); };
window.confirm = () => { throw new Error('confirm() is not supported.'); };

// The in-app dialog, once it is up.
const dialog = async () => within(await screen.findByRole('dialog'));
// Answer it: type a name (prompts only) and confirm, or back out.
async function answer(name) {
  const d = await dialog();
  const input = d.getByRole('textbox');
  fireEvent.change(input, { target: { value: name } });
  fireEvent.submit(input.form);
}
async function choose(label) {
  fireEvent.click((await dialog()).getByRole('button', { name: label }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

function mount(repo = '/repos/alpha', props = {}) {
  return render(<RepoWorkspace repo={repo} theme="light" onToggleTheme={() => {}}
    onBrowse={() => {}} diffHeight={240} onSplitterDrag={() => {}} {...props} />);
}

describe('RepoWorkspace', () => {
  it('loads its own repository on mount', async () => {
    mount('/repos/alpha');
    await waitFor(() => expect(api.bindRepo).toHaveBeenCalledWith('/repos/alpha'));
    const c = clients['/repos/alpha'];
    await waitFor(() => expect(c.getLog).toHaveBeenCalled());
    expect(c.getStatus).toHaveBeenCalled();
    expect(c.getBranches).toHaveBeenCalled();
    expect(c.getStashes).toHaveBeenCalled();
    expect(await screen.findByText('first commit')).toBeTruthy();
  });

  it('binds to the repo it was given, not a shared one', async () => {
    mount('/repos/beta');
    await waitFor(() => expect(api.bindRepo).toHaveBeenCalledWith('/repos/beta'));
    expect(api.bindRepo).not.toHaveBeenCalledWith('/repos/alpha');
  });

  it('shows a commit diff through its own client', async () => {
    mount('/repos/alpha');
    const row = await screen.findByText('first commit');
    fireEvent.click(row);
    const c = clients['/repos/alpha'];
    await waitFor(() => expect(c.getDiff).toHaveBeenCalledWith({ commit: 'aaaaaaa1' }));
  });

  it('renders the toolbar for its repository', async () => {
    mount('/repos/alpha');
    await waitFor(() => expect(screen.getByTitle('/repos/alpha').textContent)
      .toBe('/repos/alpha'));
    expect(await screen.findByTitle('Current branch / HEAD')).toBeTruthy();
  });

  it('shows how far the branch is ahead of and behind its upstream on Push and Pull', async () => {
    api.bindRepo.mockImplementation((repo) => (clients[repo] ??= {
      ...stubClient(repo),
      getBranches: vi.fn().mockResolvedValue({ current: 'main', local: ['main'], remote: ['origin/main'],
        upstream: { name: 'origin/main', ahead: 4, behind: 1 } }),
    }));
    mount('/repos/alpha');
    await waitFor(() => expect(screen.getByTitle('Push 4 commits to origin/main')).toBeTruthy());
    expect(screen.getByTitle('Pull 1 commit from origin/main')).toBeTruthy();
  });

  // The uncommitted-changes panel (file lists | diff) has its own divider.
  async function openUncommittedPanel() {
    mount('/repos/alpha');
    // The row renders as "✎ Uncommitted changes", so match on its title.
    fireEvent.click(await screen.findByTitle('View uncommitted changes'));
    await waitFor(() => expect(document.querySelector('.uncommitted-panel')).toBeTruthy());
  }
  const filesWidth = () =>
    parseInt(document.querySelector('.uncommitted-files').style.width, 10);

  it('puts the commit box below both the file lists and the code', async () => {
    await openUncommittedPanel();
    const panel = document.querySelector('.uncommitted-panel');
    const box = panel.querySelector('.fs-commit');

    // A sibling after the row, not tucked inside the file-lists column.
    expect(box.parentElement).toBe(panel);
    expect(box.previousElementSibling.className).toContain('uncommitted-row');
    expect(document.querySelector('.uncommitted-files .fs-commit')).toBeNull();
  });

  it('puts a divider between the uncommitted file lists and the diff', async () => {
    await openUncommittedPanel();
    const splitter = document.querySelector('.uncommitted-panel .col-splitter');
    expect(splitter).toBeTruthy();
    expect(splitter.previousElementSibling.className).toContain('uncommitted-files');
    expect(splitter.nextElementSibling.className).toContain('uncommitted-diff');
  });

  it('resizes the uncommitted file lists, and remembers the width', async () => {
    await openUncommittedPanel();
    const before = filesWidth();

    const splitter = document.querySelector('.uncommitted-panel .col-splitter');
    fireEvent.mouseDown(splitter, { clientX: 400 });
    fireEvent.mouseMove(window, { clientX: 460 });
    fireEvent.mouseUp(window, { clientX: 460 });

    expect(filesWidth()).toBe(before + 60);
    expect(Number(localStorage.getItem('uncommittedWidth'))).toBe(before + 60);
  });
});

// Two hunks in one file, so a test can act on one and check the other is left
// out of the patch that reaches the client.
const FILE_PATCH = [
  'diff --git a/a.txt b/a.txt',
  'index 111..222 100644',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-two',
  '+two prime',
  '@@ -20,2 +20,2 @@',
  '-old tail',
  '+new tail',
  ' end',
  '',
].join('\n');

describe('RepoWorkspace hunk actions', () => {
  afterEach(() => vi.restoreAllMocks());

  // `status` replaces the default working-tree status. It has to be given
  // here: refresh asks for the status as soon as the workspace mounts.
  function mountWithChanges({ untracked = false, stashes = [], status } = {}) {
    const c = stubClient('/repos/alpha');
    c.getStashes = vi.fn().mockResolvedValue({ stashes });
    c.getStatus = vi.fn().mockResolvedValue(status ?? {
      staged: [{ path: 'staged.txt', status: 'M' }],
      unstaged: untracked ? [] : [{ path: 'a.txt', status: 'M' }],
      untracked: untracked ? ['new.txt'] : [],
    });
    c.getDiff = vi.fn().mockResolvedValue({ patch: FILE_PATCH });
    c.applyHunk = vi.fn().mockResolvedValue({ ok: true, output: '' });
    clients['/repos/alpha'] = c;
    mount('/repos/alpha');
    return c;
  }

  // Open the uncommitted panel and click a file in it to show that file's diff.
  async function openFile(name) {
    fireEvent.click(await screen.findByTitle('View uncommitted changes'));
    await waitFor(() => expect(document.querySelector('.uncommitted-panel')).toBeTruthy());
    fireEvent.click(await screen.findByText(name));
    await waitFor(() => expect(document.querySelector('.uncommitted-diff .hunk')).toBeTruthy());
    return within(document.querySelector('.uncommitted-diff'));
  }

  it('stages the one hunk whose button was clicked', async () => {
    const client = mountWithChanges();
    const diff = await openFile('a.txt');

    fireEvent.click(diff.getAllByRole('button', { name: 'Stage' })[1]);

    await waitFor(() => expect(client.applyHunk).toHaveBeenCalledTimes(1));
    const arg = client.applyHunk.mock.calls[0][0];
    expect(arg.cached).toBe(true);
    expect(arg.reverse).toBeFalsy();
    expect(arg.patch).toMatch(/^\+new tail$/m);
    expect(arg.patch).not.toMatch(/two prime/);
  });

  it('reloads the status after staging, so the file lists catch up', async () => {
    const client = mountWithChanges();
    const diff = await openFile('a.txt');
    const before = client.getStatus.mock.calls.length;

    fireEvent.click(diff.getAllByRole('button', { name: 'Stage' })[0]);

    await waitFor(() => expect(client.getStatus.mock.calls.length).toBeGreaterThan(before));
  });

  it('unstages a hunk from a file on the staged side', async () => {
    const client = mountWithChanges();
    const diff = await openFile('staged.txt');

    fireEvent.click(diff.getAllByRole('button', { name: 'Unstage' })[0]);

    await waitFor(() => expect(client.applyHunk).toHaveBeenCalled());
    expect(client.applyHunk.mock.calls[0][0]).toMatchObject({ cached: true, reverse: true });
  });

  it('discards a hunk from the working tree once confirmed', async () => {
    const client = mountWithChanges();
    const diff = await openFile('a.txt');

    fireEvent.click(diff.getAllByRole('button', { name: 'Discard' })[0]);
    await choose('Discard hunk');

    await waitFor(() => expect(client.applyHunk).toHaveBeenCalled());
    const arg = client.applyHunk.mock.calls[0][0];
    expect(arg.reverse).toBe(true);
    expect(arg.cached).toBeFalsy();
    expect(arg.patch).toMatch(/^\+two prime$/m);
  });

  it('discards nothing when the confirmation is declined', async () => {
    const client = mountWithChanges();
    const diff = await openFile('a.txt');

    fireEvent.click(diff.getAllByRole('button', { name: 'Discard' })[0]);
    await choose('Cancel');

    expect(client.applyHunk).not.toHaveBeenCalled();
  });

  it('surfaces git\'s complaint when a hunk no longer applies', async () => {
    const client = mountWithChanges();
    client.applyHunk = vi.fn().mockResolvedValue({ ok: false, error: 'error: patch does not apply' });
    const diff = await openFile('a.txt');

    fireEvent.click(diff.getAllByRole('button', { name: 'Stage' })[0]);

    expect(await screen.findByText('error: patch does not apply')).toBeTruthy();
  });

  it('offers no hunk buttons for an untracked file, which stages whole', async () => {
    mountWithChanges({ untracked: true });
    const diff = await openFile('new.txt');

    expect(diff.queryAllByRole('button', { name: 'Stage' })).toHaveLength(0);
    expect(diff.queryAllByRole('button', { name: 'Discard' })).toHaveLength(0);
  });
  it('offers no hunk buttons on a stash diff, even after a working file was open', async () => {
    mountWithChanges({ stashes: [{ ref: 'stash@{0}', message: 'wip' }] });
    await openFile('a.txt');

    fireEvent.contextMenu(screen.getByText(/wip/));
    fireEvent.click(await screen.findByText('View diff'));

    await waitFor(() => expect(document.querySelector('.hunk')).toBeTruthy());
    // Within the diff: the toolbar has a Discard button of its own.
    const diff = within(document.querySelector('.diff-wrap'));
    expect(diff.queryAllByRole('button', { name: 'Stage' })).toHaveLength(0);
    expect(diff.queryAllByRole('button', { name: 'Discard' })).toHaveLength(0);
  });

  it('asks for a staged rename\'s diff with both of its paths', async () => {
    const client = mountWithChanges({ status: {
      staged: [{ path: 'new name.txt', origPath: 'old name.txt', status: 'R' }],
      unstaged: [], untracked: [],
    } });
    await openFile('new name.txt');
    expect(client.getDiff).toHaveBeenCalledWith({ path: 'new name.txt', origPath: 'old name.txt', staged: true });
  });

  it('reloads the open file\'s diff after a hunk is staged, so it stops being offered', async () => {
    const client = mountWithChanges();
    const diff = await openFile('a.txt');
    client.getDiff.mockClear();

    fireEvent.click(diff.getAllByRole('button', { name: 'Stage' })[0]);

    await waitFor(() => expect(client.getDiff).toHaveBeenCalledWith({ path: 'a.txt', staged: false }));
  });

  it('leaves the diff alone when a discard is declined', async () => {
    const client = mountWithChanges();
    const diff = await openFile('a.txt');
    client.getDiff.mockClear();

    fireEvent.click(diff.getAllByRole('button', { name: 'Discard' })[0]);
    await choose('Cancel');

    expect(client.getDiff).not.toHaveBeenCalled();
  });
});

// The uncommitted panel's diff belongs to the working tree: a commit selected
// before it must not leave its patch showing there.
describe('RepoWorkspace switching from a commit to the uncommitted changes', () => {
  const COMMIT_PATCH = [
    'diff --git a/old.txt b/old.txt',
    '--- a/old.txt',
    '+++ b/old.txt',
    '@@ -1 +1 @@',
    '-before',
    '+from the commit',
    '',
  ].join('\n');

  function mountWithCommitDiff(getDiff) {
    const c = stubClient('/repos/alpha');
    c.getStatus = vi.fn().mockResolvedValue({
      staged: [], unstaged: [{ path: 'a.txt', status: 'M' }], untracked: [],
    });
    c.getDiff = getDiff;
    clients['/repos/alpha'] = c;
    mount('/repos/alpha');
    return c;
  }

  it('shows the empty placeholder, not the commit\'s hunks', async () => {
    mountWithCommitDiff(vi.fn().mockResolvedValue({ patch: COMMIT_PATCH }));
    fireEvent.click(await screen.findByText('first commit'));
    expect(await screen.findByText('+from the commit')).toBeTruthy();

    fireEvent.click(screen.getByTitle('View uncommitted changes'));
    await waitFor(() => expect(document.querySelector('.uncommitted-panel')).toBeTruthy());

    const pane = within(document.querySelector('.uncommitted-diff'));
    expect(pane.queryByText('+from the commit')).toBeNull();
    expect(pane.getByText('Select a commit or file to see its diff.')).toBeTruthy();
  });

  it('drops a commit diff that answers after the uncommitted changes were selected', async () => {
    let answer;
    mountWithCommitDiff(vi.fn(() => new Promise((r) => { answer = r; })));
    fireEvent.click(await screen.findByText('first commit'));
    fireEvent.click(screen.getByTitle('View uncommitted changes'));
    await waitFor(() => expect(document.querySelector('.uncommitted-panel')).toBeTruthy());

    answer({ patch: COMMIT_PATCH });
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByText('+from the commit')).toBeNull();
  });
});

describe('RepoWorkspace tags', () => {
  it('loads the tags for its repository', async () => {
    mount('/repos/alpha');
    const c = clients['/repos/alpha'];
    await waitFor(() => expect(c.getTags).toHaveBeenCalled());
    expect(await screen.findByText(/v2\.0/)).toBeTruthy();
    expect(await screen.findByText(/v1\.0/)).toBeTruthy();
  });

  it('deletes a tag once confirmed, then reloads', async () => {
    mount('/repos/alpha');
    const c = clients['/repos/alpha'];
    fireEvent.contextMenu(await screen.findByText(/v1\.0/));
    fireEvent.click(screen.getByText('Delete'));
    expect(c.deleteTag).not.toHaveBeenCalled();
    await choose('Delete tag');
    await waitFor(() => expect(c.deleteTag).toHaveBeenCalledWith('v1.0'));
    await waitFor(() => expect(c.getTags.mock.calls.length).toBeGreaterThan(1));
  });

  it('leaves the tag alone when the confirmation is dismissed', async () => {
    mount('/repos/alpha');
    const c = clients['/repos/alpha'];
    fireEvent.contextMenu(await screen.findByText(/v1\.0/));
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(c.deleteTag).not.toHaveBeenCalled();
  });

  it('checks a tag out by double-clicking it', async () => {
    mount('/repos/alpha');
    const c = clients['/repos/alpha'];
    c.checkout = vi.fn().mockResolvedValue({ ok: true });
    fireEvent.doubleClick(await screen.findByText(/v1\.0/));
    await waitFor(() => expect(c.checkout).toHaveBeenCalledWith('v1.0'));
  });
});

describe('RepoWorkspace tag selection', () => {
  // A log where a tag sits on an older commit than HEAD, so selecting the tag
  // has to move the cursor rather than leave it where it already was.
  const tagged = [
    { hash: 'ccccccc3', parents: ['bbbbbbb2'], subject: 'newest', author: 'a', email: 'a@b',
      date: '2026-03-01', refs: ['HEAD -> main'], lane: 0, connectors: [], color: '#000' },
    { hash: 'bbbbbbb2', parents: ['aaaaaaa1'], subject: 'the tagged one', author: 'a', email: 'a@b',
      date: '2026-02-01', refs: ['tag: v1.0'], lane: 0, connectors: [], color: '#000' },
    { hash: 'aaaaaaa1', parents: [], subject: 'oldest', author: 'a', email: 'a@b',
      date: '2026-01-01', refs: [], lane: 0, connectors: [], color: '#000' },
  ];

  function mountTagged() {
    clients['/repos/tagged'] = {
      repo: '/repos/tagged',
      getLog: vi.fn().mockResolvedValue({ commits: tagged }),
      getStatus: vi.fn().mockResolvedValue({ staged: [], unstaged: [], untracked: [] }),
      getBranches: vi.fn().mockResolvedValue({ current: 'main', local: ['main'], remote: [] }),
      getStashes: vi.fn().mockResolvedValue({ stashes: [] }),
      getTags: vi.fn().mockResolvedValue({ tags: ['v1.0'] }),
      getDiff: vi.fn().mockResolvedValue({ patch: 'diff --git a/tagged b/tagged\n+at the tag' }),
    };
    return mount('/repos/tagged');
  }

  // The sidebar row, not the graph's "tag: v1.0" decoration pill — clicking
  // that pill's commit row would reach the same commit by another path and
  // make these tests pass without the sidebar doing anything.
  const tagRow = async (container) => {
    await waitFor(() => expect(container.querySelector('.tag-row')).toBeTruthy());
    return container.querySelector('.tag-row');
  };
  const branchRow = async (container) => {
    await waitFor(() => expect(container.querySelector('.current-branch')).toBeTruthy());
    return container.querySelector('.current-branch');
  };

  it('shows the diff of the commit a clicked tag points at', async () => {
    const { container } = mountTagged();
    const c = clients['/repos/tagged'];
    fireEvent.click(await tagRow(container));
    await waitFor(() => expect(c.getDiff).toHaveBeenCalledWith({ commit: 'bbbbbbb2' }));
    expect(await screen.findByText(/at the tag/)).toBeTruthy();
  });

  it('highlights the clicked tag in the sidebar', async () => {
    const { container } = mountTagged();
    fireEvent.click(await tagRow(container));
    await waitFor(() => expect(container.querySelector('.selected-tag')).toBeTruthy());
    expect(container.querySelector('.selected-tag').textContent).toContain('v1.0');
  });

  it('drops the branch highlight when a tag is clicked', async () => {
    const { container } = mountTagged();
    fireEvent.click(await branchRow(container));
    await waitFor(() => expect(container.querySelector('.selected-branch')).toBeTruthy());
    fireEvent.click(await tagRow(container));
    await waitFor(() => expect(container.querySelector('.selected-tag')).toBeTruthy());
    expect(container.querySelector('.selected-branch')).toBeNull();
  });

  it('drops the tag highlight when a commit is clicked', async () => {
    const { container } = mountTagged();
    fireEvent.click(await tagRow(container));
    await waitFor(() => expect(container.querySelector('.selected-tag')).toBeTruthy());
    fireEvent.click(await screen.findByText('oldest'));
    await waitFor(() => expect(container.querySelector('.selected-tag')).toBeNull());
  });
});

describe('RepoWorkspace history paging and refresh', () => {
  it('asks for a page of history, and a bigger one when the graph wants more', async () => {
    api.bindRepo.mockImplementation((repo) => (clients[repo] ??= {
      ...stubClient(repo),
      getLog: vi.fn().mockResolvedValue({ commits, hasMore: true }),
    }));
    mount('/repos/alpha');
    const c = clients['/repos/alpha'];
    // Two commits fit on screen and more exist, so the graph asks right away.
    await waitFor(() => expect(c.getLog).toHaveBeenCalledTimes(2));
    const [first] = c.getLog.mock.calls[0];
    const [second] = c.getLog.mock.calls[1];
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  });

  it('re-reads the repository when the window regains focus', async () => {
    mount('/repos/alpha');
    const c = clients['/repos/alpha'];
    await waitFor(() => expect(c.getStatus).toHaveBeenCalledTimes(1));
    fireEvent.focus(window);
    await waitFor(() => expect(c.getStatus).toHaveBeenCalledTimes(2));
  });

  it('leaves an inactive tab alone when the window regains focus', async () => {
    mount('/repos/alpha', { active: false });
    const c = clients['/repos/alpha'];
    fireEvent.focus(window);
    await new Promise((r) => setTimeout(r, 20));
    expect(c.getStatus).not.toHaveBeenCalled();
  });
});

describe('RepoWorkspace paging past a longer reply', () => {
  it('asks for a page beyond what arrived, when the server sent more than asked', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({
      hash: `h${i}`, parents: [], subject: `c${i}`, author: 'a', email: '', date: '', refs: [],
      lane: 0, connectors: [], color: '#000' }));
    api.bindRepo.mockImplementation((repo) => (clients[repo] ??= {
      ...stubClient(repo),
      getLog: vi.fn().mockResolvedValue({ commits: many, hasMore: true }),
    }));
    const { container } = mount('/repos/alpha');
    const c = clients['/repos/alpha'];
    await waitFor(() => expect(c.getLog).toHaveBeenCalledTimes(1));
    const graph = await waitFor(() => container.querySelector('.commit-graph'));
    graph.scrollTop = 2500 * 44;
    fireEvent.scroll(graph);
    await waitFor(() => expect(c.getLog).toHaveBeenCalledTimes(2));
    expect(c.getLog.mock.calls[1][0]).toBeGreaterThan(2500);
  });
});

describe('RepoWorkspace selecting a ref below the loaded history', () => {
  // 3000 commits, newest first; a tag and a branch sit on commit 1400, well
  // past the first page. getLog answers like the server: a page of `limit`,
  // doubled until it holds the `include` ref's commit.
  const TARGET = 1400;
  const deep = Array.from({ length: 3000 }, (_, i) => ({
    hash: `h${i}`, parents: i + 1 < 3000 ? [`h${i + 1}`] : [], subject: `commit ${i}`,
    author: 'a', email: '', date: '', lane: 0, connectors: [], color: '#000',
    refs: i === 0 ? ['HEAD -> main'] : i === TARGET ? ['topic', 'tag: v0.1'] : [],
  }));
  function getLog(limit = 1000, include) {
    let n = limit;
    if (include) while (n <= TARGET) n *= 2;
    return Promise.resolve({ commits: deep.slice(0, n), hasMore: n < deep.length });
  }

  function mountDeep() {
    clients['/repos/deep'] = {
      ...stubClient('/repos/deep'),
      getLog: vi.fn(getLog),
      getBranches: vi.fn().mockResolvedValue({ current: 'main', local: ['main', 'topic'], remote: [] }),
      getTags: vi.fn().mockResolvedValue({ tags: ['v0.1'] }),
    };
    return mount('/repos/deep');
  }
  const rowOf = (subject) => screen.getByText(subject).closest('.graph-row');

  it('loads history down to a clicked tag and shows its commit selected', async () => {
    const { container } = mountDeep();
    const c = clients['/repos/deep'];
    await waitFor(() => expect(container.querySelector('.tag-row')).toBeTruthy());
    await waitFor(() => expect(c.getLog).toHaveBeenCalled());
    fireEvent.click(container.querySelector('.tag-row'));
    await waitFor(() => expect(c.getLog).toHaveBeenCalledWith(expect.any(Number), 'refs/tags/v0.1'));
    await waitFor(() => expect(c.getDiff).toHaveBeenCalledWith({ commit: `h${TARGET}` }));
    await waitFor(() => expect(rowOf(`commit ${TARGET}`).className).toContain('selected'));
  });

  it('loads history down to a clicked branch and shows its commit selected', async () => {
    const { container } = mountDeep();
    const c = clients['/repos/deep'];
    await waitFor(() => expect(screen.getByText('⑂ topic')).toBeTruthy());
    await waitFor(() => expect(c.getLog).toHaveBeenCalled());
    fireEvent.click(screen.getByText('⑂ topic'));
    await waitFor(() => expect(c.getLog).toHaveBeenCalledWith(expect.any(Number), 'refs/heads/topic'));
    await waitFor(() => expect(rowOf(`commit ${TARGET}`).className).toContain('selected'));
    expect(container.querySelector('.selected-branch').textContent).toContain('topic');
  });

  it('does not read again the history the ref just brought in', async () => {
    const { container } = mountDeep();
    const c = clients['/repos/deep'];
    await waitFor(() => expect(container.querySelector('.tag-row')).toBeTruthy());
    await waitFor(() => expect(c.getLog).toHaveBeenCalledTimes(1));
    fireEvent.click(container.querySelector('.tag-row'));
    await waitFor(() => expect(rowOf(`commit ${TARGET}`).className).toContain('selected'));
    await new Promise((r) => setTimeout(r, 50));
    expect(c.getLog).toHaveBeenCalledTimes(2); // the first page, then the one down to the ref
  });

  it('keeps the reached commit when the history is read again', async () => {
    const { container } = mountDeep();
    const c = clients['/repos/deep'];
    await waitFor(() => expect(container.querySelector('.tag-row')).toBeTruthy());
    await waitFor(() => expect(c.getLog).toHaveBeenCalled());
    fireEvent.click(container.querySelector('.tag-row'));
    await waitFor(() => expect(rowOf(`commit ${TARGET}`).className).toContain('selected'));
    const calls = c.getLog.mock.calls.length;
    fireEvent.focus(window);
    await waitFor(() => expect(c.getLog.mock.calls.length).toBeGreaterThan(calls));
    // A plain re-read asks for at least as much as the ref's page held.
    const [limit, include] = c.getLog.mock.calls.at(-1);
    expect(include).toBeUndefined();
    expect(limit).toBeGreaterThan(TARGET);
    await waitFor(() => expect(rowOf(`commit ${TARGET}`).className).toContain('selected'));
  });
});

describe('RepoWorkspace refresh', () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
  };
  const logOf = (subject) => ({ commits: [{ hash: 'abcdef12', parents: [], subject, author: 'a',
    email: 'a@b', date: '2026-01-01', refs: ['HEAD -> main'], lane: 0, connectors: [], color: '#000' }] });

  it('asks for everything at once rather than one after another', async () => {
    const log = deferred();
    api.bindRepo.mockImplementation((repo) => {
      const c = stubClient(repo);
      c.getLog = vi.fn(() => log.promise);
      return (clients[repo] = c);
    });
    mount('/repos/alpha');
    const c = clients['/repos/alpha'];
    // The log has not answered, and the rest have still been asked for.
    await waitFor(() => expect(c.getTags).toHaveBeenCalled());
    expect(c.getStatus).toHaveBeenCalled();
    expect(c.getBranches).toHaveBeenCalled();
    expect(c.getStashes).toHaveBeenCalled();
    log.resolve({ commits });
    expect(await screen.findByText('first commit')).toBeTruthy();
  });

  it('ignores a slow refresh that a newer one has already overtaken', async () => {
    const slow = deferred();
    api.bindRepo.mockImplementation((repo) => {
      const c = stubClient(repo);
      c.getLog = vi.fn()
        .mockImplementationOnce(() => slow.promise)
        .mockResolvedValue(logOf('the newer history'));
      return (clients[repo] = c);
    });
    const { rerender } = mount('/repos/alpha');
    const c = clients['/repos/alpha'];
    await waitFor(() => expect(c.getLog).toHaveBeenCalledTimes(1));
    // Leave and re-enter the tab: a second refresh, which answers first.
    const props = { repo: '/repos/alpha', theme: 'light', onToggleTheme: () => {},
      diffHeight: 240, onSplitterDrag: () => {} };
    rerender(<RepoWorkspace {...props} active={false} />);
    rerender(<RepoWorkspace {...props} active />);
    expect(await screen.findByText('the newer history')).toBeTruthy();
    // Now the first one finally answers, with what is by now out of date.
    slow.resolve(logOf('the stale history'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('the stale history')).toBeNull();
    expect(screen.getByText('the newer history')).toBeTruthy();
  });
});

describe('RepoWorkspace merge conflicts', () => {
  afterEach(() => vi.restoreAllMocks());

  const MERGING = {
    staged: [], unstaged: [], untracked: [],
    conflicted: [{ path: 'both.txt', status: 'UU' }],
    merge: { message: "Merge branch 'feat'" },
  };

  function mountMerging(status = MERGING) {
    const c = stubClient('/repos/alpha');
    c.getStatus = vi.fn().mockResolvedValue(status);
    c.getDiff = vi.fn().mockResolvedValue({ patch: FILE_PATCH });
    c.abortMerge = vi.fn().mockResolvedValue({ ok: true, output: '' });
    c.continueMerge = vi.fn().mockResolvedValue({ ok: true, output: '' });
    c.resolveConflict = vi.fn().mockResolvedValue({ ok: true, output: '' });
    c.stage = vi.fn().mockResolvedValue({ ok: true });
    clients['/repos/alpha'] = c;
    mount('/repos/alpha');
    return c;
  }

  it('shows the merge banner while a merge is in progress', async () => {
    mountMerging();
    const banner = await waitFor(() => {
      const b = document.querySelector('.merge-banner');
      expect(b).toBeTruthy();
      return b;
    });
    expect(banner.textContent).toContain("Merge branch 'feat'");
  });

  it('shows no banner outside a merge', async () => {
    const c = clients['/repos/alpha'] = stubClient('/repos/alpha');
    mount('/repos/alpha');
    await waitFor(() => expect(c.getStatus).toHaveBeenCalled());
    expect(document.querySelector('.merge-banner')).toBeNull();
  });

  it('opens the file status view so the conflicts are in front of the user', async () => {
    mountMerging();
    await waitFor(() => expect(document.querySelector('.fs-conflicted')).toBeTruthy());
  });

  it('aborts the merge once confirmed, then reloads', async () => {
    const c = mountMerging();
    fireEvent.click(await screen.findByRole('button', { name: 'Abort merge' }));
    await choose('Abort merge');
    await waitFor(() => expect(c.abortMerge).toHaveBeenCalled());
    await waitFor(() => expect(c.getStatus.mock.calls.length).toBeGreaterThan(1));
    expect(await screen.findByText('Merge aborted.')).toBeTruthy();
  });

  it('leaves the merge alone when the abort is declined', async () => {
    const c = mountMerging();
    fireEvent.click(await screen.findByRole('button', { name: 'Abort merge' }));
    await choose('Cancel');
    expect(c.abortMerge).not.toHaveBeenCalled();
  });

  it('commits the merge from the banner once nothing is left in conflict', async () => {
    const c = mountMerging({ ...MERGING, conflicted: [], staged: [{ path: 'both.txt', status: 'M' }] });
    const button = await screen.findByRole('button', { name: 'Commit merge' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(c.continueMerge).toHaveBeenCalled());
  });

  it('closes the open file diff once the merge is committed or aborted', async () => {
    const c = mountMerging({ ...MERGING, conflicted: [], staged: [{ path: 'both.txt', status: 'M' }] });
    fireEvent.click(await screen.findByText('both.txt'));
    await waitFor(() => expect(document.querySelector('.hunk')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Commit merge' }));
    await waitFor(() => expect(c.continueMerge).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('.hunk')).toBeNull());
  });

  it('resolves a conflicted file to one side and reloads', async () => {
    const c = mountMerging();
    fireEvent.contextMenu(await screen.findByText('both.txt'));
    fireEvent.click(screen.getByText('Resolve using theirs'));
    await waitFor(() => expect(c.resolveConflict).toHaveBeenCalledWith('both.txt', 'theirs'));
    await waitFor(() => expect(c.getStatus.mock.calls.length).toBeGreaterThan(1));
  });

  it('surfaces git\'s complaint when a resolve fails', async () => {
    const c = mountMerging();
    c.resolveConflict = vi.fn().mockResolvedValue({ ok: false, error: 'error: no such path' });
    fireEvent.contextMenu(await screen.findByText('both.txt'));
    fireEvent.click(screen.getByText('Resolve using mine'));
    expect(await screen.findByText('error: no such path')).toBeTruthy();
  });

  it('marks a hand-edited file resolved by staging it', async () => {
    const c = mountMerging();
    fireEvent.click(await screen.findByLabelText('mark both.txt resolved'));
    await waitFor(() => expect(c.stage).toHaveBeenCalledWith(['both.txt']));
  });

  it('shows what got staged when the open file is resolved, not its stale conflict', async () => {
    const c = mountMerging();
    fireEvent.click(await screen.findByText('both.txt'));
    await waitFor(() => expect(c.getDiff).toHaveBeenCalledWith({ path: 'both.txt', staged: false }));
    fireEvent.contextMenu(screen.getByText('both.txt'));
    fireEvent.click(screen.getByText('Resolve using mine'));
    await waitFor(() => expect(c.getDiff).toHaveBeenCalledWith({ path: 'both.txt', staged: true }));
    expect(await screen.findByText('Resolved both.txt using mine.')).toBeTruthy();
  });

  it('leaves the open diff alone when a different file is resolved', async () => {
    const c = mountMerging({ ...MERGING, conflicted: [...MERGING.conflicted, { path: 'other.txt', status: 'AA' }] });
    fireEvent.click(await screen.findByText('both.txt'));
    await waitFor(() => expect(c.getDiff).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText('mark other.txt resolved'));
    await waitFor(() => expect(c.stage).toHaveBeenCalledWith(['other.txt']));
    expect(c.getDiff).toHaveBeenCalledTimes(1);
  });

  it('offers no hunk buttons on a conflicted file\'s diff', async () => {
    const c = mountMerging();
    fireEvent.click(await screen.findByText('both.txt'));
    await waitFor(() => expect(c.getDiff).toHaveBeenCalledWith({ path: 'both.txt', staged: false }));
    await waitFor(() => expect(document.querySelector('.hunk')).toBeTruthy());
    expect(screen.queryAllByRole('button', { name: 'Stage' })).toHaveLength(0);
  });
});

// The server answers a git log that failed partway with ok:false; what it
// printed before failing is not the history, so none of it arrives.
describe('RepoWorkspace when the history cannot be read', () => {
  const failed = { ok: false, error: 'git log: fatal: bad object deadbeef' };

  it('says so, and keeps the history already on screen', async () => {
    api.bindRepo.mockImplementation((repo) => (clients[repo] ??= {
      ...stubClient(repo),
      getLog: vi.fn().mockResolvedValueOnce({ commits }).mockResolvedValue(failed),
    }));
    const { container } = mount('/repos/alpha');
    expect(await screen.findByText('first commit')).toBeTruthy();
    fireEvent.focus(window);
    await waitFor(() => expect(container.querySelector('.error-bar')?.textContent)
      .toContain('fatal: bad object deadbeef'));
    expect(screen.getByText('first commit')).toBeTruthy();
  });

  it('says so when the history down to a clicked tag cannot be read', async () => {
    api.bindRepo.mockImplementation((repo) => (clients[repo] ??= {
      ...stubClient(repo),
      getLog: vi.fn((limit, include) => Promise.resolve(include ? failed : { commits, hasMore: true })),
    }));
    const { container } = mount('/repos/alpha');
    await waitFor(() => expect(container.querySelector('.tag-row')).toBeTruthy());
    expect(await screen.findByText('first commit')).toBeTruthy();
    fireEvent.click(container.querySelector('.tag-row'));
    await waitFor(() => expect(container.querySelector('.error-bar')?.textContent)
      .toContain('fatal: bad object deadbeef'));
    expect(screen.getByText('first commit')).toBeTruthy();
  });
});

describe('RepoWorkspace naming dialogs', () => {
  const ok = { ok: true, output: '' };
  function mountNaming() {
    const c = stubClient('/repos/alpha');
    c.getBranches = vi.fn().mockResolvedValue({ current: 'main', local: ['main', 'topic'], remote: [] });
    c.createBranch = vi.fn().mockResolvedValue(ok);
    c.renameBranch = vi.fn().mockResolvedValue(ok);
    c.tag = vi.fn().mockResolvedValue(ok);
    clients['/repos/alpha'] = c;
    mount('/repos/alpha');
    return c;
  }

  it('creates a branch at HEAD from the toolbar', async () => {
    const c = mountNaming();
    fireEvent.click(await screen.findByText('Branch'));
    await answer('  feature/x ');
    await waitFor(() => expect(c.createBranch).toHaveBeenCalledWith('feature/x'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(c.getBranches.mock.calls.length).toBeGreaterThan(1));
  });

  it('creates no branch from a name git would refuse, and says why', async () => {
    const c = mountNaming();
    fireEvent.click(await screen.findByText('Branch'));
    await answer('my branch');
    expect((await dialog()).getByRole('alert').textContent).toMatch(/space/i);
    expect(c.createBranch).not.toHaveBeenCalled();
  });

  it('creates nothing when the dialog is cancelled', async () => {
    const c = mountNaming();
    fireEvent.click(await screen.findByText('Branch'));
    await choose('Cancel');
    expect(c.createBranch).not.toHaveBeenCalled();
  });

  it('still shows git\'s complaint when the server refuses the name', async () => {
    const c = mountNaming();
    c.createBranch.mockResolvedValue({ ok: false, error: "fatal: a branch named 'topic' already exists" });
    fireEvent.click(await screen.findByText('Branch'));
    await answer('topic');
    expect(await screen.findByText("fatal: a branch named 'topic' already exists")).toBeTruthy();
  });

  it('tags HEAD from the toolbar', async () => {
    const c = mountNaming();
    fireEvent.click(await screen.findByText('Tag'));
    await answer('v3.0');
    await waitFor(() => expect(c.tag).toHaveBeenCalledWith('v3.0'));
  });

  it('renames a branch, starting from its current name', async () => {
    const c = mountNaming();
    fireEvent.contextMenu(await screen.findByText('⑂ topic'));
    fireEvent.click(screen.getByText('Rename…'));
    expect((await dialog()).getByRole('textbox').value).toBe('topic');
    await answer('topic-2');
    await waitFor(() => expect(c.renameBranch).toHaveBeenCalledWith('topic', 'topic-2'));
  });

  it('renames nothing when the name is left as it was', async () => {
    const c = mountNaming();
    fireEvent.contextMenu(await screen.findByText('⑂ topic'));
    fireEvent.click(screen.getByText('Rename…'));
    await answer('topic');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(c.renameBranch).not.toHaveBeenCalled();
  });

  it('creates a branch at a commit from its context menu', async () => {
    const c = mountNaming();
    fireEvent.contextMenu(await screen.findByText('first commit'));
    fireEvent.click(screen.getByText('Create branch here…'));
    await answer('from-first');
    await waitFor(() => expect(c.createBranch).toHaveBeenCalledWith('from-first', 'aaaaaaa1'));
  });

  it('tags a commit from its context menu', async () => {
    const c = mountNaming();
    fireEvent.contextMenu(await screen.findByText('first commit'));
    fireEvent.click(screen.getByText('Create tag here…'));
    await answer('v0.1');
    await waitFor(() => expect(c.tag).toHaveBeenCalledWith('v0.1', 'aaaaaaa1'));
  });
});

describe('RepoWorkspace confirmations', () => {
  const ok = { ok: true, output: '' };
  function mountConfirming() {
    const c = stubClient('/repos/alpha');
    c.getBranches = vi.fn().mockResolvedValue({ current: 'main', local: ['main', 'topic'], remote: [] });
    c.getStashes = vi.fn().mockResolvedValue({ stashes: [{ ref: 'stash@{0}', message: 'wip' }] });
    c.getStatus = vi.fn().mockResolvedValue({
      staged: [], unstaged: [{ path: 'a.txt', status: 'M' }], untracked: ['new.txt'],
    });
    c.deleteBranch = vi.fn().mockResolvedValue(ok);
    c.dropStash = vi.fn().mockResolvedValue(ok);
    c.discardFile = vi.fn().mockResolvedValue(ok);
    c.deleteFile = vi.fn().mockResolvedValue(ok);
    c.discard = vi.fn().mockResolvedValue(ok);
    clients['/repos/alpha'] = c;
    mount('/repos/alpha');
    return c;
  }
  const fileMenu = async (name, item) => {
    fireEvent.click(await screen.findByTitle('View uncommitted changes'));
    fireEvent.contextMenu(await screen.findByText(name));
    fireEvent.click(screen.getByText(item));
  };

  it('force-deletes an unmerged branch only once that is confirmed', async () => {
    const c = mountConfirming();
    c.deleteBranch.mockResolvedValueOnce({ ok: false, error: 'error: not fully merged' });
    fireEvent.contextMenu(await screen.findByText('⑂ topic'));
    fireEvent.click(screen.getByText('Delete'));
    expect((await dialog()).getByText(/not fully merged/)).toBeTruthy();
    expect(c.deleteBranch).toHaveBeenCalledWith('topic', false);
    await choose('Force delete');
    await waitFor(() => expect(c.deleteBranch).toHaveBeenCalledWith('topic', true));
  });

  it('keeps an unmerged branch, and shows why, when the force-delete is declined', async () => {
    const c = mountConfirming();
    c.deleteBranch.mockResolvedValueOnce({ ok: false, error: 'error: not fully merged' });
    fireEvent.contextMenu(await screen.findByText('⑂ topic'));
    fireEvent.click(screen.getByText('Delete'));
    await choose('Cancel');
    expect(await screen.findByText('error: not fully merged')).toBeTruthy();
    expect(c.deleteBranch).toHaveBeenCalledTimes(1);
  });

  it('drops a stash once confirmed', async () => {
    const c = mountConfirming();
    fireEvent.contextMenu(await screen.findByText(/wip/));
    fireEvent.click(screen.getByText('Drop'));
    expect(c.dropStash).not.toHaveBeenCalled();
    await choose('Drop stash');
    await waitFor(() => expect(c.dropStash).toHaveBeenCalledWith('stash@{0}'));
  });

  it('discards one file\'s changes once confirmed', async () => {
    const c = mountConfirming();
    await fileMenu('a.txt', 'Discard changes');
    await choose('Discard changes');
    await waitFor(() => expect(c.discardFile).toHaveBeenCalledWith('a.txt'));
  });

  it('deletes an untracked file once confirmed', async () => {
    const c = mountConfirming();
    await fileMenu('new.txt', 'Delete file');
    await choose('Delete file');
    await waitFor(() => expect(c.deleteFile).toHaveBeenCalledWith('new.txt'));
  });

  it('discards every change from the toolbar once confirmed, and not before', async () => {
    const c = mountConfirming();
    fireEvent.click(await screen.findByText('Discard'));
    await choose('Cancel');
    expect(c.discard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Discard'));
    await choose('Discard all');
    await waitFor(() => expect(c.discard).toHaveBeenCalled());
  });
});
