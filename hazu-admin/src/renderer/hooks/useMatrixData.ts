import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Person, Room, PersonType, RoomType } from '../../shared/types';

export interface MatrixAssignment {
  person_id: string;
  room_id: string;
  role: string;
}

export interface MatrixFilters {
  personTypes: Set<PersonType>;
  roomTypes: Set<RoomType>;
  personSearch: string;
  roomSearch: string;
}

export interface MatrixData {
  persons: Person[];
  rooms: Room[];
  assignmentMap: Map<string, string>; // "personId-roomId" -> role
  loading: boolean;
  error: string | null;
}

const ALL_PERSON_TYPES: PersonType[] = ['student', 'schoolteacher', 'courseteacher', 'companymentor', 'stateadvisor', 'guardian'];
const ALL_ROOM_TYPES: RoomType[] = ['class', 'enterprise', 'state', 'cie'];

const PERSON_TYPE_ORDER: Record<PersonType, number> = {
  student: 0,
  schoolteacher: 1,
  courseteacher: 2,
  companymentor: 3,
  stateadvisor: 4,
  guardian: 5,
};

const ROOM_TYPE_ORDER: Record<RoomType, number> = {
  class: 0,
  enterprise: 1,
  state: 2,
  cie: 3,
};

function createAssignmentKey(personId: string, roomId: string): string {
  return `${personId}-${roomId}`;
}

export function useMatrixData() {
  const [allPersons, setAllPersons] = useState<Person[]>([]);
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [allAssignments, setAllAssignments] = useState<MatrixAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filters, setFilters] = useState<MatrixFilters>({
    personTypes: new Set(ALL_PERSON_TYPES),
    roomTypes: new Set(ALL_ROOM_TYPES),
    personSearch: '',
    roomSearch: '',
  });

  // Load all data on mount
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const [persons, rooms, assignments] = await Promise.all([
          window.electronAPI.getPersons(),
          window.electronAPI.getRooms(),
          window.electronAPI.getAllAssignments(),
        ]);
        setAllPersons(persons);
        setAllRooms(rooms);
        setAllAssignments(assignments);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Build assignment lookup map
  const assignmentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of allAssignments) {
      map.set(createAssignmentKey(a.person_id, a.room_id), a.role);
    }
    return map;
  }, [allAssignments]);

  // Build sets of room IDs each person is assigned to
  const personAssignments = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const a of allAssignments) {
      if (!map.has(a.person_id)) {
        map.set(a.person_id, new Set());
      }
      map.get(a.person_id)!.add(a.room_id);
    }
    return map;
  }, [allAssignments]);

  // Build sets of person IDs assigned to each room
  const roomAssignments = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const a of allAssignments) {
      if (!map.has(a.room_id)) {
        map.set(a.room_id, new Set());
      }
      map.get(a.room_id)!.add(a.person_id);
    }
    return map;
  }, [allAssignments]);

  // Filter and sort persons
  const filteredPersons = useMemo(() => {
    let persons = allPersons.filter(p => filters.personTypes.has(p.person_type));

    // Apply search filter
    if (filters.personSearch) {
      const searchLower = filters.personSearch.toLowerCase();
      persons = persons.filter(p =>
        p.display_name.toLowerCase().includes(searchLower) ||
        p.email?.toLowerCase().includes(searchLower) ||
        p.first_name?.toLowerCase().includes(searchLower) ||
        p.last_name?.toLowerCase().includes(searchLower)
      );
    }

    // Sort by category then alphabetical
    persons.sort((a, b) => {
      const typeOrderA = PERSON_TYPE_ORDER[a.person_type] ?? 99;
      const typeOrderB = PERSON_TYPE_ORDER[b.person_type] ?? 99;
      if (typeOrderA !== typeOrderB) return typeOrderA - typeOrderB;
      return a.display_name.localeCompare(b.display_name);
    });

    return persons;
  }, [allPersons, filters.personTypes, filters.personSearch]);

  // Filter and sort rooms
  const filteredRooms = useMemo(() => {
    let rooms = allRooms.filter(r => filters.roomTypes.has(r.room_type));

    // Apply search filter
    if (filters.roomSearch) {
      const searchLower = filters.roomSearch.toLowerCase();
      rooms = rooms.filter(r =>
        r.title.toLowerCase().includes(searchLower) ||
        r.description?.toLowerCase().includes(searchLower)
      );
    }

    // Sort by category then alphabetical
    rooms.sort((a, b) => {
      const typeOrderA = ROOM_TYPE_ORDER[a.room_type] ?? 99;
      const typeOrderB = ROOM_TYPE_ORDER[b.room_type] ?? 99;
      if (typeOrderA !== typeOrderB) return typeOrderA - typeOrderB;
      return a.title.localeCompare(b.title);
    });

    return rooms;
  }, [allRooms, filters.roomTypes, filters.roomSearch]);

  // Smart-sorted rooms (when person search is active)
  const sortedRooms = useMemo(() => {
    if (!filters.personSearch || filteredPersons.length === 0) {
      return filteredRooms;
    }

    // Get the topmost person's assigned room IDs
    const topPerson = filteredPersons[0];
    const assignedRoomIds = personAssignments.get(topPerson.id) || new Set();

    // Partition into assigned and unassigned
    const assigned: Room[] = [];
    const unassigned: Room[] = [];

    for (const room of filteredRooms) {
      if (assignedRoomIds.has(room.id)) {
        assigned.push(room);
      } else {
        unassigned.push(room);
      }
    }

    // Unassigned rooms are already sorted by category+alpha
    // Assigned rooms - sort by category+alpha as well
    assigned.sort((a, b) => {
      const typeOrderA = ROOM_TYPE_ORDER[a.room_type] ?? 99;
      const typeOrderB = ROOM_TYPE_ORDER[b.room_type] ?? 99;
      if (typeOrderA !== typeOrderB) return typeOrderA - typeOrderB;
      return a.title.localeCompare(b.title);
    });

    return [...assigned, ...unassigned];
  }, [filteredRooms, filteredPersons, filters.personSearch, personAssignments]);

  // Smart-sorted persons (when room search is active)
  const sortedPersons = useMemo(() => {
    if (!filters.roomSearch || filteredRooms.length === 0) {
      return filteredPersons;
    }

    // Get the topmost room's assigned person IDs
    const topRoom = filteredRooms[0];
    const assignedPersonIds = roomAssignments.get(topRoom.id) || new Set();

    // Partition into assigned and unassigned
    const assigned: Person[] = [];
    const unassigned: Person[] = [];

    for (const person of filteredPersons) {
      if (assignedPersonIds.has(person.id)) {
        assigned.push(person);
      } else {
        unassigned.push(person);
      }
    }

    // Assigned persons - sort by category+alpha
    assigned.sort((a, b) => {
      const typeOrderA = PERSON_TYPE_ORDER[a.person_type] ?? 99;
      const typeOrderB = PERSON_TYPE_ORDER[b.person_type] ?? 99;
      if (typeOrderA !== typeOrderB) return typeOrderA - typeOrderB;
      return a.display_name.localeCompare(b.display_name);
    });

    return [...assigned, ...unassigned];
  }, [filteredPersons, filteredRooms, filters.roomSearch, roomAssignments]);

  // Filter update functions
  const togglePersonType = useCallback((type: PersonType) => {
    setFilters(prev => {
      const newTypes = new Set(prev.personTypes);
      if (newTypes.has(type)) {
        newTypes.delete(type);
      } else {
        newTypes.add(type);
      }
      return { ...prev, personTypes: newTypes };
    });
  }, []);

  const toggleRoomType = useCallback((type: RoomType) => {
    setFilters(prev => {
      const newTypes = new Set(prev.roomTypes);
      if (newTypes.has(type)) {
        newTypes.delete(type);
      } else {
        newTypes.add(type);
      }
      return { ...prev, roomTypes: newTypes };
    });
  }, []);

  const setPersonSearch = useCallback((search: string) => {
    setFilters(prev => ({ ...prev, personSearch: search }));
  }, []);

  const setRoomSearch = useCallback((search: string) => {
    setFilters(prev => ({ ...prev, roomSearch: search }));
  }, []);

  const getAssignment = useCallback((personId: string, roomId: string): string | null => {
    return assignmentMap.get(createAssignmentKey(personId, roomId)) || null;
  }, [assignmentMap]);

  return {
    // Data
    persons: sortedPersons,
    rooms: sortedRooms,
    getAssignment,
    loading,
    error,

    // Filters
    filters,
    togglePersonType,
    toggleRoomType,
    setPersonSearch,
    setRoomSearch,

    // Constants for UI
    allPersonTypes: ALL_PERSON_TYPES,
    allRoomTypes: ALL_ROOM_TYPES,
  };
}
