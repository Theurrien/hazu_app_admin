import React from 'react';
import type { PairLine } from '../../../../shared/cross-check';
import type { RoomCategory } from '../../../../shared/correspondence';
import { confirmSummary } from './controle-logic';

const TYPE_LABEL: Record<RoomCategory, string> = { class: 'classe', enterprise: 'entreprise', state: 'canton' };

interface FixConfirmModalProps {
  /** The ticked lines; null = closed. */
  lines: PairLine[] | null;
  nameOf: (personId: string) => string;
  roomTitleOf: (roomId: string) => string;
  onCancel: () => void;
  onConfirm: () => void;
}

/** One confirmation for « Corriger la sélection »: counts, the removals by name, the company warning, S4's slowness. */
export function FixConfirmModal({ lines, nameOf, roomTitleOf, onCancel, onConfirm }: FixConfirmModalProps) {
  if (lines === null) return null;
  const { adds, removals, companyRemovals } = confirmSummary(lines);
  const total = adds + removals.length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[85vh] flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Corriger la sélection ?</h2>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto text-sm text-gray-700 leading-relaxed">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>{adds}</strong> ajout{adds === 1 ? '' : 's'} comme élève
            </li>
            <li>
              <strong>{removals.length}</strong> retrait{removals.length === 1 ? '' : 's'}
            </li>
          </ul>
          {removals.length > 0 && (
            <>
              <p>Retirés de :</p>
              <ul className="list-disc pl-5 space-y-1 max-h-48 overflow-y-auto">
                {removals.map((l) => (
                  <li key={l.key}>
                    {nameOf(l.personId)} — {l.roomId ? roomTitleOf(l.roomId) : '?'}{' '}
                    <span className="text-gray-500">({TYPE_LABEL[l.category]})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {companyRemovals > 0 && (
            <p className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900">
              {companyRemovals === 1 ? 'Un retrait concerne une entreprise' : `${companyRemovals} retraits concernent une entreprise`} :
              5-Enterprise ne trouvera plus l'entreprise de l'élève.
            </p>
          )}
          <p className="text-gray-500">
            Chaque modification passe par la file des tâches, l'une après l'autre : environ 22 s par modification
            {total > 1 ? ` (${total} au total)` : ''}.
          </p>
        </div>
        <div className="flex justify-end gap-2 p-6 border-t border-gray-200">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded">
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={total === 0}
            className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Corriger ({total})
          </button>
        </div>
      </div>
    </div>
  );
}
