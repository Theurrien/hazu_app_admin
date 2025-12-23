import React, { useEffect, useState } from 'react';
import type { Person, PersonType, RoomType } from '../../shared/types';
import { PersonAssignmentsList } from '../components/AssignmentsList';
import { CreatePersonModal } from '../components/CreatePersonModal';

const personTypeLabels: Record<PersonType, string> = {
  student: 'Students',
  companymentor: 'Company Mentors',
  schoolteacher: 'School Teachers',
  courseteacher: 'Course Teachers',
  stateadvisor: 'State Advisors',
  guardian: 'Guardians',
};

const personTypeColors: Record<PersonType, string> = {
  student: 'bg-blue-100 text-blue-800',
  companymentor: 'bg-purple-100 text-purple-800',
  schoolteacher: 'bg-green-100 text-green-800',
  courseteacher: 'bg-teal-100 text-teal-800',
  stateadvisor: 'bg-orange-100 text-orange-800',
  guardian: 'bg-pink-100 text-pink-800',
};

interface RoomAssignment {
  id: string;
  room_id: string;
  title: string;
  room_title: string;
  room_type: RoomType;
}

function PersonsPage() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<PersonType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<RoomAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [rooms, setRooms] = useState<Array<{ id: string; title: string; room_type: string }>>([]);

  useEffect(() => {
    loadPersons();
    loadRooms();
  }, [filter]);

  const loadPersons = async () => {
    setLoading(true);
    try {
      const type = filter === 'all' ? undefined : filter;
      const result = await window.electronAPI.getPersons(type);
      setPersons(result);
    } catch (error) {
      console.error('Failed to load persons:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRooms = async () => {
    try {
      const result = await window.electronAPI.getRooms();
      setRooms(result);
    } catch (error) {
      console.error('Failed to load rooms:', error);
    }
  };

  const handleRowClick = async (personId: string) => {
    if (expandedId === personId) {
      // Collapse if already expanded
      setExpandedId(null);
      setAssignments([]);
    } else {
      // Expand and load assignments
      setExpandedId(personId);
      setAssignmentsLoading(true);
      try {
        const result = await window.electronAPI.getAssignmentsForPerson(personId);
        // Map the response to include the title field expected by AssignmentsList
        const mapped = result.map((a: any) => ({
          ...a,
          id: a.room_id,
          title: a.room_title,
        }));
        setAssignments(mapped);
      } catch (error) {
        console.error('Failed to load assignments:', error);
        setAssignments([]);
      } finally {
        setAssignmentsLoading(false);
      }
    }
  };

  const filteredPersons = persons.filter((person) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      person.display_name.toLowerCase().includes(searchLower) ||
      person.email?.toLowerCase().includes(searchLower) ||
      person.first_name?.toLowerCase().includes(searchLower) ||
      person.last_name?.toLowerCase().includes(searchLower)
    );
  });

  const handlePersonCreated = (person: Person) => {
    setPersons(prev => [...prev, person]);
    console.log('Person created:', person.display_name);
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex flex-wrap gap-2">
          <FilterButton
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label="All"
          />
          {(Object.keys(personTypeLabels) as PersonType[]).map((type) => (
            <FilterButton
              key={type}
              active={filter === type}
              onClick={() => setFilter(type)}
              label={personTypeLabels[type]}
            />
          ))}
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <span>+</span>
          <span>New Person</span>
        </button>
        <div className="flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search persons..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Person List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading persons...</div>
        </div>
      ) : filteredPersons.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">No persons found. Run a sync to fetch data from Hazu.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-8 px-3 py-3"></th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredPersons.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  isExpanded={expandedId === person.id}
                  assignments={expandedId === person.id ? assignments : []}
                  assignmentsLoading={expandedId === person.id && assignmentsLoading}
                  onClick={() => handleRowClick(person.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Person Modal */}
      <CreatePersonModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onPersonCreated={handlePersonCreated}
        rooms={rooms}
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
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

interface PersonRowProps {
  person: Person;
  isExpanded: boolean;
  assignments: RoomAssignment[];
  assignmentsLoading: boolean;
  onClick: () => void;
}

function PersonRow({ person, isExpanded, assignments, assignmentsLoading, onClick }: PersonRowProps) {
  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer"
        onClick={onClick}
      >
        <td className="px-3 py-4 text-gray-400">
          {isExpanded ? '▼' : '▶'}
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <div className="font-medium text-gray-900">{person.display_name}</div>
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-gray-500">
          {person.email || '-'}
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <span
            className={`inline-block px-2 py-1 text-xs font-medium rounded ${
              personTypeColors[person.person_type as PersonType]
            }`}
          >
            {personTypeLabels[person.person_type as PersonType]}
          </span>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={4} className="p-0">
            <PersonAssignmentsList
              assignments={assignments}
              loading={assignmentsLoading}
            />
          </td>
        </tr>
      )}
    </>
  );
}

export default PersonsPage;
