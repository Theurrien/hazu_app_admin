import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { PersonType, RoomType } from '../../../shared/types';
import type { PersonArchivePlan } from '../../../shared/archive-types';
import {
  matchRows,
  resolvedPersonByRow,
  findLeavers,
  type CheckDecision,
  type ClassFilter,
  type HazuPerson,
  type SheetPerson,
} from '../../../shared/person-match';
import { useAppMode } from '../../contexts/AppModeContext';
import { useTaskQueue } from '../../contexts/TaskQueueContext';
import { PersonArchiveConfirmModal } from '../archive/PersonArchiveConfirmModal';
import { CheckSection, LeaverSection, UnknownSection, sheetLabel, type ClassSelection } from './PersonCheckResults';
import {
  buildClassIdsOf,
  canRunAssignmentDiff,
  canRunPersonCheck,
  canShowLeavers,
  droppedRowCount,
  leaverCounts,
  sheetPersons,
  type VerifyColumns,
} from './verify-logic';
import type { ColumnMapping } from './ColumnMappingDropdown';
import { DataPreviewTable } from './DataPreviewTable';
import { VerificationResults, DiscrepancyItem } from './VerificationResults';
import { buildRoomMapping, MatchingMode } from '../../utils/fuzzyMatch';

interface FileData {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
}

interface VerifyAssignmentsTabProps {
  fileData: FileData | null;
}

const personTypeLabels: Record<PersonType, string> = {
  student: 'Student',
  companymentor: 'Company Mentor',
  schoolteacher: 'School Teacher',
  courseteacher: 'Course Teacher',
  stateadvisor: 'State Advisor',
  guardian: 'Guardian',
};

const roomTypeLabels: Record<RoomType, string> = {
  state: 'Canton/State',
  class: 'Class',
  enterprise: 'Enterprise',
  cie: 'CIE Location',
};

interface VerificationResult {
  missingInHazu: DiscrepancyItem[];
  extraInHazu: DiscrepancyItem[];
  unmatchedRooms: string[];
  unknownPersons: string[];
}

/** What the last « Verify » read from the database, plus the sheet it was run against. */
interface Snapshot {
  personType: PersonType;
  sheet: SheetPerson[];
  persons: any[];
  rooms: any[];
  classRooms: any[];
  assignments: Array<{ person_id: string; room_id: string; role: string }>;
  roomNameByRow: Map<number, string>;
  roomMapping: Map<string, string | null>;
  withDiff: boolean;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function VerifyAssignmentsTab({ fileData }: VerifyAssignmentsTabProps) {
  const { mode } = useAppMode();
  const { tasks, addArchivePersonTask } = useTaskQueue();

  // Selection state
  const [selectedPersonType, setSelectedPersonType] = useState<PersonType | null>(null);
  const [selectedRoomType, setSelectedRoomType] = useState<RoomType | null>(null);
  const [matchingMode, setMatchingMode] = useState<MatchingMode>('normal');

  // Column mapping state
  const [columnMappings, setColumnMappings] = useState<Record<string, ColumnMapping>>({});

  // Verification state
  const [isVerifying, setIsVerifying] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [decisions, setDecisions] = useState<CheckDecision[]>([]);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Leavers state
  const [classSel, setClassSel] = useState<ClassSelection>({ all: false, classIds: [], includeNoClass: false });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [plans, setPlans] = useState<PersonArchivePlan[]>([]);
  const [planning, setPlanning] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const enqueuedRef = useRef(false);
  const planningRef = useRef(false);
  const runRef = useRef(0);

  // A new (or cleared) file invalidates everything derived from the old one.
  useEffect(() => {
    runRef.current += 1;
    setColumnMappings({});
    setSnapshot(null);
    setDecisions([]);
    setTicked(new Set());
    setVerifyError(null);
    setClassSel({ all: false, classIds: [], includeNoClass: false });
    setPlans([]);
    setPlanning(false);
    setArchiveError(null);
    setIsVerifying(false);
    enqueuedRef.current = false;
    planningRef.current = false;
  }, [fileData]);

  const colOf = useCallback(
    (m: ColumnMapping) => Object.entries(columnMappings).find(([, v]) => v === m)?.[0] || null,
    [columnMappings]
  );
  const columns: VerifyColumns = useMemo(
    () => ({
      email: colOf('verifyEmail'),
      firstName: colOf('verifyFirstName'),
      lastName: colOf('verifyLastName'),
      fullName: colOf('verifyFullName'),
      room: colOf('verifyRoomName'),
    }),
    [colOf]
  );

  // A mapping, person-type or matching-mode change invalidates every result in flight: bumping the
  // generation discards a verify result, an archive plan or a reload that lands afterwards. Their
  // busy flags are reset here, because a discarded run no longer resets them itself — otherwise
  // « Vérifier » or « Archiver la sélection » would stay disabled.
  const clearResults = useCallback(() => {
    runRef.current += 1;
    setSnapshot(null);
    setDecisions([]);
    setTicked(new Set());
    setVerifyError(null);
    setPlans([]);
    setPlanning(false);
    planningRef.current = false;
    setIsVerifying(false);
  }, []);

  // Handle column mapping change
  const handleColumnMappingChange = useCallback((header: string, mapping: ColumnMapping | null) => {
    setColumnMappings(prev => {
      const newMappings = { ...prev };
      if (mapping === null) {
        delete newMappings[header];
      } else {
        // Remove existing mapping of same type
        for (const [key, value] of Object.entries(newMappings)) {
          if (value === mapping) {
            delete newMappings[key];
          }
        }
        newMappings[header] = mapping;
      }
      return newMappings;
    });
    // Clear results when mapping changes
    clearResults();
  }, [clearResults]);

  // Ready to verify: a person type and a way to identify people; room + room type only for the diff
  const canVerify = !!(fileData && selectedPersonType && canRunPersonCheck(columns));
  const diffWanted = canRunAssignmentDiff(columns);
  const diffNeedsRoomType = diffWanted && !selectedRoomType;

  const fetchSnapshot = useCallback(
    async (sheet: SheetPerson[], personType: PersonType, roomType: RoomType | null, withRooms: boolean): Promise<Snapshot> => {
      const [persons, rooms, classRooms, assignments] = await Promise.all([
        window.electronAPI.getPersons(personType),
        withRooms && roomType ? window.electronAPI.getRooms(roomType) : Promise.resolve([]),
        personType === 'student' ? window.electronAPI.getRooms('class') : Promise.resolve([]),
        window.electronAPI.getAllAssignments(),
      ]);

      const roomNameByRow = new Map<number, string>();
      const roomMapping = new Map<string, string | null>();
      if (withRooms && columns.room && fileData) {
        const excelRoomNames = new Set<string>();
        for (const r of sheet) {
          const roomName = fileData.rows[r.rowIndex]?.[columns.room]?.trim();
          if (roomName) {
            roomNameByRow.set(r.rowIndex, roomName);
            excelRoomNames.add(roomName);
          }
        }
        const mapping = buildRoomMapping(Array.from(excelRoomNames), rooms.map((r: any) => r.title), matchingMode);
        mapping.forEach((v, k) => roomMapping.set(k, v || null));
      }
      return { personType, sheet, persons, rooms, classRooms, assignments, roomNameByRow, roomMapping, withDiff: withRooms };
    },
    [columns.room, fileData, matchingMode]
  );

  // Run verification
  const handleVerify = useCallback(async () => {
    if (!canVerify || !fileData || !selectedPersonType) return;
    if (diffNeedsRoomType) return;

    clearResults(); // bumps the generation: capture it afterwards
    const run = runRef.current;
    setIsVerifying(true);

    try {
      const sheet = sheetPersons(fileData.rows, columns);
      const snap = await fetchSnapshot(sheet, selectedPersonType, selectedRoomType, diffWanted);
      if (run === runRef.current) setSnapshot(snap);
    } catch (error) {
      console.error('Verification error:', error);
      if (run === runRef.current) setVerifyError(errMsg(error));
    } finally {
      if (run === runRef.current) setIsVerifying(false);
    }
  }, [canVerify, fileData, selectedPersonType, selectedRoomType, diffWanted, diffNeedsRoomType, columns, fetchSnapshot, clearResults]);

  // ---- Derived state: everything re-derives from the snapshot and the decisions, no re-read ----
  const hazuPersons: HazuPerson[] = useMemo(
    () => (snapshot?.persons ?? []).map((p: any) => ({ id: p.id, email: p.email ?? null, displayName: p.display_name })),
    [snapshot]
  );
  const personsById = useMemo(() => new Map(hazuPersons.map(p => [p.id, p])), [hazuPersons]);
  const matches = useMemo(() => (snapshot ? matchRows(snapshot.sheet, hazuPersons) : []), [snapshot, hazuPersons]);
  const sheetByRow = useMemo(() => new Map((snapshot?.sheet ?? []).map(r => [r.rowIndex, r])), [snapshot]);
  const checks = useMemo(() => matches.filter((m): m is Extract<typeof m, { kind: 'check' }> => m.kind === 'check'), [matches]);
  const decidedMap = useMemo(() => new Map(decisions.map(d => [d.rowIndex, d.personId])), [decisions]);
  const unknowns = useMemo(() => matches.filter((m): m is Extract<typeof m, { kind: 'unknown' }> => m.kind === 'unknown'), [matches]);
  const claimed = useMemo(() => new Set(resolvedPersonByRow(matches, decisions).values()), [matches, decisions]);
  const unattachedUnknown = unknowns.filter(m => !decidedMap.get(m.rowIndex)).length;
  const nameMapped = canShowLeavers(columns);
  const droppedRows = fileData ? droppedRowCount(fileData.rows, columns) : 0;
  const undecided = checks.filter(c => !decidedMap.has(c.rowIndex)).length;

  const verificationResult: VerificationResult | null = useMemo(() => {
    if (!snapshot) return null;
    const resolved = resolvedPersonByRow(matches, decisions);

    const unknownPersons: string[] = [];
    for (const m of matches) {
      if (m.kind !== 'unknown') continue;
      const row = sheetByRow.get(m.rowIndex);
      const label = row ? sheetLabel(row) : '';
      if (label && !unknownPersons.includes(label)) unknownPersons.push(label);
    }

    if (!snapshot.withDiff) {
      return { missingInHazu: [], extraInHazu: [], unmatchedRooms: [], unknownPersons };
    }

    const unmatchedRooms: string[] = [];
    snapshot.roomMapping.forEach((hazu, excel) => { if (!hazu) unmatchedRooms.push(excel); });

    const roomsById = new Map<string, string>(snapshot.rooms.map((r: any) => [r.id, r.title]));
    const personIds = new Set(snapshot.persons.map((p: any) => p.id));

    // Hazu side, keyed by person id
    const hazuPairs = new Set<string>();
    const hazuPairDetails = new Map<string, DiscrepancyItem & { personId: string }>();
    for (const a of snapshot.assignments) {
      const roomName = roomsById.get(a.room_id);
      if (!personIds.has(a.person_id) || !roomName) continue;
      const person = personsById.get(a.person_id);
      const key = `${a.person_id}|${roomName}`;
      hazuPairs.add(key);
      hazuPairDetails.set(key, { personId: a.person_id, email: person?.email ?? '', roomName, personName: person?.displayName });
    }

    // Sheet side: only rows resolved to a person (unknown or undecided rows stay out)
    const excelPairs = new Set<string>();
    const missingInHazu: DiscrepancyItem[] = [];
    resolved.forEach((personId, rowIndex) => {
      const excelRoom = snapshot.roomNameByRow.get(rowIndex);
      if (!excelRoom) return;
      const hazuRoom = snapshot.roomMapping.get(excelRoom);
      if (!hazuRoom) return;
      const key = `${personId}|${hazuRoom}`;
      excelPairs.add(key);
      if (!hazuPairs.has(key)) {
        const p = personsById.get(personId);
        missingInHazu.push({ email: p?.email ?? '', roomName: excelRoom, personName: p?.displayName });
      }
    });

    // A person who may be the one of an undecided row is never reported as « extra ».
    const doubtful = new Set<string>();
    for (const c of checks) if (!decidedMap.has(c.rowIndex)) c.candidateIds.forEach(id => doubtful.add(id));
    const extraInHazu: DiscrepancyItem[] = [];
    hazuPairDetails.forEach((d, key) => {
      if (!excelPairs.has(key) && !doubtful.has(d.personId)) {
        extraInHazu.push({ email: d.email, roomName: d.roomName, personName: d.personName });
      }
    });

    const dedupe = (items: DiscrepancyItem[]) => {
      const seen = new Set<string>();
      return items.filter(item => {
        const k = `${item.personName}|${item.email}|${item.roomName}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };
    return { missingInHazu: dedupe(missingInHazu), extraInHazu: dedupe(extraInHazu), unmatchedRooms, unknownPersons };
  }, [snapshot, matches, decisions, sheetByRow, personsById, checks, decidedMap]);

  // ---- Leavers ----
  const showLeavers = !!snapshot && snapshot.personType === 'student';
  const leaversActive = showLeavers && nameMapped;
  const classIdsOf = useMemo(
    () => buildClassIdsOf(snapshot?.assignments ?? [], snapshot?.classRooms ?? []),
    [snapshot]
  );
  const classOptions = useMemo(
    () =>
      (snapshot?.classRooms ?? [])
        .map((r: any) => ({ id: r.id as string, title: r.title as string }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [snapshot]
  );
  const roomCountOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of snapshot?.assignments ?? []) m.set(a.person_id, (m.get(a.person_id) ?? 0) + 1);
    return m;
  }, [snapshot]);
  const filter: ClassFilter | null = useMemo(() => {
    if (classSel.all) return { all: true };
    if (classSel.classIds.length === 0 && !classSel.includeNoClass) return null;
    return { all: false, classIds: classSel.classIds, includeNoClass: classSel.includeNoClass };
  }, [classSel]);
  const leavers = useMemo(
    () => (leaversActive ? findLeavers(hazuPersons, matches, decisions, classIdsOf, filter) : []),
    [leaversActive, hazuPersons, matches, decisions, classIdsOf, filter]
  );
  const counts = useMemo(
    () => (leaversActive ? leaverCounts(hazuPersons, matches, decisions, classIdsOf, filter) : { absent: 0, inClasses: 0 }),
    [leaversActive, hazuPersons, matches, decisions, classIdsOf, filter]
  );

  const pending = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) {
      if ((t.status === 'queued' || t.status === 'processing') && t.type === 'archivePerson') ids.add(t.personId);
    }
    return ids;
  }, [tasks]);

  const decide = useCallback((rowIndex: number, personId: string | null) => {
    setDecisions(prev => [...prev.filter(d => d.rowIndex !== rowIndex), { rowIndex, personId }]);
  }, []);
  const undo = useCallback((rowIndex: number) => {
    setDecisions(prev => prev.filter(d => d.rowIndex !== rowIndex));
  }, []);

  const toggleTick = (id: string) =>
    setTicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllTicks = () => {
    const selectable = leavers.filter(l => !pending.has(l.id));
    setTicked(prev =>
      selectable.length > 0 && selectable.every(l => prev.has(l.id)) ? new Set() : new Set(selectable.map(l => l.id))
    );
  };

  const askArchive = async () => {
    if (planningRef.current) return;
    // Only ticked students that are still on the list and not already queued.
    const ids = leavers.filter(l => ticked.has(l.id) && !pending.has(l.id)).map(l => l.id);
    if (ids.length === 0) return;
    const run = runRef.current;
    planningRef.current = true;
    setPlanning(true);
    setArchiveError(null);
    try {
      const planned = await Promise.all(ids.map(id => window.electronAPI.planPersonArchive(id)));
      if (run !== runRef.current) return;
      enqueuedRef.current = false;
      setPlans(planned);
    } catch (e) {
      if (run === runRef.current) setArchiveError(errMsg(e));
    } finally {
      if (run === runRef.current) {
        planningRef.current = false;
        setPlanning(false);
      }
    }
  };

  const confirmArchive = () => {
    if (enqueuedRef.current) return; // a double click must not enqueue twice
    enqueuedRef.current = true;
    plans.forEach(p => {
      if (!pending.has(p.personId)) {
        addArchivePersonTask({ personId: p.personId, displayName: p.displayName, roomCount: p.rooms.length });
      }
    });
    setPlans([]);
    setTicked(new Set());
  };

  // When the Task Queue drains after archiving, reload persons and assignments and recompute.
  const handled = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (handled.current === null) {
      handled.current = new Set(tasks.filter(t => t.status === 'success').map(t => t.id));
    }
    const seen = handled.current;
    tasks.forEach(t => {
      if (t.status === 'queued' || t.status === 'processing') seen.delete(t.id);
    });
    if (tasks.some(t => t.status === 'queued' || t.status === 'processing')) return;
    const fresh = tasks.filter(t => t.status === 'success' && t.type === 'archivePerson' && !seen.has(t.id));
    if (fresh.length === 0) return;
    fresh.forEach(t => seen.add(t.id));
    if (!snapshot) return;
    const run = runRef.current;
    void fetchSnapshot(snapshot.sheet, snapshot.personType, selectedRoomType, snapshot.withDiff)
      .then(snap => { if (run === runRef.current) setSnapshot(snap); })
      .catch(e => { if (run === runRef.current) setArchiveError(errMsg(e)); });
  }, [tasks, snapshot, fetchSnapshot, selectedRoomType]);

  if (!fileData) {
    return (
      <div className="text-center py-12 text-gray-500">
        Please upload a file first using the file uploader above.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Data preview */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">Data Preview</h3>
        <DataPreviewTable
          headers={fileData.headers}
          rows={fileData.rows}
          columnMappings={columnMappings}
          onColumnMappingChange={handleColumnMappingChange}
          mode="verify"
        />
      </div>

      {/* Relationship Selection */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">Relationship to Verify</h3>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Person Type</label>
            <select
              value={selectedPersonType || ''}
              onChange={(e) => {
                setSelectedPersonType(e.target.value as PersonType || null);
                clearResults();
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select person type...</option>
              {(Object.keys(personTypeLabels) as PersonType[]).map(type => (
                <option key={type} value={type}>{personTypeLabels[type]}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Room Type</label>
            <select
              value={selectedRoomType || ''}
              onChange={(e) => {
                setSelectedRoomType(e.target.value as RoomType || null);
                clearResults();
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">No room type</option>
              {(Object.keys(roomTypeLabels) as RoomType[]).map(type => (
                <option key={type} value={type}>{roomTypeLabels[type]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Matching Mode */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">Room Name Matching</h3>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="matchingMode"
              checked={matchingMode === 'strict'}
              onChange={() => {
                setMatchingMode('strict');
                clearResults();
              }}
              className="w-4 h-4 text-blue-600"
            />
            <span className="text-sm text-gray-700">Strict</span>
            <span className="text-xs text-gray-400">(exact match)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="matchingMode"
              checked={matchingMode === 'normal'}
              onChange={() => {
                setMatchingMode('normal');
                clearResults();
              }}
              className="w-4 h-4 text-blue-600"
            />
            <span className="text-sm text-gray-700">Normal</span>
            <span className="text-xs text-gray-400">(minor typos)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="matchingMode"
              checked={matchingMode === 'loose'}
              onChange={() => {
                setMatchingMode('loose');
                clearResults();
              }}
              className="w-4 h-4 text-blue-600"
            />
            <span className="text-sm text-gray-700">Loose</span>
            <span className="text-xs text-gray-400">(abbreviations)</span>
          </label>
        </div>
      </div>

      {/* Verify Button */}
      <div>
        <button
          onClick={handleVerify}
          disabled={!canVerify || isVerifying}
          className={`px-6 py-2 rounded-lg transition-colors ${
            canVerify && !isVerifying
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {isVerifying ? 'Verifying...' : 'Verify Assignments'}
        </button>
        {(!canVerify || diffNeedsRoomType) && (
          <p className="text-sm text-gray-500 mt-2">
            {!canRunPersonCheck(columns) && 'Map an email column, a full name column, or first and last name columns. '}
            {!selectedPersonType && 'Select person type. '}
            {diffNeedsRoomType && 'Select a room type to compare the room column.'}
          </p>
        )}
      </div>

      {verifyError && <div className="p-4 rounded-lg bg-red-50 text-red-800 text-sm">{verifyError}</div>}

      {/* Results */}
      {snapshot && (
        <div className="space-y-4">
          <CheckSection
            checks={checks}
            sheetByRow={sheetByRow}
            personsById={personsById}
            decided={decidedMap}
            onDecide={decide}
            onUndo={undo}
          />
          <UnknownSection
            unknowns={unknowns}
            sheetByRow={sheetByRow}
            persons={hazuPersons}
            personsById={personsById}
            claimed={claimed}
            attached={decidedMap}
            onAttach={decide}
            onUndo={undo}
          />
          {(verificationResult || isVerifying) && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Verification Results</h3>
              <VerificationResults
                missingInHazu={verificationResult?.missingInHazu || []}
                extraInHazu={verificationResult?.extraInHazu || []}
                unmatchedRooms={verificationResult?.unmatchedRooms || []}
                unknownPersons={[]}
                assignmentsChecked={snapshot.withDiff}
                isLoading={isVerifying}
              />
            </div>
          )}
          {showLeavers && (
            <LeaverSection
              classes={classOptions}
              selection={classSel}
              onSelectionChange={setClassSel}
              leavers={leavers}
              counts={counts}
              roomCountOf={roomCountOf}
              ticked={ticked}
              onToggle={toggleTick}
              onToggleAll={toggleAllTicks}
              pending={pending}
              undecided={undecided}
              nameMapped={nameMapped}
              droppedRows={droppedRows}
              unattachedUnknown={unattachedUnknown}
              canArchive={mode === 'complete'}
              planning={planning}
              onArchive={askArchive}
              error={archiveError}
            />
          )}
        </div>
      )}

      <PersonArchiveConfirmModal plans={plans} onCancel={() => setPlans([])} onConfirm={confirmArchive} />
    </div>
  );
}
