import { runGit } from './runner.js';

// Fields before the path in each `--porcelain=v2` record type: "1" ordinary,
// "2" rename/copy, "u" unmerged. The path is everything after them, so a
// name with spaces stays whole.
const FIELDS = { 1: 8, 2: 9, u: 10 };

// Split off the first `n` space-separated fields; the remainder is the path.
function pathAfter(record, n) {
  let at = 0;
  for (let i = 0; i < n; i++) at = record.indexOf(' ', at) + 1;
  return record.slice(at);
}

// Working-tree status as four lists. Paths are exactly as on disk: `-z`
// turns off git's C-quoting ("caf\303\251.txt") and gives a rename its
// original path as a separate field, instead of an "old -> new" string that
// cannot be told apart from a file whose name contains " -> ".
//
// A staged rename or copy carries `origPath`. An unmerged path is neither
// staged nor unstaged: it is listed in `conflicted` with its XY pair (UU,
// DU, AA, ...), the only description of how the two sides disagree.
export async function getStatus(cwd) {
  const { stdout } = await runGit(['status', '--porcelain=v2', '-z'], cwd);
  const staged = [], unstaged = [], untracked = [], conflicted = [];
  const records = stdout.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const type = record[0];
    if (type === '?') { untracked.push(record.slice(2)); continue; }
    if (!(type in FIELDS)) continue; // "!" ignored entries, or the trailing empty field
    const x = record[2], y = record[3];
    const path = pathAfter(record, FIELDS[type]);
    if (type === 'u') { conflicted.push({ path, status: x + y }); continue; }
    // A rename/copy record is followed by its original path as its own field.
    const origPath = type === '2' ? records[++i] : undefined;
    const entry = (code) => (code === 'R' || code === 'C')
      ? { path, origPath, status: code }
      : { path, status: code };
    if (x !== '.') staged.push(entry(x));
    if (y !== '.') unstaged.push(entry(y));
  }
  return { staged, unstaged, untracked, conflicted };
}
