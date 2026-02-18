# Assignment Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Assignment workflow to Bulk Import page for assigning existing users to existing rooms via Excel upload.

**Architecture:** Extend BulkImportPage with assignment tab, add matching/resolution components, use distribution_groups table for API calls.

**Tech Stack:** TypeScript, React, Electron IPC, SQLite, Tailwind CSS

---

### Task 1: Add IPC Channels and Handlers for User Types

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/preload.ts`

**Step 1: Add channel constants to ipc-channels.ts**

Add after line 48 (after PROFILE_TEMPLATES_FETCH):

```typescript
  // User Types (for assignment workflow)
  USER_TYPES_GET_ALL: 'userTypes:getAll',

  // Distribution Groups
  DISTRIBUTION_GROUPS_GET: 'distributionGroups:get',
```

**Step 2: Add IPC handler for getUserTypes in ipc/index.ts**

Add after the PROFILE_TEMPLATES_FETCH handler section (around line 582):

```typescript
  // ============================================================================
  // USER TYPES
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.USER_TYPES_GET_ALL, async () => {
    try {
      return query('SELECT id, name, title FROM user_types ORDER BY title');
    } catch (error) {
      console.error('Get user types error:', error);
      throw error;
    }
  });

  // ============================================================================
  // DISTRIBUTION GROUPS
  // ============================================================================

  ipcMain.handle(
    IPC_CHANNELS.DISTRIBUTION_GROUPS_GET,
    async (_event, roomId: string, role: string) => {
      try {
        return get(
          'SELECT id FROM distribution_groups WHERE room_id = ? AND role = ?',
          [roomId, role]
        );
      } catch (error) {
        console.error('Get distribution group error:', error);
        throw error;
      }
    }
  );
```

**Step 3: Update preload.ts channels and expose methods**

Add to IPC_CHANNELS constant (after PROFILE_TEMPLATES_FETCH line 32):

```typescript
  USER_TYPES_GET_ALL: 'userTypes:getAll',
  DISTRIBUTION_GROUPS_GET: 'distributionGroups:get',
```

Add to contextBridge.exposeInMainWorld (after fetchProfileTemplates around line 127):

```typescript
  // User Types
  getUserTypes: () =>
    ipcRenderer.invoke(IPC_CHANNELS.USER_TYPES_GET_ALL),

  // Distribution Groups
  getDistributionGroup: (roomId: string, role: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DISTRIBUTION_GROUPS_GET, roomId, role),
```

Add to Window interface (after fetchProfileTemplates around line 229):

```typescript
      getUserTypes: () => Promise<Array<{ id: string; name: string; title: string }>>;
      getDistributionGroup: (roomId: string, role: string) => Promise<{ id: string } | undefined>;
```

**Step 4: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/ipc/index.ts src/main/preload.ts
git commit -m "feat(ipc): add user types and distribution groups handlers"
```

---

### Task 2: Add Assignment Mode to ColumnMappingDropdown

**Files:**
- Modify: `src/renderer/components/bulk-import/ColumnMappingDropdown.tsx`

**Step 1: Update ColumnMapping type**

Update line 3:

```typescript
export type ColumnMapping = 'roomName' | 'firstName' | 'lastName' | 'email' | 'grouping1' | 'grouping2' | 'templateGroup' | 'verifyEmail' | 'verifyRoomName' | 'assignEmail' | 'assignRoom';
```

**Step 2: Update MappingMode type**

Update line 5:

```typescript
export type MappingMode = 'room' | 'person' | 'verify' | 'assignment';
```

**Step 3: Add labels for new mappings**

Update mappingLabels (add after verifyRoomName):

```typescript
  assignEmail: 'Email',
  assignRoom: 'Room',
```

**Step 4: Add assignment mode rendering**

Add before the person mode return (around line 160, before `// Person mode`):

```typescript
  // Assignment mode: email and room options
  if (mode === 'assignment') {
    return (
      <div
        ref={dropdownRef}
        className={`${positionClass} bg-white border border-gray-300 rounded-md shadow-lg z-50 min-w-[200px]`}
        style={positionStyle}
      >
        <div className="py-1">
          {renderOption('assignEmail')}
          {renderOption('assignRoom')}

          <div className="border-t border-gray-200 my-1"></div>

          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 cursor-pointer transition-colors"
          >
            <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-gray-500">
              ✕
            </span>
            <span className="text-gray-700">Clear</span>
          </button>
        </div>
      </div>
    );
  }
```

**Step 5: Update DataPreviewTable mappingLabels**

In `src/renderer/components/bulk-import/DataPreviewTable.tsx`, add to mappingLabels (around line 25):

```typescript
  assignEmail: 'Email',
  assignRoom: 'Room',
```

**Step 6: Commit**

```bash
git add src/renderer/components/bulk-import/ColumnMappingDropdown.tsx src/renderer/components/bulk-import/DataPreviewTable.tsx
git commit -m "feat(bulk-import): add assignment mode to column mapping"
```

---

### Task 3: Create AssignmentRoleSelector Component

**Files:**
- Create: `src/renderer/components/bulk-import/AssignmentRoleSelector.tsx`

**Step 1: Create the component**

```typescript
import React, { useEffect, useState } from 'react';

interface UserType {
  id: string;
  name: string;
  title: string;
}

interface AssignmentRoleSelectorProps {
  selectedRole: string | null;
  onRoleChange: (role: string) => void;
  disabled?: boolean;
}

export function AssignmentRoleSelector({
  selectedRole,
  onRoleChange,
  disabled = false,
}: AssignmentRoleSelectorProps) {
  const [userTypes, setUserTypes] = useState<UserType[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadUserTypes = async () => {
      setIsLoading(true);
      try {
        const types = await window.electronAPI.getUserTypes();
        setUserTypes(types);
      } catch (error) {
        console.error('Failed to load user types:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadUserTypes();
  }, []);

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-24 mb-3"></div>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-gray-200 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  if (userTypes.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No roles available. Please run sync first.
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-3">
        Role <span className="text-red-500">*</span>
      </label>
      <div className="grid grid-cols-3 gap-2">
        {userTypes.map((type) => (
          <label
            key={type.id}
            className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
              selectedRole === type.name
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              name="assignmentRole"
              value={type.name}
              checked={selectedRole === type.name}
              onChange={(e) => onRoleChange(e.target.value)}
              className="w-4 h-4 text-blue-600"
              disabled={disabled}
            />
            <span className="text-sm font-medium text-gray-900">
              {type.title}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/bulk-import/AssignmentRoleSelector.tsx
git commit -m "feat(bulk-import): add AssignmentRoleSelector component"
```

---

### Task 4: Create GroupedRoomSelector Component

**Files:**
- Create: `src/renderer/components/bulk-import/GroupedRoomSelector.tsx`

**Step 1: Create the component**

```typescript
import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { RoomType } from '../../../shared/types';

interface Room {
  id: string;
  title: string;
  room_type: string;
}

interface GroupedRoomSelectorProps {
  rooms: Room[];
  value: string | null;
  onChange: (roomId: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

const roomTypeLabels: Record<RoomType, string> = {
  class: 'Class',
  enterprise: 'Enterprise',
  state: 'Canton/State',
  cie: 'CIE',
};

const roomTypeOrder: RoomType[] = ['class', 'enterprise', 'cie', 'state'];

export function GroupedRoomSelector({
  rooms,
  value,
  onChange,
  placeholder = 'Select room...',
  disabled = false,
}: GroupedRoomSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<RoomType | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get selected room title
  const selectedRoom = value ? rooms.find((r) => r.id === value) : null;

  // Group rooms by type
  const groupedRooms = useMemo(() => {
    const groups: Record<RoomType, Room[]> = {
      class: [],
      enterprise: [],
      cie: [],
      state: [],
    };

    rooms.forEach((room) => {
      const type = room.room_type as RoomType;
      if (groups[type]) {
        groups[type].push(room);
      }
    });

    // Sort rooms within each group
    Object.keys(groups).forEach((type) => {
      groups[type as RoomType].sort((a, b) => a.title.localeCompare(b.title));
    });

    return groups;
  }, [rooms]);

  // Filter rooms by search and selected type
  const filteredRooms = useMemo(() => {
    if (!selectedType) return [];

    let filtered = groupedRooms[selectedType];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((room) =>
        room.title.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [groupedRooms, selectedType, searchQuery]);

  // Count rooms per type
  const roomCounts = useMemo(() => {
    const counts: Record<RoomType, number> = {
      class: groupedRooms.class.length,
      enterprise: groupedRooms.enterprise.length,
      cie: groupedRooms.cie.length,
      state: groupedRooms.state.length,
    };
    return counts;
  }, [groupedRooms]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && selectedType && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, selectedType]);

  const handleOpen = () => {
    if (!disabled) {
      setIsOpen(true);
      setSearchQuery('');
    }
  };

  const handleSelectType = (type: RoomType) => {
    setSelectedType(type);
    setSearchQuery('');
  };

  const handleSelectRoom = (roomId: string) => {
    onChange(roomId);
    setIsOpen(false);
    setSelectedType(null);
    setSearchQuery('');
  };

  const handleClear = () => {
    onChange(null);
    setIsOpen(false);
    setSelectedType(null);
    setSearchQuery('');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Selected value display / trigger */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={`
          w-full px-3 py-2 text-left border rounded-lg text-sm
          ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white cursor-pointer hover:border-gray-400'}
          ${isOpen ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300'}
          flex items-center justify-between
        `}
      >
        <span className={selectedRoom ? 'text-gray-900' : 'text-gray-500'}>
          {selectedRoom ? (
            <>
              {selectedRoom.title}
              <span className="text-gray-400 ml-2">
                ({roomTypeLabels[selectedRoom.room_type as RoomType]})
              </span>
            </>
          ) : (
            placeholder
          )}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg overflow-hidden">
          {!selectedType ? (
            // Type selection
            <div className="py-1">
              {roomTypeOrder.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleSelectType(type)}
                  disabled={roomCounts[type] === 0}
                  className={`
                    w-full px-4 py-2 text-left text-sm flex items-center justify-between
                    ${roomCounts[type] === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100 cursor-pointer'}
                  `}
                >
                  <span>{roomTypeLabels[type]}</span>
                  <span className="text-gray-400">{roomCounts[type]}</span>
                </button>
              ))}

              {value && (
                <>
                  <div className="border-t border-gray-200 my-1"></div>
                  <button
                    type="button"
                    onClick={handleClear}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    Clear selection
                  </button>
                </>
              )}
            </div>
          ) : (
            // Room selection within type
            <div>
              {/* Back button + search */}
              <div className="border-b border-gray-200 p-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedType(null)}
                    className="p-1 hover:bg-gray-100 rounded"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span className="text-sm font-medium text-gray-700">
                    {roomTypeLabels[selectedType]}
                  </span>
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full mt-2 px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Room list */}
              <div className="max-h-48 overflow-y-auto">
                {filteredRooms.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500 text-center">
                    No rooms found
                  </div>
                ) : (
                  filteredRooms.map((room) => (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => handleSelectRoom(room.id)}
                      className={`
                        w-full px-4 py-2 text-left text-sm hover:bg-gray-100 cursor-pointer
                        ${room.id === value ? 'bg-blue-50 text-blue-700' : ''}
                      `}
                    >
                      {room.title}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/bulk-import/GroupedRoomSelector.tsx
git commit -m "feat(bulk-import): add GroupedRoomSelector component"
```

---

### Task 5: Create PersonMatchingPanel Component

**Files:**
- Create: `src/renderer/components/bulk-import/PersonMatchingPanel.tsx`

**Step 1: Create the component**

```typescript
import React, { useState, useMemo } from 'react';

interface Person {
  id: string;
  email: string | null;
  display_name: string;
}

interface PersonMatchingPanelProps {
  emails: string[];
  persons: Person[];
  personMatches: Map<string, string | null>;
  personResolutions: Map<string, string>;
  onResolutionChange: (email: string, personId: string | null) => void;
}

export function PersonMatchingPanel({
  emails,
  persons,
  personMatches,
  personResolutions,
  onResolutionChange,
}: PersonMatchingPanelProps) {
  const [searchQueries, setSearchQueries] = useState<Map<string, string>>(new Map());

  // Count matched and unmatched
  const { matchedCount, unmatchedEmails } = useMemo(() => {
    let matched = 0;
    const unmatched: string[] = [];

    emails.forEach((email) => {
      const autoMatch = personMatches.get(email);
      const manualMatch = personResolutions.get(email);

      if (autoMatch || manualMatch) {
        matched++;
      } else {
        unmatched.push(email);
      }
    });

    return { matchedCount: matched, unmatchedEmails: unmatched };
  }, [emails, personMatches, personResolutions]);

  // Get persons that are not yet matched (for dropdown options)
  const getAvailablePersons = (excludeEmail: string) => {
    const usedPersonIds = new Set<string>();

    emails.forEach((email) => {
      if (email === excludeEmail) return;

      const autoMatch = personMatches.get(email);
      const manualMatch = personResolutions.get(email);
      if (autoMatch) usedPersonIds.add(autoMatch);
      if (manualMatch) usedPersonIds.add(manualMatch);
    });

    return persons.filter((p) => !usedPersonIds.has(p.id));
  };

  // Filter persons by search query
  const filterPersons = (availablePersons: Person[], query: string) => {
    if (!query.trim()) return availablePersons.slice(0, 50); // Limit to 50

    const lowerQuery = query.toLowerCase();
    return availablePersons
      .filter(
        (p) =>
          p.display_name.toLowerCase().includes(lowerQuery) ||
          p.email?.toLowerCase().includes(lowerQuery)
      )
      .slice(0, 50);
  };

  const handleSearchChange = (email: string, query: string) => {
    setSearchQueries((prev) => new Map(prev).set(email, query));
  };

  const handleSelectPerson = (email: string, personId: string) => {
    onResolutionChange(email, personId);
    setSearchQueries((prev) => {
      const next = new Map(prev);
      next.delete(email);
      return next;
    });
  };

  if (emails.length === 0) {
    return null;
  }

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-300 px-4 py-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Person Matching</h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-green-600">✓ {matchedCount} matched</span>
          {unmatchedEmails.length > 0 && (
            <span className="text-yellow-600">⚠ {unmatchedEmails.length} unmatched</span>
          )}
        </div>
      </div>

      {/* Unmatched list */}
      {unmatchedEmails.length > 0 && (
        <div className="max-h-64 overflow-y-auto">
          <div className="divide-y divide-gray-200">
            {unmatchedEmails.map((email) => {
              const searchQuery = searchQueries.get(email) || '';
              const availablePersons = getAvailablePersons(email);
              const filteredPersons = filterPersons(availablePersons, searchQuery);
              const currentResolution = personResolutions.get(email);

              return (
                <div key={email} className="px-4 py-3">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {email}
                      </div>
                      <div className="text-xs text-red-500">No match found</div>
                    </div>

                    <div className="flex-1">
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Search person..."
                          value={currentResolution ? '' : searchQuery}
                          onChange={(e) => handleSearchChange(email, e.target.value)}
                          disabled={!!currentResolution}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                        />

                        {/* Search results dropdown */}
                        {searchQuery && !currentResolution && (
                          <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                            {filteredPersons.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500">
                                No persons found
                              </div>
                            ) : (
                              filteredPersons.map((person) => (
                                <button
                                  key={person.id}
                                  type="button"
                                  onClick={() => handleSelectPerson(email, person.id)}
                                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                                >
                                  <div className="font-medium">{person.display_name}</div>
                                  {person.email && (
                                    <div className="text-xs text-gray-500">{person.email}</div>
                                  )}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                      {/* Show selected resolution */}
                      {currentResolution && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-sm text-green-600">
                            → {persons.find((p) => p.id === currentResolution)?.display_name}
                          </span>
                          <button
                            type="button"
                            onClick={() => onResolutionChange(email, null)}
                            className="text-xs text-gray-500 hover:text-red-500"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All matched message */}
      {unmatchedEmails.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-green-600">
          All emails matched successfully!
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/bulk-import/PersonMatchingPanel.tsx
git commit -m "feat(bulk-import): add PersonMatchingPanel component"
```

---

### Task 6: Create RoomMatchingPanel Component

**Files:**
- Create: `src/renderer/components/bulk-import/RoomMatchingPanel.tsx`

**Step 1: Create the component**

```typescript
import React from 'react';
import { GroupedRoomSelector } from './GroupedRoomSelector';

interface Room {
  id: string;
  title: string;
  room_type: string;
}

interface RoomMatchingPanelProps {
  uniqueRoomValues: string[];
  rooms: Room[];
  roomMatches: Map<string, string | null>;
  roomResolutions: Map<string, string>;
  onResolutionChange: (roomValue: string, roomId: string | null) => void;
}

export function RoomMatchingPanel({
  uniqueRoomValues,
  rooms,
  roomMatches,
  roomResolutions,
  onResolutionChange,
}: RoomMatchingPanelProps) {
  // Count matched and unmatched
  const matchedCount = uniqueRoomValues.filter((value) => {
    const autoMatch = roomMatches.get(value);
    const manualMatch = roomResolutions.get(value);
    return autoMatch || manualMatch;
  }).length;

  const unmatchedCount = uniqueRoomValues.length - matchedCount;

  // Get resolved room ID for a value (auto-match or manual resolution)
  const getResolvedRoomId = (value: string): string | null => {
    return roomResolutions.get(value) || roomMatches.get(value) || null;
  };

  if (uniqueRoomValues.length === 0) {
    return null;
  }

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-300 px-4 py-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Room Matching</h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-green-600">✓ {matchedCount} matched</span>
          {unmatchedCount > 0 && (
            <span className="text-yellow-600">⚠ {unmatchedCount} unmatched</span>
          )}
        </div>
      </div>

      {/* Room value list */}
      <div className="max-h-80 overflow-y-auto">
        <div className="divide-y divide-gray-200">
          {uniqueRoomValues.map((value) => {
            const autoMatch = roomMatches.get(value);
            const resolvedId = getResolvedRoomId(value);
            const isAutoMatched = !!autoMatch;

            return (
              <div key={value} className="px-4 py-3">
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      "{value}"
                    </div>
                    {isAutoMatched ? (
                      <div className="text-xs text-green-500">Auto-matched</div>
                    ) : (
                      <div className="text-xs text-yellow-500">No exact match</div>
                    )}
                  </div>

                  <div className="flex-1">
                    <GroupedRoomSelector
                      rooms={rooms}
                      value={resolvedId}
                      onChange={(roomId) => onResolutionChange(value, roomId)}
                      placeholder="Select room..."
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/bulk-import/RoomMatchingPanel.tsx
git commit -m "feat(bulk-import): add RoomMatchingPanel component"
```

---

### Task 7: Add Execute Assignments IPC Handler

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/preload.ts`

**Step 1: Add channel constant to ipc-channels.ts**

Add after DISTRIBUTION_GROUPS_GET:

```typescript
  ASSIGNMENTS_EXECUTE: 'assignments:execute',
```

**Step 2: Add IPC handler in ipc/index.ts**

Add after the DISTRIBUTION_GROUPS_GET handler:

```typescript
  ipcMain.handle(
    IPC_CHANNELS.ASSIGNMENTS_EXECUTE,
    async (
      _event,
      payload: {
        assignments: Array<{
          personId: string;
          personEmail: string;
          firstName: string;
          lastName: string;
          roomId: string;
          role: string;
        }>;
      }
    ) => {
      try {
        // Get config from settings
        const rootHazuId = get<{ value: string }>("SELECT value FROM settings WHERE key = 'root_hazu_id'")?.value;
        const adminId = get<{ value: string }>("SELECT value FROM settings WHERE key = 'admin_id'")?.value;

        if (!rootHazuId || !adminId) {
          return { success: false, error: 'Configuration missing. Please run sync first.' };
        }

        // Group assignments by person (aggregate classIds)
        const byPerson = new Map<
          string,
          {
            personId: string;
            personEmail: string;
            firstName: string;
            lastName: string;
            classIds: Array<{ classId: string; userType: string }>;
          }
        >();

        for (const assignment of payload.assignments) {
          // Look up distribution group
          const distGroup = get<{ id: string }>(
            'SELECT id FROM distribution_groups WHERE room_id = ? AND role = ?',
            [assignment.roomId, assignment.role]
          );

          if (!distGroup) {
            console.warn(
              `[ASSIGNMENTS_EXECUTE] No distribution group for room ${assignment.roomId} and role ${assignment.role}`
            );
            continue;
          }

          const existing = byPerson.get(assignment.personId);
          if (existing) {
            existing.classIds.push({
              classId: distGroup.id,
              userType: assignment.role,
            });
          } else {
            byPerson.set(assignment.personId, {
              personId: assignment.personId,
              personEmail: assignment.personEmail,
              firstName: assignment.firstName,
              lastName: assignment.lastName,
              classIds: [{ classId: distGroup.id, userType: assignment.role }],
            });
          }
        }

        // Build API payload
        const users = Array.from(byPerson.values()).map((person) => ({
          sourceId: rootHazuId,
          adminId: adminId,
          targetId: person.personId,
          userEmail: person.personEmail,
          firstName: person.firstName,
          lastName: person.lastName,
          classIds: person.classIds,
        }));

        if (users.length === 0) {
          return { success: false, error: 'No valid assignments to execute.' };
        }

        console.log('[ASSIGNMENTS_EXECUTE] Sending', users.length, 'users to API');

        // Call API
        const { getApiEndpoint, getApiHeaders } = await import('../services/hazu-api/config');
        const response = await axios.post(
          `${getApiEndpoint()}/api-v2-admin/add-users`,
          { users },
          { headers: getApiHeaders(), timeout: 120000 }
        );

        console.log('[ASSIGNMENTS_EXECUTE] Response:', response.status, response.data);

        // Update local DB with new assignments
        const now = Date.now();
        for (const assignment of payload.assignments) {
          run(
            `INSERT OR REPLACE INTO person_room_assignments (person_id, room_id, role, synced_at)
             VALUES (?, ?, ?, ?)`,
            [assignment.personId, assignment.roomId, assignment.role, now]
          );
        }

        return {
          success: true,
          totalUsers: response.data.totalUsers || users.length,
          successful: response.data.successful || users.length,
          failed: response.data.failed || 0,
        };
      } catch (error) {
        console.error('Execute assignments error:', error);
        let message = 'Unknown error';
        if (axios.isAxiosError(error)) {
          message = error.response?.data?.message || error.message;
        } else if (error instanceof Error) {
          message = error.message;
        }
        return { success: false, error: message };
      }
    }
  );
```

**Step 3: Update preload.ts**

Add to IPC_CHANNELS constant:

```typescript
  ASSIGNMENTS_EXECUTE: 'assignments:execute',
```

Add to contextBridge.exposeInMainWorld:

```typescript
  executeAssignments: (payload: {
    assignments: Array<{
      personId: string;
      personEmail: string;
      firstName: string;
      lastName: string;
      roomId: string;
      role: string;
    }>;
  }) => ipcRenderer.invoke(IPC_CHANNELS.ASSIGNMENTS_EXECUTE, payload),
```

Add to Window interface:

```typescript
      executeAssignments: (payload: {
        assignments: Array<{
          personId: string;
          personEmail: string;
          firstName: string;
          lastName: string;
          roomId: string;
          role: string;
        }>;
      }) => Promise<{
        success: boolean;
        totalUsers?: number;
        successful?: number;
        failed?: number;
        error?: string;
      }>;
```

**Step 4: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/ipc/index.ts src/main/preload.ts
git commit -m "feat(ipc): add executeAssignments handler"
```

---

### Task 8: Integrate Assignment Workflow in BulkImportPage

**Files:**
- Modify: `src/renderer/pages/BulkImportPage.tsx`

**Step 1: Add imports**

Add at top with other imports:

```typescript
import { AssignmentRoleSelector } from '../components/bulk-import/AssignmentRoleSelector';
import { PersonMatchingPanel } from '../components/bulk-import/PersonMatchingPanel';
import { RoomMatchingPanel } from '../components/bulk-import/RoomMatchingPanel';
```

**Step 2: Add assignment workflow state**

Add after the existing state declarations (around line 82):

```typescript
  // Assignment workflow state
  const [assignmentEmailColumn, setAssignmentEmailColumn] = useState<string | null>(null);
  const [assignmentRoomColumn, setAssignmentRoomColumn] = useState<string | null>(null);
  const [selectedAssignmentRole, setSelectedAssignmentRole] = useState<string | null>(null);
  const [assignmentColumnMappings, setAssignmentColumnMappings] = useState<Record<string, ColumnMapping>>({});

  // Assignment matching
  const [personMatches, setPersonMatches] = useState<Map<string, string | null>>(new Map());
  const [personResolutions, setPersonResolutions] = useState<Map<string, string>>(new Map());
  const [roomMatches, setRoomMatches] = useState<Map<string, string | null>>(new Map());
  const [roomResolutions, setRoomResolutions] = useState<Map<string, string>>(new Map());

  // Persons for matching
  const [persons, setPersons] = useState<Array<{ id: string; email: string | null; display_name: string; first_name: string | null; last_name: string | null }>>([]);
```

**Step 3: Load persons on mount**

Update the loadData useEffect (around line 86):

```typescript
  useEffect(() => {
    const loadData = async () => {
      const [roomsData, config, personsData] = await Promise.all([
        window.electronAPI.getRooms(),
        window.electronAPI.getApiConfig(),
        window.electronAPI.getPersons(),
      ]);
      setRooms(roomsData);
      setRootHazuId(config.rootHazuId);
      setPersons(personsData);
    };
    loadData();
  }, []);
```

**Step 4: Add assignment column mapping handler**

Add after handleColumnMappingChange (around line 354):

```typescript
  // Handle assignment column mapping change
  const handleAssignmentColumnMappingChange = useCallback((header: string, mapping: ColumnMapping | null) => {
    setAssignmentColumnMappings(prev => {
      const newMappings = { ...prev };
      if (mapping === null) {
        delete newMappings[header];
      } else {
        newMappings[header] = mapping;
      }
      return newMappings;
    });

    // Update column references
    if (mapping === 'assignEmail') {
      setAssignmentEmailColumn(header);
    } else if (mapping === 'assignRoom') {
      setAssignmentRoomColumn(header);
    }

    // Clear if removed
    if (mapping === null) {
      if (assignmentColumnMappings[header] === 'assignEmail') {
        setAssignmentEmailColumn(null);
      } else if (assignmentColumnMappings[header] === 'assignRoom') {
        setAssignmentRoomColumn(null);
      }
    }
  }, [assignmentColumnMappings]);
```

**Step 5: Add person matching logic**

Add after the above:

```typescript
  // Compute person matches when email column changes
  useEffect(() => {
    if (!fileData || !assignmentEmailColumn) {
      setPersonMatches(new Map());
      return;
    }

    const matches = new Map<string, string | null>();
    const seenEmails = new Set<string>();

    fileData.rows.forEach((row) => {
      const email = row[assignmentEmailColumn]?.trim().toLowerCase();
      if (!email || seenEmails.has(email)) return;
      seenEmails.add(email);

      const person = persons.find((p) => p.email?.toLowerCase() === email);
      matches.set(email, person?.id || null);
    });

    setPersonMatches(matches);
    setPersonResolutions(new Map()); // Clear resolutions when column changes
  }, [fileData, assignmentEmailColumn, persons]);

  // Get unique emails from file
  const uniqueEmails = useMemo(() => {
    if (!fileData || !assignmentEmailColumn) return [];
    const emails = new Set<string>();
    fileData.rows.forEach((row) => {
      const email = row[assignmentEmailColumn]?.trim().toLowerCase();
      if (email) emails.add(email);
    });
    return Array.from(emails);
  }, [fileData, assignmentEmailColumn]);
```

**Step 6: Add room matching logic**

Add after the above:

```typescript
  // Extract unique room values and compute matches
  const uniqueAssignmentRoomValues = useMemo(() => {
    if (!fileData || !assignmentRoomColumn) return [];
    const values = new Set<string>();
    fileData.rows.forEach((row) => {
      const value = row[assignmentRoomColumn]?.trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort();
  }, [fileData, assignmentRoomColumn]);

  // Compute room matches when room column changes
  useEffect(() => {
    if (!fileData || !assignmentRoomColumn) {
      setRoomMatches(new Map());
      return;
    }

    const matches = new Map<string, string | null>();

    uniqueAssignmentRoomValues.forEach((value) => {
      const room = rooms.find(
        (r) => r.title.toLowerCase() === value.toLowerCase()
      );
      matches.set(value, room?.id || null);
    });

    setRoomMatches(matches);
    setRoomResolutions(new Map()); // Clear resolutions when column changes
  }, [fileData, assignmentRoomColumn, rooms, uniqueAssignmentRoomValues]);
```

**Step 7: Add resolved mappings computation**

Add after the above:

```typescript
  // Get resolved person ID (auto or manual)
  const getResolvedPersonId = useCallback((email: string): string | null => {
    return personResolutions.get(email) || personMatches.get(email) || null;
  }, [personMatches, personResolutions]);

  // Get resolved room ID (auto or manual)
  const getResolvedRoomId = useCallback((roomValue: string): string | null => {
    return roomResolutions.get(roomValue) || roomMatches.get(roomValue) || null;
  }, [roomMatches, roomResolutions]);

  // Count valid assignments
  const validAssignmentCount = useMemo(() => {
    if (!fileData || !assignmentEmailColumn || !assignmentRoomColumn) return 0;

    let count = 0;
    fileData.rows.forEach((row) => {
      const email = row[assignmentEmailColumn]?.trim().toLowerCase();
      const roomValue = row[assignmentRoomColumn]?.trim();

      if (email && roomValue) {
        const personId = getResolvedPersonId(email);
        const roomId = getResolvedRoomId(roomValue);

        if (personId && roomId) {
          count++;
        }
      }
    });

    return count;
  }, [fileData, assignmentEmailColumn, assignmentRoomColumn, getResolvedPersonId, getResolvedRoomId]);
```

**Step 8: Add execute handler**

Add after the above:

```typescript
  // Handle assignment execution
  const handleExecuteAssignments = useCallback(async () => {
    if (!fileData || !assignmentEmailColumn || !assignmentRoomColumn || !selectedAssignmentRole) {
      return;
    }

    const assignments: Array<{
      personId: string;
      personEmail: string;
      firstName: string;
      lastName: string;
      roomId: string;
      role: string;
    }> = [];

    fileData.rows.forEach((row) => {
      const email = row[assignmentEmailColumn]?.trim().toLowerCase();
      const roomValue = row[assignmentRoomColumn]?.trim();

      if (!email || !roomValue) return;

      const personId = getResolvedPersonId(email);
      const roomId = getResolvedRoomId(roomValue);

      if (!personId || !roomId) return;

      const person = persons.find((p) => p.id === personId);
      if (!person) return;

      assignments.push({
        personId,
        personEmail: person.email || email,
        firstName: person.first_name || '',
        lastName: person.last_name || '',
        roomId,
        role: selectedAssignmentRole,
      });
    });

    if (assignments.length === 0) {
      alert('No valid assignments to execute.');
      return;
    }

    try {
      const result = await window.electronAPI.executeAssignments({ assignments });

      if (result.success) {
        alert(`Successfully assigned ${result.successful} users to rooms!`);
        // Reset assignment state
        setAssignmentEmailColumn(null);
        setAssignmentRoomColumn(null);
        setAssignmentColumnMappings({});
        setPersonMatches(new Map());
        setPersonResolutions(new Map());
        setRoomMatches(new Map());
        setRoomResolutions(new Map());
        setSelectedAssignmentRole(null);
      } else {
        alert(`Assignment failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Execute assignments error:', error);
      alert('Failed to execute assignments. Check console for details.');
    }
  }, [
    fileData,
    assignmentEmailColumn,
    assignmentRoomColumn,
    selectedAssignmentRole,
    persons,
    getResolvedPersonId,
    getResolvedRoomId,
  ]);
```

**Step 9: Update handleStartOver to reset assignment state**

Update handleStartOver (around line 508):

```typescript
  const handleStartOver = useCallback(() => {
    setFileData(null);
    setMappedColumn(null);
    setSelectedValue(null);
    setRoomConfigs(new Map());
    setRoomType(null);
    setColumnMappings({});
    setRoomAssignments(new Map());
    setTemplatesByGroup(new Map());
    // Reset assignment state
    setAssignmentEmailColumn(null);
    setAssignmentRoomColumn(null);
    setAssignmentColumnMappings({});
    setPersonMatches(new Map());
    setPersonResolutions(new Map());
    setRoomMatches(new Map());
    setRoomResolutions(new Map());
    setSelectedAssignmentRole(null);
  }, []);
```

**Step 10: Update the assignment workflow section in render**

Replace the placeholder (around line 704-708):

```typescript
        {/* Assignment workflow */}
        {activeWorkflow === 'assignment' && fileData && (
          <>
            {/* Data preview with assignment column mapping */}
            <DataPreviewTable
              headers={fileData.headers}
              rows={fileData.rows}
              columnMappings={assignmentColumnMappings}
              onColumnMappingChange={handleAssignmentColumnMappingChange}
              mode="assignment"
            />

            {/* Role selector */}
            {assignmentEmailColumn && assignmentRoomColumn && (
              <div className="mt-6">
                <AssignmentRoleSelector
                  selectedRole={selectedAssignmentRole}
                  onRoleChange={setSelectedAssignmentRole}
                />
              </div>
            )}

            {/* Person matching panel */}
            {assignmentEmailColumn && (
              <div className="mt-6">
                <PersonMatchingPanel
                  emails={uniqueEmails}
                  persons={persons}
                  personMatches={personMatches}
                  personResolutions={personResolutions}
                  onResolutionChange={(email, personId) => {
                    setPersonResolutions(prev => {
                      const next = new Map(prev);
                      if (personId) {
                        next.set(email, personId);
                      } else {
                        next.delete(email);
                      }
                      return next;
                    });
                  }}
                />
              </div>
            )}

            {/* Room matching panel */}
            {assignmentRoomColumn && (
              <div className="mt-6">
                <RoomMatchingPanel
                  uniqueRoomValues={uniqueAssignmentRoomValues}
                  rooms={rooms}
                  roomMatches={roomMatches}
                  roomResolutions={roomResolutions}
                  onResolutionChange={(roomValue, roomId) => {
                    setRoomResolutions(prev => {
                      const next = new Map(prev);
                      if (roomId) {
                        next.set(roomValue, roomId);
                      } else {
                        next.delete(roomValue);
                      }
                      return next;
                    });
                  }}
                />
              </div>
            )}
          </>
        )}
```

**Step 11: Add footer for assignment workflow**

Add after the person workflow footer (around line 769):

```typescript
      {/* Footer with action button - Assignment workflow */}
      {activeWorkflow === 'assignment' && fileData && (
        <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {validAssignmentCount > 0
              ? `${validAssignmentCount} assignment${validAssignmentCount !== 1 ? 's' : ''} ready`
              : 'Map columns and resolve matches to enable assignment'}
          </div>
          <button
            onClick={handleExecuteAssignments}
            disabled={validAssignmentCount === 0 || !selectedAssignmentRole}
            className={`px-6 py-2 rounded-lg transition-colors ${
              validAssignmentCount > 0 && selectedAssignmentRole
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            Assign {validAssignmentCount} Person{validAssignmentCount !== 1 ? 's' : ''} to Rooms
          </button>
        </div>
      )}
```

**Step 12: Commit**

```bash
git add src/renderer/pages/BulkImportPage.tsx
git commit -m "feat(bulk-import): integrate assignment workflow"
```

---

### Task 9: Build and Test

**Step 1: Build the app**

```bash
npm run build
```

**Step 2: Start the app**

```bash
npm start
```

**Step 3: Test the workflow**

1. Go to Bulk Import → Assignment tab
2. Upload an Excel with email and room columns
3. Click column headers to map Email and Room
4. Select a role (Student, etc.)
5. Verify person matching shows matched/unmatched counts
6. Verify room matching shows auto-matches
7. Resolve any unmatched items
8. Click "Assign X Persons to Rooms"
9. Verify success message

**Step 4: Final commit if needed**

```bash
git add -A
git commit -m "fix: address any issues found during testing"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add IPC channels for user types and distribution groups | ipc-channels.ts, ipc/index.ts, preload.ts |
| 2 | Add assignment mode to ColumnMappingDropdown | ColumnMappingDropdown.tsx, DataPreviewTable.tsx |
| 3 | Create AssignmentRoleSelector component | AssignmentRoleSelector.tsx |
| 4 | Create GroupedRoomSelector component | GroupedRoomSelector.tsx |
| 5 | Create PersonMatchingPanel component | PersonMatchingPanel.tsx |
| 6 | Create RoomMatchingPanel component | RoomMatchingPanel.tsx |
| 7 | Add executeAssignments IPC handler | ipc-channels.ts, ipc/index.ts, preload.ts |
| 8 | Integrate in BulkImportPage | BulkImportPage.tsx |
| 9 | Build and test | - |

Total: 8 code tasks + 1 testing task
