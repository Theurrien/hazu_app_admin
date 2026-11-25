import React from 'react';
import type { PersonArchivePlan } from '../../../shared/archive-types';
import { PERSON_TYPE_LABEL, formatArchivedAt, plainTitle } from './archive-logic';

interface Props {
  plans: PersonArchivePlan[];
  onConfirm: () => void;
  onCancel: () => void;
}

const LONG_RUN_ROOMS = 20;

/** Confirmation for archiving one person, or several at once. Displays only; the caller enqueues. */
export function PersonArchiveConfirmModal({ plans, onConfirm, onCancel }: Props) {
  if (plans.length === 0) return null;
  const single = plans.length === 1 ? plans[0] : null;
  const totalRooms = plans.reduce((n, p) => n + p.rooms.length, 0);
  const stale = plans.filter((p) => p.syncStale);
  // A sync running or never finished leaves the room list partial: the archive would be refused.
  const incomplete = plans.some((p) => p.syncIncomplete);
  // Every plan of one batch shares the same last sync; take the oldest known.
  const syncDates = plans.map((p) => p.lastSyncAt).filter((t): t is number => t !== null);
  const lastSync = syncDates.length > 0 ? Math.min(...syncDates) : null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[85vh] flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {single ? 'Archiver cette personne ?' : `Archiver ${plans.length} personnes ?`}
          </h2>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto text-sm text-gray-700 leading-relaxed">
          {single ? (
            <>
              <p>
                <strong>{single.displayName}</strong> — {PERSON_TYPE_LABEL[single.personType] ?? single.personType}
              </p>
              {single.rooms.length === 0 ? (
                <p>Cette personne n'est dans aucune salle.</p>
              ) : (
                <>
                  <p>
                    Elle quitte {single.rooms.length === 1 ? 'la salle suivante' : `les ${single.rooms.length} salles suivantes`} :
                  </p>
                  <ul className="list-disc pl-5 space-y-1 max-h-48 overflow-y-auto">
                    {single.rooms.map((r) => (
                      <li key={r.roomId}>{plainTitle(r.title)} <span className="text-gray-500">({r.role})</span></li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>{plans.length}</strong> personnes</li>
              <li><strong>{totalRooms}</strong> retrait{totalRooms === 1 ? '' : 's'} de salle au total</li>
            </ul>
          )}
          <p>
            Le profil est déplacé dans le dossier d'archive. Restaurer une personne ne la remet pas dans ses salles :
            les salles ne sont pas restaurées.
          </p>
          {incomplete && (
            <p className="p-3 rounded bg-red-50 border border-red-200 text-red-900">
              Synchronisation incomplète : une synchronisation est en cours, ou la dernière n'a pas abouti.
              La liste des salles est partielle. Synchronisez d'abord, puis archivez.
            </p>
          )}
          {!incomplete && stale.length > 0 && (
            <p className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900">
              La dernière synchronisation date de plus de 24 h
              {lastSync !== null ? ` (${formatArchivedAt(lastSync)})` : ' ou n\'a jamais eu lieu'} : la liste des salles
              peut être incomplète. Synchronisez avant d'archiver si possible.
            </p>
          )}
          {totalRooms > LONG_RUN_ROOMS && (
            <p className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900">
              {totalRooms} retraits de salle : cela peut prendre longtemps.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 p-6 border-t border-gray-200">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded">Annuler</button>
          <button
            onClick={onConfirm}
            disabled={incomplete}
            className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Archiver
          </button>
        </div>
      </div>
    </div>
  );
}
