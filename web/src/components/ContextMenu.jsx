import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function ContextMenu({ x, y, items, onClose }) {
  useEffect(() => {
    const close = () => onClose();
    // Defer attaching the close listeners by a tick so the very right-click
    // that opened the menu can't immediately close it.
    const id = setTimeout(() => {
      window.addEventListener('click', close);
      window.addEventListener('contextmenu', close);
      window.addEventListener('scroll', close, true);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [onClose]);

  // Portal to body so no scrollable/overflow ancestor can clip or hide it.
  return createPortal(
    <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      {items.map((it, i) => (
        <div
          key={i}
          className={`ctx-item${it.danger ? ' danger' : ''}`}
          onClick={() => { onClose(); it.onClick(); }}
        >
          {it.label}
        </div>
      ))}
    </div>,
    document.body
  );
}
