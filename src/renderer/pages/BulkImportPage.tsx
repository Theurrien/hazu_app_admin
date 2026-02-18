import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { RoomType } from '../../shared/types';
import { FileUploader } from '../components/bulk-import/FileUploader';
import { DataPreviewTable } from '../components/bulk-import/DataPreviewTable';
import { RoomTypeSelector } from '../components/bulk-import/RoomTypeSelector';
import { VariableTabs } from '../components/bulk-import/VariableTabs';
import { RoomConfigurator } from '../components/bulk-import/RoomConfigurator';
import { PersonRoleSelector } from '../components/bulk-import/PersonRoleSelector';
import { TemplateSelector } from '../components/bulk-import/TemplateSelector';
import { RoomAssignmentPanel, RoomAssignment } from '../components/bulk-import/RoomAssignmentPanel';
import type { ColumnMapping } from '../components/bulk-import/ColumnMappingDropdown';
import { VerifyAssignmentsTab } from '../components/bulk-import/VerifyAssignmentsTab';
import { useTaskQueue } from '../contexts/TaskQueueContext';
import { AssignmentRoleSelector } from '../components/bulk-import/AssignmentRoleSelector';
import { PersonMatchingPanel } from '../components/bulk-import/PersonMatchingPanel';
import { RoomMatchingPanel } from '../components/bulk-import/RoomMatchingPanel';
import { AssignmentPreviewPanel, PreviewAssignment } from '../components/bulk-import/AssignmentPreviewPanel';

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

type Workflow = 'room' | 'person' | 'assignment' | 'verify';

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function BulkImportPage() {
  const { addCreateRoomTask, addCreatePersonTask, addRoleUpdateTask } = useTaskQueue();

  // Workflow state
  const [activeWorkflow, setActiveWorkflow] = useState<Workflow>('room');

  // File state
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [hasHeaders, setHasHeaders] = useState(true);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  // Room configuration state
  const [roomType, setRoomType] = useState<RoomType | null>(null);
  const [mappedColumn, setMappedColumn] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [roomConfigs, setRoomConfigs] = useState<Map<string, RoomConfig>>(new Map());

  // Templates state (Room workflow)
  const [allTemplates, setAllTemplates] = useState<Template[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  // Person workflow state - Role & Template
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [personTemplates, setPersonTemplates] = useState<Array<{ id: string; title: string }>>([]);
  const [isLoadingPersonTemplates, setIsLoadingPersonTemplates] = useState(false);
  const [selectedPersonTemplateId, setSelectedPersonTemplateId] = useState<string | null>(null);

  // Person workflow - Template grouping mode
  const [useTemplateGrouping, setUseTemplateGrouping] = useState(false);
  const [templateGroupColumn, setTemplateGroupColumn] = useState<string | null>(null);
  const [templatesByGroup, setTemplatesByGroup] = useState<Map<string, string>>(new Map());

  // Person workflow - Column mappings
  const [columnMappings, setColumnMappings] = useState<Record<string, ColumnMapping>>({});

  // Person workflow - Room assignments
  const [roomAssignments, setRoomAssignments] = useState<Map<string, RoomAssignment>>(new Map());

  // Person workflow - Options
  const [sendInvitationEmail, setSendInvitationEmail] = useState(false);

  // Person workflow - Profile categories (for targetId lookup)
  const [profileCategories, setProfileCategories] = useState<Array<{ id: string; title: string; profileType: string }>>([]);

  // Rooms for target lookup and assignments
  const [rooms, setRooms] = useState<Array<{ id: string; title: string; room_type: string; parent_id: string | null }>>([]);
  const [rootHazuId, setRootHazuId] = useState<string | null>(null);

  // Assignment workflow state
  const [assignmentEmailColumn, setAssignmentEmailColumn] = useState<string | null>(null);
  const [assignmentRoomColumn, setAssignmentRoomColumn] = useState<string | null>(null);
  const [selectedAssignmentRole, setSelectedAssignmentRole] = useState<string | null>(null);
  const [assignmentColumnMappings, setAssignmentColumnMappings] = useState<Record<string, ColumnMapping>>({});

  // Assignment matching
  const [personMatches, setPersonMatches] = useState<Map<string, string | null>>(new Map());
  const [personResolutions, setPersonResolutions] = useState<Map<string, string>>(new Map());
  const [roomMatches, setRoomMatches] = useState<Map<string, string | null>>(new Map());
  const [roomResolutions, setRoomResolutions] = useState<Map<string, string>>(new Map());

  // Assignment preview state
  const [existingAssignments, setExistingAssignments] = useState<Array<{ person_id: string; room_id: string; role: string }>>([]);
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());
  const [roleOverrides, setRoleOverrides] = useState<Map<string, string>>(new Map());

  // Persons for matching
  const [persons, setPersons] = useState<Array<{ id: string; email: string | null; display_name: string }>>([]);

  // Load existing assignments when switching to assignment tab
  useEffect(() => {
    if (activeWorkflow === 'assignment') {
      window.electronAPI.getAllAssignments().then(setExistingAssignments);
    }
  }, [activeWorkflow]);

  // Load rooms, persons, and root ID on mount
  useEffect(() => {
    const loadData = async () => {
      const [roomsData, config, personsData] = await Promise.all([
        window.electronAPI.getRooms(),
        window.electronAPI.getApiConfig(),
        window.electronAPI.getPersons(),
      ]);
      setRooms(roomsData);
      setRootHazuId(config.rootHazuId);
      setPersons(personsData);
    };
    loadData();
  }, []);

  // Fetch templates when room type changes (Room workflow)
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

  // Fetch profile templates and categories when role changes (Person workflow)
  useEffect(() => {
    if (!selectedRole) {
      setPersonTemplates([]);
      setProfileCategories([]);
      return;
    }

    const fetchData = async () => {
      setIsLoadingPersonTemplates(true);
      try {
        const [templatesResult, categoriesResult] = await Promise.all([
          window.electronAPI.fetchProfileTemplates(selectedRole),
          window.electronAPI.fetchProfileCategories(),
        ]);

        if (templatesResult.success && templatesResult.templates) {
          setPersonTemplates(templatesResult.templates);
        }

        if (categoriesResult.success && categoriesResult.categories) {
          setProfileCategories(categoriesResult.categories);
        }
      } catch (error) {
        console.error('Failed to fetch profile data:', error);
      } finally {
        setIsLoadingPersonTemplates(false);
      }
    };

    fetchData();
  }, [selectedRole]);

  // Filter templates by selected room type (Room workflow)
  const filteredTemplates = useMemo(() => {
    if (!roomType) return [];
    return allTemplates.filter(t => t.roomType === roomType);
  }, [allTemplates, roomType]);

  // Extract unique values when column is mapped (Room workflow)
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

  // Person workflow - Get reverse mapping (columnMapping -> header)
  const getHeaderForMapping = useCallback((mapping: ColumnMapping): string | null => {
    for (const [header, m] of Object.entries(columnMappings)) {
      if (m === mapping) return header;
    }
    return null;
  }, [columnMappings]);

  // Person workflow - Extract unique grouping values
  const uniqueGroupValues = useMemo(() => {
    if (!fileData) return [];

    const grouping1Header = getHeaderForMapping('grouping1');
    const grouping2Header = getHeaderForMapping('grouping2');

    if (!grouping1Header && !grouping2Header) return [];

    const values = new Set<string>();

    for (const row of fileData.rows) {
      const parts: string[] = [];

      if (grouping1Header) {
        const val = row[grouping1Header]?.trim();
        if (val) parts.push(val);
      }

      if (grouping2Header) {
        const val = row[grouping2Header]?.trim();
        if (val) parts.push(val);
      }

      if (parts.length > 0) {
        values.add(parts.join(' - '));
      }
    }

    return Array.from(values).sort();
  }, [fileData, columnMappings, getHeaderForMapping]);

  // Person workflow - Extract unique template group values
  const uniqueTemplateGroupValues = useMemo(() => {
    if (!fileData || !templateGroupColumn) return [];

    const values = new Set<string>();
    for (const row of fileData.rows) {
      const value = row[templateGroupColumn]?.trim();
      if (value) {
        values.add(value);
      }
    }
    return Array.from(values).sort();
  }, [fileData, templateGroupColumn]);

  // Person workflow - Extract group1 values only (for separator in RoomAssignmentPanel)
  const group1Values = useMemo(() => {
    if (!fileData) return [];

    const grouping1Header = getHeaderForMapping('grouping1');
    if (!grouping1Header) return [];

    const values = new Set<string>();
    for (const row of fileData.rows) {
      const val = row[grouping1Header]?.trim();
      if (val) values.add(val);
    }
    return Array.from(values).sort();
  }, [fileData, columnMappings, getHeaderForMapping]);

  // Person workflow - Validation
  const personValidation = useMemo(() => {
    if (!fileData || activeWorkflow !== 'person') {
      return { validCount: 0, invalidCount: 0, warnings: {} };
    }

    const firstNameHeader = getHeaderForMapping('firstName');
    const lastNameHeader = getHeaderForMapping('lastName');
    const emailHeader = getHeaderForMapping('email');

    let validCount = 0;
    let invalidCount = 0;
    const warnings: Record<string, number[]> = {};

    fileData.rows.forEach((row, rowIndex) => {
      let isValid = true;

      // Check firstName
      if (!firstNameHeader || !row[firstNameHeader]?.trim()) {
        isValid = false;
        if (firstNameHeader) {
          if (!warnings[firstNameHeader]) warnings[firstNameHeader] = [];
          warnings[firstNameHeader].push(rowIndex + 1);
        }
      }

      // Check lastName
      if (!lastNameHeader || !row[lastNameHeader]?.trim()) {
        isValid = false;
        if (lastNameHeader) {
          if (!warnings[lastNameHeader]) warnings[lastNameHeader] = [];
          warnings[lastNameHeader].push(rowIndex + 1);
        }
      }

      // Check email
      const email = emailHeader ? row[emailHeader]?.trim() : '';
      if (!emailHeader || !email || !EMAIL_REGEX.test(email)) {
        isValid = false;
        if (emailHeader) {
          if (!warnings[emailHeader]) warnings[emailHeader] = [];
          warnings[emailHeader].push(rowIndex + 1);
        }
      }

      // Check template group if grouping is enabled
      if (useTemplateGrouping && templateGroupColumn) {
        const groupValue = row[templateGroupColumn]?.trim();
        if (!groupValue || !templatesByGroup.has(groupValue)) {
          isValid = false;
          if (!warnings[templateGroupColumn]) warnings[templateGroupColumn] = [];
          warnings[templateGroupColumn].push(rowIndex + 1);
        }
      }

      if (isValid) {
        validCount++;
      } else {
        invalidCount++;
      }
    });

    return { validCount, invalidCount, warnings };
  }, [fileData, activeWorkflow, columnMappings, getHeaderForMapping, useTemplateGrouping, templateGroupColumn, templatesByGroup]);

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
    // Reset Room workflow state
    setMappedColumn(null);
    setSelectedValue(null);
    setRoomConfigs(new Map());
    // Reset Person workflow state
    setColumnMappings({});
    setRoomAssignments(new Map());
    setTemplatesByGroup(new Map());
    // Reset Assignment workflow state
    setAssignmentEmailColumn(null);
    setAssignmentRoomColumn(null);
    setAssignmentColumnMappings({});
    setPersonMatches(new Map());
    setPersonResolutions(new Map());
    setRoomMatches(new Map());
    setRoomResolutions(new Map());
    setSelectedAssignmentRole(null);
  }, []);

  // Handle column click (Room workflow - old API)
  const handleColumnClick = useCallback((header: string) => {
    setMappedColumn(header);
    setSelectedValue(null);
  }, []);

  // Handle column mapping change (Person workflow - new API)
  const handleColumnMappingChange = useCallback((header: string, mapping: ColumnMapping | null) => {
    setColumnMappings(prev => {
      const newMappings = { ...prev };
      if (mapping === null) {
        delete newMappings[header];
      } else {
        newMappings[header] = mapping;
      }
      return newMappings;
    });
  }, []);

  // Handle assignment column mapping change
  const handleAssignmentColumnMappingChange = useCallback((header: string, mapping: ColumnMapping | null) => {
    setAssignmentColumnMappings(prev => {
      const newMappings = { ...prev };
      if (mapping === null) {
        delete newMappings[header];
      } else {
        newMappings[header] = mapping;
      }
      return newMappings;
    });

    // Update column references
    if (mapping === 'assignEmail') {
      setAssignmentEmailColumn(header);
    } else if (mapping === 'assignRoom') {
      setAssignmentRoomColumn(header);
    }

    // Clear if this mapping was previously set and now removed
    if (mapping === null) {
      const prevMapping = assignmentColumnMappings[header];
      if (prevMapping === 'assignEmail') {
        setAssignmentEmailColumn(null);
      } else if (prevMapping === 'assignRoom') {
        setAssignmentRoomColumn(null);
      }
    }
  }, [assignmentColumnMappings]);

  // Compute person matches when email column changes
  useEffect(() => {
    if (!fileData || !assignmentEmailColumn) {
      setPersonMatches(new Map());
      return;
    }

    const matches = new Map<string, string | null>();
    const seenEmails = new Set<string>();

    fileData.rows.forEach((row) => {
      const email = row[assignmentEmailColumn]?.trim().toLowerCase();
      if (!email || seenEmails.has(email)) return;
      seenEmails.add(email);

      const person = persons.find((p) => p.email?.toLowerCase() === email);
      matches.set(email, person?.id || null);
    });

    setPersonMatches(matches);
    setPersonResolutions(new Map()); // Clear resolutions when column changes
  }, [fileData, assignmentEmailColumn, persons]);

  // Get unique emails from file
  const uniqueEmails = useMemo(() => {
    if (!fileData || !assignmentEmailColumn) return [];
    const emails = new Set<string>();
    fileData.rows.forEach((row) => {
      const email = row[assignmentEmailColumn]?.trim().toLowerCase();
      if (email) emails.add(email);
    });
    return Array.from(emails);
  }, [fileData, assignmentEmailColumn]);

  // Extract unique room values and compute matches
  const uniqueAssignmentRoomValues = useMemo(() => {
    if (!fileData || !assignmentRoomColumn) return [];
    const values = new Set<string>();
    fileData.rows.forEach((row) => {
      const value = row[assignmentRoomColumn]?.trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort();
  }, [fileData, assignmentRoomColumn]);

  // Compute room matches when room column changes
  useEffect(() => {
    if (!fileData || !assignmentRoomColumn) {
      setRoomMatches(new Map());
      return;
    }

    const matches = new Map<string, string | null>();

    uniqueAssignmentRoomValues.forEach((value) => {
      const room = rooms.find(
        (r) => r.title.toLowerCase() === value.toLowerCase()
      );
      matches.set(value, room?.id || null);
    });

    setRoomMatches(matches);
    setRoomResolutions(new Map()); // Clear resolutions when column changes
  }, [fileData, assignmentRoomColumn, rooms, uniqueAssignmentRoomValues]);

  // Get resolved person ID (auto or manual)
  const getResolvedPersonId = useCallback((email: string): string | null => {
    return personResolutions.get(email) || personMatches.get(email) || null;
  }, [personMatches, personResolutions]);

  // Get resolved room ID (auto or manual)
  const getResolvedRoomId = useCallback((roomValue: string): string | null => {
    return roomResolutions.get(roomValue) || roomMatches.get(roomValue) || null;
  }, [roomMatches, roomResolutions]);

  // Compute preview assignments from matched data, cross-referencing existing assignments
  const previewAssignments = useMemo((): PreviewAssignment[] => {
    if (!fileData || !assignmentEmailColumn || !assignmentRoomColumn || !selectedAssignmentRole) return [];

    const result: PreviewAssignment[] = [];
    const seen = new Set<string>();

    fileData.rows.forEach((row) => {
      const email = row[assignmentEmailColumn]?.trim().toLowerCase();
      const roomValue = row[assignmentRoomColumn]?.trim();
      if (!email || !roomValue) return;

      const personId = getResolvedPersonId(email);
      const roomId = getResolvedRoomId(roomValue);
      if (!personId || !roomId) return;

      const key = `${personId}:${roomId}`;
      if (seen.has(key)) return;
      seen.add(key);

      const person = persons.find((p) => p.id === personId);
      const room = rooms.find((r) => r.id === roomId);
      if (!person) return;

      const existing = existingAssignments.find(
        (a) => a.person_id === personId && a.room_id === roomId
      );

      result.push({
        personId,
        personName: person.display_name,
        personEmail: person.email || email,
        roomId,
        roomName: room?.title || roomValue,
        role: selectedAssignmentRole,
        existingRole: existing?.role || null,
      });
    });

    return result;
  }, [fileData, assignmentEmailColumn, assignmentRoomColumn, selectedAssignmentRole, persons, rooms, existingAssignments, getResolvedPersonId, getResolvedRoomId]);

  // Auto-exclude already-assigned rows when preview changes
  useEffect(() => {
    const excluded = new Set<string>();
    previewAssignments.forEach((a) => {
      if (a.existingRole) {
        excluded.add(`${a.personId}:${a.roomId}`);
      }
    });
    setExcludedKeys(excluded);
    setRoleOverrides(new Map());
  }, [previewAssignments]);

  // Count valid assignments
  const validAssignmentCount = useMemo(() => {
    if (!fileData || !assignmentEmailColumn || !assignmentRoomColumn) return 0;

    let count = 0;
    fileData.rows.forEach((row) => {
      const email = row[assignmentEmailColumn]?.trim().toLowerCase();
      const roomValue = row[assignmentRoomColumn]?.trim();

      if (email && roomValue) {
        const personId = getResolvedPersonId(email);
        const roomId = getResolvedRoomId(roomValue);

        if (personId && roomId) {
          count++;
        }
      }
    });

    return count;
  }, [fileData, assignmentEmailColumn, assignmentRoomColumn, getResolvedPersonId, getResolvedRoomId]);

  const handleToggleExclude = useCallback((key: string) => {
    setExcludedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handlePreviewRoleChange = useCallback((key: string, newRole: string) => {
    setRoleOverrides((prev) => {
      const next = new Map(prev);
      next.set(key, newRole);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback((included: boolean) => {
    if (included) {
      setExcludedKeys(new Set());
    } else {
      setExcludedKeys(new Set(previewAssignments.map((a) => `${a.personId}:${a.roomId}`)));
    }
  }, [previewAssignments]);

  // Handle assignment execution - queues one TaskQueue task per included assignment
  const handleExecuteAssignments = useCallback(() => {
    if (!selectedAssignmentRole) return;

    const included = previewAssignments.filter(
      (a) => !excludedKeys.has(`${a.personId}:${a.roomId}`)
    );

    if (included.length === 0) return;

    for (const a of included) {
      const key = `${a.personId}:${a.roomId}`;
      const role = roleOverrides.get(key) || a.role;

      addRoleUpdateTask({
        personName: a.personName,
        personId: a.personId,
        roomName: a.roomName,
        roomId: a.roomId,
        oldRole: a.existingRole || '_',
        newRole: role,
      });
    }

    // Reset assignment state after queuing
    setAssignmentEmailColumn(null);
    setAssignmentRoomColumn(null);
    setAssignmentColumnMappings({});
    setPersonMatches(new Map());
    setPersonResolutions(new Map());
    setRoomMatches(new Map());
    setRoomResolutions(new Map());
    setSelectedAssignmentRole(null);
    setExcludedKeys(new Set());
    setRoleOverrides(new Map());
  }, [
    selectedAssignmentRole,
    previewAssignments,
    excludedKeys,
    roleOverrides,
    addRoleUpdateTask,
  ]);

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

  // Find target ID for person role
  const findPersonTargetId = useCallback((role: string): string | null => {
    const category = profileCategories.find(c => c.profileType === role);
    return category?.id || null;
  }, [profileCategories]);

  // Count rooms ready to create
  const readyCount = useMemo(() => {
    let count = 0;
    roomConfigs.forEach(config => {
      if (config.templateId) count++;
    });
    return count;
  }, [roomConfigs]);

  // Count selected (non-excluded) assignments from preview
  const selectedAssignmentCount = useMemo(() => {
    return previewAssignments.filter(
      (a) => !excludedKeys.has(`${a.personId}:${a.roomId}`)
    ).length;
  }, [previewAssignments, excludedKeys]);

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

  // Handle person creation - adds tasks to queue
  const handleCreatePersons = useCallback(() => {
    if (!selectedRole || !fileData) return;

    const targetId = findPersonTargetId(selectedRole);
    if (!targetId) {
      alert(`No parent location found for role: ${selectedRole}`);
      return;
    }

    const firstNameHeader = getHeaderForMapping('firstName');
    const lastNameHeader = getHeaderForMapping('lastName');
    const emailHeader = getHeaderForMapping('email');
    const grouping1Header = getHeaderForMapping('grouping1');
    const grouping2Header = getHeaderForMapping('grouping2');

    if (!firstNameHeader || !lastNameHeader || !emailHeader) {
      alert('Please map firstName, lastName, and email columns');
      return;
    }

    // Get template ID (either global or needs grouping)
    let globalTemplateId: string | null = null;
    if (!useTemplateGrouping) {
      globalTemplateId = selectedPersonTemplateId;
      if (!globalTemplateId) {
        alert('Please select a template');
        return;
      }
    }

    fileData.rows.forEach((row, index) => {
      const firstName = row[firstNameHeader]?.trim();
      const lastName = row[lastNameHeader]?.trim();
      const email = row[emailHeader]?.trim();

      // Skip invalid rows
      if (!firstName || !lastName || !email || !EMAIL_REGEX.test(email)) {
        return;
      }

      // Get template ID
      let sourceId = globalTemplateId;
      if (useTemplateGrouping && templateGroupColumn) {
        const groupValue = row[templateGroupColumn]?.trim();
        if (!groupValue) return;
        sourceId = templatesByGroup.get(groupValue) || null;
        if (!sourceId) return;
      }

      if (!sourceId) return;

      // Build grouping value for room lookup
      const groupingParts: string[] = [];
      if (grouping1Header) {
        const val = row[grouping1Header]?.trim();
        if (val) groupingParts.push(val);
      }
      if (grouping2Header) {
        const val = row[grouping2Header]?.trim();
        if (val) groupingParts.push(val);
      }

      const groupingValue = groupingParts.length > 0 ? groupingParts.join(' - ') : null;

      // Get room IDs from assignments
      const roomIds = groupingValue ? (roomAssignments.get(groupingValue)?.roomIds || []) : [];

      // Add person creation task
      addCreatePersonTask({
        personName: `${firstName} ${lastName}`,
        params: {
          sourceId,
          targetId,
          firstName,
          lastName,
          userEmail: email,
          role: selectedRole,
          roomIds,
          invitationMail: sendInvitationEmail,
        },
      });
    });
  }, [
    selectedRole,
    fileData,
    findPersonTargetId,
    getHeaderForMapping,
    useTemplateGrouping,
    selectedPersonTemplateId,
    templateGroupColumn,
    templatesByGroup,
    roomAssignments,
    sendInvitationEmail,
    addCreatePersonTask,
  ]);

  // Handle start over
  const handleStartOver = useCallback(() => {
    setFileData(null);
    setMappedColumn(null);
    setSelectedValue(null);
    setRoomConfigs(new Map());
    setRoomType(null);
    setColumnMappings({});
    setRoomAssignments(new Map());
    setTemplatesByGroup(new Map());
    // Reset assignment state
    setAssignmentEmailColumn(null);
    setAssignmentRoomColumn(null);
    setAssignmentColumnMappings({});
    setPersonMatches(new Map());
    setPersonResolutions(new Map());
    setRoomMatches(new Map());
    setRoomResolutions(new Map());
    setSelectedAssignmentRole(null);
  }, []);

  const selectedConfig = selectedValue ? roomConfigs.get(selectedValue) : null;

  return (
    <div className="h-full flex flex-col bg-white rounded-lg shadow overflow-hidden">
      {/* Header with workflow tabs */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveWorkflow('room')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeWorkflow === 'room'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Room Creation
          </button>
          <button
            onClick={() => setActiveWorkflow('person')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeWorkflow === 'person'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Person
          </button>
          <button
            onClick={() => setActiveWorkflow('assignment')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeWorkflow === 'assignment'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Assignment
          </button>
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
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* File upload section - shared across all workflows */}
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
              {/* Show different table based on workflow */}
              {activeWorkflow === 'room' ? (
                <DataPreviewTable
                  headers={fileData.headers}
                  rows={fileData.rows}
                  columnMappings={mappedColumn ? { [mappedColumn]: 'roomName' } : {}}
                  onColumnMappingChange={handleColumnClick as any}
                  mode="room"
                />
              ) : activeWorkflow === 'person' ? (
                <DataPreviewTable
                  headers={fileData.headers}
                  rows={fileData.rows}
                  columnMappings={columnMappings}
                  onColumnMappingChange={handleColumnMappingChange}
                  validationWarnings={personValidation.warnings}
                  showTemplateGroup={useTemplateGrouping}
                  mode="person"
                />
              ) : null}
              <button
                onClick={handleStartOver}
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                Upload different file
              </button>
            </div>
          )}
        </div>

        {/* Room workflow - only show when Room tab is active */}
        {activeWorkflow === 'room' && fileData && (
          <>
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
          </>
        )}

        {/* Person workflow */}
        {activeWorkflow === 'person' && fileData && (
          <>
            {/* Role selection */}
            <div>
              <PersonRoleSelector
                selectedRole={selectedRole}
                onRoleChange={setSelectedRole}
              />
            </div>

            {/* Template selection */}
            {selectedRole && (
              <div>
                <TemplateSelector
                  templates={personTemplates}
                  isLoadingTemplates={isLoadingPersonTemplates}
                  selectedTemplateId={selectedPersonTemplateId}
                  onTemplateChange={setSelectedPersonTemplateId}
                  useGrouping={useTemplateGrouping}
                  onUseGroupingChange={setUseTemplateGrouping}
                  groupingColumn={templateGroupColumn}
                  onGroupingColumnChange={setTemplateGroupColumn}
                  templatesByGroup={templatesByGroup}
                  onTemplatesByGroupChange={setTemplatesByGroup}
                  availableColumns={fileData.headers}
                  uniqueGroupValues={uniqueTemplateGroupValues}
                />
              </div>
            )}

            {/* Room assignments - show if either grouping column is mapped */}
            {uniqueGroupValues.length > 0 && (
              <div>
                <RoomAssignmentPanel
                  groupingValues={uniqueGroupValues}
                  group1Values={group1Values}
                  roomAssignments={roomAssignments}
                  onRoomAssignmentsChange={setRoomAssignments}
                  rooms={rooms}
                />
              </div>
            )}
          </>
        )}

        {/* Assignment workflow */}
        {activeWorkflow === 'assignment' && fileData && (
          <>
            {/* Data preview with assignment column mapping */}
            <DataPreviewTable
              headers={fileData.headers}
              rows={fileData.rows}
              columnMappings={assignmentColumnMappings}
              onColumnMappingChange={handleAssignmentColumnMappingChange}
              mode="assignment"
            />

            {/* Role selector */}
            {assignmentEmailColumn && assignmentRoomColumn && (
              <div className="mt-6">
                <AssignmentRoleSelector
                  selectedRole={selectedAssignmentRole}
                  onRoleChange={setSelectedAssignmentRole}
                />
              </div>
            )}

            {/* Person matching panel */}
            {assignmentEmailColumn && (
              <div className="mt-6">
                <PersonMatchingPanel
                  emails={uniqueEmails}
                  persons={persons}
                  personMatches={personMatches}
                  personResolutions={personResolutions}
                  onResolutionChange={(email, personId) => {
                    setPersonResolutions(prev => {
                      const next = new Map(prev);
                      if (personId) {
                        next.set(email, personId);
                      } else {
                        next.delete(email);
                      }
                      return next;
                    });
                  }}
                />
              </div>
            )}

            {/* Room matching panel */}
            {assignmentRoomColumn && (
              <div className="mt-6">
                <RoomMatchingPanel
                  uniqueRoomValues={uniqueAssignmentRoomValues}
                  rooms={rooms}
                  roomMatches={roomMatches}
                  roomResolutions={roomResolutions}
                  onResolutionChange={(roomValue, roomId) => {
                    setRoomResolutions(prev => {
                      const next = new Map(prev);
                      if (roomId) {
                        next.set(roomValue, roomId);
                      } else {
                        next.delete(roomValue);
                      }
                      return next;
                    });
                  }}
                />
              </div>
            )}

            {/* Assignment Preview */}
            {previewAssignments.length > 0 && (
              <div className="mt-6">
                <AssignmentPreviewPanel
                  assignments={previewAssignments}
                  availableRoles={['student', 'companymentor', 'schoolteacher', 'courseteacher', 'stateadvisor']}
                  excludedKeys={excludedKeys}
                  roleOverrides={roleOverrides}
                  onToggleExclude={handleToggleExclude}
                  onRoleChange={handlePreviewRoleChange}
                  onToggleAll={handleToggleAll}
                />
              </div>
            )}
          </>
        )}

        {/* Verify workflow */}
        {activeWorkflow === 'verify' && (
          <VerifyAssignmentsTab fileData={fileData} />
        )}
      </div>

      {/* Footer with action button - Room workflow */}
      {activeWorkflow === 'room' && fileData && (
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
      )}

      {/* Footer with action button - Person workflow */}
      {activeWorkflow === 'person' && fileData && (
        <div className="border-t border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendInvitationEmail}
                  onChange={(e) => setSendInvitationEmail(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Send invitation emails</span>
              </label>
              <div className="text-sm text-gray-500">
                Ready: {personValidation.validCount} | Skipped: {personValidation.invalidCount}
              </div>
            </div>
            <button
              onClick={handleCreatePersons}
              disabled={personValidation.validCount === 0 || !selectedRole}
              className={`px-6 py-2 rounded-lg transition-colors ${
                personValidation.validCount > 0 && selectedRole
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              Add {personValidation.validCount} Person{personValidation.validCount !== 1 ? 's' : ''} to Queue
            </button>
          </div>
        </div>
      )}

      {/* Footer with action button - Assignment workflow */}
      {activeWorkflow === 'assignment' && fileData && (
        <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {selectedAssignmentCount > 0
              ? `${selectedAssignmentCount} assignment${selectedAssignmentCount !== 1 ? 's' : ''} ready`
              : 'Map columns and resolve matches to enable assignment'}
          </div>
          <button
            onClick={handleExecuteAssignments}
            disabled={selectedAssignmentCount === 0 || !selectedAssignmentRole}
            className={`px-6 py-2 rounded-lg transition-colors ${
              selectedAssignmentCount > 0 && selectedAssignmentRole
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            Assign {selectedAssignmentCount} Person{selectedAssignmentCount !== 1 ? 's' : ''} to Rooms
          </button>
        </div>
      )}
    </div>
  );
}

export default BulkImportPage;
