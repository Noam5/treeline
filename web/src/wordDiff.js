// Word-level differences between a removed line and the added line that
// replaced it, so a diff can mark just the words that changed.

// Words, runs of whitespace, and single punctuation characters.
const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
// Past this many token pairs the table gets slow; such lines go unmarked.
const MAX_CELLS = 250000;
// Lines sharing less than this share of their text are simply different
// lines, and marking nearly every word of both would only add noise.
const MIN_SIMILARITY = 0.4;

// Merge neighbouring tokens that are both changed or both not. Whitespace
// alone between two changes counts as changed, so "a, b" reads as one change
// rather than two with a gap that happened to line up.
function segments(tokens, changed) {
  changed = changed.map((c, i) => c || (!tokens[i].trim() && changed[i - 1] && changed[i + 1]) || false);
  const out = [];
  tokens.forEach((text, i) => {
    const last = out[out.length - 1];
    if (last && last.changed === changed[i]) last.text += text;
    else out.push({ text, changed: changed[i] });
  });
  return out;
}

// { old, new, similarity }: each line as segments of { text, changed }, and
// the share of text the two have in common — or null when the lines are too
// different (or too long) to be worth marking.
export function wordDiff(a, b) {
  const x = a.match(TOKEN) || [];
  const y = b.match(TOKEN) || [];
  if (x.length * y.length > MAX_CELLS) return null;

  // Longest common subsequence of tokens, filled from the ends.
  const w = y.length + 1;
  const lcs = new Uint32Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i * w + j] = x[i] === y[j]
        ? lcs[(i + 1) * w + j + 1] + 1
        : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const oldChanged = x.map(() => true);
  const newChanged = y.map(() => true);
  let same = 0;
  for (let i = 0, j = 0; i < x.length && j < y.length;) {
    if (x[i] === y[j]) {
      oldChanged[i] = newChanged[j] = false;
      if (x[i].trim()) same += x[i].length;
      i++; j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) i++;
    else j++;
  }

  const visible = (s) => s.replace(/\s+/g, '').length;
  const total = visible(a) + visible(b);
  if (!total || (2 * same) / total < MIN_SIMILARITY) return null;
  return { old: segments(x, oldChanged), new: segments(y, newChanged), similarity: (2 * same) / total };
}

// Past this many candidate pairs in one block, lines pair up by position.
const MAX_CANDIDATES = 400;

// `words`: for each of a hunk's lines, its text past the +/-/space marker as
// segments with the changed words marked, or null where there is nothing to
// mark. `pairs`: removed line index → the added line index it was matched to.
// Each run of removed lines is matched against the run of added lines right
// after it: in order, each removed line takes the most similar added line
// below the previous match, so an inserted line does not throw off the rest.
export function markChangedWords(lines) {
  const words = lines.map(() => null);
  const pairs = new Map();
  for (let i = 0; i < lines.length;) {
    if (!lines[i].startsWith('-')) { i++; continue; }
    const dels = [];
    const adds = [];
    while (i < lines.length && lines[i].startsWith('-')) dels.push(i++);
    while (i < lines.length && lines[i].startsWith('+')) adds.push(i++);
    const byPosition = dels.length * adds.length > MAX_CANDIDATES;
    let next = 0; // first added line still free to match
    for (let k = 0; k < dels.length && next < adds.length; k++) {
      const text = lines[dels[k]].slice(1);
      let best = null;
      let bestAt = -1;
      const last = byPosition ? Math.min(next + 1, adds.length) : adds.length;
      for (let j = next; j < last; j++) {
        const d = wordDiff(text, lines[adds[j]].slice(1));
        if (d && (!best || d.similarity > best.similarity)) { best = d; bestAt = j; }
      }
      if (byPosition) next++;
      if (!best) continue;
      words[dels[k]] = best.old;
      words[adds[bestAt]] = best.new;
      pairs.set(dels[k], adds[bestAt]);
      next = bestAt + 1;
    }
  }
  return { words, pairs };
}
