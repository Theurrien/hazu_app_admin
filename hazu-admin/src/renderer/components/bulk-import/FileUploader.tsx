import React, { useCallback, useState } from 'react';

interface FileUploaderProps {
  onFileLoaded: (data: { headers: string[]; rows: Record<string, string>[]; fileName: string }) => void;
  hasHeaders: boolean;
  onHasHeadersChange: (value: boolean) => void;
  isLoading: boolean;
  setIsLoading: (value: boolean) => void;
}

export function FileUploader({
  onFileLoaded,
  hasHeaders,
  onHasHeadersChange,
  isLoading,
  setIsLoading,
}: FileUploaderProps) {
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const parseFilePath = useCallback(async (filePath: string) => {
    setError(null);
    setIsLoading(true);

    try {
      const result = await window.electronAPI.parseFile(filePath, hasHeaders);

      if (result.success && result.data) {
        // Extract filename from path
        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'file';
        onFileLoaded({
          headers: result.data.headers,
          rows: result.data.rows,
          fileName,
        });
      } else {
        setError(result.error || 'Failed to parse file');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setIsLoading(false);
    }
  }, [hasHeaders, onFileLoaded, setIsLoading]);

  const handleBrowseClick = useCallback(async () => {
    try {
      const result = await window.electronAPI.selectFileDialog();
      if (!result.canceled && result.filePath) {
        await parseFilePath(result.filePath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open file dialog');
    }
  }, [parseFilePath]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      // Try to get path from dropped file (works in some Electron configs)
      const filePath = (file as any).path;
      if (filePath) {
        await parseFilePath(filePath);
      } else {
        // Fallback: show error and suggest using Browse button
        setError('Drag and drop not supported. Please use the Browse Files button.');
      }
    }
  }, [parseFilePath]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  return (
    <div className="space-y-3">
      {/* Headers checkbox */}
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={hasHeaders}
          onChange={(e) => onHasHeadersChange(e.target.checked)}
          className="w-4 h-4 text-blue-600 rounded"
          disabled={isLoading}
        />
        First row contains column headers
      </label>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          border-2 border-dashed rounded-lg p-6 text-center transition-colors
          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
          ${isLoading ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 text-gray-600">
            <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
            <span>Parsing file...</span>
          </div>
        ) : (
          <>
            <div className="text-gray-600 mb-2">
              Drag and drop an Excel or CSV file here, or
            </div>
            <button
              onClick={handleBrowseClick}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors"
            >
              Browse Files
            </button>
            <div className="text-xs text-gray-400 mt-2">
              Supported: .xlsx, .xls, .csv
            </div>
          </>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}
