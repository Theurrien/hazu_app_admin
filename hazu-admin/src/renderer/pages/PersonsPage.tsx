import React, { useEffect, useState } from 'react';
import type { Person, PersonType } from '../../shared/types';

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

function PersonsPage() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<PersonType | 'all'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadPersons();
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredPersons.map((person) => (
                <tr key={person.id} className="hover:bg-gray-50 cursor-pointer">
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
                  <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                    {person.role || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

export default PersonsPage;
