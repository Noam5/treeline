import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import DiffPane, { splitDiff, parseFileSection, hunkPatch, parseCommitPreamble } from '../components/DiffPane.jsx';

const TWO_FILE_PATCH = [
  'commit abc123',
  'Author: me',
  '',
  '    my message',
  '',
  'diff --git a/src/one.js b/src/one.js',
  'index 111..222 100644',
  '--- a/src/one.js',
  '+++ b/src/one.js',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  'diff --git a/src/two.js b/src/two.js',
  'index 333..444 100644',
  '--- a/src/two.js',
  '+++ b/src/two.js',
  '@@ -0,0 +1 @@',
  '+added',
].join('\n');

describe('splitDiff', () => {
  it('separates the preamble from one section per file', () => {
    const { preamble, files } = splitDiff(TWO_FILE_PATCH);
    expect(preamble.join('\n')).toMatch(/my message/);
    expect(files).toHaveLength(2);
    expect(files[0].name).toBe('src/one.js');
    expect(files[1].name).toBe('src/two.js');
    expect(files[0].lines.some((l) => l === '+new')).toBe(true);
  });

  it('shows "a → b" for a rename', () => {
    const { files } = splitDiff('diff --git a/old.js b/new.js\n+x');
    expect(files[0].name).toBe('old.js → new.js');
  });

  it('decodes the names git quotes in a diff header', () => {
    const names = [
      'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
      'diff --git "a/say \\"hi\\".txt" "b/say \\"hi\\".txt"',
      'diff --git "a/caf\\303\\251.txt" b/plain.txt',
      'diff --git a/plain.txt "b/tab\\there.txt"',
      'diff --git a/a -> b.txt b/a -> b.txt',
      'diff --git a/x b/y b/x b/y',
    ].map((header) => splitDiff(header + '\n+x').files[0].name);
    expect(names).toEqual([
      'café.txt',
      'say "hi".txt',
      'café.txt → plain.txt',
      'plain.txt → tab\there.txt',
      'a -> b.txt',
      'x b/y',
    ]);
  });

  it('classifies added / deleted / modified files', () => {
    const added = splitDiff('diff --git a/n.js b/n.js\nnew file mode 100644\n+x').files[0];
    const deleted = splitDiff('diff --git a/d.js b/d.js\ndeleted file mode 100644\n-x').files[0];
    const modified = splitDiff('diff --git a/m.js b/m.js\nindex 1..2 100644\n-a\n+b').files[0];
    expect(added.change).toBe('added');
    expect(deleted.change).toBe('deleted');
    expect(modified.change).toBe('modified');
  });
});

describe('DiffPane', () => {
  it('renders a header per file in the patch', () => {
    render(<DiffPane patch={TWO_FILE_PATCH} />);
    expect(screen.getByText('src/one.js')).toBeTruthy();
    expect(screen.getByText('src/two.js')).toBeTruthy();
  });

  it('hides the internal file list when showFileList is false, still showing the diff', () => {
    // A working-tree diff (no commit-message preamble), as in the uncommitted view.
    const filePatch = 'diff --git a/a.txt b/a.txt\nindex 1..2 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new';
    const { container } = render(<DiffPane patch={filePatch} showFileList={false} />);
    expect(container.querySelector('.diff-filelist')).toBeNull();
    expect(container.querySelector('.diff-detail')).toBeTruthy();
    expect(screen.getByText('+new')).toBeTruthy();
  });

  it('shows the placeholder when patch is empty', () => {
    render(<DiffPane patch="" />);
    expect(screen.getByText(/Select a commit or file/)).toBeTruthy();
  });

  it('shows a file\'s diff after clicking it in the list', () => {
    render(<DiffPane patch={TWO_FILE_PATCH} />);
    // default selection is the commit message summary; +new is not shown yet
    expect(screen.queryByText('+new')).toBeNull();
    fireEvent.click(screen.getByText('src/one.js'));
    expect(screen.getByText('+new')).toBeTruthy();
  });
});

describe('DiffPane file-list splitter', () => {
  beforeEach(() => localStorage.clear());

  // Drag the divider by `by` pixels (positive widens the file list).
  const drag = (by) => {
    const splitter = document.querySelector('.diff-split .col-splitter');
    fireEvent.mouseDown(splitter, { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 300 + by });
    fireEvent.mouseUp(window, { clientX: 300 + by });
    return splitter;
  };
  const listWidth = () =>
    parseInt(document.querySelector('.diff-filelist').style.width, 10);

  it('sits between the file list and the code', () => {
    render(<DiffPane patch={TWO_FILE_PATCH} />);
    const splitter = document.querySelector('.diff-split .col-splitter');
    expect(splitter).toBeTruthy();
    expect(splitter.previousElementSibling.className).toContain('diff-filelist');
    // the code, under its layout toggle
    expect(splitter.nextElementSibling.querySelector('.diff-detail')).toBeTruthy();
  });

  it('is absent when there is no file list to resize', () => {
    render(<DiffPane patch={TWO_FILE_PATCH} showFileList={false} />);
    expect(document.querySelector('.col-splitter')).toBeNull();
  });

  it('widens the file list as it is dragged, and remembers the width', () => {
    render(<DiffPane patch={TWO_FILE_PATCH} />);
    const before = listWidth();

    drag(80);

    expect(listWidth()).toBe(before + 80);
    expect(Number(localStorage.getItem('diffListWidth'))).toBe(before + 80);
  });

  it('starts from the remembered width', () => {
    localStorage.setItem('diffListWidth', '345');
    render(<DiffPane patch={TWO_FILE_PATCH} />);
    expect(listWidth()).toBe(345);
  });

  it('will not let either side be dragged shut', () => {
    render(<DiffPane patch={TWO_FILE_PATCH} />);

    drag(-5000);
    expect(listWidth()).toBe(120); // floor

    drag(5000);
    expect(listWidth()).toBe(700); // ceiling
  });
});

const HUNKS_PATCH = [
  'diff --git a/src/app.js b/src/app.js',
  'index 111..222 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -1,3 +1,4 @@ export default function App() {',
  ' one',
  '-two',
  '+two prime',
  '+two and a half',
  ' three',
  '@@ -20,2 +21,2 @@ function tail() {',
  '-old tail',
  '+new tail',
  ' end',
].join('\n');

const NEW_FILE_PATCH = [
  'diff --git a/src/fresh.js b/src/fresh.js',
  'new file mode 100644',
  'index 000..111',
  '--- /dev/null',
  '+++ b/src/fresh.js',
  '@@ -0,0 +1,2 @@',
  '+first',
  '+second',
  '\\ No newline at end of file',
].join('\n');

// A row is [old number][new number][the raw line], so line text stays copyable.
// Rows are matched on exact code text rather than through getByText, which
// trims whitespace and so cannot address a context line's leading space.
const rowOf = (text) => [...document.querySelectorAll('.diff-row')]
  .find((r) => r.querySelector('.code').textContent === text);
const nums = (text) => {
  const row = rowOf(text);
  if (!row) throw new Error(`no diff row for ${JSON.stringify(text)}`);
  return [row.querySelector('.ln-old').textContent, row.querySelector('.ln-new').textContent];
};

describe('DiffPane hunks', () => {
  it('renders one block per hunk, with its range and enclosing function', () => {
    render(<DiffPane patch={HUNKS_PATCH} />);
    const hunks = document.querySelectorAll('.hunk');
    expect(hunks).toHaveLength(2);
    expect([...document.querySelectorAll('.hunk-range')].map((e) => e.textContent))
      .toEqual(['-1,3 +1,4', '-20,2 +21,2']);
    expect([...document.querySelectorAll('.hunk-context')].map((e) => e.textContent))
      .toEqual(['export default function App() {', 'function tail() {']);
  });

  it('numbers both sides, leaving each blank where the line does not exist', () => {
    render(<DiffPane patch={HUNKS_PATCH} />);
    expect(nums(' one')).toEqual(['1', '1']);          // context: both sides
    expect(nums('-two')).toEqual(['2', '']);           // removed: old only
    expect(nums('+two prime')).toEqual(['', '2']);     // added: new only
    expect(nums('+two and a half')).toEqual(['', '3']);
    expect(nums(' three')).toEqual(['3', '4']);
    // Numbering restarts from the second hunk's own ranges.
    expect(nums('-old tail')).toEqual(['20', '']);
    expect(nums('+new tail')).toEqual(['', '21']);
    expect(nums(' end')).toEqual(['21', '22']);
  });

  it('drops the diff --git / index / --- / +++ noise', () => {
    render(<DiffPane patch={HUNKS_PATCH} />);
    const shown = document.querySelector('.diff-detail').textContent;
    expect(shown).not.toMatch(/diff --git/);
    expect(shown).not.toMatch(/index 111/);
    expect(shown).not.toMatch(/\+\+\+ b\//);
    expect(shown).not.toMatch(/--- a\//);
    expect(shown).toMatch(/two prime/); // the content itself is untouched
  });

  it('keeps the header lines that carry information', () => {
    render(<DiffPane patch={NEW_FILE_PATCH} />);
    expect(screen.getByText('new file mode 100644').className).toContain('diff-note');
  });

  it('gives the no-newline marker no line numbers', () => {
    render(<DiffPane patch={NEW_FILE_PATCH} />);
    expect(nums('\\ No newline at end of file')).toEqual(['', '']);
  });

  it('renders every file when the list is hidden, not just the first', () => {
    render(<DiffPane patch={TWO_FILE_PATCH} showFileList={false} />);
    expect([...document.querySelectorAll('.diff-file-name')].map((e) => e.textContent))
      .toEqual(['src/one.js', 'src/two.js']);
    expect(screen.getByText('+new')).toBeTruthy();
    expect(screen.getByText('+added')).toBeTruthy();
  });
});

describe('hunkPatch', () => {
  const hunksOf = (patch) => {
    const file = splitDiff(patch).files[0];
    return { file, hunks: parseFileSection(file.lines).hunks };
  };

  it('rebuilds a patch of the file headers and one hunk only', () => {
    const { file, hunks } = hunksOf(HUNKS_PATCH);

    expect(hunkPatch(file, hunks[1])).toBe([
      'diff --git a/src/app.js b/src/app.js',
      'index 111..222 100644',
      '--- a/src/app.js',
      '+++ b/src/app.js',
      '@@ -20,2 +21,2 @@ function tail() {',
      '-old tail',
      '+new tail',
      ' end',
      '',
    ].join('\n'));
  });

  it('keeps header lines git needs to identify a new file', () => {
    const { file, hunks } = hunksOf(NEW_FILE_PATCH);
    const patch = hunkPatch(file, hunks[0]);
    expect(patch).toMatch(/^new file mode 100644$/m);
    expect(patch).toMatch(/^--- \/dev\/null$/m);
    expect(patch).toMatch(/^\\ No newline at end of file$/m);
  });

  it('drops the blank line left by splitting a newline-terminated patch', () => {
    // A real patch from git ends in a newline, so splitting on \n leaves a
    // trailing empty entry that is no part of the hunk.
    const { file, hunks } = hunksOf(HUNKS_PATCH + '\n');
    expect(hunkPatch(file, hunks[1])).toMatch(/ end\n$/);
  });
});

describe('DiffPane hunk actions', () => {
  const buttons = (name) => screen.queryAllByRole('button', { name });

  it('offers Stage and Discard on an unstaged diff, one pair per hunk', () => {
    render(<DiffPane patch={HUNKS_PATCH} showFileList={false} onHunk={() => {}} />);
    expect(buttons('Stage')).toHaveLength(2);
    expect(buttons('Discard')).toHaveLength(2);
    expect(buttons('Unstage')).toHaveLength(0);
  });

  it('offers only Unstage on a staged diff', () => {
    render(<DiffPane patch={HUNKS_PATCH} showFileList={false} staged onHunk={() => {}} />);
    expect(buttons('Unstage')).toHaveLength(2);
    expect(buttons('Stage')).toHaveLength(0);
    expect(buttons('Discard')).toHaveLength(0);
  });

  it('offers nothing on a commit or stash diff, which has no onHunk', () => {
    render(<DiffPane patch={HUNKS_PATCH} />);
    expect(buttons('Stage')).toHaveLength(0);
    expect(buttons('Discard')).toHaveLength(0);
    expect(buttons('Unstage')).toHaveLength(0);
  });

  it('stages the hunk whose button was clicked, not the whole file', () => {
    const onHunk = vi.fn();
    render(<DiffPane patch={HUNKS_PATCH} showFileList={false} onHunk={onHunk} />);

    fireEvent.click(buttons('Stage')[1]);

    expect(onHunk).toHaveBeenCalledTimes(1);
    const [action, patch] = onHunk.mock.calls[0];
    expect(action).toBe('stage');
    expect(patch).toMatch(/^\+new tail$/m);
    expect(patch).not.toMatch(/two prime/);
    expect(patch).toMatch(/^diff --git a\/src\/app\.js b\/src\/app\.js$/m);
  });

  it('discards the hunk whose button was clicked', () => {
    const onHunk = vi.fn();
    render(<DiffPane patch={HUNKS_PATCH} showFileList={false} onHunk={onHunk} />);

    fireEvent.click(buttons('Discard')[0]);

    expect(onHunk.mock.calls[0][0]).toBe('discard');
    expect(onHunk.mock.calls[0][1]).toMatch(/^\+two prime$/m);
  });

  it('unstages the hunk whose button was clicked', () => {
    const onHunk = vi.fn();
    render(<DiffPane patch={HUNKS_PATCH} showFileList={false} staged onHunk={onHunk} />);

    fireEvent.click(buttons('Unstage')[0]);

    expect(onHunk.mock.calls[0][0]).toBe('unstage');
    expect(onHunk.mock.calls[0][1]).toMatch(/^\+two prime$/m);
  });

  it('offers the actions in the file-list layout too, where the status view shows a diff', () => {
    render(<DiffPane patch={HUNKS_PATCH} onHunk={() => {}} />);
    expect(buttons('Stage')).toHaveLength(2);
  });
});

const SHOW_PATCH = [
  'commit c0ffee0123456789abcdef0123456789abcdef01',
  'Author: Ada Lovelace <ada@example.com>',
  'Date:   Mon Oct 19 12:00:00 2026 +0000',
  '',
  '    Resolve a conflicted file by its literal name',
  '    ',
  '    resolveConflict passed the path as a pathspec.',
  '    It now uses --literal-pathspecs.',
  '',
  'diff --git a/src/one.js b/src/one.js',
  'index 111..222 100644',
  '--- a/src/one.js',
  '+++ b/src/one.js',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

const MERGE_PATCH = [
  'commit 3333333333333333333333333333333333333333',
  'Merge: 1111111 2222222',
  'Author: Grace Hopper <grace@example.com>',
  'Date:   Mon Oct 19 20:00:00 2026 +0000',
  '',
  "    Merge branch 'feature'",
  '',
].join('\n');

describe('parseCommitPreamble', () => {
  it('reads the hash, author, date, subject and body out of git show', () => {
    const { preamble } = splitDiff(SHOW_PATCH);
    expect(parseCommitPreamble(preamble)).toEqual({
      hash: 'c0ffee0123456789abcdef0123456789abcdef01',
      parents: [],
      author: 'Ada Lovelace',
      email: 'ada@example.com',
      date: 'Mon Oct 19 12:00:00 2026 +0000',
      subject: 'Resolve a conflicted file by its literal name',
      body: 'resolveConflict passed the path as a pathspec.\nIt now uses --literal-pathspecs.',
      rest: [],
    });
  });

  it('reads a merge commit\'s parents', () => {
    expect(parseCommitPreamble(MERGE_PATCH.split('\n')).parents).toEqual(['1111111', '2222222']);
  });

  it('is null for text that is not a commit', () => {
    expect(parseCommitPreamble(['just some text'])).toBeNull();
  });
});

describe('DiffPane commit header', () => {
  it('shows the commit as a header rather than raw git show text', () => {
    render(<DiffPane patch={SHOW_PATCH} />);
    expect(screen.getByText('Resolve a conflicted file by its literal name').className).toContain('ch-subject');
    expect(document.querySelector('.ch-body').textContent)
      .toBe('resolveConflict passed the path as a pathspec.\nIt now uses --literal-pathspecs.');
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('<ada@example.com>')).toBeTruthy();
    expect(screen.getByText('c0ffee0123456789abcdef0123456789abcdef01')).toBeTruthy();
    expect(document.querySelector('.diff-detail').textContent).not.toMatch(/Author:/);
  });

  it('still lists the files beside the header', () => {
    render(<DiffPane patch={SHOW_PATCH} />);
    expect(screen.getByText('src/one.js')).toBeTruthy();
    fireEvent.click(screen.getByText('src/one.js'));
    expect(screen.getByText('+new')).toBeTruthy();
  });

  it('copies the full hash', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<DiffPane patch={SHOW_PATCH} />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith('c0ffee0123456789abcdef0123456789abcdef01');
  });

  it('links each parent to that commit', () => {
    const onSelectCommit = vi.fn();
    const commit = { hash: 'c0ffee0123456789abcdef0123456789abcdef01',
      parents: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], refs: [], date: '2026-10-19 12:00' };
    render(<DiffPane patch={SHOW_PATCH} commit={commit} onSelectCommit={onSelectCommit} />);
    fireEvent.click(screen.getByRole('button', { name: 'aaaaaaa' }));
    expect(onSelectCommit).toHaveBeenCalledWith('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('shows the commit\'s refs, by kind', () => {
    const commit = { hash: 'c0ffee0123456789abcdef0123456789abcdef01', parents: [],
      refs: ['HEAD -> main', 'origin/main', 'tag: v1'], color: '#4c8dff' };
    render(<DiffPane patch={SHOW_PATCH} commit={commit} localBranches={['main']} />);
    expect([...document.querySelectorAll('.commit-header .ref-pill')].map((p) => p.textContent))
      .toEqual(['main', 'origin/main', 'v1']);
  });

  it('ignores graph details for a different commit than the patch shows', () => {
    const stale = { hash: 'ffffffffffffffffffffffffffffffffffffffff', parents: ['bbbbbbb'], refs: ['other'] };
    render(<DiffPane patch={SHOW_PATCH} commit={stale} onSelectCommit={() => {}} />);
    expect(screen.queryByText('other')).toBeNull();
    expect(screen.queryByRole('button', { name: 'bbbbbbb' })).toBeNull();
  });

  it('renders the header for a merge with no file changes too', () => {
    const onSelectCommit = vi.fn();
    render(<DiffPane patch={MERGE_PATCH} onSelectCommit={onSelectCommit} />);
    expect(screen.getByText("Merge branch 'feature'").className).toContain('ch-subject');
    fireEvent.click(screen.getByRole('button', { name: '2222222' }));
    expect(onSelectCommit).toHaveBeenCalledWith('2222222');
  });
});

describe('DiffPane word highlighting', () => {
  beforeEach(() => localStorage.clear());

  it('highlights the words that changed within a changed line pair', () => {
    render(<DiffPane patch={HUNKS_PATCH} />);
    const words = (text) => [...rowOf(text).querySelectorAll('.diff-word')].map((w) => w.textContent);
    expect(words('-old tail')).toEqual(['old']);
    expect(words('+new tail')).toEqual(['new']);
    expect(words('+two prime')).toEqual([' prime']);
    expect(words('+two and a half')).toEqual([]); // the extra added line has no partner
  });

  it('leaves lines with nothing in common unmarked', () => {
    render(<DiffPane patch={TWO_FILE_PATCH} showFileList={false} />);
    expect(screen.getByText('+new').querySelector('.diff-word')).toBeNull();
  });
});

describe('DiffPane side by side', () => {
  beforeEach(() => localStorage.clear());
  const sides = () => [...document.querySelectorAll('.split-row')].map((r) =>
    [...r.children].map((c) => c.textContent));

  it('lines removed and added up on facing sides', () => {
    render(<DiffPane patch={HUNKS_PATCH} />);
    fireEvent.click(screen.getByRole('button', { name: 'Side by side' }));
    expect(document.querySelector('.diff-row')).toBeNull();
    expect(sides().slice(0, 4)).toEqual([
      ['1', 'one', '1', 'one'],
      ['2', 'two', '2', 'two prime'],
      ['', '', '3', 'two and a half'],
      ['3', 'three', '4', 'three'],
    ]);
    const changed = document.querySelectorAll('.split-row')[1];
    expect(changed.querySelector('.split-old').className).toContain('diff-del');
    expect(changed.querySelector('.split-new').className).toContain('diff-add');
    expect(changed.querySelector('.split-new .diff-word').textContent).toBe(' prime');
  });

  it('lines up a removed line with the added line it matches, not the one in its place', () => {
    const patch = [
      'diff --git a/e.js b/e.js', '--- a/e.js', '+++ b/e.js', '@@ -1,3 +1,4 @@',
      ' function f() {',
      '-  return { total };',
      '+  const avg = total / n;',
      '+  return { total, avg };',
      ' }',
    ].join('\n');
    localStorage.setItem('diffLayout', 'split');
    render(<DiffPane patch={patch} showFileList={false} />);
    expect(sides()).toEqual([
      ['1', 'function f() {', '1', 'function f() {'],
      ['', '', '2', '  const avg = total / n;'],
      ['2', '  return { total };', '3', '  return { total, avg };'],
      ['3', '}', '4', '}'],
    ]);
  });

  it('remembers the layout', () => {
    render(<DiffPane patch={HUNKS_PATCH} />);
    fireEvent.click(screen.getByRole('button', { name: 'Side by side' }));
    expect(localStorage.getItem('diffLayout')).toBe('split');
    expect(screen.getByRole('button', { name: 'Side by side' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('starts from the remembered layout, and switches back', () => {
    localStorage.setItem('diffLayout', 'split');
    render(<DiffPane patch={HUNKS_PATCH} />);
    expect(document.querySelector('.split-row')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unified' }));
    expect(document.querySelector('.split-row')).toBeNull();
    expect(nums('-two')).toEqual(['2', '']);
  });

  it('keeps the hunk actions', () => {
    localStorage.setItem('diffLayout', 'split');
    const onHunk = vi.fn();
    render(<DiffPane patch={HUNKS_PATCH} showFileList={false} onHunk={onHunk} />);
    fireEvent.click(screen.getAllByText('Stage')[1]);
    expect(onHunk.mock.calls[0][1]).toMatch(/@@ -20,2 \+21,2 @@/);
  });
});
