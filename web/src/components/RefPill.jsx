// A branch, tag or HEAD label on a commit.

// What each kind of ref pill says on hover, and the icon that marks it — so
// the kinds differ in shape, not by color alone.
const REF_TITLE = {
  head: (n) => `HEAD → ${n} (checked out)`,
  detached: () => 'Detached HEAD',
  local: (n) => `Local branch ${n}`,
  remote: (n) => `Remote branch ${n}`,
  tag: (n) => `Tag ${n}`,
};
const REF_ICON = {
  head: <><circle cx="8" cy="8" r="5.5" fill="none" /><circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" /></>,
  local: <><circle cx="4.5" cy="3.5" r="1.8" /><circle cx="4.5" cy="12.5" r="1.8" /><circle cx="11.5" cy="5" r="1.8" />
    <path d="M4.5 5.3v5.4M11.5 6.8c0 2.8-7 2-7 3.9" /></>,
  remote: <path d="M4.6 12.5h6.8a2.9 2.9 0 0 0 .3-5.8 3.9 3.9 0 0 0-7.5.9 2.5 2.5 0 0 0 .4 4.9z" />,
  tag: <><path d="M2 2.5h5.5l6.5 6.5-5 5-6.5-6.5z" /><circle cx="5" cy="5.5" r="1" fill="currentColor" stroke="none" /></>,
};
REF_ICON.detached = REF_ICON.head;

export default function RefPill({ kind, name, color }) {
  return (
    <span className={`ref-pill ref-${kind}`} style={{ '--ref': color }} title={REF_TITLE[kind](name)}>
      <svg className="ref-icon" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {REF_ICON[kind]}
      </svg>
      {name}
    </span>
  );
}
