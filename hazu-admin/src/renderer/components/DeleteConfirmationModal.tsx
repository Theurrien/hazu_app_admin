import React, { useState } from 'react';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  entityType: 'room' | 'person';
  entityName: string;
  onConfirm: () => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

export function DeleteConfirmationModal({
  isOpen,
  entityType,
  entityName,
  onConfirm,
  onClose,
}: DeleteConfirmationModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  if (!isOpen) {
    return null;
  }

  const handleConfirm = async () => {
    setIsDeleting(true);
    setErrorMessage('');

    try {
      const result = await onConfirm();

      if (result.success) {
        // Close modal on success
        onClose();
        // Reset state
        setIsDeleting(false);
        setErrorMessage('');
      } else {
        // Show error message
        setErrorMessage(result.error || 'Failed to delete');
        setIsDeleting(false);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    if (!isDeleting) {
      setErrorMessage('');
      onClose();
    }
  };

  const entityTypeLabel = entityType.charAt(0).toUpperCase() + entityType.slice(1);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-red-200 bg-red-50">
          <h2 className="text-lg font-semibold text-red-900">Delete {entityTypeLabel}?</h2>
          <button
            onClick={handleClose}
            className="text-red-400 hover:text-red-600 transition-colors"
            disabled={isDeleting}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Warning message */}
          <div className="flex items-start gap-3 text-gray-700">
            <svg
              className="w-6 h-6 text-red-600 mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="text-sm leading-relaxed">
                This action cannot be undone. <strong>{entityName}</strong> will be permanently deleted.
              </p>
            </div>
          </div>

          {/* Error message */}
          {errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-sm text-red-800">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={handleClose}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              disabled={isDeleting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isDeleting}
              className={`px-6 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                isDeleting
                  ? 'bg-red-400 text-white cursor-not-allowed'
                  : 'bg-red-600 text-white hover:bg-red-700'
              }`}
            >
              {isDeleting && (
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
              )}
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
