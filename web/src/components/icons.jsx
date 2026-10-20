// The toolbar's icon set: line icons on one 24-unit grid, drawn in
// currentColor so they follow the theme and a button's own color (Discard's
// red, a disabled button's fade). Inline, so no font or package is needed.
const PATHS = {
  commit: <><circle cx="12" cy="12" r="3.5" /><path d="M3 12h5.5M15.5 12H21" /></>,
  pull: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 20h14" /></>,
  push: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 20h14" /></>,
  fetch: <>
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 3v5h5" />
    <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 21v-5h-5" />
  </>,
  branch: <>
    <circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="7" r="2.2" />
    <path d="M6 7.2v9.6" /><path d="M18 9.2v.8a4 4 0 0 1-4 4H9a3 3 0 0 0-3 3" />
  </>,
  merge: <>
    <circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="15" r="2.2" />
    <path d="M6 7.2v9.6" /><path d="M6 8a7 7 0 0 0 7 7h2.8" />
  </>,
  stash: <>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" /><path d="M10 13h4" />
  </>,
  discard: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  tag: <><path d="M3 3h8.5l9.5 9.5-8.5 8.5L3 11.5z" /><circle cx="7.5" cy="7.5" r="1.3" /></>,
  sun: <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  warning: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
};

export default function Icon({ name, size = 18 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
