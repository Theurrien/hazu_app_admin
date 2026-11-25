import React from 'react';
import type { RestorePlan } from '../../../shared/archive-types';
import { plainTitle } from './archive-logic';

interface Props {
  plan: RestorePlan | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function RestoreConfirmModal({ plan, onConfirm, onClose }: Props) {
  if (!plan) return null;
  const canRestore = plan.fromParentExists;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[85vh] flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Restaurer cette salle ?</h2>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto text-sm text-gray-700 leading-relaxed">
          <p><strong>{plainTitle(plan.title)}</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Catégorie d'origine :{' '}
              {canRestore
                ? <strong>{plan.fromParentTitle ? plainTitle(plan.fromParentTitle) : '—'}</strong>
                : <strong className="text-red-700">catégorie d'origine introuvable</strong>}
            </li>
            <li><strong>{plan.groupCount}</strong> groupe{plan.groupCount === 1 ? '' : 's'} remis dans le conteneur de partage</li>
            <li>Les membres retrouvent l'étiquette de la salle.</li>
          </ul>
        </div>
        <div className="flex justify-end gap-2 p-6 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded">Annuler</button>
          <button
            onClick={onConfirm}
            disabled={!canRestore}
            className={`px-4 py-2 text-sm rounded ${canRestore ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
          >
            Restaurer
          </button>
        </div>
      </div>
    </div>
  );
}
