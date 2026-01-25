import React from 'react';
import { GroupedRoomSelector } from './GroupedRoomSelector';

interface Room {
  id: string;
  title: string;
  room_type: string;
}

interface RoomMatchingPanelProps {
  uniqueRoomValues: string[];
  rooms: Room[];
  roomMatches: Map<string, string | null>;
  roomResolutions: Map<string, string>;
  onResolutionChange: (roomValue: string, roomId: string | null) => void;
}

export function RoomMatchingPanel({
  uniqueRoomValues,
  rooms,
  roomMatches,
  roomResolutions,
  onResolutionChange,
}: RoomMatchingPanelProps) {
  // Count matched and unmatched
  const matchedCount = uniqueRoomValues.filter((value) => {
    const autoMatch = roomMatches.get(value);
    const manualMatch = roomResolutions.get(value);
    return autoMatch || manualMatch;
  }).length;

  const unmatchedCount = uniqueRoomValues.length - matchedCount;

  // Get resolved room ID for a value (auto-match or manual resolution)
  const getResolvedRoomId = (value: string): string | null => {
    return roomResolutions.get(value) || roomMatches.get(value) || null;
  };

  if (uniqueRoomValues.length === 0) {
    return null;
  }

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-300 px-4 py-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Room Matching</h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-green-600">✓ {matchedCount} matched</span>
          {unmatchedCount > 0 && (
            <span className="text-yellow-600">⚠ {unmatchedCount} unmatched</span>
          )}
        </div>
      </div>

      {/* Room value list */}
      <div className="max-h-80 overflow-y-auto">
        <div className="divide-y divide-gray-200">
          {uniqueRoomValues.map((value) => {
            const autoMatch = roomMatches.get(value);
            const resolvedId = getResolvedRoomId(value);
            const isAutoMatched = !!autoMatch;

            return (
              <div key={value} className="px-4 py-3">
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      "{value}"
                    </div>
                    {isAutoMatched ? (
                      <div className="text-xs text-green-500">Auto-matched</div>
                    ) : (
                      <div className="text-xs text-yellow-500">No exact match</div>
                    )}
                  </div>

                  <div className="flex-1">
                    <GroupedRoomSelector
                      rooms={rooms}
                      value={resolvedId}
                      onChange={(roomId) => onResolutionChange(value, roomId)}
                      placeholder="Select room..."
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
