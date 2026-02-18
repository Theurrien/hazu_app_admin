import React, { useState, useCallback } from 'react';
import { useMatrixData } from '../hooks/useMatrixData';
import { MatrixFilters } from '../components/MatrixFilters';
import { MatrixGrid } from '../components/MatrixGrid';
import { useTaskQueue } from '../contexts/TaskQueueContext';
import { DeleteConfirmationModal } from '../components/DeleteConfirmationModal';
import { RenameRoomModal } from '../components/RenameRoomModal';

function MatrixPage() {
  const {
    persons,
    rooms,
    getAssignment,
    loading,
    error,
    refetch,
    filters,
    togglePersonType,
    toggleRoomType,
    setPersonSearch,
    setRoomSearch,
    allPersonTypes,
    allRoomTypes,
  } = useMatrixData();

  const { addRoleUpdateTask } = useTaskQueue();

  // Local state for optimistic updates
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map());

  // Modal state for delete/rename
  const [deleteRoomModal, setDeleteRoomModal] = useState<{ isOpen: boolean; roomId: string; roomTitle: string }>({
    isOpen: false,
    roomId: '',
    roomTitle: '',
  });
  const [deletePersonModal, setDeletePersonModal] = useState<{ isOpen: boolean; personId: string; personName: string }>({
    isOpen: false,
    personId: '',
    personName: '',
  });
  const [renameRoomModal, setRenameRoomModal] = useState<{ isOpen: boolean; roomId: string; currentTitle: string }>({
    isOpen: false,
    roomId: '',
    currentTitle: '',
  });

  // Handle role changes from the grid
  const handleRoleChange = useCallback(
    (
      personId: string,
      personName: string,
      roomId: string,
      roomName: string,
      oldRole: string | null,
      newRole: string | null
    ) => {
      // Update local state immediately for responsiveness
      if (newRole) {
        setAssignments((prev) => {
          const newMap = new Map(prev);
          newMap.set(`${personId}:${roomId}`, newRole);
          return newMap;
        });
      } else {
        setAssignments((prev) => {
          const newMap = new Map(prev);
          newMap.delete(`${personId}:${roomId}`);
          return newMap;
        });
      }

      // Add to task queue with revert callback
      addRoleUpdateTask({
        personName,
        roomName,
        personId,
        roomId,
        oldRole,
        newRole,
        onError: () => {
          // Revert to old role on error
          if (oldRole) {
            setAssignments((prev) => {
              const newMap = new Map(prev);
              newMap.set(`${personId}:${roomId}`, oldRole);
              return newMap;
            });
          } else {
            setAssignments((prev) => {
              const newMap = new Map(prev);
              newMap.delete(`${personId}:${roomId}`);
              return newMap;
            });
          }
        },
      });
    },
    [addRoleUpdateTask]
  );

  // Handlers for delete/rename from matrix headers
  const handleDeleteRoom = useCallback((roomId: string, roomTitle: string) => {
    setDeleteRoomModal({ isOpen: true, roomId, roomTitle: roomTitle.replace(/<[^>]*>/g, '').trim() });
  }, []);

  const handleDeletePerson = useCallback((personId: string, personName: string) => {
    setDeletePersonModal({ isOpen: true, personId, personName });
  }, []);

  const handleRenameRoom = useCallback((roomId: string, currentTitle: string) => {
    setRenameRoomModal({ isOpen: true, roomId, currentTitle: currentTitle.replace(/<[^>]*>/g, '').trim() });
  }, []);

  const handleDeleteRoomConfirm = async () => {
    if (!deleteRoomModal.roomId) return { success: false, error: 'No room selected' };
    try {
      const result = await window.electronAPI.deleteRoom(deleteRoomModal.roomId);
      if (result.success) {
        await refetch();
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete room' };
    }
  };

  const handleDeletePersonConfirm = async () => {
    if (!deletePersonModal.personId) return { success: false, error: 'No person selected' };
    try {
      const result = await window.electronAPI.deletePerson(deletePersonModal.personId);
      if (result.success) {
        await refetch();
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete person' };
    }
  };

  const handleRenameRoomConfirm = async (newTitle: string) => {
    if (!renameRoomModal.roomId) return { success: false, error: 'No room selected' };
    try {
      const result = await window.electronAPI.renameRoom(renameRoomModal.roomId, newTitle);
      if (result.success) {
        await refetch();
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to rename room' };
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-gray-500">Loading matrix data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-red-500">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white rounded-lg shadow overflow-hidden">
      <MatrixFilters
        personTypes={filters.personTypes}
        roomTypes={filters.roomTypes}
        personSearch={filters.personSearch}
        roomSearch={filters.roomSearch}
        onTogglePersonType={togglePersonType}
        onToggleRoomType={toggleRoomType}
        onPersonSearchChange={setPersonSearch}
        onRoomSearchChange={setRoomSearch}
        allPersonTypes={allPersonTypes}
        allRoomTypes={allRoomTypes}
      />
      <MatrixGrid
        persons={persons}
        rooms={rooms}
        getAssignment={getAssignment}
        onRoleChange={handleRoleChange}
        onDeleteRoom={handleDeleteRoom}
        onDeletePerson={handleDeletePerson}
        onRenameRoom={handleRenameRoom}
      />

      {/* Delete Room Modal */}
      <DeleteConfirmationModal
        isOpen={deleteRoomModal.isOpen}
        entityType="room"
        entityName={deleteRoomModal.roomTitle}
        onConfirm={handleDeleteRoomConfirm}
        onClose={() => setDeleteRoomModal({ isOpen: false, roomId: '', roomTitle: '' })}
      />

      {/* Delete Person Modal */}
      <DeleteConfirmationModal
        isOpen={deletePersonModal.isOpen}
        entityType="person"
        entityName={deletePersonModal.personName}
        onConfirm={handleDeletePersonConfirm}
        onClose={() => setDeletePersonModal({ isOpen: false, personId: '', personName: '' })}
      />

      {/* Rename Room Modal */}
      <RenameRoomModal
        isOpen={renameRoomModal.isOpen}
        currentTitle={renameRoomModal.currentTitle}
        onConfirm={handleRenameRoomConfirm}
        onClose={() => setRenameRoomModal({ isOpen: false, roomId: '', currentTitle: '' })}
      />
    </div>
  );
}

export default MatrixPage;
