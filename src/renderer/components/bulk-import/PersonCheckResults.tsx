import React from 'react';
import type { HazuPerson, RowMatch, SheetPerson } from '../../../shared/person-match';

const panel = { border: '1px solid var(--hazu-border)' };

export function sheetLabel(r: SheetPerson): string {
  const name = (r.fullName ?? `${r.firstName ?? ''} ${r.lastName ?? ''}`).trim();
  return name || r.email || '';
}

const REASON: Record<'conflict' | 'ambiguous' | 'near', string> = {
  conflict: "L'e-mail et le nom désignent des personnes différentes",
  ambiguous: 'Plusieurs personnes possibles',
  near: 'Nom proche, sans correspondance exacte',
};

type CheckMatch = Extract<RowMatch, { kind: 'check' }>;

interface CheckProps {
  checks: CheckMatch[];
  sheetByRow: Map<number, SheetPerson>;
  personsById: Map<string, HazuPerson>;
  /** rowIndex → chosen person id, or null when every candidate was rejected. */
  decided: Map<number, string | null>;
  onDecide: (rowIndex: number, personId: string | null) => void;
  onUndo: (rowIndex: number) => void;
}

/** « À vérifier » — doubtful matches the user resolves by hand. */
export function CheckSection({ checks, sheetByRow, personsById, decided, onDecide, onUndo }: CheckProps) {
  if (checks.length === 0) return null;
  const open = checks.filter((c) => !decided.has(c.rowIndex)).length;
  return (
    <section className="bg-white rounded-lg" style={panel}>
      <h4 className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">À vérifier ({open})</h4>
      <ul className="divide-y divide-gray-100">
        {checks.map((c) => {
          const row = sheetByRow.get(c.rowIndex);
          const d = decided.get(c.rowIndex);
          const isDecided = decided.has(c.rowIndex);
          return (
            <li key={c.rowIndex} className={`px-4 py-3 text-sm ${isDecided ? 'bg-gray-50 text-gray-500' : ''}`}>
              <div className="font-medium text-gray-900">
                {row ? sheetLabel(row) : `Ligne ${c.rowIndex + 1}`}
                {row?.email && row.email !== sheetLabel(row) && (
                  <span className="ml-2 font-normal text-gray-500">{row.email}</span>
                )}
              </div>
              <div className="text-xs text-gray-500 mb-2">{REASON[c.reason]}</div>
              {isDecided ? (
                <div className="flex items-center gap-3">
                  <span>
                    {d === null ? 'Aucune de ces personnes' : `Même personne : ${personsById.get(d ?? '')?.displayName ?? d}`}
                  </span>
                  <button className="text-blue-600 hover:underline" onClick={() => onUndo(c.rowIndex)}>
                    Annuler
                  </button>
                </div>
              ) : (
                <ul className="space-y-1">
                  {c.candidateIds.map((id) => {
                    const p = personsById.get(id);
                    return (
                      <li key={id} className="flex items-center gap-3">
                        <span className="flex-1 min-w-0 truncate text-gray-800">
                          {p?.displayName ?? id}
                          {p?.email && <span className="ml-2 text-gray-500">{p.email}</span>}
                        </span>
                        <button
                          className="px-2 py-1 rounded text-xs bg-blue-600 text-white hover:bg-blue-700"
                          onClick={() => onDecide(c.rowIndex, id)}
                        >
                          C'est la même personne
                        </button>
                      </li>
                    );
                  })}
                  <li>
                    <button
                      className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700 hover:bg-gray-200"
                      onClick={() => onDecide(c.rowIndex, null)}
                    >
                      Aucune
                    </button>
                  </li>
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface ClassOption {
  id: string;
  title: string;
}
export interface ClassSelection {
  all: boolean;
  classIds: string[];
  includeNoClass: boolean;
}

interface LeaverProps {
  classes: ClassOption[];
  selection: ClassSelection;
  onSelectionChange: (s: ClassSelection) => void;
  leavers: HazuPerson[];
  counts: { absent: number; inClasses: number };
  roomCountOf: Map<string, number>;
  ticked: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  pending: Set<string>;
  undecided: number;
  canArchive: boolean;
  planning: boolean;
  onArchive: () => void;
  error: string | null;
}

/** « Élèves dans Hazu, absents du fichier » — empty until classes are chosen. */
export function LeaverSection(p: LeaverProps) {
  const { selection: sel } = p;
  const nothingChosen = !sel.all && sel.classIds.length === 0 && !sel.includeNoClass;
  const toggleClass = (id: string) =>
    p.onSelectionChange({
      ...sel,
      classIds: sel.classIds.includes(id) ? sel.classIds.filter((c) => c !== id) : [...sel.classIds, id],
    });
  const selectable = p.leavers.filter((l) => !p.pending.has(l.id));
  const allTicked = selectable.length > 0 && selectable.every((l) => p.ticked.has(l.id));
  const tickedCount = p.leavers.filter((l) => p.ticked.has(l.id)).length;

  return (
    <section className="bg-white rounded-lg" style={panel}>
      <h4 className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">
        Élèves dans Hazu, absents du fichier
      </h4>
      <div className="px-4 py-3 border-b border-gray-100 space-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={sel.all}
            onChange={(e) => p.onSelectionChange({ ...sel, all: e.target.checked })}
          />
          Toutes les classes
        </label>
        <div className={`flex flex-wrap gap-x-4 gap-y-1 max-h-40 overflow-y-auto ${sel.all ? 'opacity-40' : ''}`}>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              disabled={sel.all}
              checked={sel.includeNoClass}
              onChange={(e) => p.onSelectionChange({ ...sel, includeNoClass: e.target.checked })}
            />
            Sans classe
          </label>
          {p.classes.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                disabled={sel.all}
                checked={sel.classIds.includes(c.id)}
                onChange={() => toggleClass(c.id)}
              />
              {c.title}
            </label>
          ))}
        </div>
      </div>

      {nothingChosen ? (
        <p className="px-4 py-3 text-sm text-gray-500">Choisissez une ou plusieurs classes</p>
      ) : (
        <>
          <div className="px-4 py-2 text-sm text-gray-700 border-b border-gray-100">
            {p.counts.absent} élève{p.counts.absent > 1 ? 's' : ''} absent{p.counts.absent > 1 ? 's' : ''} du fichier sur{' '}
            {p.counts.inClasses} dans les classes choisies
            {p.undecided > 0 && (
              <div className="text-xs text-amber-700 mt-1">
                {p.undecided} ligne{p.undecided > 1 ? 's' : ''} encore à vérifier : leurs candidats ne figurent pas dans cette liste.
              </div>
            )}
          </div>
          {p.leavers.length > 0 && (
            <div className="px-4 py-2 flex items-center gap-3 border-b border-gray-100 text-sm">
              <label className="flex items-center gap-2 text-gray-700">
                <input type="checkbox" checked={allTicked} onChange={p.onToggleAll} />
                Tout cocher
              </label>
              {p.canArchive && (
                <button
                  className={`ml-auto px-3 py-1 rounded text-sm ${
                    tickedCount === 0 || p.planning
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-gray-800 text-white hover:bg-gray-900'
                  }`}
                  disabled={tickedCount === 0 || p.planning}
                  onClick={p.onArchive}
                >
                  {p.planning ? '…' : `Archiver la sélection (${tickedCount})`}
                </button>
              )}
            </div>
          )}
          {p.error && <div className="m-4 p-3 rounded bg-red-50 text-red-800 text-sm">{p.error}</div>}
          <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {p.leavers.map((l) => {
              const queued = p.pending.has(l.id);
              return (
                <li key={l.id} className="px-4 py-2 flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    disabled={queued}
                    checked={p.ticked.has(l.id)}
                    onChange={() => p.onToggle(l.id)}
                  />
                  <span className="flex-1 min-w-0 truncate text-gray-900">{l.displayName}</span>
                  <span className="text-gray-500">
                    {queued ? 'En file…' : `${p.roomCountOf.get(l.id) ?? 0} salle${(p.roomCountOf.get(l.id) ?? 0) > 1 ? 's' : ''}`}
                  </span>
                </li>
              );
            })}
            {p.leavers.length === 0 && (
              <li className="px-4 py-3 text-sm text-gray-500">Aucun élève absent du fichier dans ces classes.</li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}
