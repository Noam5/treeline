// Small formatting helpers for the history view: how long ago a commit was
// made, an author's initials, and what kind of ref each decoration names.

// The log sends local dates as "YYYY-MM-DD HH:MM".
const LOG_DATE = /^(\d{4})-(\d\d)-(\d\d)(?: (\d\d):(\d\d))?$/;

// `date` as "2 h ago", with the date itself kept for the tooltip. Dates the
// log did not write pass through unchanged. `now` is for tests.
export function relativeDate(date, now = new Date()) {
  const m = LOG_DATE.exec(date || '');
  if (!m) return { text: date || '', title: date || '' };
  const when = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  // A clock that ran ahead of this one reads as just now, not as the future.
  const minutes = Math.max(0, Math.floor((now - when) / 60000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  let text;
  if (minutes < 2) text = 'just now'; // the log only has minutes, so 1 min is noise
  else if (minutes < 60) text = `${minutes} min ago`;
  else if (hours < 24) text = `${hours} h ago`;
  else if (days < 2) text = 'yesterday';
  else if (days < 7) text = `${days} days ago`;
  else if (days < 35) text = `${Math.floor(days / 7)} wk ago`;
  else if (days < 365) text = `${Math.floor(days / 30)} mo ago`;
  else text = `${Math.floor(days / 365)} yr ago`;
  return { text, title: date };
}

// "Ada Lovelace" → "AL", "Ada" → "A".
export function initials(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = [...words[0]][0];
  const last = words.length > 1 ? [...words[words.length - 1]][0] : '';
  return (first + last).toUpperCase();
}

// Split a commit's decorations into typed refs:
//   head     — the checked-out branch ("HEAD -> main"), shown once
//   detached — a detached HEAD
//   local / remote — a branch; local when it is one of `localBranches`
//   tag
// With no branch list to check against, every branch counts as local.
export function parseRefs(refs, localBranches = []) {
  const out = [];
  const checkedOut = new Set();
  for (const ref of refs || []) {
    const head = /^HEAD -> (.+)$/.exec(ref);
    if (head) checkedOut.add(head[1]);
  }
  for (const ref of refs || []) {
    const head = /^HEAD -> (.+)$/.exec(ref);
    if (head) out.push({ kind: 'head', name: head[1] });
    else if (ref === 'HEAD') out.push({ kind: 'detached', name: 'HEAD' });
    else if (ref.startsWith('tag: ')) out.push({ kind: 'tag', name: ref.slice(5) });
    else if (checkedOut.has(ref)) continue;
    else if (!localBranches.length || localBranches.includes(ref)) out.push({ kind: 'local', name: ref });
    else out.push({ kind: 'remote', name: ref });
  }
  return out;
}

// A stable color per author, so the same person reads the same everywhere.
const AVATAR_COLORS = ['#4c8dff', '#2da44e', '#d4762c', '#a463d8', '#1f9fb0', '#d0454f', '#7a7f2a', '#c2459b'];
export function avatarColor(key) {
  let h = 0;
  for (const ch of key || '') h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
