import React from 'react';
import type { PersonType, RoomType } from '../../shared/types';

const personTypeLabels: Record<PersonType, string> = {
  student: 'Students',
  companymentor: 'Mentors',
  schoolteacher: 'Teachers',
  courseteacher: 'Course T.',
  stateadvisor: 'Advisors',
  guardian: 'Guardians',
};

const roomTypeLabels: Record<RoomType, string> = {
  state: 'Cantons',
  class: 'Classes',
  enterprise: 'Enterprises',
  cie: 'CIE',
};

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-sm font-medium rounded-full transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
      }`}
    >
      {label}
    </button>
  );
}

interface MatrixFiltersProps {
  personTypes: Set<PersonType>;
  roomTypes: Set<RoomType>;
  personSearch: string;
  roomSearch: string;
  onTogglePersonType: (type: PersonType) => void;
  onToggleRoomType: (type: RoomType) => void;
  onPersonSearchChange: (search: string) => void;
  onRoomSearchChange: (search: string) => void;
  allPersonTypes: PersonType[];
  allRoomTypes: RoomType[];
}

export function MatrixFilters({
  personTypes,
  roomTypes,
  personSearch,
  roomSearch,
  onTogglePersonType,
  onToggleRoomType,
  onPersonSearchChange,
  onRoomSearchChange,
  allPersonTypes,
  allRoomTypes,
}: MatrixFiltersProps) {
  return (
    <div className="flex gap-6 p-4 bg-white border-b border-gray-200">
      {/* Person Filters (Left side) */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium text-gray-500 uppercase">Persons</div>
        <div className="flex flex-wrap gap-1.5">
          {allPersonTypes.map((type) => (
            <FilterChip
              key={type}
              label={personTypeLabels[type]}
              active={personTypes.has(type)}
              onClick={() => onTogglePersonType(type)}
            />
          ))}
        </div>
        <input
          type="text"
          placeholder="Search persons..."
          value={personSearch}
          onChange={(e) => onPersonSearchChange(e.target.value)}
          className="mt-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
        />
      </div>

      {/* Divider */}
      <div className="w-px bg-gray-200" />

      {/* Room Filters (Right side) */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium text-gray-500 uppercase">Rooms</div>
        <div className="flex flex-wrap gap-1.5">
          {allRoomTypes.map((type) => (
            <FilterChip
              key={type}
              label={roomTypeLabels[type]}
              active={roomTypes.has(type)}
              onClick={() => onToggleRoomType(type)}
            />
          ))}
        </div>
        <input
          type="text"
          placeholder="Search rooms..."
          value={roomSearch}
          onChange={(e) => onRoomSearchChange(e.target.value)}
          className="mt-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
        />
      </div>
    </div>
  );
}
