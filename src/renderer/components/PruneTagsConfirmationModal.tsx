import React from 'react';

interface SkippedId {
  classId: string;
  verdict: 'alive' | 'unreadable';
  reason: string;
  title: string | null;
  parentId: string | null;
  tagCount: number;
}

interface PruneTagsConfirmationModalProps {
  isOpen: boolean;
  tagCount: number;
  personCount: number;
  roomCount: number;
  rooms: Array<{ classId: string; tagCount: number }>;
  skipped: SkippedId[];
  onConfirm: () => void;
  onClose: () => void;
}

const VERDICT_LABEL: Record<SkippedId['verdict'], string> = {
  alive: 'Still exists',
  unreadable: 'Could not read',
};

export function PruneTagsConfirmationModal({
  isOpen,
  tagCount,
  personCount,
  roomCount,
  rooms,
  skipped,
  onConfirm,
  onClose,
}: PruneTagsConfirmationModalProps) {
  if (!isOpen) return null;

  const nothingToDelete = tagCount === 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Delete tags for missing rooms?</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {nothingToDelete ? (
            <p className="text-sm text-gray-700">
              Nothing to delete. No unmatched class id came back as deleted from Hazu.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-700 leading-relaxed">
                This permanently deletes <strong>{tagCount}</strong> breadcrumb tag
                {tagCount === 1 ? '' : 's'} from <strong>{personCount}</strong> profile
                {personCount === 1 ? '' : 's'}, across <strong>{roomCount}</strong> room
                {roomCount === 1 ? '' : 's'} that Hazu returned <strong>404</strong> for.
                This cannot be undone.
              </p>

              <ul className="text-sm text-gray-700 border border-gray-200 rounded divide-y divide-gray-100">
                {rooms.map((r) => (
                  <li key={r.classId} className="px-3 py-2 flex justify-between gap-3">
                    <span className="font-mono text-xs text-gray-600 truncate">{r.classId}</span>
                    <span className="text-gray-500 whitespace-nowrap">
                      {r.tagCount} tag{r.tagCount === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="text-sm text-gray-500">
                Each id is checked against Hazu again at the moment of deletion. Anything that
                answers differently by then is left alone, and every removal is verified against
                the profile afterwards.
              </p>
            </>
          )}

          {skipped.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-900">
                Skipped ({skipped.length})
              </h3>
              <ul className="text-sm border border-amber-200 bg-amber-50 rounded divide-y divide-amber-100">
                {skipped.map((s) => (
                  <li key={s.classId} className="px-3 py-2 space-y-0.5">
                    <div className="flex justify-between gap-3">
                      <span className="font-mono text-xs text-gray-700 truncate">
                        {s.title || s.classId}
                      </span>
                      <span className="text-amber-800 whitespace-nowrap">
                        {VERDICT_LABEL[s.verdict]}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600">{s.reason}</div>
                    {s.parentId && (
                      <div className="text-xs text-gray-500">
                        Parent: <span className="font-mono">{s.parentId}</span> — the sync did not
                        import this room.
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-6 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={nothingToDelete}
            className={`px-4 py-2 text-sm rounded ${
              nothingToDelete
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-red-600 text-white hover:bg-red-700'
            }`}
          >
            Delete {tagCount} tag{tagCount === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
