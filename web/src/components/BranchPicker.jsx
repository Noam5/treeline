export default function BranchPicker({ title, branches, onPick, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        {branches.length === 0 ? (
          <div className="modal-empty">No other branches to choose from.</div>
        ) : (
          <div className="modal-list">
            {branches.map((b) => (
              <div key={b} className="modal-item" onClick={() => onPick(b)}>⑂ {b}</div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
