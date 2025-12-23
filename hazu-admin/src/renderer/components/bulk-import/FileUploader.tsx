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

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setIsLoading(true);

    // Validate file type
    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!validExtensions.includes(extension)) {
      setError('Unsupported file format. Please upload .xlsx, .xls, or .csv files.');
      setIsLoading(false);
      return;
    }

    try {
      // Get file path - in Electron we can access the path property
      const filePath = (file as any).path;
      if (!filePath) {
        setError('Could not access file path. Please try again.');
        setIsLoading(false);
        return;
      }

      const result = await window.electronAPI.parseFile(filePath, hasHeaders);

      if (result.success && result.data) {
        onFileLoaded({
          headers: result.data.headers,
          rows: result.data.rows,
          fileName: file.name,
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

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
            <label className="inline-block">
              <span className="px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors">
                Browse Files
              </span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleInputChange}
                className="hidden"
              />
            </label>
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
