// Shown for as long as the repository is mid-merge (MERGE_HEAD exists): what
// is being merged, how much is left to resolve, and the two ways out. The
// commit waits for the last conflict — git would refuse it anyway.
export default function MergeBanner({ merge, conflicts, onContinue, onAbort }) {
  const left = conflicts === 0
    ? 'All conflicts resolved — commit to finish the merge.'
    : `${conflicts} conflicted file${conflicts === 1 ? '' : 's'} left to resolve.`;
  return (
    <div className="merge-banner" role="status">
      <span className="bar-msg">
        <strong>Merging</strong>{merge.message ? ` — ${merge.message}` : ''}. {left}
      </span>
      <button className="merge-continue" onClick={onContinue} disabled={conflicts > 0}
        title={conflicts > 0 ? 'Resolve every conflicted file first' : 'Commit the merge'}>
        Commit merge
      </button>
      <button className="merge-abort" onClick={onAbort} title="Return to the state before the merge">
        Abort merge
      </button>
    </div>
  );
}
