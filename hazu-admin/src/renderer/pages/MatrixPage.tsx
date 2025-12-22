import React, { useState, useCallback } from 'react';
import { useMatrixData } from '../hooks/useMatrixData';
import { MatrixFilters } from '../components/MatrixFilters';
import { MatrixGrid } from '../components/MatrixGrid';
import { useTaskQueue } from '../contexts/TaskQueueContext';

function MatrixPage() {
  const {
    persons,
    rooms,
    getAssignment,
    loading,
    error,
    filters,
    togglePersonType,
    toggleRoomType,
    setPersonSearch,
    setRoomSearch,
    allPersonTypes,
    allRoomTypes,
  } = useMatrixData();

  const { addTask } = useTaskQueue();

  // Local state for optimistic updates
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map());

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
      addTask({
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
    [addTask]
  );

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
      />
    </div>
  );
}

export default MatrixPage;
