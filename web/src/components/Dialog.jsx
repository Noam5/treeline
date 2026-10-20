import { useState, useEffect, useRef, useId } from 'react';

// The app's own prompt and confirm. Electron implements no prompt() (it
// throws), so every question asked mid-action comes through here: a name
// to give something (`input`), or whether to go ahead with something that
// cannot be undone (`danger`).
//
// onDone gets the trimmed name, or true for a confirmation, when the user goes
// ahead, and null when they back out: Esc, Cancel or a click outside. A
// destructive action is never the focused button, so a stray Enter cancels.
export default function Dialog({
  title, message, input = false, initial = '', validate, confirmLabel = 'OK', danger = false, onDone,
}) {
  const [value, setValue] = useState(initial);
  // Whether to show what is wrong with the name: not before the user has
  // typed or tried to confirm, so an empty field does not open with a scold.
  const [touched, setTouched] = useState(false);
  const formRef = useRef(null);
  const fieldRef = useRef(null);
  const cancelRef = useRef(null);
  const titleId = useId();
  const messageId = useId();
  const errorId = useId();

  // Focus the name (selected, so typing replaces it) or Cancel; hand focus back
  // to wherever it was once the dialog closes.
  useEffect(() => {
    const before = document.activeElement;
    if (input) { fieldRef.current.focus(); fieldRef.current.select(); }
    else cancelRef.current.focus();
    return () => { if (before?.isConnected) before.focus(); };
  }, [input]);

  const error = input && validate ? validate(value) : '';
  const showError = touched && !!error;

  const submit = (e) => {
    e.preventDefault();
    if (!input) { onDone(true); return; }
    if (error) { setTouched(true); return; }
    onDone(value.trim());
  };

  // Esc backs out; Tab stays inside the dialog, as it would in a native one.
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onDone(null); return; }
    if (e.key !== 'Tab') return;
    const stops = [...formRef.current.querySelectorAll('input, button:not(:disabled)')];
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onDone(null); }}>
      <form ref={formRef} className="modal dialog" role="dialog" aria-modal="true"
        aria-labelledby={titleId} aria-describedby={message ? messageId : undefined}
        onSubmit={submit} onKeyDown={onKeyDown}>
        <div className="modal-title" id={titleId}>{title}</div>
        <div className="dialog-body">
          {message && <p className="dialog-message" id={messageId}>{message}</p>}
          {input && (
            <input ref={fieldRef} className="dialog-input" value={value} aria-labelledby={titleId}
              aria-invalid={showError} aria-describedby={showError ? errorId : undefined}
              spellCheck={false} autoComplete="off"
              onChange={(e) => { setValue(e.target.value); setTouched(true); }} />
          )}
          {showError && <div className="dialog-error" id={errorId} role="alert">{error}</div>}
        </div>
        <div className="modal-actions">
          <button type="button" ref={cancelRef} onClick={() => onDone(null)}>Cancel</button>
          <button type="submit" className={danger ? 'danger' : 'primary'} disabled={showError}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
