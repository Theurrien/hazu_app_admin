import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArchivableRoom,
  ArchivedRoom,
  ArchivePlan,
  ArchiveRoomType,
  RestorePlan,
} from '../../shared/archive-types';
import { useTaskQueue } from '../contexts/TaskQueueContext';
import { ArchiveConfirmModal } from '../components/archive/ArchiveConfirmModal';
import { RestoreConfirmModal } from '../components/archive/RestoreConfirmModal';
import { TYPE_LABEL, TYPE_ORDER, filterRooms, formatArchivedAt, plainTitle } from '../components/archive/archive-logic';

const panel = { border: '1px solid var(--hazu-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Archive — move finished rooms out of the live tree, or bring them back (spec §9). */
function ArchivePage() {
  const { tasks, addArchiveRoomTask, addRestoreRoomTask } = useTaskQueue();
  const [active, setActive] = useState<ArchivableRoom[]>([]);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [archived, setArchived] = useState<ArchivedRoom[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(true);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [types, setTypes] = useState<Set<ArchiveRoomType>>(new Set());
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [archivePlan, setArchivePlan] = useState<ArchivePlan | null>(null);
  const [restorePlan, setRestorePlan] = useState<RestorePlan | null>(null);
  const [planningId, setPlanningId] = useState<string | null>(null);
  const planningRef = useRef<string | null>(null);

  // Ids with an archive/restore task still waiting or running: their buttons stay disabled.
  const pending = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) {
      if (t.status !== 'queued' && t.status !== 'processing') continue;
      if (t.type === 'archiveRoom') ids.add(t.roomId);
      else if (t.type === 'restoreRoom') ids.add(t.folderId);
    }
    return ids;
  }, [tasks]);

  const loadActive = useCallback(async () => {
    try {
      setActive(await window.electronAPI.listArchivableRooms());
      setActiveError(null);
    } catch (e) {
      setActiveError(errMsg(e));
    }
  }, []);

  const loadArchived = useCallback(async () => {
    setArchivedLoading(true);
    try {
      setArchived(await window.electronAPI.listArchivedRooms());
      setArchivedError(null);
    } catch (e) {
      setArchivedError(errMsg(e));
    } finally {
      setArchivedLoading(false);
    }
  }, []);

  const reload = useCallback(() => {
    void loadActive();
    void loadArchived();
  }, [loadActive, loadArchived]);

  useEffect(() => { reload(); }, [reload]);

  // Reload both lists when the Task Queue drains (same mechanism as BulkImportPage).
  const handled = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (handled.current === null) {
      handled.current = new Set(tasks.filter((t) => t.status === 'success').map((t) => t.id));
    }
    const seen = handled.current;
    tasks.forEach((t) => {
      if (t.status === 'queued' || t.status === 'processing') seen.delete(t.id);
    });
    if (tasks.some((t) => t.status === 'queued' || t.status === 'processing')) return;
    const fresh = tasks.filter(
      (t) => t.status === 'success' && (t.type === 'archiveRoom' || t.type === 'restoreRoom') && !seen.has(t.id)
    );
    if (fresh.length === 0) return;
    fresh.forEach((t) => seen.add(t.id));
    reload();
  }, [tasks, reload]);

  const toggle = (t: ArchiveRoomType) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });

  const shownActive = useMemo(() => filterRooms(active, types, query), [active, types, query]);
  const shownArchived = useMemo(() => filterRooms(archived, types, query), [archived, types, query]);

  const askArchive = async (roomId: string) => {
    planningRef.current = roomId;
    setPlanningId(roomId);
    setError(null);
    try {
      const plan = await window.electronAPI.planArchive(roomId);
      if (planningRef.current === roomId) setArchivePlan(plan);
    } catch (e) {
      if (planningRef.current === roomId) setError(errMsg(e));
    } finally {
      if (planningRef.current === roomId) {
        planningRef.current = null;
        setPlanningId(null);
      }
    }
  };
  const askRestore = async (folderId: string) => {
    planningRef.current = folderId;
    setPlanningId(folderId);
    setError(null);
    try {
      const plan = await window.electronAPI.planRestore(folderId);
      if (planningRef.current === folderId) setRestorePlan(plan);
    } catch (e) {
      if (planningRef.current === folderId) setError(errMsg(e));
    } finally {
      if (planningRef.current === folderId) {
        planningRef.current = null;
        setPlanningId(null);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {TYPE_ORDER.map((t) => (
          <button
            key={t}
            onClick={() => toggle(t)}
            className={`px-3 py-1.5 text-sm rounded-full border ${
              types.has(t) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une salle"
          className="ml-auto px-3 py-1.5 text-sm border border-gray-300 rounded w-64"
        />
      </div>

      {error && <div className="p-4 rounded-lg bg-red-50 text-red-800 text-sm">{error}</div>}

      <section className="bg-white rounded-lg" style={panel}>
        <h2 className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">
          Salles actives ({shownActive.length})
        </h2>
        {activeError && <div className="m-4 p-3 rounded bg-red-50 text-red-800 text-sm">{activeError}</div>}
        <ul className="divide-y divide-gray-100">
          {shownActive.map((r) => (
            <li key={r.id} className="px-4 py-2 flex items-center gap-3 text-sm">
              <span className="flex-1 min-w-0 truncate text-gray-900">{plainTitle(r.title)}</span>
              <span className="text-gray-500 w-24">{TYPE_LABEL[r.roomType]}</span>
              <span className="text-gray-500 w-24 text-right">{r.memberCount} membre{r.memberCount === 1 ? '' : 's'}</span>
              {r.blockedReason && <span className="text-xs text-amber-700 max-w-xs truncate" title={r.blockedReason}>{r.blockedReason}</span>}
              <button
                onClick={() => askArchive(r.id)}
                disabled={r.blockedReason !== null || pending.has(r.id) || planningId === r.id}
                className={`px-3 py-1 rounded text-sm ${
                  r.blockedReason !== null || pending.has(r.id) || planningId === r.id ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-800 text-white hover:bg-gray-900'
                }`}
              >
                {pending.has(r.id) ? 'En file…' : planningId === r.id ? '…' : 'Archiver'}
              </button>
            </li>
          ))}
          {shownActive.length === 0 && !activeError && (
            <li className="px-4 py-3 text-sm text-gray-500">Aucune salle.</li>
          )}
        </ul>
      </section>

      <section className="bg-white rounded-lg" style={panel}>
        <h2 className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">
          Archivées{archivedLoading ? '' : ` (${shownArchived.length})`}
        </h2>
        {archivedLoading && <div className="px-4 py-3 text-sm text-gray-500">Chargement…</div>}
        {!archivedLoading && archivedError && (
          <div className="m-4 p-3 rounded bg-red-50 text-red-800 text-sm">{archivedError}</div>
        )}
        {!archivedLoading && !archivedError && (
          <ul className="divide-y divide-gray-100">
            {shownArchived.map((r) => (
              <li key={r.folderId} className="px-4 py-2 flex items-center gap-3 text-sm">
                <span className="flex-1 min-w-0 truncate text-gray-900">{plainTitle(r.title)}</span>
                <span className="text-gray-500 w-24">{TYPE_LABEL[r.roomType]}</span>
                <span className="text-gray-500 w-24 text-right">{formatArchivedAt(r.archivedAt)}</span>
                <button
                  onClick={() => askRestore(r.folderId)}
                  disabled={pending.has(r.folderId) || planningId === r.folderId}
                  className={`px-3 py-1 rounded text-sm ${
                    pending.has(r.folderId) || planningId === r.folderId
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {pending.has(r.folderId) ? 'En file…' : planningId === r.folderId ? '…' : 'Restaurer'}
                </button>
              </li>
            ))}
            {shownArchived.length === 0 && (
              <li className="px-4 py-3 text-sm text-gray-500">Aucune salle archivée.</li>
            )}
          </ul>
        )}
      </section>

      <ArchiveConfirmModal
        plan={archivePlan}
        onClose={() => setArchivePlan(null)}
        onConfirm={() => {
          if (archivePlan && !pending.has(archivePlan.roomId)) addArchiveRoomTask({ roomId: archivePlan.roomId, roomTitle: plainTitle(archivePlan.title) });
          setArchivePlan(null);
        }}
      />
      <RestoreConfirmModal
        plan={restorePlan}
        onClose={() => setRestorePlan(null)}
        onConfirm={() => {
          if (restorePlan && !pending.has(restorePlan.folderId)) addRestoreRoomTask({ folderId: restorePlan.folderId, roomTitle: plainTitle(restorePlan.title) });
          setRestorePlan(null);
        }}
      />
    </div>
  );
}

export default ArchivePage;
