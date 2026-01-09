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

      // Extract Excel data
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
        }
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

      // Build room name to ID mapping
      const roomIdByName = new Map<string, string>();
      for (const room of rooms) {
        roomIdByName.set(room.title, room.id);
      }

      // Build Hazu assignment set for selected person type and room type
      // Only include assignments where the person is of selected type and room is of selected type
      const personIds = new Set(persons.map(p => p.id));
      const roomIds = new Set(rooms.map(r => r.id));

      const hazuPairs = new Set<string>();
      const hazuPairDetails = new Map<string, { email: string; roomName: string; personName: string }>();

      for (const assignment of assignments) {
        // Filter to only relevant assignments
        if (!personIds.has(assignment.person_id) || !roomIds.has(assignment.room_id)) {
          continue;
        }

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
