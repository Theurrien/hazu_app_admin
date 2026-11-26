import React, { useMemo, useState } from 'react';
import { isResolved, resolvedId, type StudentResolution } from '../../../../shared/correspondence';
import type { HazuPerson, SheetPerson } from '../../../../shared/person-match';
import { sheetLabel } from '../PersonCheckResults';
import { searchCandidates } from '../verify-logic';

const panel = { border: '1px solid var(--hazu-border)' };

const NO_CLAIMS = new Set<string>();

const REASON: Record<'conflict' | 'ambiguous' | 'near', string> = {
  conflict: "L'e-mail et le nom désignent des personnes différentes",
  ambiguous: 'Plusieurs élèves possibles',
  near: 'Nom proche, sans correspondance exacte',
};

function statusOf(res: StudentResolution, sessionOnly: boolean): string {
  if (sessionOnly) return res.kind === 'ignored' ? 'ignoré (cette session)' : 'choisi (cette session)';
  switch (res.kind) {
    case 'saved':
      return 'enregistré';
    case 'matched':
      return 'trouvé';
    case 'ignored':
      return 'ignoré';
    case 'stale':
      return 'lien périmé';
    case 'check':
      return 'à vérifier';
    case 'unknown':
      return 'sans correspondance';
  }
}

interface PickerProps {
  students: HazuPerson[];
  /** Proposed persons (« à vérifier »), shown first. */
  candidateIds?: string[];
  studentsById: Map<string, HazuPerson>;
  busy: boolean;
  onPick: (personId: string) => void;
  onIgnore: () => void;
  onCancel?: () => void;
}

/** Candidates, a name search over every student (two letters minimum), and « Ignorer ». */
export function StudentPicker({ students, candidateIds = [], studentsById, busy, onPick, onIgnore, onCancel }: PickerProps) {
  const [query, setQuery] = useState('');
  const found = searchCandidates(students, query, NO_CLAIMS);
  const btn =
    'px-2 py-1 rounded text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed';
  return (
    <div className="mt-2 space-y-2">
      {candidateIds.length > 0 && (
        <ul className="space-y-1">
          {candidateIds.map((id) => {
            const p = studentsById.get(id);
            return (
              <li key={id} className="flex items-center gap-3">
                <span className="flex-1 min-w-0 truncate text-gray-800">
                  {p?.displayName ?? id}
                  {p?.email && <span className="ml-2 text-gray-500">{p.email}</span>}
                </span>
                <button type="button" disabled={busy} className={btn} onClick={() => onPick(id)}>
                  Choisir
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Chercher un élève (2 lettres minimum)"
        className="px-2 py-1 border border-gray-300 rounded w-72 text-sm"
      />
      {found.length > 0 && (
        <ul className="space-y-1">
          {found.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={busy}
                className="text-left text-blue-700 hover:underline disabled:text-gray-400"
                onClick={() => onPick(p.id)}
              >
                {p.displayName}
                {p.email ? ` — ${p.email}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onIgnore}
          className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          Ignorer
        </button>
        {onCancel && (
          <button type="button" className="text-xs text-gray-500 hover:underline" onClick={onCancel}>
            Fermer
          </button>
        )}
      </div>
    </div>
  );
}

interface PanelProps {
  sheet: SheetPerson[];
  resolutions: Map<number, { res: StudentResolution; saveKey: string | null }>;
  /** Rows decided in memory for this session only. */
  sessionOnly: Set<number>;
  students: HazuPerson[];
  open: number;
  busy: boolean;
  /** personId null = ignored. */
  onDecide: (row: SheetPerson, saveKey: string | null, personId: string | null) => void;
}

/** The file's rows to Hazu students: open rows listed, resolved rows behind a toggle. */
export function StudentCorrespondencePanel({ sheet, resolutions, sessionOnly, students, open, busy, onDecide }: PanelProps) {
  const [showResolved, setShowResolved] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const studentsById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const rows = useMemo(
    () =>
      sheet
        .map((row) => ({ row, r: resolutions.get(row.rowIndex) }))
        .filter((x): x is { row: SheetPerson; r: { res: StudentResolution; saveKey: string | null } } => !!x.r)
        .sort((a, b) => sheetLabel(a.row).localeCompare(sheetLabel(b.row), 'fr')),
    [sheet, resolutions],
  );
  const openRows = rows.filter((x) => !isResolved(x.r.res));
  const resolvedRows = rows.filter((x) => isResolved(x.r.res));

  const decide = (row: SheetPerson, saveKey: string | null, personId: string | null) => {
    setEditing(null);
    onDecide(row, saveKey, personId);
  };

  const item = ({ row, r }: (typeof rows)[number]) => {
    const resolved = isResolved(r.res);
    const id = resolvedId(r.res);
    const person = id ? studentsById.get(id) : undefined;
    const label = sheetLabel(row);
    return (
      <li key={row.rowIndex} className={`px-4 py-3 text-sm ${resolved && editing !== row.rowIndex ? 'text-gray-600' : ''}`}>
        <div className="flex items-center gap-3">
          <span className="font-medium text-gray-900">
            {label || `Ligne ${row.rowIndex + 1}`}
            {row.email && row.email !== label && <span className="ml-2 font-normal text-gray-500">{row.email}</span>}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-xs ${resolved ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-800'}`}
          >
            {statusOf(r.res, sessionOnly.has(row.rowIndex))}
          </span>
          {person && <span className="text-gray-700">→ {person.displayName}</span>}
          {resolved && editing !== row.rowIndex && (
            <button
              type="button"
              className="ml-auto text-xs text-blue-600 hover:underline"
              onClick={() => setEditing(row.rowIndex)}
            >
              Modifier
            </button>
          )}
        </div>
        {r.res.kind === 'check' && <div className="text-xs text-gray-500">{REASON[r.res.reason]}</div>}
        {r.saveKey === null && (!resolved || editing === row.rowIndex) && (
          <div className="text-xs text-gray-500">
            Plusieurs lignes du fichier portent ce nom : la décision vaut pour cette session seulement.
          </div>
        )}
        {(!resolved || editing === row.rowIndex) && (
          <StudentPicker
            students={students}
            candidateIds={r.res.kind === 'check' ? r.res.candidateIds : []}
            studentsById={studentsById}
            busy={busy}
            onPick={(personId) => decide(row, r.saveKey, personId)}
            onIgnore={() => decide(row, r.saveKey, null)}
            onCancel={resolved ? () => setEditing(null) : undefined}
          />
        )}
      </li>
    );
  };

  return (
    <section className="bg-white rounded-lg" style={panel}>
      <h4 className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">Élèves — {open} à résoudre</h4>
      {openRows.length > 0 && <ul className="divide-y divide-gray-100 max-h-[32rem] overflow-y-auto">{openRows.map(item)}</ul>}
      {resolvedRows.length > 0 && (
        <div className="border-t border-gray-100">
          <button
            type="button"
            className="px-4 py-2 text-xs text-blue-600 hover:underline"
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? 'Masquer' : 'Afficher'} les élèves résolus ({resolvedRows.length})
          </button>
          {showResolved && <ul className="divide-y divide-gray-100 max-h-[32rem] overflow-y-auto">{resolvedRows.map(item)}</ul>}
        </div>
      )}
      {rows.length === 0 && <p className="px-4 py-3 text-sm text-gray-500">Aucune ligne avec un e-mail ou un nom.</p>}
    </section>
  );
}
