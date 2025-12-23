import React from 'react';

export interface ImportResult {
  name: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  roomId?: string;
  error?: string;
}

interface BulkImportProgressProps {
  results: ImportResult[];
  onOpenRoom: (roomId: string) => void;
  onRetry: (name: string) => void;
}

export function BulkImportProgress({
  results,
  onOpenRoom,
  onRetry,
}: BulkImportProgressProps) {
  if (results.length === 0) {
    return null;
  }

  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;
  const pendingCount = results.filter(r => r.status === 'pending' || r.status === 'processing').length;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Summary header */}
      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Import Progress</span>
        <div className="flex items-center gap-3 text-xs">
          {successCount > 0 && (
            <span className="text-green-600">{successCount} created</span>
          )}
          {errorCount > 0 && (
            <span className="text-red-600">{errorCount} failed</span>
          )}
          {pendingCount > 0 && (
            <span className="text-gray-500">{pendingCount} pending</span>
          )}
        </div>
      </div>

      {/* Results list */}
      <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
        {results.map((result, index) => (
          <div
            key={`${result.name}-${index}`}
            className="px-4 py-3 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 min-w-0">
              {/* Status icon */}
              {result.status === 'pending' && (
                <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
              )}
              {result.status === 'processing' && (
                <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
              )}
              {result.status === 'success' && (
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {result.status === 'error' && (
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}

              {/* Name and status text */}
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {result.name}
                </div>
                {result.status === 'processing' && (
                  <div className="text-xs text-gray-500">Creating...</div>
                )}
                {result.status === 'success' && (
                  <div className="text-xs text-green-600">Created successfully</div>
                )}
                {result.status === 'error' && (
                  <div className="text-xs text-red-600 truncate">{result.error}</div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {result.status === 'success' && result.roomId && (
                <button
                  onClick={() => onOpenRoom(result.roomId!)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  Open
                </button>
              )}
              {result.status === 'error' && (
                <button
                  onClick={() => onRetry(result.name)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
