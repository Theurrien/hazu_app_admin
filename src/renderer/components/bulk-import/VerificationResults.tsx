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
