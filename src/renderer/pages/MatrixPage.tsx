import React, { useState, useCallback } from 'react';
import { useMatrixData } from '../hooks/useMatrixData';
import { MatrixFilters } from '../components/MatrixFilters';
import { MatrixGrid } from '../components/MatrixGrid';
import { useTaskQueue } from '../contexts/TaskQueueContext';
import { DeleteConfirmationModal } from '../components/DeleteConfirmationModal';
import { RenameRoomModal } from '../components/RenameRoomModal';
import { useAppMode } from '../contexts/AppModeContext';
import { allowedPersonTypes, allowedRoomTypes, isRestricted } from '../../shared/app-mode';

function MatrixPage() {
  const { mode } = useAppMode();
  const restricted = isRestricted(mode);

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
  } = useMatrixData(
    restricted
      ? { lockPersonTypes: allowedPersonTypes(mode), lockRoomTypes: allowedRoomTypes(mode) }
      : {}
  );

  const { addRoleUpdateTask } = useTaskQueue();

  // Optimistic overlay on top of the synced data, keyed `personId:roomId`.
  //
  // A value of `null` means "optimistically cleared" and is deliberately stored rather
  // than deleted: deleting the key would mean "no override", so the grid would fall back
  // to the synced row and redisplay the role the user just removed.
  //
  // `getAssignmentWithOverrides` below is what makes this visible. Before it existed the
  // overlay was written but never read, so neither the optimistic fill nor the documented
  // revert-on-failure did anything.
  const [roleOverrides, setRoleOverrides] = useState<Map<string, string | null>>(new Map());

  const setRoleOverride = useCallback((personId: string, roomId: string, role: string | null) => {
    setRoleOverrides((prev) => new Map(prev).set(`${personId}:${roomId}`, role));
  }, []);

  const getAssignmentWithOverrides = useCallback(
    (personId: string, roomId: string): string | null => {
      const key = `${personId}:${roomId}`;
      // `has` rather than a truthy check, so an explicit null reads as "cleared".
      if (roleOverrides.has(key)) return roleOverrides.get(key) ?? null;
      return getAssignment(personId, roomId);
    },
    [roleOverrides, getAssignment]
  );

  // Synced data is authoritative once reloaded, so drop the overlay with it.
  const refetchAndClearOverrides = useCallback(async () => {
    await refetch();
    setRoleOverrides(new Map());
  }, [refetch]);

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
      // Show the change immediately; `null` is stored, not deleted, so a removal reads
      // as cleared rather than falling back to the synced role.
      setRoleOverride(personId, roomId, newRole);

      // Add to task queue with revert callback
      addRoleUpdateTask({
        personName,
        roomName,
        personId,
        roomId,
        oldRole,
        newRole,
        onError: () => {
          // Put the cell back where it was. This is the revert S4 relies on when group
          // truth does not confirm a write the server accepted.
          setRoleOverride(personId, roomId, oldRole);
        },
      });
    },
    [addRoleUpdateTask, setRoleOverride]
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
        await refetchAndClearOverrides();
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
        await refetchAndClearOverrides();
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
        await refetchAndClearOverrides();
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
        showTypeFilters={!restricted}
      />
      <MatrixGrid
        persons={persons}
        rooms={rooms}
        getAssignment={getAssignmentWithOverrides}
        onRoleChange={handleRoleChange}
        allowedRoles={restricted ? allowedPersonTypes(mode) : undefined}
        onDeleteRoom={restricted ? undefined : handleDeleteRoom}
        onDeletePerson={restricted ? undefined : handleDeletePerson}
        onRenameRoom={restricted ? undefined : handleRenameRoom}
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
