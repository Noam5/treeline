import { useState, useEffect, useRef } from 'react';

// The commit message box. Its own component because it is placed differently
// depending on the view: inside FileStatus in the File Status view, and below
// both panes in the uncommitted-changes panel.
//
// `mergeMessage` is set while a merge is in progress: an empty box takes it,
// so committing finishes the merge with git's own message. When the merge
// ends some other way (committed from the banner, or aborted) the message is
// taken back out. Text the user has typed is never replaced or removed.
//
// "Amend last commit" works the same way: an empty box takes HEAD's message,
// and unticking takes it back out if it was left as loaded.

// Subject-line lengths git tooling expects: 50 is the convention, 72 is
// where `git log --oneline` and most viewers start to cut it off.
const SUBJECT_SOFT = 50;
const SUBJECT_HARD = 72;
const SHORTCUT = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '') ? '⌘↵' : 'Ctrl+Enter';

export default function CommitBox({ client, onRefresh, mergeMessage, onError }) {
  const [message, setMessage] = useState(mergeMessage || '');
  const offered = useRef(mergeMessage);
  const [amend, setAmend] = useState(false);
  // The remote branch that already has HEAD, while amending: amending is refused then.
  const [pushed, setPushed] = useState(null);
  const loaded = useRef(null); // the message an amend put in the box
  const amendSeq = useRef(0); // a later toggle outdates a lookup still in flight
  const current = useRef(message);
  current.current = message;
  const busy = useRef(false);

  useEffect(() => {
    const prev = offered.current;
    offered.current = mergeMessage;
    if (mergeMessage) setMessage((m) => (m.trim() ? m : mergeMessage));
    else if (prev) setMessage((m) => (m === prev ? '' : m));
  }, [mergeMessage]);

  const endAmend = () => {
    amendSeq.current++;
    setAmend(false);
    setPushed(null);
    loaded.current = null;
  };

  const toggleAmend = async (on) => {
    if (!on) {
      const prev = loaded.current;
      endAmend();
      if (prev !== null) setMessage((m) => (m === prev ? '' : m));
      return;
    }
    const seq = ++amendSeq.current;
    setAmend(true);
    const r = await client.getLastCommit();
    if (seq !== amendSeq.current) return;
    if (!r.ok) { endAmend(); onError?.(r.error || 'Nothing to amend'); return; }
    setPushed(r.pushed || null);
    if (!current.current.trim()) {
      loaded.current = r.message;
      setMessage(r.message);
    }
  };

  const blocked = amend && !!pushed;
  const doCommit = async () => {
    if (!message.trim() || blocked || busy.current) return;
    busy.current = true;
    try {
      const r = await client.commit(message, { amend });
      // Keep the text on failure — it is the only copy the user has.
      if (r.ok) { setMessage(''); endAmend(); onRefresh(); }
      else onError?.(r.error || 'Commit failed');
    } finally {
      busy.current = false;
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doCommit(); }
  };

  const subject = message.split('\n')[0].length;
  const lengthClass = subject > SUBJECT_HARD ? ' too-long' : subject > SUBJECT_SOFT ? ' long' : '';

  return (
    <div className="fs-commit">
      <textarea placeholder="Commit message" value={message}
        onChange={(e) => setMessage(e.target.value)} onKeyDown={onKeyDown} />
      {blocked && (
        <div className="commit-warn">
          This commit is already pushed to {pushed}; amending it would rewrite published history.
        </div>
      )}
      <div className="commit-actions">
        <label className="commit-amend">
          <input type="checkbox" checked={amend} onChange={(e) => toggleAmend(e.target.checked)} />
          Amend last commit
        </label>
        <span className="commit-spacer" />
        {message && (
          <span className={`commit-subject-len${lengthClass}`}
            title={`Subject line length: aim for ${SUBJECT_SOFT} characters, at most ${SUBJECT_HARD}`}>
            {subject}
          </span>
        )}
        <button onClick={doCommit} disabled={blocked} title={`${amend ? 'Amend' : 'Commit'} (${SHORTCUT})`}>
          {amend ? 'Amend' : 'Commit'}
        </button>
      </div>
    </div>
  );
}
