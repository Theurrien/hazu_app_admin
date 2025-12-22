import React, { useEffect, useState } from 'react';
import type { Room, RoomType } from '../../shared/types';
import { RoomAssignmentsList } from '../components/AssignmentsList';
import { CreateRoomModal } from '../components/CreateRoomModal';

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

interface PersonAssignment {
  person_id: string;
  display_name: string;
  email: string | null;
  person_type: string;
}

function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RoomType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<PersonAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [rootHazuId, setRootHazuId] = useState<string | null>(null);

  useEffect(() => {
    loadRooms();
    loadRootHazuId();
  }, [filter]);

  const loadRootHazuId = async () => {
    try {
      const config = await window.electronAPI.getApiConfig();
      setRootHazuId(config.rootHazuId || null);
    } catch (error) {
      console.error('Failed to load rootHazuId:', error);
    }
  };

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

  const handleCardClick = async (roomId: string) => {
    if (expandedId === roomId) {
      // Collapse if already expanded
      setExpandedId(null);
      setAssignments([]);
    } else {
      // Expand and load assignments
      setExpandedId(roomId);
      setAssignmentsLoading(true);
      try {
        const result = await window.electronAPI.getAssignmentsForRoom(roomId);
        setAssignments(result);
      } catch (error) {
        console.error('Failed to load assignments:', error);
        setAssignments([]);
      } finally {
        setAssignmentsLoading(false);
      }
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

  const handleRoomCreated = (room: Room) => {
    // Add new room to list
    setRooms(prev => [...prev, room]);
    // Show success in console
    console.log('Room created:', room.title);
  };

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
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <span>+</span>
          <span>New Room</span>
        </button>
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
        <div className="space-y-3">
          {filteredRooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              isExpanded={expandedId === room.id}
              assignments={expandedId === room.id ? assignments : []}
              assignmentsLoading={expandedId === room.id && assignmentsLoading}
              onClick={() => handleCardClick(room.id)}
            />
          ))}
        </div>
      )}

      {/* Create Room Modal */}
      <CreateRoomModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onRoomCreated={handleRoomCreated}
        rooms={rooms}
        rootHazuId={rootHazuId}
      />
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
  isExpanded: boolean;
  assignments: PersonAssignment[];
  assignmentsLoading: boolean;
  onClick: () => void;
}

function RoomCard({ room, isExpanded, assignments, assignmentsLoading, onClick }: RoomCardProps) {
  const cleanTitle = room.title.replace(/<[^>]*>/g, '').trim();

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div
        className="p-4 hover:bg-gray-50 transition-colors cursor-pointer"
        onClick={onClick}
      >
        <div className="flex items-center gap-3">
          {/* Expand/collapse indicator */}
          <div className="text-gray-400 w-4">
            {isExpanded ? '▼' : '▶'}
          </div>

          {/* Room icon */}
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-lg flex-shrink-0"
            style={{ backgroundColor: room.color || '#6B7280' }}
          >
            {room.icon ? (
              <i className={`fa ${room.icon}`}></i>
            ) : (
              '🏠'
            )}
          </div>

          {/* Room info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-gray-900">{cleanTitle}</h3>
            {room.description && (
              <p className="text-sm text-gray-500 truncate">
                {room.description.replace(/<[^>]*>/g, '').trim()}
              </p>
            )}
          </div>

          {/* Room type badge */}
          <span
            className={`px-2 py-1 text-xs font-medium rounded ${
              roomTypeColors[room.room_type as RoomType]
            }`}
          >
            {roomTypeLabels[room.room_type as RoomType]}
          </span>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <RoomAssignmentsList
          assignments={assignments}
          loading={assignmentsLoading}
        />
      )}
    </div>
  );
}

export default RoomsPage;
