import React from 'react';
import type { RoomType, PersonType } from '../../shared/types';

// Display labels for categories
const roomTypeLabels: Record<RoomType, string> = {
  state: 'Cantons',
  class: 'School Classes',
  enterprise: 'Enterprises',
  cie: 'Companies',
};

const personTypeLabels: Record<PersonType, string> = {
  student: 'Students',
  companymentor: 'Company Mentors',
  schoolteacher: 'School Teachers',
  courseteacher: 'Course Teachers',
  stateadvisor: 'State Advisors',
  guardian: 'Guardians',
};

// Types for assignment data from IPC
interface RoomAssignment {
  id: string;
  title: string;
  room_type: RoomType;
}

interface PersonAssignment {
  person_id: string;
  display_name: string;
  email: string | null;
  person_type: PersonType;
}

// Group assignments by category
function groupByRoomType(assignments: RoomAssignment[]): Record<RoomType, RoomAssignment[]> {
  const grouped: Partial<Record<RoomType, RoomAssignment[]>> = {};

  for (const assignment of assignments) {
    const type = assignment.room_type;
    if (!grouped[type]) {
      grouped[type] = [];
    }
    grouped[type]!.push(assignment);
  }

  return grouped as Record<RoomType, RoomAssignment[]>;
}

function groupByPersonType(assignments: PersonAssignment[]): Record<PersonType, PersonAssignment[]> {
  const grouped: Partial<Record<PersonType, PersonAssignment[]>> = {};

  for (const assignment of assignments) {
    const type = assignment.person_type;
    if (!grouped[type]) {
      grouped[type] = [];
    }
    grouped[type]!.push(assignment);
  }

  return grouped as Record<PersonType, PersonAssignment[]>;
}

// Component for person's room assignments
interface PersonAssignmentsListProps {
  assignments: RoomAssignment[];
  loading?: boolean;
}

export function PersonAssignmentsList({ assignments, loading }: PersonAssignmentsListProps) {
  if (loading) {
    return (
      <div className="py-4 px-6 bg-gray-50 text-gray-500 text-sm">
        Loading assignments...
      </div>
    );
  }

  if (assignments.length === 0) {
    return (
      <div className="py-4 px-6 bg-gray-50 text-gray-500 text-sm">
        No room assignments
      </div>
    );
  }

  const grouped = groupByRoomType(assignments);
  const orderedTypes: RoomType[] = ['class', 'enterprise', 'state', 'cie'];

  return (
    <div className="py-4 px-6 bg-gray-50 border-t border-gray-200">
      <div className="space-y-3">
        {orderedTypes.map((type) => {
          const items = grouped[type];
          if (!items || items.length === 0) return null;

          return (
            <div key={type}>
              <div className="text-sm font-medium text-gray-700">
                {roomTypeLabels[type]} - {items.length}
              </div>
              <ul className="mt-1 ml-4 space-y-0.5">
                {items.map((item) => (
                  <li key={item.id} className="text-sm text-gray-600">
                    • {item.title.replace(/<[^>]*>/g, '').trim()}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Component for room's person assignments
interface RoomAssignmentsListProps {
  assignments: PersonAssignment[];
  loading?: boolean;
}

export function RoomAssignmentsList({ assignments, loading }: RoomAssignmentsListProps) {
  if (loading) {
    return (
      <div className="py-4 px-6 bg-gray-50 text-gray-500 text-sm">
        Loading assignments...
      </div>
    );
  }

  if (assignments.length === 0) {
    return (
      <div className="py-4 px-6 bg-gray-50 text-gray-500 text-sm">
        No person assignments
      </div>
    );
  }

  const grouped = groupByPersonType(assignments);
  const orderedTypes: PersonType[] = ['student', 'schoolteacher', 'courseteacher', 'companymentor', 'stateadvisor', 'guardian'];

  return (
    <div className="py-4 px-6 bg-gray-50">
      <div className="space-y-3">
        {orderedTypes.map((type) => {
          const items = grouped[type];
          if (!items || items.length === 0) return null;

          return (
            <div key={type}>
              <div className="text-sm font-medium text-gray-700">
                {personTypeLabels[type]} - {items.length}
              </div>
              <ul className="mt-1 ml-4 space-y-0.5">
                {items.map((item) => (
                  <li key={item.person_id} className="text-sm text-gray-600">
                    • {item.display_name}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
