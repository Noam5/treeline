import { useState } from 'react';

const TYPES = [
  { value: 'commit', label: 'Commit id' },
  { value: 'author', label: 'Author' },
  { value: 'description', label: 'Description' },
  { value: 'code', label: 'Line of code' },
];

const shortHash = (h) => (h || '').slice(0, 7);

export default function Search({ client, onSelect }) {
  const [type, setType] = useState('description');
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null); // null = not searched yet
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!q.trim()) { setResults([]); return; }
    setBusy(true);
    const r = await client.search(type, q.trim());
    setResults(r.commits || []);
    setBusy(false);
  };

  return (
    <div className="search-view">
      <div className="search-bar">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input
          className="search-input"
          placeholder={`Search by ${TYPES.find((t) => t.value === type).label.toLowerCase()}…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
        />
        <button onClick={run} disabled={busy}>{busy ? '…' : 'Search'}</button>
      </div>

      <div className="search-results">
        {results === null && <div className="search-hint">Enter a query and press Search.</div>}
        {results !== null && results.length === 0 && <div className="search-hint">No matching commits.</div>}
        {results && results.map((c) => (
          <div key={c.hash} className="search-row" onClick={() => onSelect(c.hash)}>
            <span className="search-hash">{shortHash(c.hash)}</span>
            <span className="search-subject">{c.subject}</span>
            <span className="search-author">{c.author}</span>
            <span className="search-date">{c.date}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
