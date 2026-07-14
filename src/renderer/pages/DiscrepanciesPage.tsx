import React, { useEffect, useMemo, useState } from 'react';

type DiscrepancyType = 'orphan-tag' | 'missing-tag' | 'unresolved' | 'unknown';

interface Discrepancy {
  type: DiscrepancyType;
  roomId: string;
  roomTitle: string | null;
  role: string;
  personId?: string;
  email?: string | null;
  uid?: string;
  displayName?: string | null;
  note?: string;
}

const TYPE_LABELS: Record<DiscrepancyType, string> = {
  'orphan-tag': 'Orphan tag',
  'missing-tag': 'Missing tag',
  unresolved: 'Unresolved',
  unknown: 'Unknown person',
};

const TYPE_DESCRIPTIONS: Record<DiscrepancyType, string> = {
  'orphan-tag': 'Has the profile tag but is NOT a group member (the tag grants nothing).',
  'missing-tag': 'Is a group member but the profile lacks the breadcrumb tag (healable in S3).',
  unresolved: 'Group member whose ACL entry has no email — cannot be mapped to a person.',
  unknown: 'Group member with an email but no local profile (not synced).',
};

const ORDER: DiscrepancyType[] = ['orphan-tag', 'missing-tag', 'unresolved', 'unknown'];

function DiscrepanciesPage() {
  const [items, setItems] = useState<Discrepancy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | DiscrepancyType>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    window.electronAPI
      .getDiscrepancies()
      .then((rows) => {
        if (alive) setItems(rows as Discrepancy[]);
      })
      .catch((e) => {
        if (alive) setError(String(e?.message || e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<DiscrepancyType, number> = { 'orphan-tag': 0, 'missing-tag': 0, unresolved: 0, unknown: 0 };
    for (const d of items || []) c[d.type] += 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items || []).filter((d) => {
      if (typeFilter !== 'all' && d.type !== typeFilter) return false;
      if (!q) return true;
      return [d.roomTitle, d.roomId, d.role, d.email, d.displayName, d.uid, d.personId]
        .some((v) => (v || '').toString().toLowerCase().includes(q));
    });
  }, [items, typeFilter, search]);

  if (error) return <div className="text-red-600">Failed to load discrepancies: {error}</div>;
  if (!items) return <div className="text-gray-500">Loading discrepancies…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Discrepancies</h2>
        <p className="text-sm text-gray-500">
          Where profile tags and group-ACL truth disagree. Read-only — computed from the last sync.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setTypeFilter('all')}
          className={`px-3 py-1.5 rounded text-sm ${typeFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
        >
          All ({items.length})
        </button>
        {ORDER.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            title={TYPE_DESCRIPTIONS[t]}
            className={`px-3 py-1.5 rounded text-sm ${typeFilter === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            {TYPE_LABELS[t]} ({counts[t]})
          </button>
        ))}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search room, person, email, role…"
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
      />

      {filtered.length === 0 ? (
        <div className="text-gray-500 text-sm">No discrepancies match.</div>
      ) : (
        <div className="overflow-auto border border-gray-200 rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Room</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Email / UID</th>
                <th className="px-3 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-3 py-2 whitespace-nowrap">{TYPE_LABELS[d.type]}</td>
                  <td className="px-3 py-2">{d.roomTitle || d.roomId}</td>
                  <td className="px-3 py-2">{d.role}</td>
                  <td className="px-3 py-2">{d.displayName || d.personId || '—'}</td>
                  <td className="px-3 py-2">{d.email || d.uid || '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{d.note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default DiscrepanciesPage;
