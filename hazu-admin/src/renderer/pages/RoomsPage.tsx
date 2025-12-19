import React, { useEffect, useState } from 'react';
import type { Room, RoomType } from '../../shared/types';

const roomTypeLabels: Record<RoomType, string> = {
  state: 'Cantons',
  class: 'Classes',
  enterprise: 'Enterprises',
  cie: 'Companies',
};

const roomTypeColors: Record<RoomType, string> = {
  state: 'bg-blue-100 text-blue-800',
  class: 'bg-green-100 text-green-800',
  enterprise: 'bg-purple-100 text-purple-800',
  cie: 'bg-orange-100 text-orange-800',
};

function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RoomType | 'all'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadRooms();
  }, [filter]);

  const loadRooms = async () => {
    setLoading(true);
    try {
      const type = filter === 'all' ? undefined : filter;
      const result = await window.electronAPI.getRooms(type);
      setRooms(result);
    } catch (error) {
      console.error('Failed to load rooms:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredRooms = rooms.filter((room) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      room.title.toLowerCase().includes(searchLower) ||
      room.description?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex gap-2">
          <FilterButton
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label="All"
          />
          {(Object.keys(roomTypeLabels) as RoomType[]).map((type) => (
            <FilterButton
              key={type}
              active={filter === type}
              onClick={() => setFilter(type)}
              label={roomTypeLabels[type]}
            />
          ))}
        </div>
        <div className="flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search rooms..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Room List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading rooms...</div>
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">No rooms found. Run a sync to fetch data from Hazu.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRooms.map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      )}
    </div>
  );
}

interface FilterButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
}

function FilterButton({ active, onClick, label }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

interface RoomCardProps {
  room: Room;
}

function RoomCard({ room }: RoomCardProps) {
  const cleanTitle = room.title.replace(/<[^>]*>/g, '').trim();

  return (
    <div className="bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow cursor-pointer">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-lg"
          style={{ backgroundColor: room.color || '#6B7280' }}
        >
          {room.icon ? (
            <i className={`fa ${room.icon}`}></i>
          ) : (
            '🏠'
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 truncate">{cleanTitle}</h3>
          <span
            className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded ${
              roomTypeColors[room.room_type as RoomType]
            }`}
          >
            {roomTypeLabels[room.room_type as RoomType]}
          </span>
        </div>
      </div>
    </div>
  );
}

export default RoomsPage;
