import { useState, useEffect } from 'react';
import { startWidthDrag } from '../resize.js';
import RefPill from './RefPill.jsx';
import { relativeDate, initials, parseRefs, avatarColor } from '../format.js';
import { markChangedWords } from '../wordDiff.js';

// Width of the file list beside a diff. Kept here, and in localStorage, the
// same way CommitGraph keeps its column widths — shared by every tab, with no
// need to thread it through the workspace.
const LIST_MIN = 120;
const LIST_MAX = 700;
const storedListWidth = () => Number(localStorage.getItem('diffListWidth')) || 230;
// Unified or side-by-side ('split'), remembered the same way.
const storedLayout = () => {
  try { return localStorage.getItem('diffLayout') === 'split' ? 'split' : 'unified'; }
  catch { return 'unified'; }
};

function lineClass(line) {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'diff-add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'diff-del';
  if (line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ')) return 'diff-meta';
  return '';
}

const C_ESCAPES = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '"': 34, '\\': 92 };

// Read the C-quoted name git writes for a path with special or non-ASCII
// characters ("caf\303\251.txt"), starting at the opening quote. Octal
// escapes are UTF-8 bytes, so the name is rebuilt as bytes and decoded once.
// Returns the name and the index just past the closing quote.
function unquote(s, at) {
  const bytes = [];
  const encoder = new TextEncoder();
  let i = at + 1;
  while (i < s.length && s[i] !== '"') {
    if (s[i] !== '\\') {
      const cp = s.codePointAt(i);
      const ch = String.fromCodePoint(cp);
      bytes.push(...encoder.encode(ch));
      i += ch.length;
    } else if (/[0-7]{3}/.test(s.slice(i + 1, i + 4))) {
      bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
      i += 4;
    } else {
      bytes.push(C_ESCAPES[s[i + 1]] ?? s.charCodeAt(i + 1));
      i += 2;
    }
  }
  return { name: new TextDecoder().decode(new Uint8Array(bytes)), end: i + 1 };
}

// Split the two paths out of a "diff --git a/X b/Y" line. Either one may be
// C-quoted; an unquoted pair is split at " b/", preferring the split that
// gives two equal names when there is more than one " b/" to choose from.
function headerPaths(rest) {
  let a, tail;
  if (rest.startsWith('"')) {
    const q = unquote(rest, 0);
    a = q.name;
    tail = rest.slice(q.end + 1);
  } else if (rest.endsWith('"')) {
    const open = rest.lastIndexOf(' "');
    if (open < 0) return null;
    a = rest.slice(0, open);
    tail = rest.slice(open + 1);
  } else {
    const m = /^a\/(.+) b\/(.+)$/.exec(rest);
    if (!m) return null;
    const half = (rest.length - 1) / 2;
    if (rest[half] === ' ' && rest.slice(2, half) === rest.slice(half + 3)) {
      const same = rest.slice(2, half);
      return [same, same];
    }
    return [m[1], m[2]];
  }
  const b = tail.startsWith('"') ? unquote(tail, 0).name : tail;
  if (!a.startsWith('a/') || !b.startsWith('b/')) return null;
  return [a.slice(2), b.slice(2)];
}

function fileName(diffLine) {
  const rest = diffLine.replace(/^diff --git /, '');
  const paths = headerPaths(rest);
  if (!paths) return rest;
  return paths[0] === paths[1] ? paths[0] : `${paths[0]} → ${paths[1]}`;
}

// Classify a file section by its diff header lines.
function changeOf(lines) {
  for (const l of lines) {
    if (l.startsWith('new file mode')) return 'added';
    if (l.startsWith('deleted file mode')) return 'deleted';
    if (l.startsWith('rename ')) return 'renamed';
  }
  return 'modified';
}

const CHANGE_ICON = { added: '✚', modified: '✎', deleted: '✕', renamed: '⇄' };

// Split a unified patch (or `git show` output) into the leading commit/preamble
// text and one section per file (each starting at a `diff --git` line).
export function splitDiff(patch) {
  const preamble = [];
  const files = [];
  let current = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { name: fileName(line), lines: [line] };
      files.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  for (const f of files) f.change = changeOf(f.lines);
  return { preamble, files };
}

// Read the commit `git show` prints ahead of its diff: the header fields up to
// the first blank line, then the message, indented four spaces. Whatever
// follows (a merge's combined diff) is left in `rest`. Null when the text is
// not a commit, such as a stash's patch.
export function parseCommitPreamble(lines) {
  const head = /^commit ([0-9a-f]{4,})/.exec(lines[0] || '');
  if (!head) return null;
  const info = { hash: head[1], parents: [], author: '', email: '', date: '' };
  let i = 1;
  for (; i < lines.length && lines[i] !== ''; i++) {
    const [, key, value] = /^(\w+):\s*(.*)$/.exec(lines[i]) || [];
    if (key === 'Merge') info.parents = value.split(/\s+/).filter(Boolean);
    else if (key === 'Author') {
      const m = /^(.*?)\s*<([^>]*)>$/.exec(value);
      info.author = m ? m[1] : value;
      info.email = m ? m[2] : '';
    } else if (key === 'Date') info.date = value;
  }
  const message = [];
  for (i += 1; i < lines.length && (lines[i] === '' || lines[i].startsWith('    ')); i++) {
    message.push(lines[i].slice(4));
  }
  const trim = (ls) => {
    let a = 0, b = ls.length;
    while (a < b && !ls[a].trim()) a++;
    while (b > a && !ls[b - 1].trim()) b--;
    return ls.slice(a, b);
  };
  const text = trim(message);
  return {
    ...info,
    subject: text[0] || '',
    body: trim(text.slice(1)).join('\n'),
    rest: trim(lines.slice(i)),
  };
}

const shortHash = (h) => h.slice(0, 7);

// The selected commit as a readable header. `commit` is the graph's record of
// the same commit, which adds full parent hashes and refs; it is ignored when
// it describes some other commit (the patch may still be loading).
function CommitHeader({ info, commit, onSelectCommit, localBranches }) {
  const [copied, setCopied] = useState(false);
  const known = commit && commit.hash === info.hash ? commit : null;
  const parents = known ? known.parents || [] : info.parents;
  const refs = known ? parseRefs(known.refs, localBranches) : [];
  const ago = known ? relativeDate(known.date).text : '';
  const copy = () => {
    navigator.clipboard?.writeText(info.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="commit-header">
      <div className="ch-subject">{info.subject}</div>
      {info.body && <div className="ch-body">{info.body}</div>}
      <div className="ch-meta">
        <span className="ch-key">Author</span>
        <span className="ch-author">
          <span className="avatar" style={{ background: avatarColor(info.email || info.author) }}>
            {initials(info.author)}
          </span>
          <span>{info.author}</span>
          {info.email && <span className="ch-email">{`<${info.email}>`}</span>}
        </span>
        {info.date && <>
          <span className="ch-key">Date</span>
          <span>{info.date}{ago && <span className="ch-ago"> · {ago}</span>}</span>
        </>}
        <span className="ch-key">Commit</span>
        <span className="ch-hash">
          <code>{info.hash}</code>
          <button className="ch-copy" onClick={copy} aria-label="Copy hash" title="Copy the full hash">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </span>
        {parents.length > 0 && <>
          <span className="ch-key">{parents.length > 1 ? 'Parents' : 'Parent'}</span>
          <span className="ch-parents">
            {parents.map((p) => (onSelectCommit
              ? <button key={p} className="ch-parent" title={`Show ${p}`}
                  onClick={() => onSelectCommit(p)}>{shortHash(p)}</button>
              : <code key={p}>{shortHash(p)}</code>))}
          </span>
        </>}
        {refs.length > 0 && <>
          <span className="ch-key">Refs</span>
          <span className="ch-refs">
            {refs.map((r) => (
              <RefPill key={`${r.kind}:${r.name}`} kind={r.kind} name={r.name}
                color={known.color || 'var(--accent)'} />
            ))}
          </span>
        </>}
      </div>
    </div>
  );
}

function Lines({ lines }) {
  return lines.map((line, i) => (
    <div key={i} className={lineClass(line)}>{line || ' '}</div>
  ));
}

// Header lines that say nothing the file header does not already say. Mode
// changes, renames and binary markers are kept — see parseFileSection.
const NOISE = /^(diff --git |index |--- |\+\+\+ )/;
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

// Split one file's section into the header lines worth showing and its hunks.
// Each hunk knows where it starts on both sides, which is what lets the two
// gutters be numbered without re-reading the file.
export function parseFileSection(lines) {
  const notes = [];
  const hunks = [];
  let current = null;
  for (const line of lines) {
    const m = HUNK.exec(line);
    if (m) {
      current = {
        header: line,
        range: line.slice(3, line.indexOf(' @@', 3)),
        context: m[3].trim(),
        oldNo: Number(m[1]),
        newNo: Number(m[2]),
        lines: [],
      };
      hunks.push(current);
    } else if (current) {
      current.lines.push(line);
    } else if (!NOISE.test(line) && line.trim()) {
      notes.push(line);
    }
  }
  return { notes, hunks };
}

// A patch containing one hunk and nothing else: the file's own header lines
// (which tell git what to patch, and whether it is new or a rename) followed
// by that single hunk. Splitting a newline-terminated patch leaves a trailing
// empty element behind; git apply happens to tolerate it, but it is dropped so
// the patch is a faithful copy of what git would emit for that hunk alone.
export function hunkPatch(file, hunk) {
  const head = [];
  for (const line of file.lines) {
    if (line.startsWith('@@')) break;
    head.push(line);
  }
  const body = [...hunk.lines];
  while (body.length && body[body.length - 1] === '') body.pop();
  return [...head, hunk.header, ...body].join('\n') + '\n';
}

// Old/new line numbers for one hunk: context advances both sides, - only the
// old, + only the new, and the no-newline marker belongs to neither.
function numberHunk(hunk) {
  let oldNo = hunk.oldNo;
  let newNo = hunk.newNo;
  return hunk.lines.map((line) => {
    if (line.startsWith('\\')) return { line, old: '', now: '' };
    if (line.startsWith('-')) return { line, old: oldNo++, now: '' };
    if (line.startsWith('+')) return { line, old: '', now: newNo++ };
    return { line, old: oldNo++, now: newNo++ };
  });
}

// What a hunk can be done with, per side of the index. A commit or stash diff
// passes no handler and so gets no buttons at all.
const STAGED_ACTIONS = [['unstage', 'Unstage']];
const UNSTAGED_ACTIONS = [['stage', 'Stage'], ['discard', 'Discard']];

const Words = ({ segs }) => segs.map((s, i) => (
  s.changed ? <span key={i} className="diff-word">{s.text}</span> : s.text
));

// Pair a hunk's numbered rows into [left, right] for the side-by-side layout:
// context faces itself, and in each run of removed lines followed by added
// lines, matched lines (`pairs`, by row index) face each other; the unmatched
// lines between two matches face each other in order, padded with blanks
// where one side has fewer.
function splitRows(rows, pairs) {
  const out = [];
  const zip = (dels, adds) => {
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push([dels[k], adds[k]]);
  };
  for (let i = 0; i < rows.length;) {
    const { line } = rows[i];
    if (!line.startsWith('-') && !line.startsWith('+')) {
      out.push([rows[i], rows[i]]);
      i++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < rows.length && rows[i].line.startsWith('-')) dels.push(rows[i++]);
    while (i < rows.length && rows[i].line.startsWith('+')) adds.push(rows[i++]);
    let d = 0;
    let a = 0;
    for (let k = 0; k < dels.length; k++) {
      if (!pairs.has(dels[k].i)) continue;
      const to = adds.findIndex((row) => row.i === pairs.get(dels[k].i));
      zip(dels.slice(d, k), adds.slice(a, to));
      out.push([dels[k], adds[to]]);
      d = k + 1;
      a = to + 1;
    }
    zip(dels.slice(d), adds.slice(a));
  }
  return out;
}

function SplitSide({ row, side, words }) {
  if (!row) {
    return <><span className={`ln ln-${side}`} /><span className={`code split-${side} split-empty`} /></>;
  }
  const marker = row.line.startsWith('\\');
  return <>
    <span className={`ln ln-${side}`}>{side === 'old' ? row.old : row.now}</span>
    <span className={`code split-${side} ${lineClass(row.line)}`}>
      {marker ? row.line : (words[row.i] ? <Words segs={words[row.i]} /> : row.line.slice(1))}
    </span>
  </>;
}

function Hunk({ hunk, actions, onAct, layout }) {
  const rows = numberHunk(hunk).map((row, i) => ({ ...row, i }));
  const { words, pairs } = markChangedWords(hunk.lines);
  return (
    <div className="hunk">
      <div className="hunk-header">
        <span className="hunk-range">{hunk.range}</span>
        <span className="hunk-context">{hunk.context}</span>
        {actions && (
          <span className="hunk-actions">
            {actions.map(([action, label]) => (
              <button key={action} className={`hunk-btn${action === 'discard' ? ' danger' : ''}`}
                onClick={() => onAct(action)}>{label}</button>
            ))}
          </span>
        )}
      </div>
      {layout === 'split'
        ? splitRows(rows, pairs).map(([left, right], k) => (
            <div key={k} className="split-row">
              <SplitSide row={left} side="old" words={words} />
              <SplitSide row={right} side="new" words={words} />
            </div>
          ))
        : rows.map((row) => (
            <div key={row.i} className={`diff-row ${lineClass(row.line)}`}>
              <span className="ln ln-old">{row.old}</span>
              <span className="ln ln-new">{row.now}</span>
              <span className="code">
                {words[row.i] ? <>{row.line[0]}<Words segs={words[row.i]} /></> : (row.line || ' ')}
              </span>
            </div>
          ))}
    </div>
  );
}

function LayoutToggle({ layout, onLayout }) {
  return (
    <div className="diff-toolbar">
      <span className="seg">
        {[['unified', 'Unified'], ['split', 'Side by side']].map(([value, label]) => (
          <button key={value} className={layout === value ? 'on' : ''} aria-pressed={layout === value}
            onClick={() => onLayout(value)}>{label}</button>
        ))}
      </span>
    </div>
  );
}

// One file's diff: its notes, then a block per hunk. `name` is shown only when
// the pane has no file list of its own to name it.
function FileDiff({ file, name, staged, onHunk, layout }) {
  const { notes, hunks } = parseFileSection(file.lines);
  const actions = onHunk ? (staged ? STAGED_ACTIONS : UNSTAGED_ACTIONS) : null;
  return (
    <div className="diff-file">
      {name && <div className="diff-file-name" title={name}>{name}</div>}
      {notes.map((n, i) => <div key={i} className="diff-note">{n}</div>)}
      {hunks.map((h, i) => (
        <Hunk key={i} hunk={h} actions={actions} layout={layout}
          onAct={(action) => onHunk(action, hunkPatch(file, h))} />
      ))}
    </div>
  );
}

// `onHunk(action, patch)` turns on the per-hunk buttons; it is given the
// action and a patch holding that hunk alone. `staged` picks which side of the
// index this diff is, and so which actions make sense.
//
// For a commit, `commit` is the graph's record of it (parents, refs, color),
// `onSelectCommit(hash)` makes its parents links, and `localBranches` tells
// its local branches from remote ones.
export default function DiffPane({ patch, showFileList = true, staged = false, onHunk = null,
  commit = null, onSelectCommit = null, localBranches = [] }) {
  const { preamble, files } = patch ? splitDiff(patch) : { preamble: [], files: [] };
  const hasSummary = preamble.join('\n').trim().length > 0;
  const info = parseCommitPreamble(preamble);
  const summary = info
    ? <>
        <CommitHeader info={info} commit={commit} onSelectCommit={onSelectCommit}
          localBranches={localBranches} />
        <Lines lines={info.rest} />
      </>
    : <Lines lines={preamble} />;

  // Selected entry: 'summary' for the commit message, or a file index.
  const [sel, setSel] = useState(0);
  const [listWidth, setListWidth] = useState(storedListWidth);
  const [layout, setLayoutState] = useState(storedLayout);
  const setLayout = (next) => {
    setLayoutState(next);
    try { localStorage.setItem('diffLayout', next); } catch { /* not persisted */ }
  };
  const toggle = <LayoutToggle layout={layout} onLayout={setLayout} />;
  // Reset selection whenever a new patch is shown.
  useEffect(() => { setSel(hasSummary ? 'summary' : 0); }, [patch]);

  if (!patch) {
    return (
      <div className="diff-pane">
        <span className="diff-meta">Select a commit or file to see its diff.</span>
      </div>
    );
  }

  // No `diff --git` sections (e.g. an empty patch): render flat.
  if (files.length === 0) {
    return <div className="diff-pane"><div className="diff-detail">{summary}</div></div>;
  }

  const showSummary = sel === 'summary' && hasSummary;
  const fileIndex = sel === 'summary' ? 0 : Math.min(sel, files.length - 1);

  // When the file list is suppressed (e.g. the uncommitted view, where the
  // staged/unstaged panes already list files), show every file in the patch,
  // each under its own name — there is no list here to select one with.
  if (!showFileList) {
    return (
      <div className="diff-pane">
        {toggle}
        <div className="diff-detail">
          {files.map((f, i) => (
            <FileDiff key={i} file={f} name={f.name} staged={staged} onHunk={onHunk} layout={layout} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="diff-pane diff-split">
      <div className="diff-filelist" style={{ flex: `0 0 ${listWidth}px`, width: listWidth }}>
        {hasSummary && (
          <div
            className={`diff-fileitem${showSummary ? ' sel' : ''}`}
            onClick={() => setSel('summary')}
          >
            ✉ Commit details
          </div>
        )}
        {files.map((f, i) => (
          <div
            key={i}
            className={`diff-fileitem${!showSummary && i === fileIndex ? ' sel' : ''}`}
            title={`${f.change}: ${f.name}`}
            onClick={() => setSel(i)}
          >
            <span className={`fi-icon fi-${f.change}`}>{CHANGE_ICON[f.change]}</span>
            {f.name}
          </div>
        ))}
      </div>
      <div className="col-splitter" title="Drag to resize"
        onMouseDown={(e) => startWidthDrag(e, {
          from: listWidth, min: LIST_MIN, max: LIST_MAX,
          onSize: setListWidth,
          onCommit: (w) => localStorage.setItem('diffListWidth', String(w)),
        })} />
      <div className="diff-main">
        {!showSummary && toggle}
        <div className="diff-detail">
          {showSummary
            ? summary
            : <FileDiff file={files[fileIndex]} staged={staged} onHunk={onHunk} layout={layout} />}
        </div>
      </div>
    </div>
  );
}
