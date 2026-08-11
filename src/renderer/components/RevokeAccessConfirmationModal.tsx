import React from 'react';

interface Grant {
  kind: 'group' | 'roomItem';
  title: string;
  aclRole?: string;
}

interface RevokeAccessConfirmationModalProps {
  isOpen: boolean;
  personLabel: string;
  roomTitle: string;
  grants: Grant[];
  onConfirm: () => void;
  onClose: () => void;
}

const KIND_LABEL: Record<Grant['kind'], string> = {
  group: 'Role group',
  roomItem: 'Direct access on the room',
};

export function RevokeAccessConfirmationModal({
  isOpen,
  personLabel,
  roomTitle,
  grants,
  onConfirm,
  onClose,
}: RevokeAccessConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Revoke access?</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            This removes <strong>{personLabel}</strong>&apos;s access to <strong>{roomTitle}</strong>.
            This account has no profile in Hazu.
          </p>

          {grants.length === 0 ? (
            <p className="text-sm text-gray-500">
              No access found — it may already have been removed. Confirming will just clear the row.
            </p>
          ) : (
            <ul className="text-sm text-gray-700 border border-gray-200 rounded divide-y divide-gray-100">
              {grants.map((g, i) => (
                <li key={i} className="px-3 py-2">
                  <span className="text-gray-500">{KIND_LABEL[g.kind]}:</span> {g.title}
                  {g.aclRole ? <span className="text-gray-500"> ({g.aclRole})</span> : null}
                </li>
              ))}
            </ul>
          )}

          <p className="text-sm text-gray-500">
            The removal is verified against Hazu afterwards. If any part of it survives, the row stays
            and the task reports an error.
          </p>
        </div>

        <div className="flex justify-end gap-2 p-6 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700">
            Revoke access
          </button>
        </div>
      </div>
    </div>
  );
}
