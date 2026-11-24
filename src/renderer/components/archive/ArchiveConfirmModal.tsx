import React from 'react';
import type { ArchivePlan } from '../../../shared/archive-types';
import { TYPE_LABEL, plainTitle } from './archive-logic';

interface Props {
  plan: ArchivePlan | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function ArchiveConfirmModal({ plan, onConfirm, onClose }: Props) {
  if (!plan) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[85vh] flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Archiver cette salle ?</h2>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto text-sm text-gray-700 leading-relaxed">
          <p>
            <strong>{plainTitle(plan.title)}</strong> — {TYPE_LABEL[plan.roomType]}
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>{plan.groupCount}</strong> groupe{plan.groupCount === 1 ? '' : 's'} déplacé{plan.groupCount === 1 ? '' : 's'}</li>
            <li><strong>{plan.holderCount}</strong> profil{plan.holderCount === 1 ? '' : 's'} perdant l'étiquette de la salle</li>
            <li><strong>{plan.memberCount}</strong> membre{plan.memberCount === 1 ? '' : 's'}</li>
          </ul>
          <p>
            Les accès ne changent pas : les membres peuvent toujours ouvrir la salle par son lien.
          </p>
          {plan.warnsDashboards && (
            <p className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900">
              Les tableaux de bord des apprentis et mentors ne listeront plus cette salle.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 p-6 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded">Annuler</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700">Archiver</button>
        </div>
      </div>
    </div>
  );
}
