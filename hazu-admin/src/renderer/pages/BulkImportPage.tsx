import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { RoomType } from '../../shared/types';
import { FileUploader } from '../components/bulk-import/FileUploader';
import { DataPreviewTable } from '../components/bulk-import/DataPreviewTable';
import { RoomTypeSelector } from '../components/bulk-import/RoomTypeSelector';
import { VariableTabs } from '../components/bulk-import/VariableTabs';
import { RoomConfigurator } from '../components/bulk-import/RoomConfigurator';
import { BulkImportProgress, ImportResult } from '../components/bulk-import/BulkImportProgress';

interface Template {
  id: string;
  title: string;
  roomType: string;
}

interface RoomConfig {
  newName: string;
  templateId: string | null;
}

interface FileData {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
}

type Workflow = 'room' | 'person' | 'assignment';

function BulkImportPage() {
  // Workflow state
  const [activeWorkflow] = useState<Workflow>('room');

  // File state
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [hasHeaders, setHasHeaders] = useState(true);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  // Room configuration state
  const [roomType, setRoomType] = useState<RoomType | null>(null);
  const [mappedColumn, setMappedColumn] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [roomConfigs, setRoomConfigs] = useState<Map<string, RoomConfig>>(new Map());

  // Templates state
  const [allTemplates, setAllTemplates] = useState<Template[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);

  // Rooms for target lookup
  const [rooms, setRooms] = useState<Array<{ id: string; room_type: string; parent_id: string | null }>>([]);
  const [rootHazuId, setRootHazuId] = useState<string | null>(null);

  // Load rooms and root ID on mount
  useEffect(() => {
    const loadData = async () => {
      const [roomsData, config] = await Promise.all([
        window.electronAPI.getRooms(),
        window.electronAPI.getApiConfig(),
      ]);
      setRooms(roomsData);
      setRootHazuId(config.rootHazuId);
    };
    loadData();
  }, []);

  // Fetch templates when room type changes
  useEffect(() => {
    if (!roomType) {
      setAllTemplates([]);
      return;
    }

    const fetchTemplates = async () => {
      setIsLoadingTemplates(true);
      try {
        const result = await window.electronAPI.fetchTemplates();
        if (result.success && result.templates) {
          setAllTemplates(result.templates);
        }
      } catch (error) {
        console.error('Failed to fetch templates:', error);
      } finally {
        setIsLoadingTemplates(false);
      }
    };

    fetchTemplates();
  }, [roomType]);

  // Filter templates by selected room type
  const filteredTemplates = useMemo(() => {
    if (!roomType) return [];
    return allTemplates.filter(t => t.roomType === roomType);
  }, [allTemplates, roomType]);

  // Extract unique values when column is mapped
  const uniqueValues = useMemo(() => {
    if (!fileData || !mappedColumn) return [];
    const values = new Set<string>();
    for (const row of fileData.rows) {
      const value = row[mappedColumn]?.trim();
      if (value) {
        values.add(value);
      }
    }
    return Array.from(values).sort();
  }, [fileData, mappedColumn]);

  // Initialize room configs when unique values change
  useEffect(() => {
    const newConfigs = new Map<string, RoomConfig>();
    for (const value of uniqueValues) {
      const existing = roomConfigs.get(value);
      newConfigs.set(value, existing || { newName: value, templateId: null });
    }
    setRoomConfigs(newConfigs);

    // Select first value if none selected
    if (uniqueValues.length > 0 && !selectedValue) {
      setSelectedValue(uniqueValues[0]);
    }
  }, [uniqueValues]);

  // Handle file loaded
  const handleFileLoaded = useCallback((data: FileData) => {
    setFileData(data);
    setMappedColumn(null);
    setSelectedValue(null);
    setRoomConfigs(new Map());
    setResults([]);
  }, []);

  // Handle column click
  const handleColumnClick = useCallback((header: string) => {
    setMappedColumn(header);
    setSelectedValue(null);
  }, []);

  // Handle config change for selected value
  const handleConfigChange = useCallback((config: RoomConfig) => {
    if (!selectedValue) return;
    setRoomConfigs(prev => {
      const newMap = new Map(prev);
      newMap.set(selectedValue, config);
      return newMap;
    });
  }, [selectedValue]);

  // Find target ID for room type
  const findTargetId = useCallback((type: RoomType): string | null => {
    const targetRoom = rooms.find(
      room => room.room_type === type && room.parent_id === rootHazuId
    );
    return targetRoom?.id || null;
  }, [rooms, rootHazuId]);

  // Count rooms ready to create
  const readyCount = useMemo(() => {
    let count = 0;
    roomConfigs.forEach(config => {
      if (config.templateId) count++;
    });
    return count;
  }, [roomConfigs]);

  // Handle room creation
  const handleCreateRooms = useCallback(async () => {
    if (!roomType) return;

    const targetId = findTargetId(roomType);
    if (!targetId) {
      alert(`No parent location found for type: ${roomType}`);
      return;
    }

    // Get rooms to create (those with templates)
    const roomsToCreate: Array<{ name: string; templateId: string; newName: string }> = [];
    roomConfigs.forEach((config, name) => {
      if (config.templateId) {
        roomsToCreate.push({
          name,
          templateId: config.templateId,
          newName: config.newName || name,
        });
      }
    });

    if (roomsToCreate.length === 0) return;

    setIsProcessing(true);

    // Initialize results
    setResults(roomsToCreate.map(room => ({
      name: room.newName,
      status: 'pending' as const,
    })));

    // Process each room sequentially
    for (let i = 0; i < roomsToCreate.length; i++) {
      const room = roomsToCreate[i];

      // Update to processing
      setResults(prev => prev.map((r, idx) =>
        idx === i ? { ...r, status: 'processing' as const } : r
      ));

      try {
        const result = await window.electronAPI.createRoom(
          room.templateId,
          targetId,
          room.newName
        );

        if (result.success && result.room) {
          setResults(prev => prev.map((r, idx) =>
            idx === i ? { ...r, status: 'success' as const, roomId: result.room.id } : r
          ));
        } else {
          setResults(prev => prev.map((r, idx) =>
            idx === i ? { ...r, status: 'error' as const, error: result.error || 'Unknown error' } : r
          ));
        }
      } catch (error) {
        setResults(prev => prev.map((r, idx) =>
          idx === i ? { ...r, status: 'error' as const, error: error instanceof Error ? error.message : 'Unknown error' } : r
        ));
      }
    }

    setIsProcessing(false);
  }, [roomType, roomConfigs, findTargetId]);

  // Handle open room
  const handleOpenRoom = useCallback(async (roomId: string) => {
    const config = await window.electronAPI.getApiConfig();
    const env = config.environment || 'swiss';
    const baseUrl = env === 'swiss' ? 'https://hazu.swiss' : env === 'io' ? 'https://hazu.io' : 'https://dev.hazu.swiss';
    const url = `${baseUrl}/#/hazu/${roomId}`;
    window.electronAPI.openExternal(url);
  }, []);

  // Handle retry
  const handleRetry = useCallback(async (name: string) => {
    // Find the original config
    const config = roomConfigs.get(name);
    if (!config?.templateId || !roomType) return;

    const targetId = findTargetId(roomType);
    if (!targetId) return;

    // Update to processing
    setResults(prev => prev.map(r =>
      r.name === name ? { ...r, status: 'processing' as const, error: undefined } : r
    ));

    try {
      const result = await window.electronAPI.createRoom(
        config.templateId,
        targetId,
        config.newName || name
      );

      if (result.success && result.room) {
        setResults(prev => prev.map(r =>
          r.name === name ? { ...r, status: 'success' as const, roomId: result.room.id } : r
        ));
      } else {
        setResults(prev => prev.map(r =>
          r.name === name ? { ...r, status: 'error' as const, error: result.error || 'Unknown error' } : r
        ));
      }
    } catch (error) {
      setResults(prev => prev.map(r =>
        r.name === name ? { ...r, status: 'error' as const, error: error instanceof Error ? error.message : 'Unknown error' } : r
      ));
    }
  }, [roomConfigs, roomType, findTargetId]);

  // Handle start over
  const handleStartOver = useCallback(() => {
    setFileData(null);
    setMappedColumn(null);
    setSelectedValue(null);
    setRoomConfigs(new Map());
    setResults([]);
    setRoomType(null);
  }, []);

  const selectedConfig = selectedValue ? roomConfigs.get(selectedValue) : null;

  return (
    <div className="h-full flex flex-col bg-white rounded-lg shadow overflow-hidden">
      {/* Header with workflow tabs */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeWorkflow === 'room'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-500 cursor-not-allowed'
            }`}
          >
            Room Creation
          </button>
          <button
            disabled
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-400 cursor-not-allowed"
          >
            Person
          </button>
          <button
            disabled
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-400 cursor-not-allowed"
          >
            Assignment
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Room type selector */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">Room Type</h3>
          <RoomTypeSelector
            selectedType={roomType}
            onTypeChange={setRoomType}
            disabled={isProcessing}
          />
        </div>

        {/* Variable configuration section - only show when column is mapped */}
        {uniqueValues.length > 0 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">
                Rooms to Create ({readyCount} of {uniqueValues.length} configured)
              </h3>
              <VariableTabs
                uniqueValues={uniqueValues}
                roomConfigs={roomConfigs}
                selectedValue={selectedValue}
                onSelectValue={setSelectedValue}
              />
            </div>

            {selectedValue && selectedConfig && (
              <RoomConfigurator
                originalName={selectedValue}
                config={selectedConfig}
                templates={filteredTemplates}
                onConfigChange={handleConfigChange}
                isLoadingTemplates={isLoadingTemplates}
              />
            )}
          </div>
        )}

        {/* File upload section */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            {fileData ? `File: ${fileData.fileName}` : 'Upload File'}
          </h3>
          {!fileData ? (
            <FileUploader
              onFileLoaded={handleFileLoaded}
              hasHeaders={hasHeaders}
              onHasHeadersChange={setHasHeaders}
              isLoading={isLoadingFile}
              setIsLoading={setIsLoadingFile}
            />
          ) : (
            <div className="space-y-3">
              <DataPreviewTable
                headers={fileData.headers}
                rows={fileData.rows}
                mappedColumn={mappedColumn}
                onColumnClick={handleColumnClick}
              />
              <button
                onClick={handleStartOver}
                className="text-sm text-gray-600 hover:text-gray-800"
                disabled={isProcessing}
              >
                Upload different file
              </button>
            </div>
          )}
        </div>

        {/* Results section */}
        {results.length > 0 && (
          <BulkImportProgress
            results={results}
            onOpenRoom={handleOpenRoom}
            onRetry={handleRetry}
          />
        )}
      </div>

      {/* Footer with action button */}
      <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {readyCount > 0
            ? `${readyCount} room${readyCount !== 1 ? 's' : ''} ready to create`
            : 'Select templates for rooms to create'}
        </div>
        <div className="flex items-center gap-3">
          {results.length > 0 && !isProcessing && (
            <button
              onClick={handleStartOver}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Start Over
            </button>
          )}
          <button
            onClick={handleCreateRooms}
            disabled={readyCount === 0 || isProcessing || !roomType}
            className={`px-6 py-2 rounded-lg transition-colors flex items-center gap-2 ${
              readyCount > 0 && !isProcessing && roomType
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isProcessing && (
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
            )}
            Create {readyCount} Room{readyCount !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BulkImportPage;
