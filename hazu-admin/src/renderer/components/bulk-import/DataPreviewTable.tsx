import React, { useState, useRef } from 'react';
import ColumnMappingDropdown, { ColumnMapping, MappingMode } from './ColumnMappingDropdown';

interface DataPreviewTableProps {
  headers: string[];
  rows: Record<string, string>[];
  columnMappings: Record<string, ColumnMapping>;
  onColumnMappingChange: (header: string, mapping: ColumnMapping | null) => void;
  validationWarnings?: Record<string, number[]>;
  showTemplateGroup?: boolean;
  maxRows?: number;
  mode?: MappingMode;
}

const mappingLabels: Record<ColumnMapping, string> = {
  roomName: 'Room Name',
  firstName: 'First Name',
  lastName: 'Last Name',
  email: 'Email',
  grouping1: 'Grouping 1',
  grouping2: 'Grouping 2',
  templateGroup: 'Template Group',
};

export function DataPreviewTable({
  headers,
  rows,
  columnMappings,
  onColumnMappingChange,
  validationWarnings = {},
  showTemplateGroup = false,
  maxRows = 100,
  mode = 'person',
}: DataPreviewTableProps) {
  const [openDropdownHeader, setOpenDropdownHeader] = useState<string | null>(null);
  const headerRefs = useRef<Record<string, HTMLTableCellElement | null>>({});

  const displayRows = rows.slice(0, maxRows);
  const hasMore = rows.length > maxRows;

  // Get list of currently used mappings (excluding the one for openDropdownHeader)
  const getUsedMappings = (excludeHeader?: string): ColumnMapping[] => {
    return Object.entries(columnMappings)
      .filter(([header]) => header !== excludeHeader)
      .map(([_, mapping]) => mapping);
  };

  const handleColumnClick = (header: string) => {
    setOpenDropdownHeader(openDropdownHeader === header ? null : header);
  };

  const handleMappingSelect = (header: string, mapping: ColumnMapping | null) => {
    onColumnMappingChange(header, mapping);
    setOpenDropdownHeader(null);
  };

  const formatWarningTooltip = (rowNumbers: number[]): string => {
    const limit = 5;
    const displayRows = rowNumbers.slice(0, limit);
    const remaining = rowNumbers.length - limit;

    const rowsText = displayRows.join(', ');
    const moreText = remaining > 0 ? ` +${remaining} more` : '';

    return `Invalid in rows: ${rowsText}${moreText}`;
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Info bar */}
      <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 border-b border-gray-200 flex justify-between">
        <span>
          {hasMore
            ? `Showing ${maxRows} of ${rows.length} rows`
            : `${rows.length} rows`}
        </span>
        <span>Click column headers to assign meaning</span>
      </div>

      {/* Table container with scroll */}
      <div className="overflow-auto max-h-64">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 sticky top-0">
            <tr>
              {headers.map((header) => {
                const mapping = columnMappings[header];
                const isMapped = !!mapping;
                const warnings = validationWarnings[header];
                const hasWarnings = warnings && warnings.length > 0;

                return (
                  <th
                    key={header}
                    ref={(el) => { headerRefs.current[header] = el; }}
                    onClick={() => handleColumnClick(header)}
                    className={`
                      px-3 py-2 text-left font-medium cursor-pointer transition-colors relative
                      ${isMapped
                        ? 'bg-blue-100 text-blue-800'
                        : 'text-gray-700 hover:bg-gray-200'}
                    `}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col items-start min-w-0">
                        <span className="truncate max-w-32">{header}</span>
                        {isMapped && (
                          <span className="text-xs font-normal text-blue-600">
                            [{mappingLabels[mapping]}]
                          </span>
                        )}
                      </div>
                      {hasWarnings && (
                        <span
                          className="flex-shrink-0 text-yellow-600 cursor-help"
                          title={formatWarningTooltip(warnings)}
                        >
                          ⚠️
                        </span>
                      )}
                    </div>

                    {/* Dropdown */}
                    {openDropdownHeader === header && (
                      <ColumnMappingDropdown
                        isOpen={true}
                        onClose={() => setOpenDropdownHeader(null)}
                        onSelect={(mapping) => handleMappingSelect(header, mapping)}
                        currentMapping={mapping || null}
                        usedMappings={getUsedMappings(header)}
                        showTemplateGroup={showTemplateGroup}
                        mode={mode}
                        anchorRef={{ current: headerRefs.current[header] }}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {displayRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-gray-50">
                {headers.map((header) => {
                  const isMapped = !!columnMappings[header];

                  return (
                    <td
                      key={header}
                      className={`
                        px-3 py-2 truncate max-w-48
                        ${isMapped ? 'bg-blue-50' : ''}
                      `}
                    >
                      {row[header]}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
