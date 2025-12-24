import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { RoomType } from '../../shared/types';
import { FileUploader } from '../components/bulk-import/FileUploader';
import { DataPreviewTable } from '../components/bulk-import/DataPreviewTable';
import { RoomTypeSelector } from '../components/bulk-import/RoomTypeSelector';
import { VariableTabs } from '../components/bulk-import/VariableTabs';
import { RoomConfigurator } from '../components/bulk-import/RoomConfigurator';
import { useTaskQueue } from '../contexts/TaskQueueContext';

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
  const { addCreateRoomTask } = useTaskQueue();

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

  // Handle room creation - adds tasks to queue
  const handleCreateRooms = useCallback(() => {
    if (!roomType) return;

    const targetId = findTargetId(roomType);
    if (!targetId) {
      alert(`No parent location found for type: ${roomType}`);
      return;
    }

    // Add each configured room to the task queue
    roomConfigs.forEach((config, name) => {
      if (config.templateId) {
        addCreateRoomTask({
          roomName: config.newName || name,
          templateId: config.templateId,
          targetId,
        });
      }
    });
  }, [roomType, roomConfigs, findTargetId, addCreateRoomTask]);

  // Handle start over
  const handleStartOver = useCallback(() => {
    setFileData(null);
    setMappedColumn(null);
    setSelectedValue(null);
    setRoomConfigs(new Map());
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
              >
                Upload different file
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer with action button */}
      <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {readyCount > 0
            ? `${readyCount} room${readyCount !== 1 ? 's' : ''} ready to create`
            : 'Select templates for rooms to create'}
        </div>
        <button
          onClick={handleCreateRooms}
          disabled={readyCount === 0 || !roomType}
          className={`px-6 py-2 rounded-lg transition-colors ${
            readyCount > 0 && roomType
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          Add {readyCount} Room{readyCount !== 1 ? 's' : ''} to Queue
        </button>
      </div>
    </div>
  );
}

export default BulkImportPage;
