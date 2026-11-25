import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArchivableRoom,
  ArchivedPerson,
  PersonArchivePlan,
  ArchivedRoom,
  ArchivePlan,
  ArchiveRoomType,
  RestorePlan,
} from '../../shared/archive-types';
import { useTaskQueue } from '../contexts/TaskQueueContext';
import { ArchiveConfirmModal } from '../components/archive/ArchiveConfirmModal';
import { RestoreConfirmModal } from '../components/archive/RestoreConfirmModal';
import { PersonArchiveConfirmModal } from '../components/archive/PersonArchiveConfirmModal';
import { PERSON_TYPE_LABEL, PERSON_TYPE_ORDER, TYPE_LABEL, TYPE_ORDER, filterPersons, filterRooms, formatArchivedAt, plainTitle } from '../components/archive/archive-logic';

const panel = { border: '1px solid var(--hazu-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Rooms view — move finished rooms out of the live tree, or bring them back (spec §9). */
function RoomsView() {
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

interface LivePerson { id: string; display_name: string; email: string | null; person_type: string }

/** Persons view — search a person, archive them, list and restore archived ones. */
function PersonsView() {
  const { tasks, addArchivePersonTask, addRestorePersonTask } = useTaskQueue();
  const [persons, setPersons] = useState<LivePerson[]>([]);
  const [personsError, setPersonsError] = useState<string | null>(null);
  const [archived, setArchived] = useState<ArchivedPerson[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(true);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PersonArchivePlan[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<ArchivedPerson | null>(null);
  const [planningId, setPlanningId] = useState<string | null>(null);
  const planningRef = useRef<string | null>(null);

  const pending = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) {
      if (t.status !== 'queued' && t.status !== 'processing') continue;
      if (t.type === 'archivePerson') ids.add(t.personId);
      else if (t.type === 'restorePerson') ids.add(t.folderId);
    }
    return ids;
  }, [tasks]);

  const loadPersons = useCallback(async () => {
    try {
      setPersons(await window.electronAPI.getPersons());
      setPersonsError(null);
    } catch (e) {
      setPersonsError(errMsg(e));
    }
  }, []);

  const loadArchived = useCallback(async () => {
    setArchivedLoading(true);
    try {
      setArchived(await window.electronAPI.listArchivedPersons());
      setArchivedError(null);
    } catch (e) {
      setArchivedError(errMsg(e));
    } finally {
      setArchivedLoading(false);
    }
  }, []);

  const reload = useCallback(() => {
    void loadPersons();
    void loadArchived();
  }, [loadPersons, loadArchived]);

  useEffect(() => { reload(); }, [reload]);

  // Reload both lists when the Task Queue drains (same mechanism as the rooms view).
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
      (t) => t.status === 'success' && (t.type === 'archivePerson' || t.type === 'restorePerson') && !seen.has(t.id)
    );
    if (fresh.length === 0) return;
    fresh.forEach((t) => seen.add(t.id));
    reload();
  }, [tasks, reload]);

  const toggle = (t: string) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const shown = useMemo(() => filterPersons(persons, search, types), [persons, search, types]);

  const askArchive = async (personId: string) => {
    planningRef.current = personId;
    setPlanningId(personId);
    setError(null);
    try {
      const plan = await window.electronAPI.planPersonArchive(personId);
      if (planningRef.current === personId) setPlans([plan]);
    } catch (e) {
      if (planningRef.current === personId) setError(errMsg(e));
    } finally {
      if (planningRef.current === personId) {
        planningRef.current = null;
        setPlanningId(null);
      }
    }
  };

  const btn = (disabled: boolean, active: string) =>
    `px-3 py-1 rounded text-sm ${disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : active}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {PERSON_TYPE_ORDER.map((t) => (
          <button
            key={t}
            onClick={() => toggle(t)}
            className={`px-3 py-1.5 text-sm rounded-full border ${
              types.includes(t) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {PERSON_TYPE_LABEL[t]}
          </button>
        ))}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une personne (nom ou e-mail)"
          className="ml-auto px-3 py-1.5 text-sm border border-gray-300 rounded w-72"
        />
      </div>

      {error && <div className="p-4 rounded-lg bg-red-50 text-red-800 text-sm">{error}</div>}

      <section className="bg-white rounded-lg" style={panel}>
        <h2 className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">
          Personnes{search.trim() === '' && types.length === 0 ? '' : ` (${shown.length})`}
        </h2>
        {personsError && <div className="m-4 p-3 rounded bg-red-50 text-red-800 text-sm">{personsError}</div>}
        <ul className="divide-y divide-gray-100">
          {shown.map((p) => {
            const off = pending.has(p.id) || planningId === p.id;
            return (
              <li key={p.id} className="px-4 py-2 flex items-center gap-3 text-sm">
                <span className="flex-1 min-w-0 truncate text-gray-900">{p.display_name}</span>
                <span className="text-gray-500 w-48 truncate">{p.email ?? ''}</span>
                <span className="text-gray-500 w-56 truncate">{PERSON_TYPE_LABEL[p.person_type] ?? p.person_type}</span>
                <button onClick={() => askArchive(p.id)} disabled={off} className={btn(off, 'bg-gray-800 text-white hover:bg-gray-900')}>
                  {pending.has(p.id) ? 'En file…' : planningId === p.id ? '…' : 'Archiver'}
                </button>
              </li>
            );
          })}
          {shown.length === 0 && !personsError && (
            <li className="px-4 py-3 text-sm text-gray-500">
              {search.trim() === '' && types.length === 0
                ? 'Cherchez un nom ou choisissez un type pour afficher des personnes.'
                : 'Aucune personne.'}
            </li>
          )}
        </ul>
      </section>

      <section className="bg-white rounded-lg" style={panel}>
        <h2 className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">
          Personnes archivées{archivedLoading ? '' : ` (${archived.length})`}
        </h2>
        {archivedLoading && <div className="px-4 py-3 text-sm text-gray-500">Chargement…</div>}
        {!archivedLoading && archivedError && (
          <div className="m-4 p-3 rounded bg-red-50 text-red-800 text-sm">{archivedError}</div>
        )}
        {!archivedLoading && !archivedError && (
          <ul className="divide-y divide-gray-100">
            {archived.map((a) => {
              const off = pending.has(a.folderId) || !a.inFolder;
              return (
                <li key={a.folderId} className="px-4 py-2 flex items-center gap-3 text-sm">
                  <span className="flex-1 min-w-0 truncate text-gray-900">{a.displayName}</span>
                  {!a.inFolder && <span className="text-xs text-amber-700">profil introuvable dans le dossier</span>}
                  <span className="text-gray-500 w-24 text-right">{formatArchivedAt(a.archivedAt)}</span>
                  <button onClick={() => setRestoreTarget(a)} disabled={off} className={btn(off, 'bg-blue-600 text-white hover:bg-blue-700')}>
                    {pending.has(a.folderId) ? 'En file…' : 'Restaurer'}
                  </button>
                </li>
              );
            })}
            {archived.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">Aucune personne archivée.</li>}
          </ul>
        )}
      </section>

      <PersonArchiveConfirmModal
        plans={plans}
        onCancel={() => setPlans([])}
        onConfirm={() => {
          plans.forEach((p) => {
            if (!pending.has(p.personId)) {
              addArchivePersonTask({ personId: p.personId, displayName: p.displayName, roomCount: p.rooms.length });
            }
          });
          setPlans([]);
        }}
      />
      {restoreTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Restaurer cette personne ?</h2>
            </div>
            <div className="p-6 space-y-3 text-sm text-gray-700 leading-relaxed">
              <p><strong>{restoreTarget.displayName}</strong></p>
              <p>Le profil retourne dans son dossier d'origine. Les salles ne sont pas restaurées : la personne devra y être réassignée.</p>
            </div>
            <div className="flex justify-end gap-2 p-6 border-t border-gray-200">
              <button onClick={() => setRestoreTarget(null)} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded">Annuler</button>
              <button
                onClick={() => {
                  if (!pending.has(restoreTarget.folderId)) {
                    addRestorePersonTask({ folderId: restoreTarget.folderId, displayName: restoreTarget.displayName });
                  }
                  setRestoreTarget(null);
                }}
                className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                Restaurer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Archive tab: « Salles | Personnes ». */
function ArchivePage() {
  const [view, setView] = useState<'rooms' | 'persons'>('rooms');
  const tab = (v: 'rooms' | 'persons', label: string) => (
    <button
      onClick={() => setView(v)}
      className={`px-4 py-1.5 text-sm rounded-full border ${
        view === v ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {tab('rooms', 'Salles')}
        {tab('persons', 'Personnes')}
      </div>
      {view === 'rooms' ? <RoomsView /> : <PersonsView />}
    </div>
  );
}

export default ArchivePage;
