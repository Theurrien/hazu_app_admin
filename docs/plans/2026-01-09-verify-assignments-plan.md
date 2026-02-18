# Verify Assignments Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Verify" tab to the Bulk Import page that compares Excel person-room relationships against Hazu data and shows discrepancies.

**Architecture:** New tab component in BulkImportPage that reuses shared file state, adds person/room type selectors and column mappings, performs fuzzy room name matching, and displays two discrepancy lists.

**Tech Stack:** React, TypeScript, Tailwind CSS. No new dependencies - Levenshtein distance implemented locally.

---

## Task 1: Add Fuzzy Matching Utility

**Files:**
- Create: `src/renderer/utils/fuzzyMatch.ts`

**Step 1: Create the fuzzy matching module**

```typescript
// src/renderer/utils/fuzzyMatch.ts

export type MatchingMode = 'strict' | 'normal' | 'loose';

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity percentage between two strings (0-100)
 */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  const distance = levenshteinDistance(a, b);
  return ((maxLen - distance) / maxLen) * 100;
}

/**
 * Normalize a string for comparison: lowercase, trim, collapse whitespace
 */
function normalize(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Extract tokens from a string (split by whitespace)
 */
function tokenize(str: string): string[] {
  return normalize(str).split(' ').filter(Boolean);
}

/**
 * Check if all tokens from shorter string are found in longer string
 */
function tokensMatch(a: string, b: string): boolean {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const [shorter, longer] = tokensA.length <= tokensB.length
    ? [tokensA, tokensB]
    : [tokensB, tokensA];

  return shorter.every(token =>
    longer.some(t => t.includes(token) || token.includes(t))
  );
}

export interface MatchResult {
  matched: boolean;
  matchedValue: string | null;
  score: number;
}

/**
 * Find best match for a value in a list of candidates using specified mode
 */
export function findBestMatch(
  value: string,
  candidates: string[],
  mode: MatchingMode
): MatchResult {
  const normalizedValue = normalize(value);

  if (candidates.length === 0) {
    return { matched: false, matchedValue: null, score: 0 };
  }

  // Strict mode: exact case-insensitive match
  if (mode === 'strict') {
    const exactMatch = candidates.find(c => normalize(c) === normalizedValue);
    return {
      matched: !!exactMatch,
      matchedValue: exactMatch || null,
      score: exactMatch ? 100 : 0,
    };
  }

  // Find best match by similarity
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const normalizedCandidate = normalize(candidate);
    const score = similarity(normalizedValue, normalizedCandidate);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  // Normal mode: similarity >= 85%
  if (mode === 'normal') {
    return {
      matched: bestScore >= 85,
      matchedValue: bestScore >= 85 ? bestMatch : null,
      score: bestScore,
    };
  }

  // Loose mode: similarity >= 60% OR all tokens match
  if (mode === 'loose') {
    const hasTokenMatch = bestMatch && tokensMatch(value, bestMatch);
    const matched = bestScore >= 60 || hasTokenMatch;
    return {
      matched,
      matchedValue: matched ? bestMatch : null,
      score: bestScore,
    };
  }

  return { matched: false, matchedValue: null, score: 0 };
}

/**
 * Build a mapping from Excel room names to Hazu room names
 */
export function buildRoomMapping(
  excelRoomNames: string[],
  hazuRoomNames: string[],
  mode: MatchingMode
): Map<string, string | null> {
  const mapping = new Map<string, string | null>();

  for (const excelName of excelRoomNames) {
    const result = findBestMatch(excelName, hazuRoomNames, mode);
    mapping.set(excelName, result.matchedValue);
  }

  return mapping;
}
```

**Step 2: Verify file was created**

Run: `ls -la src/renderer/utils/`

**Step 3: Commit**

```bash
git add src/renderer/utils/fuzzyMatch.ts
git commit -m "feat: add fuzzy matching utility for room name comparison"
```

---

## Task 2: Add Column Mapping Mode for Verify Workflow

**Files:**
- Modify: `src/renderer/components/bulk-import/ColumnMappingDropdown.tsx`

**Step 1: Extend ColumnMapping type and add verify mode**

In `ColumnMappingDropdown.tsx`, update the type definition and add 'verify' mode:

```typescript
// Line 3: Update ColumnMapping type
export type ColumnMapping = 'roomName' | 'firstName' | 'lastName' | 'email' | 'grouping1' | 'grouping2' | 'templateGroup' | 'verifyEmail' | 'verifyRoomName';

// Line 5: Update MappingMode type
export type MappingMode = 'room' | 'person' | 'verify';

// Line 18-27: Update mappingLabels
const mappingLabels: Record<ColumnMapping, string> = {
  roomName: 'Room Name',
  firstName: 'First Name',
  lastName: 'Last Name',
  email: 'Email',
  grouping1: 'Grouping 1',
  grouping2: 'Grouping 2',
  templateGroup: 'Template Group',
  verifyEmail: 'Person Email',
  verifyRoomName: 'Room Name',
};
```

**Step 2: Add verify mode rendering in the component**

After line 157 (after the room mode block), add:

```typescript
  // Verify mode: email and room name options
  if (mode === 'verify') {
    return (
      <div
        ref={dropdownRef}
        className={`${positionClass} bg-white border border-gray-300 rounded-md shadow-lg z-50 min-w-[200px]`}
        style={positionStyle}
      >
        <div className="py-1">
          {renderOption('verifyEmail')}
          {renderOption('verifyRoomName')}

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

**Step 3: Commit**

```bash
git add src/renderer/components/bulk-import/ColumnMappingDropdown.tsx
git commit -m "feat: add verify mode to column mapping dropdown"
```

---

## Task 3: Create VerificationResults Component

**Files:**
- Create: `src/renderer/components/bulk-import/VerificationResults.tsx`

**Step 1: Create the component**

```typescript
// src/renderer/components/bulk-import/VerificationResults.tsx

import React, { useState } from 'react';

export interface DiscrepancyItem {
  email: string;
  roomName: string;
  personName?: string;
}

interface VerificationResultsProps {
  missingInHazu: DiscrepancyItem[];
  extraInHazu: DiscrepancyItem[];
  unmatchedRooms: string[];
  unknownPersons: string[];
  isLoading?: boolean;
}

export function VerificationResults({
  missingInHazu,
  extraInHazu,
  unmatchedRooms,
  unknownPersons,
  isLoading = false,
}: VerificationResultsProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['missing', 'extra'])
  );

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-gray-500">Verifying assignments...</div>
      </div>
    );
  }

  const totalDiscrepancies = missingInHazu.length + extraInHazu.length;

  if (totalDiscrepancies === 0 && unmatchedRooms.length === 0 && unknownPersons.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
        <div className="text-green-600 font-medium">All assignments match</div>
        <div className="text-green-500 text-sm mt-1">
          No discrepancies found between Excel and Hazu
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Missing in Hazu */}
      {missingInHazu.length > 0 && (
        <div className="border border-orange-200 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('missing')}
            className="w-full flex items-center justify-between px-4 py-3 bg-orange-50 hover:bg-orange-100 transition-colors"
          >
            <span className="font-medium text-orange-800">
              Missing in Hazu ({missingInHazu.length})
            </span>
            <span className="text-orange-600">
              {expandedSections.has('missing') ? '▼' : '▶'}
            </span>
          </button>
          {expandedSections.has('missing') && (
            <div className="max-h-64 overflow-y-auto">
              <table className="min-w-full divide-y divide-orange-100">
                <thead className="bg-orange-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-orange-700">Person</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-orange-700">Room</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-orange-100">
                  {missingInHazu.map((item, idx) => (
                    <tr key={idx} className="hover:bg-orange-50">
                      <td className="px-4 py-2 text-sm">
                        <div className="text-gray-900">{item.personName || item.email}</div>
                        {item.personName && (
                          <div className="text-gray-500 text-xs">{item.email}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-700">{item.roomName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Extra in Hazu */}
      {extraInHazu.length > 0 && (
        <div className="border border-blue-200 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('extra')}
            className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 hover:bg-blue-100 transition-colors"
          >
            <span className="font-medium text-blue-800">
              Extra in Hazu ({extraInHazu.length})
            </span>
            <span className="text-blue-600">
              {expandedSections.has('extra') ? '▼' : '▶'}
            </span>
          </button>
          {expandedSections.has('extra') && (
            <div className="max-h-64 overflow-y-auto">
              <table className="min-w-full divide-y divide-blue-100">
                <thead className="bg-blue-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-blue-700">Person</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-blue-700">Room</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-blue-100">
                  {extraInHazu.map((item, idx) => (
                    <tr key={idx} className="hover:bg-blue-50">
                      <td className="px-4 py-2 text-sm">
                        <div className="text-gray-900">{item.personName || item.email}</div>
                        {item.personName && (
                          <div className="text-gray-500 text-xs">{item.email}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-700">{item.roomName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Unmatched Rooms */}
      {unmatchedRooms.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('unmatched')}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <span className="font-medium text-gray-700">
              Unmatched Room Names ({unmatchedRooms.length})
            </span>
            <span className="text-gray-500">
              {expandedSections.has('unmatched') ? '▼' : '▶'}
            </span>
          </button>
          {expandedSections.has('unmatched') && (
            <div className="p-4 max-h-48 overflow-y-auto">
              <p className="text-sm text-gray-500 mb-2">
                These room names from Excel could not be matched to any Hazu room:
              </p>
              <ul className="space-y-1">
                {unmatchedRooms.map((room, idx) => (
                  <li key={idx} className="text-sm text-gray-700">• {room}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Unknown Persons */}
      {unknownPersons.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('unknown')}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <span className="font-medium text-gray-700">
              Unknown Persons ({unknownPersons.length})
            </span>
            <span className="text-gray-500">
              {expandedSections.has('unknown') ? '▼' : '▶'}
            </span>
          </button>
          {expandedSections.has('unknown') && (
            <div className="p-4 max-h-48 overflow-y-auto">
              <p className="text-sm text-gray-500 mb-2">
                These emails from Excel are not found in Hazu:
              </p>
              <ul className="space-y-1">
                {unknownPersons.map((email, idx) => (
                  <li key={idx} className="text-sm text-gray-700">• {email}</li>
                ))}
              </ul>
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
git add src/renderer/components/bulk-import/VerificationResults.tsx
git commit -m "feat: add VerificationResults component for displaying discrepancies"
```

---

## Task 4: Create VerifyAssignmentsTab Component

**Files:**
- Create: `src/renderer/components/bulk-import/VerifyAssignmentsTab.tsx`

**Step 1: Create the main tab component**

```typescript
// src/renderer/components/bulk-import/VerifyAssignmentsTab.tsx

import React, { useState, useMemo, useCallback } from 'react';
import type { PersonType, RoomType } from '../../../shared/types';
import type { ColumnMapping } from './ColumnMappingDropdown';
import { DataPreviewTable } from './DataPreviewTable';
import { VerificationResults, DiscrepancyItem } from './VerificationResults';
import { buildRoomMapping, MatchingMode } from '../../utils/fuzzyMatch';

interface FileData {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
}

interface VerifyAssignmentsTabProps {
  fileData: FileData | null;
}

const personTypeLabels: Record<PersonType, string> = {
  student: 'Student',
  companymentor: 'Company Mentor',
  schoolteacher: 'School Teacher',
  courseteacher: 'Course Teacher',
  stateadvisor: 'State Advisor',
  guardian: 'Guardian',
};

const roomTypeLabels: Record<RoomType, string> = {
  state: 'Canton/State',
  class: 'Class',
  enterprise: 'Enterprise',
  cie: 'CIE Location',
};

interface VerificationResult {
  missingInHazu: DiscrepancyItem[];
  extraInHazu: DiscrepancyItem[];
  unmatchedRooms: string[];
  unknownPersons: string[];
}

export function VerifyAssignmentsTab({ fileData }: VerifyAssignmentsTabProps) {
  // Selection state
  const [selectedPersonType, setSelectedPersonType] = useState<PersonType | null>(null);
  const [selectedRoomType, setSelectedRoomType] = useState<RoomType | null>(null);
  const [matchingMode, setMatchingMode] = useState<MatchingMode>('normal');

  // Column mapping state
  const [columnMappings, setColumnMappings] = useState<Record<string, ColumnMapping>>({});

  // Verification state
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);

  // Get mapped column headers
  const emailColumn = useMemo(() => {
    return Object.entries(columnMappings).find(([, mapping]) => mapping === 'verifyEmail')?.[0] || null;
  }, [columnMappings]);

  const roomNameColumn = useMemo(() => {
    return Object.entries(columnMappings).find(([, mapping]) => mapping === 'verifyRoomName')?.[0] || null;
  }, [columnMappings]);

  // Handle column mapping change
  const handleColumnMappingChange = useCallback((header: string, mapping: ColumnMapping | null) => {
    setColumnMappings(prev => {
      const newMappings = { ...prev };
      if (mapping === null) {
        delete newMappings[header];
      } else {
        // Remove existing mapping of same type
        for (const [key, value] of Object.entries(newMappings)) {
          if (value === mapping) {
            delete newMappings[key];
          }
        }
        newMappings[header] = mapping;
      }
      return newMappings;
    });
    // Clear results when mapping changes
    setVerificationResult(null);
  }, []);

  // Check if ready to verify
  const canVerify = fileData && selectedPersonType && selectedRoomType && emailColumn && roomNameColumn;

  // Run verification
  const handleVerify = useCallback(async () => {
    if (!canVerify || !fileData || !emailColumn || !roomNameColumn) return;

    setIsVerifying(true);
    setVerificationResult(null);

    try {
      // Fetch data from database
      const [persons, rooms, assignments] = await Promise.all([
        window.electronAPI.getPersons(selectedPersonType!),
        window.electronAPI.getRooms(selectedRoomType!),
        window.electronAPI.getAllAssignments(),
      ]);

      // Build lookup maps
      const personsByEmail = new Map<string, { id: string; name: string }>();
      for (const person of persons) {
        if (person.email) {
          personsByEmail.set(person.email.toLowerCase(), {
            id: person.id,
            name: person.display_name,
          });
        }
      }

      const roomsById = new Map<string, string>();
      const roomNamesList: string[] = [];
      for (const room of rooms) {
        roomsById.set(room.id, room.title);
        roomNamesList.push(room.title);
      }

      // Build room name to ID mapping
      const roomIdByName = new Map<string, string>();
      for (const room of rooms) {
        roomIdByName.set(room.title.toLowerCase(), room.id);
      }

      // Extract Excel data
      const excelPairs = new Set<string>();
      const excelRoomNames = new Set<string>();
      const unknownPersons: string[] = [];

      for (const row of fileData.rows) {
        const email = row[emailColumn]?.trim().toLowerCase();
        const roomName = row[roomNameColumn]?.trim();

        if (!email || !roomName) continue;

        excelRoomNames.add(roomName);

        if (!personsByEmail.has(email)) {
          if (!unknownPersons.includes(email)) {
            unknownPersons.push(email);
          }
          continue;
        }

        excelPairs.add(`${email}|${roomName}`);
      }

      // Build fuzzy room mapping
      const roomMapping = buildRoomMapping(
        Array.from(excelRoomNames),
        roomNamesList,
        matchingMode
      );

      // Find unmatched rooms
      const unmatchedRooms: string[] = [];
      for (const [excelName, hazuName] of roomMapping.entries()) {
        if (!hazuName) {
          unmatchedRooms.push(excelName);
        }
      }

      // Build Hazu assignment set for selected person type and room type
      const hazuPairs = new Set<string>();
      const hazuPairDetails = new Map<string, { email: string; roomName: string; personName: string }>();

      for (const assignment of assignments) {
        const person = persons.find(p => p.id === assignment.person_id);
        const roomName = roomsById.get(assignment.room_id);

        if (!person || !person.email || !roomName) continue;

        const email = person.email.toLowerCase();
        const key = `${email}|${roomName}`;
        hazuPairs.add(key);
        hazuPairDetails.set(key, {
          email,
          roomName,
          personName: person.display_name,
        });
      }

      // Compare: Missing in Hazu (in Excel but not in Hazu)
      const missingInHazu: DiscrepancyItem[] = [];
      for (const row of fileData.rows) {
        const email = row[emailColumn]?.trim().toLowerCase();
        const excelRoomName = row[roomNameColumn]?.trim();

        if (!email || !excelRoomName) continue;
        if (!personsByEmail.has(email)) continue;

        const hazuRoomName = roomMapping.get(excelRoomName);
        if (!hazuRoomName) continue;

        const key = `${email}|${hazuRoomName}`;
        if (!hazuPairs.has(key)) {
          const person = personsByEmail.get(email);
          missingInHazu.push({
            email,
            roomName: excelRoomName,
            personName: person?.name,
          });
        }
      }

      // Compare: Extra in Hazu (in Hazu but not in Excel)
      const extraInHazu: DiscrepancyItem[] = [];

      // Build normalized Excel pairs using mapped room names
      const normalizedExcelPairs = new Set<string>();
      for (const row of fileData.rows) {
        const email = row[emailColumn]?.trim().toLowerCase();
        const excelRoomName = row[roomNameColumn]?.trim();

        if (!email || !excelRoomName) continue;

        const hazuRoomName = roomMapping.get(excelRoomName);
        if (hazuRoomName) {
          normalizedExcelPairs.add(`${email}|${hazuRoomName}`);
        }
      }

      for (const [key, details] of hazuPairDetails.entries()) {
        if (!normalizedExcelPairs.has(key)) {
          extraInHazu.push(details);
        }
      }

      // Deduplicate results
      const dedupeByKey = (items: DiscrepancyItem[]) => {
        const seen = new Set<string>();
        return items.filter(item => {
          const key = `${item.email}|${item.roomName}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };

      setVerificationResult({
        missingInHazu: dedupeByKey(missingInHazu),
        extraInHazu: dedupeByKey(extraInHazu),
        unmatchedRooms,
        unknownPersons,
      });
    } catch (error) {
      console.error('Verification error:', error);
    } finally {
      setIsVerifying(false);
    }
  }, [canVerify, fileData, emailColumn, roomNameColumn, selectedPersonType, selectedRoomType, matchingMode]);

  if (!fileData) {
    return (
      <div className="text-center py-12 text-gray-500">
        Please upload a file first using the file uploader above.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Data preview */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">Data Preview</h3>
        <DataPreviewTable
          headers={fileData.headers}
          rows={fileData.rows}
          columnMappings={columnMappings}
          onColumnMappingChange={handleColumnMappingChange}
          mode="verify"
        />
      </div>

      {/* Relationship Selection */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">Relationship to Verify</h3>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Person Type</label>
            <select
              value={selectedPersonType || ''}
              onChange={(e) => {
                setSelectedPersonType(e.target.value as PersonType || null);
                setVerificationResult(null);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select person type...</option>
              {(Object.keys(personTypeLabels) as PersonType[]).map(type => (
                <option key={type} value={type}>{personTypeLabels[type]}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Room Type</label>
            <select
              value={selectedRoomType || ''}
              onChange={(e) => {
                setSelectedRoomType(e.target.value as RoomType || null);
                setVerificationResult(null);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select room type...</option>
              {(Object.keys(roomTypeLabels) as RoomType[]).map(type => (
                <option key={type} value={type}>{roomTypeLabels[type]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Matching Mode */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">Room Name Matching</h3>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="matchingMode"
              checked={matchingMode === 'strict'}
              onChange={() => {
                setMatchingMode('strict');
                setVerificationResult(null);
              }}
              className="w-4 h-4 text-blue-600"
            />
            <span className="text-sm text-gray-700">Strict</span>
            <span className="text-xs text-gray-400">(exact match)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="matchingMode"
              checked={matchingMode === 'normal'}
              onChange={() => {
                setMatchingMode('normal');
                setVerificationResult(null);
              }}
              className="w-4 h-4 text-blue-600"
            />
            <span className="text-sm text-gray-700">Normal</span>
            <span className="text-xs text-gray-400">(minor typos)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="matchingMode"
              checked={matchingMode === 'loose'}
              onChange={() => {
                setMatchingMode('loose');
                setVerificationResult(null);
              }}
              className="w-4 h-4 text-blue-600"
            />
            <span className="text-sm text-gray-700">Loose</span>
            <span className="text-xs text-gray-400">(abbreviations)</span>
          </label>
        </div>
      </div>

      {/* Verify Button */}
      <div>
        <button
          onClick={handleVerify}
          disabled={!canVerify || isVerifying}
          className={`px-6 py-2 rounded-lg transition-colors ${
            canVerify && !isVerifying
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {isVerifying ? 'Verifying...' : 'Verify Assignments'}
        </button>
        {!canVerify && (
          <p className="text-sm text-gray-500 mt-2">
            {!emailColumn && 'Map an email column. '}
            {!roomNameColumn && 'Map a room name column. '}
            {!selectedPersonType && 'Select person type. '}
            {!selectedRoomType && 'Select room type.'}
          </p>
        )}
      </div>

      {/* Results */}
      {(verificationResult || isVerifying) && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">Verification Results</h3>
          <VerificationResults
            missingInHazu={verificationResult?.missingInHazu || []}
            extraInHazu={verificationResult?.extraInHazu || []}
            unmatchedRooms={verificationResult?.unmatchedRooms || []}
            unknownPersons={verificationResult?.unknownPersons || []}
            isLoading={isVerifying}
          />
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/bulk-import/VerifyAssignmentsTab.tsx
git commit -m "feat: add VerifyAssignmentsTab component for assignment verification"
```

---

## Task 5: Update DataPreviewTable for Verify Mode

**Files:**
- Modify: `src/renderer/components/bulk-import/DataPreviewTable.tsx`

**Step 1: Read current file to understand structure**

**Step 2: Add verify mode support**

Update the props interface to accept 'verify' mode and pass it to ColumnMappingDropdown.

**Step 3: Commit**

```bash
git add src/renderer/components/bulk-import/DataPreviewTable.tsx
git commit -m "feat: add verify mode support to DataPreviewTable"
```

---

## Task 6: Integrate Verify Tab into BulkImportPage

**Files:**
- Modify: `src/renderer/pages/BulkImportPage.tsx`

**Step 1: Add imports**

At top of file, add:
```typescript
import { VerifyAssignmentsTab } from '../components/bulk-import/VerifyAssignmentsTab';
```

**Step 2: Update Workflow type**

Change line 31 from:
```typescript
type Workflow = 'room' | 'person' | 'assignment';
```
to:
```typescript
type Workflow = 'room' | 'person' | 'assignment' | 'verify';
```

**Step 3: Add Verify tab button**

In the header section (around line 545-554), add a new button:
```typescript
<button
  onClick={() => setActiveWorkflow('verify')}
  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
    activeWorkflow === 'verify'
      ? 'bg-blue-600 text-white'
      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
  }`}
>
  Verify
</button>
```

**Step 4: Add Verify tab content**

Replace the placeholder assignment workflow (around line 692-696) with:
```typescript
{/* Assignment workflow placeholder */}
{activeWorkflow === 'assignment' && (
  <div className="text-center py-12 text-gray-500">
    Assignment workflow coming soon...
  </div>
)}

{/* Verify workflow */}
{activeWorkflow === 'verify' && (
  <VerifyAssignmentsTab fileData={fileData} />
)}
```

**Step 5: Commit**

```bash
git add src/renderer/pages/BulkImportPage.tsx
git commit -m "feat: integrate Verify tab into BulkImportPage"
```

---

## Task 7: Test and Fix Integration

**Step 1: Build the application**

Run: `npm run build`

**Step 2: Start and test**

Run: `npm start`

Test the following:
1. Navigate to Bulk Import page
2. Upload an Excel file
3. Switch to Verify tab - file should persist
4. Map email and room name columns
5. Select person type and room type
6. Choose matching mode
7. Click Verify
8. Check results display correctly

**Step 3: Fix any issues discovered**

**Step 4: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: resolve integration issues in verify assignments feature"
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | `src/renderer/utils/fuzzyMatch.ts` | Fuzzy matching utility |
| 2 | `ColumnMappingDropdown.tsx` | Add verify mode |
| 3 | `VerificationResults.tsx` | Results display component |
| 4 | `VerifyAssignmentsTab.tsx` | Main tab component |
| 5 | `DataPreviewTable.tsx` | Add verify mode support |
| 6 | `BulkImportPage.tsx` | Integrate verify tab |
| 7 | - | Test and fix |

Total: ~500 lines of new code across 4 new files and 3 modified files.
