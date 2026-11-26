import React from 'react';
import type { ProfileOnlyItem } from '../../../shared/level-change-types';
import { descendantsLabel } from './level-change-logic';

interface Props {
  /** the sections about to be marked for deletion; null = closed */
  items: ProfileOnlyItem[] | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation before a profile-only section is ticked for deletion (Annuler unticks). */
export function DeleteSectionsConfirmModal({ items, onConfirm, onCancel }: Props) {
  if (!items) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Supprimer du profil ?</h2>
        </div>
        <div className="p-6 space-y-4">
          <ul className="text-sm text-gray-700 border border-gray-200 rounded divide-y divide-gray-100">
            {items.map((i) => (
              <li key={i.sectionId} className="px-3 py-2 flex justify-between gap-3">
                <span>{i.title}</span>
                <span className="text-gray-500">{descendantsLabel(i.descendants, i.descendantsExact)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm font-medium text-red-700">irréversible — tout le contenu est supprimé</p>
        </div>
        <div className="flex justify-end gap-2 p-6 border-t border-gray-200">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm border border-gray-300">
            Annuler
          </button>
          <button type="button" onClick={onConfirm} className="px-4 py-2 rounded-lg text-sm text-white bg-red-600">
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}
