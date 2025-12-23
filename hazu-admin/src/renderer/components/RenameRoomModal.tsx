import React, { useState, useEffect } from 'react';

interface RenameRoomModalProps {
  isOpen: boolean;
  currentTitle: string;
  onConfirm: (newTitle: string) => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

export function RenameRoomModal({
  isOpen,
  currentTitle,
  onConfirm,
  onClose,
}: RenameRoomModalProps) {
  const [newTitle, setNewTitle] = useState(currentTitle);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Reset state when modal closes or currentTitle changes
  useEffect(() => {
    if (isOpen) {
      setNewTitle(currentTitle);
      setErrorMessage('');
    } else {
      setIsLoading(false);
      setErrorMessage('');
    }
  }, [isOpen, currentTitle]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newTitle.trim()) {
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const result = await onConfirm(newTitle.trim());

      if (result.success) {
        // Close modal on success
        onClose();
        // Reset state
        setIsLoading(false);
        setErrorMessage('');
      } else {
        // Show error message
        setErrorMessage(result.error || 'Failed to rename room');
        setIsLoading(false);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setErrorMessage('');
      onClose();
    }
  };

  const canSubmit = newTitle.trim().length > 0 && !isLoading;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Rename Room</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={isLoading}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Room Title Input */}
          <div>
            <label htmlFor="newTitle" className="block text-sm font-medium text-gray-700 mb-2">
              Room Name
            </label>
            <input
              id="newTitle"
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Enter new room name..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
              autoFocus
            />
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
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`px-6 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                canSubmit
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {isLoading && (
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
              )}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
