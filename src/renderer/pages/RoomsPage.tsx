import React, { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { library } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { IconName } from '@fortawesome/fontawesome-svg-core';
import type { Room, RoomType } from '../../shared/types';
import { RoomAssignmentsList } from '../components/AssignmentsList';
import { CreateRoomModal } from '../components/CreateRoomModal';
import { DeleteConfirmationModal } from '../components/DeleteConfirmationModal';
import { RenameRoomModal } from '../components/RenameRoomModal';

// Add all solid icons to the library for dynamic lookup
library.add(fas);

// Hazu uses some custom icon names that need translation to FontAwesome names
const iconNameTranslations: Record<string, string> = {
  'battery-0': 'battery-empty',
  'battery-1': 'battery-quarter',
  'battery-2': 'battery-half',
  'battery-3': 'battery-three-quarters',
  'battery-4': 'battery-full',
  'map-marked': 'map-location-dot',
};

// Convert Hazu icon string (e.g., "fa-building") to FontAwesome icon name (e.g., "building")
function parseIconName(iconString: string | null | undefined): IconName {
  if (!iconString) return 'building';
  // Remove "fa-" or "fas fa-" prefix
  let name = iconString.replace(/^(fas\s+)?fa-/, '');
  // Translate Hazu-specific names to FontAwesome names
  if (iconNameTranslations[name]) {
    name = iconNameTranslations[name];
  }
  return name as IconName;
}

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
  const [deleteModalState, setDeleteModalState] = useState<{ isOpen: boolean; room: Room | null }>({
    isOpen: false,
    room: null,
  });
  const [renameModalState, setRenameModalState] = useState<{ isOpen: boolean; room: Room | null }>({
    isOpen: false,
    room: null,
  });

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

  const handleDeleteClick = (room: Room, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteModalState({ isOpen: true, room });
  };

  const handleRenameClick = (room: Room, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameModalState({ isOpen: true, room });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModalState.room) return { success: false, error: 'No room selected' };

    try {
      const result = await window.electronAPI.deleteRoom(deleteModalState.room.id);

      if (result.success) {
        // Refetch rooms list
        await loadRooms();
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete room',
      };
    }
  };

  const handleRenameConfirm = async (newTitle: string) => {
    if (!renameModalState.room) return { success: false, error: 'No room selected' };

    try {
      const result = await window.electronAPI.renameRoom(renameModalState.room.id, newTitle);

      if (result.success) {
        // Refetch rooms list
        await loadRooms();
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to rename room',
      };
    }
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
              onDeleteClick={(e) => handleDeleteClick(room, e)}
              onRenameClick={(e) => handleRenameClick(room, e)}
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

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={deleteModalState.isOpen}
        entityType="room"
        entityName={deleteModalState.room?.title.replace(/<[^>]*>/g, '').trim() || ''}
        onConfirm={handleDeleteConfirm}
        onClose={() => setDeleteModalState({ isOpen: false, room: null })}
      />

      {/* Rename Room Modal */}
      <RenameRoomModal
        isOpen={renameModalState.isOpen}
        currentTitle={renameModalState.room?.title.replace(/<[^>]*>/g, '').trim() || ''}
        onConfirm={handleRenameConfirm}
        onClose={() => setRenameModalState({ isOpen: false, room: null })}
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
  onDeleteClick: (e: React.MouseEvent) => void;
  onRenameClick: (e: React.MouseEvent) => void;
}

function RoomCard({ room, isExpanded, assignments, assignmentsLoading, onClick, onDeleteClick, onRenameClick }: RoomCardProps) {
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
            className="w-10 h-10 rounded-lg flex items-center justify-center text-white flex-shrink-0"
            style={{ backgroundColor: room.color || '#6B7280' }}
          >
            <FontAwesomeIcon icon={['fas', parseIconName(room.icon)]} className="text-lg" />
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

          {/* Action icons */}
          <div className="flex items-center gap-2 ml-2">
            {/* Rename icon */}
            <button
              onClick={onRenameClick}
              className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
              title="Rename room"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>

            {/* Delete icon */}
            <button
              onClick={onDeleteClick}
              className="p-1 text-red-500 hover:text-red-700 transition-colors"
              title="Delete room"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
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
