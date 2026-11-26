import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isResolved,
  resolveRoomValues,
  resolveStudents,
  type RoomCandidate,
  type RoomCategory,
  type RoomResolution,
  type SavedLink,
} from '../../../../shared/correspondence';
import type { HazuPerson, SheetPerson } from '../../../../shared/person-match';
import { categoryIdsOf } from '../../../../shared/app-mode';
import { findBestMatch } from '../../../utils/fuzzyMatch';
import type { ColumnMapping } from '../ColumnMappingDropdown';
import { DataPreviewTable } from '../DataPreviewTable';
import { sheetLabel } from '../PersonCheckResults';
import {
  applyStudentOverrides,
  checkRows,
  columnsReady,
  controleColumns,
  distinctRoomValues,
  linkFromDecision,
  mappedCategories,
  openCount,
  resetForNewFile,
  roomCandidates,
  type ControleState,
  type ResolvedForCheck,
} from './controle-logic';
import { ControleResults } from './ControleResults';
import { RoomCorrespondencePanel } from './RoomCorrespondencePanel';
import { SavedCorrespondencesDrawer } from './SavedCorrespondencesDrawer';
import { StudentCorrespondencePanel } from './StudentCorrespondencePanel';

interface FileData {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
}

interface ControleTabProps {
  fileData: FileData | null;
}

/** What step 2 reads from the local database. */
interface StepData {
  students: HazuPerson[];
  /** Candidates per type, category folders left out. */
  rooms: Record<RoomCategory, RoomCandidate[]>;
  categoryIds: Set<string>;
  saved: SavedLink[];
}

const STEPS: Array<{ n: 1 | 2 | 3; mark: string; label: string }> = [
  { n: 1, mark: '①', label: 'Colonnes' },
  { n: 2, mark: '②', label: 'Correspondances' },
  { n: 3, mark: '③', label: 'Résultats' },
];

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** `suggest` for resolveRoomValues: the best fuzzy title (normal mode), or none. */
const suggest = (value: string, titles: string[]): string | null => {
  const m = findBestMatch(value, titles, 'normal');
  return m.matched ? m.matchedValue : null;
};

const secondary =
  'px-4 py-2 text-sm font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50';
const primary =
  'px-4 py-2 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed';

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className="flex items-center gap-6 text-sm">
      {STEPS.map((s) => (
        <li
          key={s.n}
          className={s.n === step ? 'font-semibold text-blue-700' : s.n < step ? 'text-gray-700' : 'text-gray-400'}
        >
          {s.mark} {s.label}
        </li>
      ))}
    </ol>
  );
}

export function ControleTab({ fileData }: ControleTabProps) {
  const [state, setState] = useState<ControleState>(resetForNewFile);
  // Bumped on every file change; discards loads and saves that finish after the file changed.
  const generationRef = useRef(0);
  /** Step 3's own Task Queue tasks; see ControleResults. */
  const ownTasks = useRef({ mine: new Set<string>(), handled: new Set<string>() });

  const [data, setData] = useState<StepData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** rowIndex → person id (null = ignored), for decisions that cannot be saved. Session only. */
  const [overrides, setOverrides] = useState<Map<number, string | null>>(new Map());
  /** Handed to step 3. */
  const [resolved, setResolved] = useState<ResolvedForCheck | null>(null);

  useEffect(() => {
    generationRef.current += 1;
    ownTasks.current = { mine: new Set(), handled: new Set() };
    setState(resetForNewFile());
    setData(null);
    setOverrides(new Map());
    setResolved(null);
    setBusy(false);
    setLoading(false);
    setError(null);
    setDrawerOpen(false);
  }, [fileData]);

  const columns = useMemo(() => controleColumns(state.mappings), [state.mappings]);
  const ready = useMemo(() => columnsReady(columns), [columns]);
  const categories = useMemo(() => mappedCategories(columns), [columns]);
  const checked = useMemo(() => (fileData ? checkRows(fileData.rows, columns) : null), [fileData, columns]);

  // Entering step 2 (re)reads students, rooms and saved links.
  useEffect(() => {
    if (state.step !== 2) return;
    const gen = generationRef.current;
    setLoading(true);
    setError(null);
    Promise.all([
      window.electronAPI.getPersons('student'),
      window.electronAPI.getRooms(),
      window.electronAPI.listCorrespondences(),
      window.electronAPI.getSetting('root_hazu_id'),
    ])
      .then(([persons, rooms, saved, rootHazuId]) => {
        if (gen !== generationRef.current) return;
        const categoryIds = categoryIdsOf(rooms, rootHazuId);
        setData({
          students: persons.map((p: any) => ({ id: p.id, email: p.email ?? null, displayName: p.display_name })),
          rooms: {
            class: roomCandidates(rooms, 'class', categoryIds),
            enterprise: roomCandidates(rooms, 'enterprise', categoryIds),
            state: roomCandidates(rooms, 'state', categoryIds),
          },
          categoryIds,
          saved,
        });
      })
      .catch((e) => {
        if (gen === generationRef.current) setError(`Lecture impossible : ${errMsg(e)}`);
      })
      .finally(() => {
        if (gen === generationRef.current) setLoading(false);
      });
  }, [state.step]);

  const roomValues = useMemo(() => {
    const out: Partial<Record<RoomCategory, Array<{ key: string; label: string }>>> = {};
    if (checked) for (const c of categories) out[c] = distinctRoomValues(checked.cells, c);
    return out;
  }, [checked, categories]);

  const roomRes = useMemo(() => {
    const out: Partial<Record<RoomCategory, Map<string, RoomResolution>>> = {};
    if (!data) return out;
    for (const c of categories) {
      out[c] = resolveRoomValues(c, (roomValues[c] ?? []).map((v) => v.label), data.rooms[c], data.saved, suggest);
    }
    return out;
  }, [data, categories, roomValues]);

  const studentRes = useMemo(
    () => (data && checked ? applyStudentOverrides(resolveStudents(checked.sheet, data.students, data.saved), overrides) : null),
    [data, checked, overrides],
  );

  const openRooms = (c: RoomCategory) => openCount(roomRes[c]?.values() ?? []);
  const openStudents = studentRes ? openCount([...studentRes.values()].map((v) => v.res)) : 0;
  const allResolved =
    !!data && !!studentRes && openStudents === 0 && categories.every((c) => openRooms(c) === 0);

  // Leavers need a name column, as in Verify (an e-mail alone may name a profile whose identity tag holds a UID).
  const nameMapped = !!columns.fullName || (!!columns.firstName && !!columns.lastName);

  /** Stable: step 3 calls it from an effect after every recompute. */
  const setTicked = useCallback(
    (update: (prev: Set<string>) => Set<string>) => setState((prev) => ({ ...prev, ticked: update(prev.ticked) })),
    [],
  );

  const handleMappingChange = (header: string, mapping: ColumnMapping | null) => {
    setOverrides(new Map()); // overrides are per row of the old identity columns
    setState((prev) => {
      const mappings = { ...prev.mappings };
      if (mapping) mappings[header] = mapping;
      else delete mappings[header];
      return { ...prev, mappings };
    });
  };

  /** Save, then re-read the links; returns the fresh list, or null when it failed or the file changed. */
  const saveLinks = async (links: SavedLink[]): Promise<SavedLink[] | null> => {
    const gen = generationRef.current;
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.saveCorrespondences(links);
      const saved = await window.electronAPI.listCorrespondences();
      if (gen !== generationRef.current) return null;
      setData((d) => (d ? { ...d, saved } : d));
      return saved;
    } catch (e) {
      if (gen === generationRef.current) setError(`Enregistrement impossible : ${errMsg(e)}`);
      return null;
    } finally {
      if (gen === generationRef.current) setBusy(false);
    }
  };

  const decideRoom = (category: RoomCategory, key: string, label: string, hazuId: string | null) => {
    void saveLinks([linkFromDecision(category, key, label, hazuId, Date.now())]);
  };

  const setOverride = (rowIndex: number, personId: string | null) =>
    setOverrides((prev) => new Map(prev).set(rowIndex, personId));

  const decideStudent = async (row: SheetPerson, saveKey: string | null, personId: string | null) => {
    if (saveKey === null || !data || !checked) {
      setOverride(row.rowIndex, personId);
      return;
    }
    setOverrides((prev) => {
      const next = new Map(prev);
      next.delete(row.rowIndex);
      return next;
    });
    const saved = await saveLinks([linkFromDecision('student', saveKey, sheetLabel(row), personId, Date.now())]);
    if (saved === null) return;
    // A saved link the row contradicts (its e-mail names another student) is not applied by the
    // resolver; the operator's choice then holds for this session.
    const again = resolveStudents(checked.sheet, data.students, saved).get(row.rowIndex);
    if (again && !isResolved(again.res)) setOverride(row.rowIndex, personId);
  };

  /** A drawer change to a student link drops the session choices of the rows it keys. */
  const dropOverridesFor = (link: SavedLink) => {
    if (link.category !== 'student' || !studentRes) return;
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const [rowIndex, v] of studentRes) if (v.saveKey === link.fileKey) next.delete(rowIndex);
      return next;
    });
  };

  const changeSaved = (link: SavedLink, hazuId: string | null) => {
    dropOverridesFor(link);
    void saveLinks([linkFromDecision(link.category, link.fileKey, link.fileLabel, hazuId, Date.now())]);
  };

  const deleteSaved = async (link: SavedLink) => {
    const gen = generationRef.current;
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.deleteCorrespondence(link.category, link.fileKey);
      const saved = await window.electronAPI.listCorrespondences();
      if (gen !== generationRef.current) return;
      dropOverridesFor(link);
      setData((d) => (d ? { ...d, saved } : d));
    } catch (e) {
      if (gen === generationRef.current) setError(`Suppression impossible : ${errMsg(e)}`);
    } finally {
      if (gen === generationRef.current) setBusy(false);
    }
  };

  const goToCheck = () => {
    if (!allResolved || !studentRes || !data || loading) return;
    const rooms: ResolvedForCheck['rooms'] = {};
    for (const c of categories) rooms[c] = roomRes[c];
    setResolved({
      students: new Map([...studentRes].map(([i, v]) => [i, v.res])),
      rooms,
      categoryIds: data.categoryIds,
    });
    setState((prev) => ({ ...prev, step: 3 }));
  };

  if (!fileData) {
    return <p className="text-sm text-gray-500">Chargez d'abord un fichier.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Stepper step={state.step} />
        {state.step >= 2 && data && (
          <button type="button" className={secondary} onClick={() => setDrawerOpen(true)}>
            Correspondances enregistrées
          </button>
        )}
      </div>

      {state.step === 1 && (
        <>
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Colonnes</h3>
            <DataPreviewTable
              headers={fileData.headers}
              rows={fileData.rows}
              columnMappings={state.mappings}
              onColumnMappingChange={handleMappingChange}
              mode="controle"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!ready.ok}
              onClick={() => setState((prev) => ({ ...prev, step: 2 }))}
              className={primary}
            >
              Continuer
            </button>
            {!ready.ok && <span className="text-sm text-gray-500">{ready.reason}</span>}
          </div>
        </>
      )}

      {state.step === 2 && (
        <>
          {error && <p className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{error}</p>}
          {loading && !data && <p className="text-sm text-gray-500">Chargement…</p>}
          {data && checked && studentRes && (
            <div className="space-y-4">
              {categories.map((c) => (
                <RoomCorrespondencePanel
                  key={c}
                  category={c}
                  values={roomValues[c] ?? []}
                  resolutions={roomRes[c] ?? new Map()}
                  candidates={data.rooms[c]}
                  open={openRooms(c)}
                  busy={busy}
                  onDecide={(key, label, hazuId) => decideRoom(c, key, label, hazuId)}
                />
              ))}
              <StudentCorrespondencePanel
                sheet={checked.sheet}
                resolutions={studentRes}
                sessionOnly={new Set(overrides.keys())}
                students={data.students}
                open={openStudents}
                busy={busy}
                onDecide={(row, saveKey, personId) => void decideStudent(row, saveKey, personId)}
              />
            </div>
          )}
          <div className="flex items-center gap-3">
            <button type="button" className={secondary} onClick={() => setState((prev) => ({ ...prev, step: 1 }))}>
              Retour
            </button>
            <button type="button" disabled={!allResolved || busy || loading} onClick={goToCheck} className={primary}>
              Contrôler
            </button>
            {data && !allResolved && (
              <span className="text-sm text-gray-500">Résolvez d'abord toutes les correspondances.</span>
            )}
          </div>
        </>
      )}

      {state.step === 3 && resolved && checked && (
        <ControleResults
          resolved={resolved}
          cells={checked.cells}
          categories={categories}
          nameMapped={nameMapped}
          droppedRows={fileData.rows.length - checked.sheet.length}
          generationRef={generationRef}
          ticked={state.ticked}
          onTickedChange={setTicked}
          ownTasks={ownTasks}
          onBack={() => setState((prev) => ({ ...prev, step: 2 }))}
        />
      )}

      {drawerOpen && data && (
        <SavedCorrespondencesDrawer
          saved={data.saved}
          rooms={data.rooms}
          students={data.students}
          busy={busy}
          error={error}
          onChange={changeSaved}
          onDelete={(l) => void deleteSaved(l)}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}
