import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { RoomType } from '../../../shared/types';

interface Room {
  id: string;
  title: string;
  room_type: string;
}

interface GroupedRoomSelectorProps {
  rooms: Room[];
  value: string | null;
  onChange: (roomId: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

const roomTypeLabels: Record<RoomType, string> = {
  class: 'Class',
  enterprise: 'Enterprise',
  state: 'Canton/State',
  cie: 'CIE',
};

const roomTypeOrder: RoomType[] = ['class', 'enterprise', 'cie', 'state'];

export function GroupedRoomSelector({
  rooms,
  value,
  onChange,
  placeholder = 'Select room...',
  disabled = false,
}: GroupedRoomSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<RoomType | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get selected room title
  const selectedRoom = value ? rooms.find((r) => r.id === value) : null;

  // Group rooms by type
  const groupedRooms = useMemo(() => {
    const groups: Record<RoomType, Room[]> = {
      class: [],
      enterprise: [],
      cie: [],
      state: [],
    };

    rooms.forEach((room) => {
      const type = room.room_type as RoomType;
      if (groups[type]) {
        groups[type].push(room);
      }
    });

    // Sort rooms within each group
    Object.keys(groups).forEach((type) => {
      groups[type as RoomType].sort((a, b) => a.title.localeCompare(b.title));
    });

    return groups;
  }, [rooms]);

  // Filter rooms by search and selected type
  const filteredRooms = useMemo(() => {
    if (!selectedType) return [];

    let filtered = groupedRooms[selectedType];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((room) =>
        room.title.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [groupedRooms, selectedType, searchQuery]);

  // Count rooms per type
  const roomCounts = useMemo(() => {
    const counts: Record<RoomType, number> = {
      class: groupedRooms.class.length,
      enterprise: groupedRooms.enterprise.length,
      cie: groupedRooms.cie.length,
      state: groupedRooms.state.length,
    };
    return counts;
  }, [groupedRooms]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && selectedType && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, selectedType]);

  const handleOpen = () => {
    if (!disabled) {
      setIsOpen(true);
      setSearchQuery('');
    }
  };

  const handleSelectType = (type: RoomType) => {
    setSelectedType(type);
    setSearchQuery('');
  };

  const handleSelectRoom = (roomId: string) => {
    onChange(roomId);
    setIsOpen(false);
    setSelectedType(null);
    setSearchQuery('');
  };

  const handleClear = () => {
    onChange(null);
    setIsOpen(false);
    setSelectedType(null);
    setSearchQuery('');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Selected value display / trigger */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={`
          w-full px-3 py-2 text-left border rounded-lg text-sm
          ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white cursor-pointer hover:border-gray-400'}
          ${isOpen ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300'}
          flex items-center justify-between
        `}
      >
        <span className={selectedRoom ? 'text-gray-900' : 'text-gray-500'}>
          {selectedRoom ? (
            <>
              {selectedRoom.title}
              <span className="text-gray-400 ml-2">
                ({roomTypeLabels[selectedRoom.room_type as RoomType]})
              </span>
            </>
          ) : (
            placeholder
          )}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg overflow-hidden">
          {!selectedType ? (
            // Type selection
            <div className="py-1">
              {roomTypeOrder.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleSelectType(type)}
                  disabled={roomCounts[type] === 0}
                  className={`
                    w-full px-4 py-2 text-left text-sm flex items-center justify-between
                    ${roomCounts[type] === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100 cursor-pointer'}
                  `}
                >
                  <span>{roomTypeLabels[type]}</span>
                  <span className="text-gray-400">{roomCounts[type]}</span>
                </button>
              ))}

              {value && (
                <>
                  <div className="border-t border-gray-200 my-1"></div>
                  <button
                    type="button"
                    onClick={handleClear}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    Clear selection
                  </button>
                </>
              )}
            </div>
          ) : (
            // Room selection within type
            <div>
              {/* Back button + search */}
              <div className="border-b border-gray-200 p-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedType(null)}
                    className="p-1 hover:bg-gray-100 rounded"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span className="text-sm font-medium text-gray-700">
                    {roomTypeLabels[selectedType]}
                  </span>
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full mt-2 px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Room list */}
              <div className="max-h-48 overflow-y-auto">
                {filteredRooms.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500 text-center">
                    No rooms found
                  </div>
                ) : (
                  filteredRooms.map((room) => (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => handleSelectRoom(room.id)}
                      className={`
                        w-full px-4 py-2 text-left text-sm hover:bg-gray-100 cursor-pointer
                        ${room.id === value ? 'bg-blue-50 text-blue-700' : ''}
                      `}
                    >
                      {room.title}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
