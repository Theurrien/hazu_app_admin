import React, { useState, useMemo } from 'react';
import type { RoomType } from '../../../shared/types';

export type { RoomType };

export interface RoomAssignment {
  roomType: RoomType | null;
  roomIds: string[];
}

interface RoomAssignmentPanelProps {
  // Grouping values (combined from grouping1 and grouping2 columns)
  groupingValues: string[];
  group1Values: string[]; // To show separator between groups

  // Room assignments: groupValue → { roomType, roomIds }
  roomAssignments: Map<string, RoomAssignment>;
  onRoomAssignmentsChange: (assignments: Map<string, RoomAssignment>) => void;

  // Available rooms from database
  rooms: Array<{ id: string; title: string; room_type: string }>;

  disabled?: boolean;
}

const roomTypeLabels: Record<RoomType, string> = {
  class: 'Class',
  enterprise: 'Enterprise',
  state: 'Canton/State',
  cie: 'CIE',
};

export function RoomAssignmentPanel({
  groupingValues,
  group1Values,
  roomAssignments,
  onRoomAssignmentsChange,
  rooms,
  disabled = false,
}: RoomAssignmentPanelProps) {
  const [selectedGrouping, setSelectedGrouping] = useState<string | null>(
    groupingValues.length > 0 ? groupingValues[0] : null
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Get current assignment for selected grouping
  const currentAssignment = selectedGrouping
    ? roomAssignments.get(selectedGrouping)
    : null;

  const selectedRoomType = currentAssignment?.roomType || null;
  const selectedRoomIds = currentAssignment?.roomIds || [];

  // Count configured groupings
  const configuredCount = useMemo(() => {
    let count = 0;
    roomAssignments.forEach((assignment) => {
      if (assignment.roomIds.length > 0) {
        count++;
      }
    });
    return count;
  }, [roomAssignments]);

  // Filter rooms by type and search
  const filteredRooms = useMemo(() => {
    let filtered = rooms;

    // Filter by room type if selected
    if (selectedRoomType) {
      filtered = filtered.filter((room) => room.room_type === selectedRoomType);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((room) =>
        room.title.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [rooms, selectedRoomType, searchQuery]);

  // Handle room type change
  const handleRoomTypeChange = (roomType: RoomType) => {
    if (!selectedGrouping || disabled) return;

    const newAssignments = new Map(roomAssignments);
    const existingAssignment = newAssignments.get(selectedGrouping);

    newAssignments.set(selectedGrouping, {
      roomType,
      roomIds: existingAssignment?.roomIds || [],
    });

    onRoomAssignmentsChange(newAssignments);
  };

  // Handle room selection toggle
  const handleRoomToggle = (roomId: string) => {
    if (!selectedGrouping || disabled) return;

    const newAssignments = new Map(roomAssignments);
    const existingAssignment = newAssignments.get(selectedGrouping);
    const currentRoomIds = existingAssignment?.roomIds || [];

    const newRoomIds = currentRoomIds.includes(roomId)
      ? currentRoomIds.filter((id) => id !== roomId)
      : [...currentRoomIds, roomId];

    newAssignments.set(selectedGrouping, {
      roomType: existingAssignment?.roomType || null,
      roomIds: newRoomIds,
    });

    onRoomAssignmentsChange(newAssignments);
  };

  if (groupingValues.length === 0) {
    return null;
  }

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-300 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-700">
          Room Assignments ({configuredCount} of {groupingValues.length} configured)
        </h3>
      </div>

      {/* Content */}
      <div className="flex" style={{ height: '400px' }}>
        {/* Left Panel - Grouping Values */}
        <div className="w-48 border-r border-gray-300 overflow-y-auto bg-gray-50">
          <div className="py-2">
            {groupingValues.map((value, index) => {
              const assignment = roomAssignments.get(value);
              const hasRooms = (assignment?.roomIds.length || 0) > 0;
              const isSelected = selectedGrouping === value;
              const isGroup1End = group1Values.includes(value);
              const nextIsGroup2 =
                index < groupingValues.length - 1 &&
                !group1Values.includes(groupingValues[index + 1]);
              const showSeparator = isGroup1End && nextIsGroup2;

              return (
                <React.Fragment key={value}>
                  <button
                    onClick={() => setSelectedGrouping(value)}
                    disabled={disabled}
                    className={`
                      w-full px-4 py-2 text-left text-sm flex items-center gap-2 transition-colors
                      ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'hover:bg-gray-100 text-gray-700'
                      }
                      ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                    `}
                  >
                    {hasRooms && (
                      <svg
                        className={`w-4 h-4 flex-shrink-0 ${
                          isSelected ? 'text-white' : 'text-green-600'
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                    <span className="truncate">{value}</span>
                  </button>
                  {showSeparator && (
                    <div className="border-t border-gray-400 my-2 mx-4" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Right Panel - Room Selection */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedGrouping ? (
            <>
              {/* Room Type Selector */}
              <div className="border-b border-gray-200 p-4">
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  Room Type
                </label>
                <select
                  value={selectedRoomType || ''}
                  onChange={(e) =>
                    handleRoomTypeChange(e.target.value as RoomType)
                  }
                  disabled={disabled}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Select room type...</option>
                  {(Object.keys(roomTypeLabels) as RoomType[]).map((type) => (
                    <option key={type} value={type}>
                      {roomTypeLabels[type]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search Input */}
              <div className="border-b border-gray-200 p-4">
                <div className="relative">
                  <svg
                    className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search rooms..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    disabled={disabled || !selectedRoomType}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Room List */}
              <div className="flex-1 overflow-y-auto p-4">
                {!selectedRoomType ? (
                  <p className="text-sm text-gray-500 text-center py-8">
                    Select a room type to view available rooms
                  </p>
                ) : filteredRooms.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">
                    No rooms found
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filteredRooms.map((room) => (
                      <label
                        key={room.id}
                        className={`
                          flex items-center gap-3 px-3 py-2 border rounded-lg cursor-pointer transition-colors
                          ${
                            selectedRoomIds.includes(room.id)
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }
                          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                      >
                        <input
                          type="checkbox"
                          checked={selectedRoomIds.includes(room.id)}
                          onChange={() => handleRoomToggle(room.id)}
                          disabled={disabled}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700 flex-1">
                          {room.title}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer - Selected Count */}
              <div className="border-t border-gray-200 px-4 py-3 bg-gray-50">
                <p className="text-xs text-gray-600">
                  Selected: {selectedRoomIds.length} room
                  {selectedRoomIds.length !== 1 ? 's' : ''}
                </p>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-500">
                Select a grouping value to configure room assignments
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
