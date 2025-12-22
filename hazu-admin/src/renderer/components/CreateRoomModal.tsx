import React, { useEffect, useState } from 'react';
import type { RoomType, Room } from '../../shared/types';

interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRoomCreated: (room: any) => void;
  rooms: Array<{ id: string; room_type: string; parent_id: string | null }>;
  rootHazuId: string | null;
}

interface Template {
  id: string;
  title: string;
  roomType: 'class' | 'cie' | 'enterprise' | 'state';
  icon?: string;
  color?: string;
}

type LoadingState = 'idle' | 'fetching' | 'submitting';
type ErrorState = 'fetch' | 'submit' | null;

const roomTypeLabels: Record<RoomType, string> = {
  state: 'State',
  class: 'Class',
  enterprise: 'Enterprise',
  cie: 'CIE',
};

export function CreateRoomModal({ isOpen, onClose, onRoomCreated, rooms, rootHazuId }: CreateRoomModalProps) {
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [errorState, setErrorState] = useState<ErrorState>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedType, setSelectedType] = useState<RoomType | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [roomName, setRoomName] = useState<string>('');

  // Fetch templates when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
    } else {
      // Reset form when modal closes
      resetForm();
    }
  }, [isOpen]);

  const resetForm = () => {
    setSelectedType(null);
    setSelectedTemplateId('');
    setRoomName('');
    setErrorState(null);
    setErrorMessage('');
    setLoadingState('idle');
  };

  const fetchTemplates = async () => {
    setLoadingState('fetching');
    setErrorState(null);

    try {
      const result = await window.electronAPI.fetchTemplates();

      if (result.success && result.templates) {
        setTemplates(result.templates);
        setLoadingState('idle');
      } else {
        setErrorState('fetch');
        setErrorMessage(result.error || 'Failed to fetch templates');
        setLoadingState('idle');
      }
    } catch (error) {
      setErrorState('fetch');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      setLoadingState('idle');
    }
  };

  const findTargetIdForType = (type: RoomType): string | null => {
    // Find first-level room (parent_id = rootHazuId) of the selected type
    const targetRoom = rooms.find(
      (room) => room.room_type === type && room.parent_id === rootHazuId
    );
    return targetRoom?.id || null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedType || !selectedTemplateId || !roomName.trim()) {
      return;
    }

    const targetId = findTargetIdForType(selectedType);
    if (!targetId) {
      setErrorState('submit');
      setErrorMessage(`No parent location found for type: ${roomTypeLabels[selectedType]}`);
      return;
    }

    setLoadingState('submitting');
    setErrorState(null);

    try {
      const result = await window.electronAPI.createRoom(
        selectedTemplateId,
        targetId,
        roomName.trim()
      );

      if (result.success && result.room) {
        // Success - call callback and close modal
        onRoomCreated(result.room);
        onClose();
        resetForm();
      } else {
        setErrorState('submit');
        setErrorMessage(result.error || 'Failed to create room');
        setLoadingState('idle');
      }
    } catch (error) {
      setErrorState('submit');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      setLoadingState('idle');
    }
  };

  // Filter templates by selected type
  const filteredTemplates = selectedType
    ? templates.filter((t) => t.roomType === selectedType)
    : [];

  // Reset template selection when type changes
  useEffect(() => {
    setSelectedTemplateId('');
  }, [selectedType]);

  const canSubmit = selectedType && selectedTemplateId && roomName.trim() && loadingState !== 'submitting';

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Create New Room</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={loadingState === 'submitting'}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Loading state while fetching templates */}
          {loadingState === 'fetching' && (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-3 text-gray-600">
                <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                <span>Loading templates...</span>
              </div>
            </div>
          )}

          {/* Fetch error state */}
          {errorState === 'fetch' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <p className="text-sm text-red-800">{errorMessage}</p>
                  <button
                    type="button"
                    onClick={fetchTemplates}
                    className="mt-2 text-sm text-red-700 hover:text-red-900 font-medium"
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Form content - only show if not fetching and no fetch error */}
          {loadingState !== 'fetching' && errorState !== 'fetch' && (
            <>
              {/* Room Type Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Room Type
                </label>
                <div className="space-y-2">
                  {(Object.keys(roomTypeLabels) as RoomType[]).map((type) => (
                    <label
                      key={type}
                      className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedType === type
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      <input
                        type="radio"
                        name="roomType"
                        value={type}
                        checked={selectedType === type}
                        onChange={(e) => setSelectedType(e.target.value as RoomType)}
                        className="w-4 h-4 text-blue-600"
                        disabled={loadingState === 'submitting'}
                      />
                      <span className="text-sm font-medium text-gray-900">
                        {roomTypeLabels[type]}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Template Selection - only show after type is selected */}
              {selectedType && (
                <div>
                  <label htmlFor="template" className="block text-sm font-medium text-gray-700 mb-2">
                    Template
                  </label>
                  {filteredTemplates.length === 0 ? (
                    <div className="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg">
                      No templates available for {roomTypeLabels[selectedType]}
                    </div>
                  ) : (
                    <select
                      id="template"
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={loadingState === 'submitting'}
                    >
                      <option value="">Select template...</option>
                      {filteredTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Room Name Input */}
              <div>
                <label htmlFor="roomName" className="block text-sm font-medium text-gray-700 mb-2">
                  Room Name
                </label>
                <input
                  id="roomName"
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="Enter room name..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={loadingState === 'submitting'}
                />
              </div>

              {/* Submit error state */}
              {errorState === 'submit' && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-red-800">{errorMessage}</p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Footer buttons */}
          {loadingState !== 'fetching' && errorState !== 'fetch' && (
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                disabled={loadingState === 'submitting'}
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
                {loadingState === 'submitting' && (
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                )}
                Create Room
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
