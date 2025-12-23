import React from 'react';

interface DataPreviewTableProps {
  headers: string[];
  rows: Record<string, string>[];
  mappedColumn: string | null;
  onColumnClick: (header: string) => void;
  maxRows?: number;
}

export function DataPreviewTable({
  headers,
  rows,
  mappedColumn,
  onColumnClick,
  maxRows = 100,
}: DataPreviewTableProps) {
  const displayRows = rows.slice(0, maxRows);
  const hasMore = rows.length > maxRows;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Info bar */}
      <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 border-b border-gray-200 flex justify-between">
        <span>
          {hasMore
            ? `Showing ${maxRows} of ${rows.length} rows`
            : `${rows.length} rows`}
        </span>
        <span>Click a column header to select the Name column</span>
      </div>

      {/* Table container with scroll */}
      <div className="overflow-auto max-h-64">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 sticky top-0">
            <tr>
              {headers.map((header) => (
                <th
                  key={header}
                  onClick={() => onColumnClick(header)}
                  className={`
                    px-3 py-2 text-left font-medium cursor-pointer transition-colors
                    ${mappedColumn === header
                      ? 'bg-blue-100 text-blue-800'
                      : 'text-gray-700 hover:bg-gray-200'}
                  `}
                >
                  <div className="flex items-center gap-2">
                    {mappedColumn === header && (
                      <span className="inline-flex items-center justify-center w-5 h-5 text-xs bg-blue-600 text-white rounded-full">
                        1
                      </span>
                    )}
                    <span className="truncate max-w-32">{header}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {displayRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-gray-50">
                {headers.map((header) => (
                  <td
                    key={header}
                    className={`
                      px-3 py-2 truncate max-w-48
                      ${mappedColumn === header ? 'bg-blue-50' : ''}
                    `}
                  >
                    {row[header]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
