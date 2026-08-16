import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTaskQueue } from '../contexts/TaskQueueContext';
import { HealConfirmationModal } from '../components/HealConfirmationModal';
import { RevokeAccessConfirmationModal } from '../components/RevokeAccessConfirmationModal';
import { PruneTagsConfirmationModal } from '../components/PruneTagsConfirmationModal';

type DiscrepancyType = 'orphan-tag' | 'missing-tag' | 'unresolved' | 'unknown';

interface Discrepancy {
  type: DiscrepancyType;
  roomId: string;
  roomTitle: string | null;
  role: string;
  personId?: string;
  email?: string | null;
  uid?: string;
  groupId?: string;
  displayName?: string | null;
  note?: string;
}

interface HealPlanItem {
  personId: string;
  roomId: string;
  roomTitle: string | null;
  role: string;
  tag: string;
  displayName: string | null;
  email: string | null;
}

interface HealPlan {
  items: HealPlanItem[];
  skipped: Array<{ personId: string; roomId: string; role: string; reason: string }>;
}

interface PruneSkippedId {
  classId: string;
  verdict: 'alive' | 'unreadable';
  reason: string;
  title: string | null;
  parentId: string | null;
  tagCount: number;
}

interface PrunePlan {
  deletions: Array<{ personId: string; items: Array<{ classId: string; tags: string[] }> }>;
  skipped: PruneSkippedId[];
  tagCount: number;
  personCount: number;
  roomCount: number;
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
  const { tasks, addHealTagTask, addRevokeAccessTask, addPruneTagsTask } = useTaskQueue();
  const [items, setItems] = useState<Discrepancy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | DiscrepancyType>('all');
  const [search, setSearch] = useState('');
  const [healPlan, setHealPlan] = useState<HealPlan | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{
    row: Discrepancy;
    grants: Array<{ kind: 'group' | 'roomItem'; title: string; aclRole?: string }>;
  } | null>(null);
  const [prunePlan, setPrunePlan] = useState<PrunePlan | null>(null);
  const [probing, setProbing] = useState(false);
  const [watching, setWatching] = useState(false);
  const enqueuedRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(() => {
    window.electronAPI
      .getDiscrepancies()
      .then((rows) => {
        if (mountedRef.current) setItems(rows as Discrepancy[]);
      })
      .catch((e) => {
        if (mountedRef.current) setError(String(e?.message || e));
      });
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const counts = useMemo(() => {
    const c: Record<DiscrepancyType, number> = { 'orphan-tag': 0, 'missing-tag': 0, unresolved: 0, unknown: 0 };
    for (const d of items || []) c[d.type] += 1;
    return c;
  }, [items]);

  // Distinct class ids behind bucket-A orphan tags. For those rows alone, `roomId` holds a
  // CLASS id rather than a room id, and computeDiscrepancies attaches a note only to them.
  const unmatchedClassIdCount = useMemo(() => {
    const ids = new Set<string>();
    for (const d of items || []) {
      if (d.type === 'orphan-tag' && d.note) ids.add(d.roomId);
    }
    return ids.size;
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

  const openHeal = useCallback(async () => {
    setActionError(null);
    try {
      const plan = await window.electronAPI.getTagHealPlan();
      setHealPlan(plan);
    } catch (e) {
      setActionError(String((e as any)?.message || e));
    }
  }, []);

  // Track enqueued ids as a UNION across flows. Previously each flow overwrote a single Set,
  // so confirming one flow while another was still in flight discarded the other's ids: the
  // settle effect stopped watching them, refetched early, and left the page stale until the
  // next batch. Three flows now share this tracker, so it has to accumulate.
  const watchIds = useCallback((ids: Set<string>) => {
    if (ids.size === 0) return;
    const merged = new Set(enqueuedRef.current);
    for (const id of ids) merged.add(id);
    enqueuedRef.current = merged;
    setWatching(true);
  }, []);

  const confirmHeal = useCallback(() => {
    if (!healPlan) return;
    const ids = new Set<string>();
    for (const it of healPlan.items) {
      const id = addHealTagTask({ personId: it.personId, tag: it.tag, displayName: it.displayName });
      ids.add(id);
    }
    watchIds(ids);
    setHealPlan(null);
  }, [healPlan, addHealTagTask, watchIds]);

  const openRevoke = useCallback(async (row: Discrepancy) => {
    if (!row.uid || !row.groupId) return;
    setActionError(null);
    try {
      const grants = await window.electronAPI.planOrphanRemoval(row.uid, row.groupId, row.roomId);
      if (mountedRef.current) setRevokeTarget({ row, grants });
    } catch (e) {
      if (mountedRef.current) setActionError(String((e as any)?.message || e));
    }
  }, []);

  const confirmRevoke = useCallback(() => {
    if (!revokeTarget) return;
    const { row } = revokeTarget;
    if (!row.uid || !row.groupId) return;
    const id = addRevokeAccessTask({
      accountId: row.uid,
      groupId: row.groupId,
      roomId: row.roomId,
      roomName: row.roomTitle || row.roomId,
      displayName: row.displayName ?? null,
    });
    watchIds(new Set([id]));
    setRevokeTarget(null);
  }, [revokeTarget, addRevokeAccessTask, watchIds]);

  const openPrune = useCallback(async () => {
    setActionError(null);
    setProbing(true);
    try {
      const plan = await window.electronAPI.planTagPrune();
      if (mountedRef.current) setPrunePlan(plan as PrunePlan);
    } catch (e) {
      if (mountedRef.current) setActionError(String((e as any)?.message || e));
    } finally {
      if (mountedRef.current) setProbing(false);
    }
  }, []);

  const confirmPrune = useCallback(() => {
    if (!prunePlan) return;
    const ids = new Set<string>();
    for (const d of prunePlan.deletions) {
      const person = (items ?? []).find((r) => r.personId === d.personId);
      const id = addPruneTagsTask({
        personId: d.personId,
        items: d.items,
        displayName: person?.displayName ?? null,
        tagCount: d.items.reduce((n, i) => n + i.tags.length, 0),
      });
      ids.add(id);
    }
    watchIds(ids);
    setPrunePlan(null);
  }, [prunePlan, items, addPruneTagsTask, watchIds]);

  // When every enqueued heal task has settled (success/error), refetch so counts drop.
  useEffect(() => {
    if (!watching) return;
    const ids = enqueuedRef.current;
    // Settle when no enqueued heal task is still in-flight. Robust to a settled
    // task being dismissed from the queue mid-batch (its id leaves `tasks`) — an
    // exact-count check would wedge `watching` permanently in that case.
    const inFlight = tasks.some(
      (t) => ids.has(t.id) && (t.status === 'queued' || t.status === 'processing'),
    );
    if (!inFlight) {
      refetch();
      setWatching(false);
      enqueuedRef.current = new Set();
    }
  }, [tasks, watching, refetch]);

  if (error) return <div className="text-red-600">Failed to load discrepancies: {error}</div>;
  if (!items) return <div className="text-gray-500">Loading discrepancies…</div>;

  const missingCount = counts['missing-tag'];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Discrepancies</h2>
          <p className="text-sm text-gray-500">
            Where profile tags and group-ACL truth disagree. Read-only — computed from the last sync.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openHeal}
            disabled={missingCount === 0 || watching || probing}
            className={`px-3 py-1.5 rounded text-sm whitespace-nowrap ${
              missingCount === 0 || watching || probing
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {watching ? 'Working…' : `Heal all missing-tags (${missingCount})`}
          </button>
          <button
            onClick={openPrune}
            disabled={unmatchedClassIdCount === 0 || watching || probing}
            className={`px-3 py-1.5 rounded text-sm whitespace-nowrap ${
              unmatchedClassIdCount === 0 || watching || probing
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-red-600 text-white hover:bg-red-700'
            }`}
          >
            {probing ? 'Checking rooms…' : `Check & prune missing rooms (${unmatchedClassIdCount})`}
          </button>
        </div>
      </div>

      {actionError ? (
        <div className="flex items-start justify-between gap-3 rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-red-600 hover:text-red-800 font-medium"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ) : null}

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
                <th className="px-3 py-2 font-medium"></th>
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
                  <td className="px-3 py-2 text-right">
                    {d.type === 'unknown' && d.uid && d.groupId ? (
                      <button
                        onClick={() => openRevoke(d)}
                        disabled={watching}
                        className={`px-2 py-1 rounded text-xs whitespace-nowrap ${
                          watching
                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            : 'bg-red-600 text-white hover:bg-red-700'
                        }`}
                      >
                        Revoke access
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <HealConfirmationModal
        isOpen={healPlan !== null}
        tagCount={healPlan?.items.length ?? 0}
        skippedCount={healPlan?.skipped.length ?? 0}
        onConfirm={confirmHeal}
        onClose={() => setHealPlan(null)}
      />

      <RevokeAccessConfirmationModal
        isOpen={revokeTarget !== null}
        personLabel={revokeTarget?.row.displayName || revokeTarget?.row.email || revokeTarget?.row.uid || 'this account'}
        roomTitle={revokeTarget?.row.roomTitle || revokeTarget?.row.roomId || ''}
        grants={revokeTarget?.grants ?? []}
        onConfirm={confirmRevoke}
        onClose={() => setRevokeTarget(null)}
      />

      <PruneTagsConfirmationModal
        isOpen={prunePlan !== null}
        tagCount={prunePlan?.tagCount ?? 0}
        personCount={prunePlan?.personCount ?? 0}
        roomCount={prunePlan?.roomCount ?? 0}
        rooms={
          prunePlan
            ? [
                ...prunePlan.deletions
                  .flatMap((d) => d.items)
                  .reduce((m, i) => m.set(i.classId, (m.get(i.classId) ?? 0) + i.tags.length), new Map<string, number>()),
              ].map(([classId, tagCount]) => ({ classId, tagCount }))
            : []
        }
        skipped={prunePlan?.skipped ?? []}
        onConfirm={confirmPrune}
        onClose={() => setPrunePlan(null)}
      />
    </div>
  );
}

export default DiscrepanciesPage;
