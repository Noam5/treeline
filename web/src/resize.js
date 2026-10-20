// Splitter drags. Both helpers report every intermediate size through `onSize`
// so the pane follows the cursor, then call `onCommit` once with the final size
// — which is where callers persist it, rather than writing on every mouse move.
//
// The bounds are fixed pixel values, not measured from the parent: CSS
// max-width/max-height keeps a pane sane when the window itself is small, and
// keeping the arithmetic here free of layout measurement makes it testable.
function drag(e, { from, min, max, onSize, onCommit, delta }) {
  e.preventDefault();
  const start = e.clientX + e.clientY; // only one axis moves; see `delta`
  let latest = from;
  const onMove = (ev) => {
    latest = Math.min(Math.max(from + delta(ev, e), min), max);
    onSize(latest);
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    onCommit(latest);
  };
  void start;
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// Vertical splitter above a bottom pane: dragging up makes that pane taller.
export function startHeightDrag(e, { from, min = 80, max = window.innerHeight - 160, onSize, onCommit }) {
  document.body.style.cursor = 'row-resize';
  drag(e, { from, min, max, onSize, onCommit, delta: (ev, down) => down.clientY - ev.clientY });
}

// Horizontal splitter to the right of a left pane: dragging right widens it.
export function startWidthDrag(e, { from, min, max, onSize, onCommit }) {
  document.body.style.cursor = 'col-resize';
  drag(e, { from, min, max, onSize, onCommit, delta: (ev, down) => ev.clientX - down.clientX });
}
