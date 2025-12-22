import React from 'react';
import { useMatrixData } from '../hooks/useMatrixData';
import { MatrixFilters } from '../components/MatrixFilters';
import { MatrixGrid } from '../components/MatrixGrid';

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
      />
    </div>
  );
}

export default MatrixPage;
