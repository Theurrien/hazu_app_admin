import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { crossCheck, fixesFor, type PairLine, type PairStatus } from '../../../../shared/cross-check';
import { roomKey, type RoomCategory } from '../../../../shared/correspondence';
import { findLeavers, type ClassFilter, type HazuPerson } from '../../../../shared/person-match';
import type { PersonArchivePlan } from '../../../../shared/archive-types';
import { useAppMode } from '../../../contexts/AppModeContext';
import { useTaskQueue } from '../../../contexts/TaskQueueContext';
import { PersonArchiveConfirmModal } from '../../archive/PersonArchiveConfirmModal';
import { formatArchivedAt, plainTitle } from '../../archive/archive-logic';
import { LeaverSection, type ClassSelection } from '../PersonCheckResults';
import { buildClassIdsOf, leaverCounts } from '../verify-logic';
import {
  checkInputFrom,
  confirmCheck,
  hasBox,
  keepTicks,
  leaverMatches,
  plansToEnqueue,
  selectedLines,
  tickId,
  tickMissing,
  visibleLines,
  type LineFilter,
  type ResolvedForCheck,
} from './controle-logic';
import { FixConfirmModal } from './FixConfirmModal';

type Assignment = { person_id: string; room_id: string; role: string };
type SyncState = { incomplete: boolean; stale: boolean; lastSyncAt: number | null; message: string | null };

/** What step 3 reads from the local database; re-read when the Task Queue drains. */
interface CheckData {
  sync: SyncState;
  students: HazuPerson[];
  rooms: Array<{ id: string; title: string; room_type: string }>;
  assignments: Assignment[];
}

interface ControleResultsProps {
  resolved: ResolvedForCheck;
  cells: Map<number, Partial<Record<RoomCategory, string>>>;
  categories: RoomCategory[];
  /** A name column is mapped: only then is the leaver list shown (as in Verify). */
  nameMapped: boolean;
  /** Rows with neither e-mail nor name. */
  droppedRows: number;
  /** Bumped on every file change: a load that finishes for an older file is discarded. */
  generationRef: React.MutableRefObject<number>;
  ticked: Set<string>;
  onTickedChange: (update: (prev: Set<string>) => Set<string>) => void;
  /**
   * Ids of the tasks step 3 enqueued (`mine`) and of those whose end already triggered a reload
   * (`handled`). Held by the tab so they survive a step back and forth; cleared on file change.
   */
  ownTasks: React.MutableRefObject<{ mine: Set<string>; handled: Set<string> }>;
  onBack: () => void;
}

const CATEGORY_LABEL: Record<RoomCategory, string> = { class: 'Classe', enterprise: 'Entreprise', state: 'Canton' };
const STATUS_CHIPS: Array<{ status: PairStatus; label: string }> = [
  { status: 'missing', label: 'Manquant' },
  { status: 'extra', label: 'En trop' },
  { status: 'unverifiable', label: 'Non vérifiable' },
  { status: 'other-role', label: 'Autre rôle' },
];
const TASK_LABEL = { queued: 'en file…', processing: 'en cours…', error: 'échec — voir la file' } as const;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pairOf = (personId: string, roomId: string) => `${personId}|${roomId}`;
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const chip = (on: boolean) =>
  `px-2.5 py-1 rounded-full text-xs border ${
    on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
  }`;
const secondary =
  'px-4 py-2 text-sm font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50';
const primary =
  'px-4 py-2 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed';
const panel = { border: '1px solid var(--hazu-border)' };

function toggled<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function ControleResults(p: ControleResultsProps) {
  const { resolved, cells, categories, generationRef, ticked, onTickedChange, ownTasks } = p;
  const { mode } = useAppMode();
  const { tasks, addRoleUpdateTask, addArchivePersonTask } = useTaskQueue();

  const [data, setData] = useState<CheckData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LineFilter>({ categories: [], statuses: [], search: '', showOk: false });
  const [confirmLines, setConfirmLines] = useState<PairLine[] | null>(null);
  /** Shown in the modal (or above the table when it closed) when the list changed before « Confirmer ». */
  const [notice, setNotice] = useState<string | null>(null);
  const loadRunRef = useRef(0);
  const enqueuedRef = useRef(false);

  // Leavers
  const [classSel, setClassSel] = useState<ClassSelection>({ all: false, classIds: [], includeNoClass: false });
  const [leaverTicked, setLeaverTicked] = useState<Set<string>>(new Set());
  const [plans, setPlans] = useState<PersonArchivePlan[]>([]);
  const [planning, setPlanning] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const planningRef = useRef(false);
  const archiveEnqueuedRef = useRef(false);

  const load = useCallback(() => {
    const gen = generationRef.current;
    const run = ++loadRunRef.current;
    const current = () => gen === generationRef.current && run === loadRunRef.current;
    setLoading(true);
    setError(null);
    Promise.all([
      window.electronAPI.getControleSyncState(),
      window.electronAPI.getPersons('student'),
      window.electronAPI.getRooms(),
      window.electronAPI.getAllAssignments(),
    ])
      .then(([sync, persons, rooms, assignments]) => {
        if (!current()) return;
        setData({
          sync,
          students: persons.map((x: any) => ({ id: x.id, email: x.email ?? null, displayName: x.display_name })),
          rooms: rooms.map((r: any) => ({ id: r.id, title: r.title ?? '', room_type: r.room_type })),
          assignments,
        });
      })
      .catch((e) => {
        if (current()) setError(`Lecture impossible : ${errMsg(e)}`);
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
  }, [generationRef]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- The check ----
  const result = useMemo(
    () => (data ? crossCheck(checkInputFrom(resolved, cells, categories, data.rooms, data.assignments)) : null),
    [data, resolved, cells, categories],
  );

  // A recompute drops the ticks of lines that vanished (now OK, or changed).
  useEffect(() => {
    if (result) onTickedChange((prev) => keepTicks(prev, result.lines));
  }, [result, onTickedChange]);

  const nameById = useMemo(() => new Map((data?.students ?? []).map((s) => [s.id, s.displayName])), [data]);
  const titleById = useMemo(() => new Map((data?.rooms ?? []).map((r) => [r.id, plainTitle(r.title)])), [data]);
  const nameOf = useCallback((id: string) => nameById.get(id) ?? '—', [nameById]);
  const roomTitleOf = useCallback((id: string) => titleById.get(id) ?? '—', [titleById]);
  const duplicates = useMemo(() => new Set(result?.duplicatePersons ?? []), [result]);

  const visible = useMemo(() => (result ? visibleLines(result.lines, filter, nameOf) : []), [result, filter, nameOf]);

  // ---- Task Queue state per (person, room) ----
  const taskState = useMemo(() => {
    const pending = new Map<string, 'queued' | 'processing'>();
    const lastMine = new Map<string, 'success' | 'error'>();
    for (const t of tasks) {
      if (t.type !== 'roleUpdate') continue;
      const k = pairOf(t.personId, t.roomId);
      if (t.status === 'queued' || t.status === 'processing') pending.set(k, t.status);
      else if (ownTasks.current.mine.has(t.id)) lastMine.set(k, t.status);
    }
    const out = new Map<string, keyof typeof TASK_LABEL>(pending);
    for (const [k, s] of lastMine) if (!out.has(k) && s === 'error') out.set(k, 'error');
    return out;
  }, [tasks, ownTasks]);
  const stateOf = (l: PairLine) => (l.roomId ? taskState.get(pairOf(l.personId, l.roomId)) : undefined);
  const locked = (l: PairLine) => {
    const s = stateOf(l);
    return s === 'queued' || s === 'processing';
  };

  // When the queue drains after our tasks, re-read persons and assignments and recompute.
  // A retried task is queued again: its next end reloads again.
  useEffect(() => {
    const { mine, handled } = ownTasks.current;
    for (const t of tasks) if ((t.status === 'queued' || t.status === 'processing') && mine.has(t.id)) handled.delete(t.id);
    if (tasks.some((t) => t.status === 'queued' || t.status === 'processing')) return;
    const fresh = tasks.filter((t) => (t.status === 'success' || t.status === 'error') && mine.has(t.id) && !handled.has(t.id));
    if (fresh.length === 0) return;
    fresh.forEach((t) => handled.add(t.id));
    load();
  }, [tasks, load, ownTasks]);

  // ---- Selection ----
  // Only what the operator sees: a ticked line hidden by a filter is never enqueued.
  const selected = selectedLines(visible, ticked, locked);
  const selAdds = selected.filter((l) => l.status === 'missing').length;
  const selRemovals = selected.length - selAdds;

  const toggleLine = (key: string) =>
    onTickedChange((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // The confirm handlers await a sync-state read: they read the check as it is then, not as it was.
  const latest = useRef({ result, locked, leavers: [] as HazuPerson[], archivePending: new Set<string>() });
  latest.current.result = result;
  latest.current.locked = locked;

  const askFix = () => {
    if (selected.length === 0) return;
    enqueuedRef.current = false;
    setNotice(null);
    setConfirmLines(selected);
  };

  const confirmFix = async () => {
    if (enqueuedRef.current || !confirmLines) return; // a double click must not enqueue twice
    enqueuedRef.current = true;
    const gen = generationRef.current;
    let sync: SyncState;
    try {
      sync = await window.electronAPI.getControleSyncState();
    } catch (e) {
      if (gen !== generationRef.current) return;
      enqueuedRef.current = false;
      setNotice(`Lecture impossible : ${errMsg(e)}`);
      return;
    }
    if (gen !== generationRef.current) return;
    const now = latest.current;
    const cc = confirmCheck(confirmLines, now.result?.lines ?? [], now.locked, sync.incomplete);
    if (!cc.ok) {
      enqueuedRef.current = false;
      if (cc.reason === 'sync') {
        setConfirmLines(null);
        setData((d) => (d ? { ...d, sync } : d)); // the step now shows only the sync message
      } else if (cc.lines.length === 0) {
        setConfirmLines(null);
        setNotice('La liste a changé — vérifiez à nouveau.');
      } else {
        setConfirmLines(cc.lines);
        setNotice('La liste a changé — vérifiez à nouveau.');
      }
      return;
    }
    const done = new Set<string>();
    for (const l of cc.lines) done.add(tickId(l));
    for (const f of fixesFor(cc.lines)) {
      const id = addRoleUpdateTask({
        personName: nameOf(f.personId),
        personId: f.personId,
        roomName: roomTitleOf(f.roomId),
        roomId: f.roomId,
        oldRole: f.oldRole,
        newRole: f.newRole,
      });
      ownTasks.current.mine.add(id);
    }
    onTickedChange((prev) => new Set([...prev].filter((k) => !done.has(k))));
    setNotice(null);
    setConfirmLines(null);
  };

  // ---- Leavers (as in Verify) ----
  const classRooms = useMemo(
    () => (data?.rooms ?? []).filter((r) => r.room_type === 'class' && !resolved.categoryIds.has(r.id)),
    [data, resolved],
  );
  const classIdsOf = useMemo(() => buildClassIdsOf(data?.assignments ?? [], classRooms), [data, classRooms]);
  const classOptions = useMemo(
    () => classRooms.map((r) => ({ id: r.id, title: plainTitle(r.title) })).sort((a, b) => a.title.localeCompare(b.title)),
    [classRooms],
  );
  const roomCountOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of data?.assignments ?? []) m.set(a.person_id, (m.get(a.person_id) ?? 0) + 1);
    return m;
  }, [data]);
  const matches = useMemo(() => leaverMatches(resolved.students), [resolved]);
  const unattached = matches.filter((m) => m.kind === 'unknown').length;
  const classFilter: ClassFilter | null = useMemo(() => {
    if (classSel.all) return { all: true };
    if (classSel.classIds.length === 0 && !classSel.includeNoClass) return null;
    return { all: false, classIds: classSel.classIds, includeNoClass: classSel.includeNoClass };
  }, [classSel]);
  const leaversActive = p.nameMapped && !!data;
  const leavers = useMemo(
    () => (leaversActive && data ? findLeavers(data.students, matches, [], classIdsOf, classFilter) : []),
    [leaversActive, data, matches, classIdsOf, classFilter],
  );
  const leaverCount = useMemo(
    () => (leaversActive && data ? leaverCounts(data.students, matches, [], classIdsOf, classFilter) : { absent: 0, inClasses: 0 }),
    [leaversActive, data, matches, classIdsOf, classFilter],
  );
  const archivePending = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) if ((t.status === 'queued' || t.status === 'processing') && t.type === 'archivePerson') ids.add(t.personId);
    return ids;
  }, [tasks]);

  const toggleLeaver = (id: string) =>
    setLeaverTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllLeavers = () => {
    const selectable = leavers.filter((l) => !archivePending.has(l.id));
    setLeaverTicked((prev) =>
      selectable.length > 0 && selectable.every((l) => prev.has(l.id)) ? new Set() : new Set(selectable.map((l) => l.id)),
    );
  };

  const askArchive = async () => {
    if (planningRef.current) return;
    const ids = leavers.filter((l) => leaverTicked.has(l.id) && !archivePending.has(l.id)).map((l) => l.id);
    if (ids.length === 0) return;
    const gen = generationRef.current;
    planningRef.current = true;
    setPlanning(true);
    setArchiveError(null);
    try {
      const planned = await Promise.all(ids.map((id) => window.electronAPI.planPersonArchive(id)));
      if (gen !== generationRef.current) return;
      archiveEnqueuedRef.current = false;
      setPlans(planned);
    } catch (e) {
      if (gen === generationRef.current) setArchiveError(errMsg(e));
    } finally {
      planningRef.current = false;
      if (gen === generationRef.current) setPlanning(false);
    }
  };

  latest.current.leavers = leavers;
  latest.current.archivePending = archivePending;

  const confirmArchive = async () => {
    if (archiveEnqueuedRef.current) return;
    archiveEnqueuedRef.current = true;
    const gen = generationRef.current;
    let sync: SyncState;
    try {
      sync = await window.electronAPI.getControleSyncState();
    } catch (e) {
      if (gen !== generationRef.current) return;
      archiveEnqueuedRef.current = false;
      setPlans([]);
      setArchiveError(`Lecture impossible : ${errMsg(e)}`);
      return;
    }
    if (gen !== generationRef.current) return;
    const now = latest.current;
    // Persons no longer on the leaver list (or already queued) are skipped.
    const toEnqueue = plansToEnqueue(plans, new Set(now.leavers.map((l) => l.id)), now.archivePending, sync.incomplete);
    if (sync.incomplete) {
      setPlans([]);
      setData((d) => (d ? { ...d, sync } : d));
      return;
    }
    for (const plan of toEnqueue) {
      const id = addArchivePersonTask({ personId: plan.personId, displayName: plan.displayName, roomCount: plan.rooms.length });
      ownTasks.current.mine.add(id);
    }
    setPlans([]);
    setLeaverTicked(new Set());
  };

  // ---- Render ----
  if (error && !data) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{error}</p>
        <button type="button" className={secondary} onClick={p.onBack}>
          Retour
        </button>
      </div>
    );
  }
  if (!data || !result) return <p className="text-sm text-gray-500">Chargement…</p>;

  if (data.sync.incomplete) {
    return (
      <div className="space-y-4">
        <p className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-900">
          {data.sync.message ?? "Synchronisation incomplète — synchronisez d'abord."}
        </p>
        <button type="button" className={secondary} onClick={p.onBack}>
          Retour
        </button>
      </div>
    );
  }

  const c = result.counts;
  const fileCell = (l: PairLine) => {
    if (l.fileValue === null) return <span className="text-gray-400">—</span>;
    if (l.status !== 'unverifiable') return l.fileValue;
    const ignored = resolved.rooms[l.category]?.get(roomKey(l.fileValue))?.kind === 'ignored';
    return ignored ? (
      <span>
        <span className="text-gray-500">(ignoré)</span> {l.fileValue}
      </span>
    ) : (
      <span>
        {l.fileValue} <span className="text-gray-500">(salle d'un autre type)</span>
      </span>
    );
  };
  const hazuCell = (l: PairLine) => {
    if (l.status === 'missing') return <span className="text-gray-500">— absent</span>;
    if (l.status === 'unverifiable' || l.roomId === null) return <span className="text-gray-500">?</span>;
    return roomTitleOf(l.roomId);
  };
  const statusCell = (l: PairLine) => {
    const t = stateOf(l);
    const base =
      l.status === 'missing' ? (
        <span className="text-amber-700">Manquant → ajouter</span>
      ) : l.status === 'extra' ? (
        <span className="text-red-700">
          En trop → retirer
          {l.multipleInHazu && (
            <span className="block text-xs text-gray-500">
              Hazu : {l.multipleInHazu} {l.category === 'enterprise' ? 'entreprises' : 'cantons'}
            </span>
          )}
        </span>
      ) : l.status === 'unverifiable' ? (
        <span className="text-gray-500">Non vérifiable</span>
      ) : l.status === 'other-role' ? (
        <span className="text-gray-700">Autre rôle{l.hazuRole ? ` (${l.hazuRole})` : ''}</span>
      ) : (
        <span className="text-green-700">OK</span>
      );
    return (
      <>
        {base}
        {t && <span className={`block text-xs ${t === 'error' ? 'text-red-700' : 'text-blue-700'}`}>{TASK_LABEL[t]}</span>}
      </>
    );
  };
  const tickableVisible = visible.filter((l) => !locked(l));

  return (
    <div className="space-y-4">
      {data.sync.stale && (
        <p className="p-3 rounded bg-amber-50 border border-amber-200 text-sm text-amber-900">
          La dernière synchronisation date de plus de 24 h
          {data.sync.lastSyncAt !== null ? ` (${formatArchivedAt(data.sync.lastSyncAt)})` : " ou n'a jamais eu lieu"} :
          les salles de Hazu peuvent avoir changé depuis. Synchronisez avant de corriger si possible.
        </p>
      )}
      {error && <p className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{error}</p>}
      {notice && confirmLines === null && (
        <p className="p-3 rounded bg-amber-50 border border-amber-200 text-sm text-amber-900">{notice}</p>
      )}

      <section className="bg-white rounded-lg" style={panel}>
        <div className="px-4 py-3 border-b border-gray-100 text-sm text-gray-800">
          {plural(c.students, 'élève contrôlé', 'élèves contrôlés')} · {plural(c.ok, 'relation OK', 'relations OK')} ·{' '}
          {plural(c.missing, 'manquante', 'manquantes')} · {c.extra} en trop ·{' '}
          {plural(c.unverifiable, 'non vérifiable', 'non vérifiables')}
          {c.otherRole > 0 && ` · ${c.otherRole} autre rôle`}
          {loading && <span className="ml-2 text-gray-400">mise à jour…</span>}
        </div>

        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={chip(filter.categories.includes(cat))}
              onClick={() => setFilter((f) => ({ ...f, categories: toggled(f.categories, cat) }))}
            >
              {CATEGORY_LABEL[cat]}
            </button>
          ))}
          <span className="w-2" />
          {STATUS_CHIPS.map((s) => (
            <button
              key={s.status}
              type="button"
              className={chip(filter.statuses.includes(s.status))}
              onClick={() => setFilter((f) => ({ ...f, statuses: toggled(f.statuses, s.status) }))}
            >
              {s.label}
            </button>
          ))}
          <label className="flex items-center gap-1.5 text-xs text-gray-700 ml-2">
            <input
              type="checkbox"
              checked={filter.showOk}
              onChange={(e) => setFilter((f) => ({ ...f, showOk: e.target.checked }))}
            />
            afficher les OK
          </label>
          <input
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            placeholder="Chercher un élève…"
            className="ml-auto px-2 py-1 border border-gray-300 rounded text-sm w-56"
          />
        </div>

        <div className="max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2 font-medium">Élève</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Fichier</th>
                <th className="px-3 py-2 font-medium">Hazu</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((l) => (
                <tr key={l.key} className={locked(l) ? 'bg-gray-50 text-gray-500' : ''}>
                  <td className="px-3 py-2 align-top">
                    {hasBox(l) && (
                      <input
                        type="checkbox"
                        aria-label="Sélectionner"
                        disabled={locked(l)}
                        checked={ticked.has(tickId(l)) && !locked(l)}
                        onChange={() => toggleLine(tickId(l))}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-gray-900">
                    {nameOf(l.personId)}
                    {duplicates.has(l.personId) && (
                      <span className="block text-xs text-amber-700">deux lignes du fichier</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-gray-600">{CATEGORY_LABEL[l.category]}</td>
                  <td className="px-3 py-2 align-top">{fileCell(l)}</td>
                  <td className="px-3 py-2 align-top">{hazuCell(l)}</td>
                  <td className="px-3 py-2 align-top">{statusCell(l)}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-sm text-gray-500">
                    {result.lines.some((l) => l.status !== 'ok') ? 'Aucune ligne ne correspond aux filtres.' : 'Tout correspond.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-gray-700">
            {selected.length} sélectionné{selected.length > 1 ? 's' : ''} : {plural(selAdds, 'ajout', 'ajouts')},{' '}
            {plural(selRemovals, 'retrait', 'retraits')}
          </span>
          <button
            type="button"
            className={`${secondary} ml-auto`}
            disabled={!tickableVisible.some((l) => l.status === 'missing')}
            onClick={() => onTickedChange((prev) => tickMissing(tickableVisible, prev))}
          >
            Cocher les manquants
          </button>
          <button type="button" className={primary} disabled={selected.length === 0} onClick={askFix}>
            Corriger la sélection
          </button>
        </div>
      </section>

      <LeaverSection
        classes={classOptions}
        selection={classSel}
        onSelectionChange={setClassSel}
        leavers={leavers}
        counts={leaverCount}
        roomCountOf={roomCountOf}
        ticked={leaverTicked}
        onToggle={toggleLeaver}
        onToggleAll={toggleAllLeavers}
        pending={archivePending}
        undecided={0}
        nameMapped={p.nameMapped}
        droppedRows={p.droppedRows}
        unattachedUnknown={unattached}
        canArchive={mode === 'complete'}
        planning={planning}
        onArchive={askArchive}
        error={archiveError}
      />

      <button type="button" className={secondary} onClick={p.onBack}>
        Retour
      </button>

      <FixConfirmModal
        lines={confirmLines}
        nameOf={nameOf}
        roomTitleOf={roomTitleOf}
        notice={notice}
        onCancel={() => {
          setConfirmLines(null);
          setNotice(null);
        }}
        onConfirm={() => void confirmFix()}
      />
      <PersonArchiveConfirmModal plans={plans} onCancel={() => setPlans([])} onConfirm={() => void confirmArchive()} />
    </div>
  );
}
