import React from 'react';

interface HealConfirmationModalProps {
  isOpen: boolean;
  tagCount: number;
  skippedCount: number;
  onConfirm: () => void;
  onClose: () => void;
}

export function HealConfirmationModal({
  isOpen,
  tagCount,
  skippedCount,
  onConfirm,
  onClose,
}: HealConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Heal missing tags?</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            Add <strong>{tagCount}</strong> breadcrumb tag{tagCount === 1 ? '' : 's'} to matching profiles.
            This is <strong>add-only</strong> — no tags are removed and access is unchanged.
            {skippedCount > 0 && (
              <> {skippedCount} row{skippedCount === 1 ? '' : 's'} skipped (missing class id).</>
            )}
          </p>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={tagCount === 0}
              className={`px-6 py-2 rounded-lg text-white ${
                tagCount === 0 ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              Heal {tagCount} tag{tagCount === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
