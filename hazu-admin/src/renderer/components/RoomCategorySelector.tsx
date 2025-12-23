import React, { useState } from 'react';

interface RoomCategorySelectorProps {
  rooms: Array<{ id: string; title: string; room_type: string }>;
  selectedRoomIds: string[];
  onChange: (selectedIds: string[]) => void;
}

type CategoryKey = 'class' | 'enterprise' | 'cie' | 'state';

const categoryLabels: Record<CategoryKey, string> = {
  class: 'Classes',
  enterprise: 'Enterprises',
  cie: 'CIE',
  state: 'Cantons',
};

export function RoomCategorySelector({ rooms, selectedRoomIds, onChange }: RoomCategorySelectorProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<CategoryKey>>(new Set());
  const [searchTerms, setSearchTerms] = useState<Record<CategoryKey, string>>({
    class: '',
    enterprise: '',
    cie: '',
    state: '',
  });

  // Group rooms by category
  const roomsByCategory = rooms.reduce((acc, room) => {
    const category = room.room_type as CategoryKey;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(room);
    return acc;
  }, {} as Record<CategoryKey, Array<{ id: string; title: string; room_type: string }>>);

  // Toggle category expansion
  const toggleCategory = (category: CategoryKey) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  // Update search term for a category
  const updateSearchTerm = (category: CategoryKey, term: string) => {
    setSearchTerms((prev) => ({ ...prev, [category]: term }));
  };

  // Filter rooms based on search term (case-insensitive)
  const getFilteredRooms = (category: CategoryKey) => {
    const categoryRooms = roomsByCategory[category] || [];
    const searchTerm = searchTerms[category].toLowerCase().trim();

    if (!searchTerm) {
      return categoryRooms;
    }

    return categoryRooms.filter((room) =>
      room.title.toLowerCase().includes(searchTerm)
    );
  };

  // Toggle room selection
  const toggleRoom = (roomId: string) => {
    const newSelection = selectedRoomIds.includes(roomId)
      ? selectedRoomIds.filter((id) => id !== roomId)
      : [...selectedRoomIds, roomId];
    onChange(newSelection);
  };

  // Count selected rooms in a category
  const getSelectedCount = (category: CategoryKey) => {
    const categoryRooms = roomsByCategory[category] || [];
    return categoryRooms.filter((room) => selectedRoomIds.includes(room.id)).length;
  };

  // Get category display suffix
  const getCategorySuffix = (category: CategoryKey) => {
    const categoryRooms = roomsByCategory[category] || [];

    if (categoryRooms.length === 0) {
      return '(empty)';
    }

    const selectedCount = getSelectedCount(category);
    if (selectedCount > 0) {
      return `(${selectedCount})`;
    }

    return '';
  };

  // Render each category
  const categories: CategoryKey[] = ['class', 'enterprise', 'cie', 'state'];

  return (
    <div className="space-y-2">
      {categories.map((category) => {
        const isExpanded = expandedCategories.has(category);
        const categoryRooms = roomsByCategory[category] || [];
        const filteredRooms = getFilteredRooms(category);
        const suffix = getCategorySuffix(category);

        return (
          <div key={category} className="border border-gray-200 rounded-lg overflow-hidden">
            {/* Category Header */}
            <button
              type="button"
              onClick={() => toggleCategory(category)}
              className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <span className="text-gray-600 text-sm">
                {isExpanded ? '▼' : '▶'}
              </span>
              <span className="font-medium text-gray-900">
                {categoryLabels[category]} {suffix && <span className="text-gray-500">{suffix}</span>}
              </span>
            </button>

            {/* Expanded Content */}
            {isExpanded && (
              <div className="p-4 space-y-3">
                {/* Search Input */}
                {categoryRooms.length > 0 && (
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <input
                      type="text"
                      value={searchTerms[category]}
                      onChange={(e) => updateSearchTerm(category, e.target.value)}
                      placeholder={`Search ${categoryLabels[category].toLowerCase()}...`}
                      className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}

                {/* Room List */}
                {filteredRooms.length === 0 && categoryRooms.length > 0 && (
                  <div className="text-sm text-gray-500 py-2">
                    No rooms match your search
                  </div>
                )}

                {filteredRooms.length === 0 && categoryRooms.length === 0 && (
                  <div className="text-sm text-gray-500 py-2">
                    No {categoryLabels[category].toLowerCase()} available
                  </div>
                )}

                {filteredRooms.length > 0 && (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {filteredRooms.map((room) => {
                      const isSelected = selectedRoomIds.includes(room.id);

                      return (
                        <label
                          key={room.id}
                          className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRoom(room.id)}
                            className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-900">
                            {room.title}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
