import { contextBridge, ipcRenderer } from 'electron';

// Inline IPC channels to avoid module resolution issues in preload sandbox
const IPC_CHANNELS = {
  DB_QUERY: 'db:query',
  DB_RUN: 'db:run',
  ROOMS_GET_ALL: 'rooms:getAll',
  ROOMS_GET_BY_ID: 'rooms:getById',
  ROOMS_SEARCH: 'rooms:search',
  PERSONS_GET_ALL: 'persons:getAll',
  PERSONS_GET_BY_ID: 'persons:getById',
  PERSONS_SEARCH: 'persons:search',
  ASSIGNMENTS_GET_ALL: 'assignments:getAll',
  ASSIGNMENTS_GET_FOR_PERSON: 'assignments:getForPerson',
  ASSIGNMENTS_GET_FOR_ROOM: 'assignments:getForRoom',
  ASSIGNMENTS_CREATE: 'assignments:create',
  ASSIGNMENTS_DELETE: 'assignments:delete',
  SYNC_RUN: 'sync:run',
  SYNC_GET_STATUS: 'sync:getStatus',
  SYNC_GET_PROGRESS: 'sync:getProgress',
  SYNC_GET_PENDING_CHANGES: 'sync:getPendingChanges',
  API_SET_CONFIG: 'api:setConfig',
  API_GET_CONFIG: 'api:getConfig',
  API_IS_CONFIGURED: 'api:isConfigured',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_WEBHOOK_CONFIG: 'settings:getWebhookConfig',
  WEBHOOK_UPDATE_USER_ROLE: 'webhook:updateUserRole',
  TEMPLATES_FETCH: 'templates:fetch',
  WEBHOOK_CREATE_ROOM: 'webhook:createRoom',
  PROFILE_CATEGORIES_FETCH: 'profileCategories:fetch',
  PROFILE_TEMPLATES_FETCH: 'profileTemplates:fetch',
  USER_TYPES_GET_ALL: 'userTypes:getAll',
  DISTRIBUTION_GROUPS_GET: 'distributionGroups:get',
  WEBHOOK_CREATE_PERSON: 'webhook:createPerson',
  WEBHOOK_DELETE_ROOM: 'webhook:deleteRoom',
  WEBHOOK_DELETE_PERSON: 'webhook:deletePerson',
  WEBHOOK_RENAME_ROOM: 'webhook:renameRoom',
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',
  FILE_PARSE: 'file:parse',
  FILE_SELECT_DIALOG: 'file:selectDialog',
  MISSION_SYNC_START: 'mission:sync:start',
  MISSION_SYNC_STATUS: 'mission:sync:status',
  MISSION_GET_DASHBOARD_DATA: 'mission:dashboard:data',
  MISSION_GET_PROFESSIONS: 'mission:professions:get',
  MISSION_GET_STUDENTS: 'mission:students:get',
  DISCREPANCIES_GET: 'discrepancies:get',
  TAG_HEAL_PLAN_GET: 'tagHeal:plan',
  TAG_HEAL: 'tagHeal:apply',
  ORPHAN_ACCESS_PLAN: 'orphanAccess:plan',
  ORPHAN_ACCESS_REVOKE: 'orphanAccess:revoke',
} as const;

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  dbQuery: (sql: string, params?: any[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_QUERY, sql, params),
  dbRun: (sql: string, params?: any[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_RUN, sql, params),

  // Rooms
  getRooms: (type?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ROOMS_GET_ALL, type),
  getRoomById: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ROOMS_GET_BY_ID, id),
  searchRooms: (query: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ROOMS_SEARCH, query),

  // Persons
  getPersons: (type?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PERSONS_GET_ALL, type),
  getPersonById: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PERSONS_GET_BY_ID, id),
  searchPersons: (query: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PERSONS_SEARCH, query),

  // Assignments
  getAllAssignments: () =>
    ipcRenderer.invoke(IPC_CHANNELS.ASSIGNMENTS_GET_ALL),
  getAssignmentsForPerson: (personId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ASSIGNMENTS_GET_FOR_PERSON, personId),
  getAssignmentsForRoom: (roomId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ASSIGNMENTS_GET_FOR_ROOM, roomId),
  createAssignment: (personId: string, roomId: string, role: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ASSIGNMENTS_CREATE, personId, roomId, role),
  deleteAssignment: (personId: string, roomId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ASSIGNMENTS_DELETE, personId, roomId),

  // Sync
  runSync: () =>
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_RUN),
  getSyncStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_GET_STATUS),
  getSyncProgress: () =>
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_GET_PROGRESS),
  getPendingChanges: () =>
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_GET_PENDING_CHANGES),

  // API Config
  setApiConfig: (config: { apiKey: string; environment: string; rootHazuId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.API_SET_CONFIG, config),
  getApiConfig: () =>
    ipcRenderer.invoke(IPC_CHANNELS.API_GET_CONFIG),
  isApiConfigured: () =>
    ipcRenderer.invoke(IPC_CHANNELS.API_IS_CONFIGURED),

  // Settings
  getSetting: (key: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, key),
  setSetting: (key: string, value: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
  getWebhookConfig: () =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_WEBHOOK_CONFIG),

  // Webhooks
  updateUserRole: (
    personId: string,
    roomId: string,
    oldRole: string | null,
    newRole: string | null
  ) => ipcRenderer.invoke(IPC_CHANNELS.WEBHOOK_UPDATE_USER_ROLE, personId, roomId, oldRole, newRole),

  // Templates
  fetchTemplates: () =>
    ipcRenderer.invoke(IPC_CHANNELS.TEMPLATES_FETCH),

  // Room creation
  createRoom: (templateId: string, targetId: string, title: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.WEBHOOK_CREATE_ROOM, templateId, targetId, title),

  // Profile Categories
  fetchProfileCategories: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_CATEGORIES_FETCH),

  // Profile Templates
  fetchProfileTemplates: (role: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_TEMPLATES_FETCH, role),

  // User Types
  getUserTypes: () =>
    ipcRenderer.invoke(IPC_CHANNELS.USER_TYPES_GET_ALL),

  // Discrepancies (S2 report)
  getDiscrepancies: () =>
    ipcRenderer.invoke(IPC_CHANNELS.DISCREPANCIES_GET),

  // Tag healing (S3)
  getTagHealPlan: () =>
    ipcRenderer.invoke(IPC_CHANNELS.TAG_HEAL_PLAN_GET),
  healTag: (personId: string, tag: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAG_HEAL, personId, tag),

  // Orphan access removal (S6)
  planOrphanRemoval: (accountId: string, groupId: string, roomId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ORPHAN_ACCESS_PLAN, accountId, groupId, roomId),
  revokeOrphanAccess: (accountId: string, groupId: string, roomId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ORPHAN_ACCESS_REVOKE, accountId, groupId, roomId),

  // Distribution Groups
  getDistributionGroup: (roomId: string, role: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DISTRIBUTION_GROUPS_GET, roomId, role),

  // Person creation
  createPerson: (params: {
    sourceId: string;
    targetId: string;
    firstName: string;
    lastName: string;
    userEmail: string;
    role: string;
    roomIds: string[];
    invitationMail: boolean;
  }) => ipcRenderer.invoke(IPC_CHANNELS.WEBHOOK_CREATE_PERSON, params),

  // Room deletion
  deleteRoom: (roomId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.WEBHOOK_DELETE_ROOM, roomId),

  // Person deletion
  deletePerson: (personId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.WEBHOOK_DELETE_PERSON, personId),

  // Room rename
  renameRoom: (roomId: string, newTitle: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.WEBHOOK_RENAME_ROOM, roomId, newTitle),

  // Shell
  openExternal: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url),

  // File operations
  selectFileDialog: () =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_SELECT_DIALOG),
  parseFile: (filePath: string, hasHeaders: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_PARSE, filePath, hasHeaders),

  // Mission Analysis
  missionSyncStart: () =>
    ipcRenderer.invoke(IPC_CHANNELS.MISSION_SYNC_START),
  missionSyncStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.MISSION_SYNC_STATUS),
  missionGetDashboardData: (filters: any) =>
    ipcRenderer.invoke(IPC_CHANNELS.MISSION_GET_DASHBOARD_DATA, filters),
  missionGetProfessions: () =>
    ipcRenderer.invoke(IPC_CHANNELS.MISSION_GET_PROFESSIONS),
  missionGetStudents: (filters: any) =>
    ipcRenderer.invoke(IPC_CHANNELS.MISSION_GET_STUDENTS, filters),

  // Event listeners
  onSyncProgress: (callback: (progress: any) => void) => {
    const subscription = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on('sync:progress', subscription);
    return () => ipcRenderer.removeListener('sync:progress', subscription);
  },
});

// Type declaration for the exposed API
declare global {
  interface Window {
    electronAPI: {
      dbQuery: (sql: string, params?: any[]) => Promise<any[]>;
      dbRun: (sql: string, params?: any[]) => Promise<any>;
      getRooms: (type?: string) => Promise<any[]>;
      getRoomById: (id: string) => Promise<any>;
      searchRooms: (query: string) => Promise<any[]>;
      getPersons: (type?: string) => Promise<any[]>;
      getPersonById: (id: string) => Promise<any>;
      searchPersons: (query: string) => Promise<any[]>;
      getAllAssignments: () => Promise<Array<{ person_id: string; room_id: string; role: string }>>;
      getAssignmentsForPerson: (personId: string) => Promise<any[]>;
      getAssignmentsForRoom: (roomId: string) => Promise<any[]>;
      createAssignment: (personId: string, roomId: string, role: string) => Promise<any>;
      deleteAssignment: (personId: string, roomId: string) => Promise<any>;
      runSync: () => Promise<any>;
      getSyncStatus: () => Promise<any>;
      getSyncProgress: () => Promise<any>;
      getPendingChanges: () => Promise<any[]>;
      setApiConfig: (config: { apiKey: string; environment: string; rootHazuId: string }) => Promise<any>;
      getApiConfig: () => Promise<{ apiKey: string; environment: string; rootHazuId: string }>;
      isApiConfigured: () => Promise<boolean>;
      getSetting: (key: string) => Promise<string | null>;
      setSetting: (key: string, value: string) => Promise<void>;
      getWebhookConfig: () => Promise<{ adminId: string; templateId: string; webhookUrl: string }>;
      updateUserRole: (
        personId: string,
        roomId: string,
        oldRole: string | null,
        newRole: string | null
      ) => Promise<{ success: boolean; error?: string }>;
      fetchTemplates: () => Promise<{
        success: boolean;
        templates?: Array<{
          id: string;
          title: string;
          roomType: 'class' | 'cie' | 'enterprise' | 'state';
          icon?: string;
          color?: string;
        }>;
        error?: string;
      }>;
      createRoom: (
        templateId: string,
        targetId: string,
        title: string
      ) => Promise<{ success: boolean; room?: any; error?: string }>;
      fetchProfileCategories: () => Promise<{
        success: boolean;
        categories?: Array<{ id: string; title: string; profileType: string }>;
        error?: string;
      }>;
      fetchProfileTemplates: (role: string) => Promise<{
        success: boolean;
        templates?: Array<{ id: string; title: string }>;
        error?: string;
      }>;
      getUserTypes: () => Promise<Array<{ id: string; name: string; title: string }>>;
      getDiscrepancies: () => Promise<Array<{
        type: 'orphan-tag' | 'missing-tag' | 'unresolved' | 'unknown';
        roomId: string;
        roomTitle: string | null;
        role: string;
        personId?: string;
        email?: string | null;
        uid?: string;
        groupId?: string;
        displayName?: string | null;
        note?: string;
      }>>;
      getTagHealPlan: () => Promise<{
        items: Array<{
          personId: string; roomId: string; roomTitle: string | null; role: string;
          tag: string; displayName: string | null; email: string | null;
        }>;
        skipped: Array<{ personId: string; roomId: string; role: string; reason: string }>;
      }>;
      healTag: (personId: string, tag: string) => Promise<{ success: boolean; error?: string }>;
      planOrphanRemoval: (accountId: string, groupId: string, roomId: string) => Promise<Array<{
        kind: 'group' | 'roomItem';
        itemId: string;
        title: string;
        aclRole?: string;
      }>>;
      revokeOrphanAccess: (accountId: string, groupId: string, roomId: string) => Promise<{ success: boolean; error?: string }>;
      getDistributionGroup: (roomId: string, role: string) => Promise<{ id: string } | undefined>;
      createPerson: (params: {
        sourceId: string;
        targetId: string;
        firstName: string;
        lastName: string;
        userEmail: string;
        role: string;
        roomIds: string[];
        invitationMail: boolean;
      }) => Promise<{ success: boolean; person?: any; error?: string }>;
      deleteRoom: (roomId: string) => Promise<{ success: boolean; error?: string }>;
      deletePerson: (personId: string) => Promise<{ success: boolean; error?: string }>;
      renameRoom: (roomId: string, newTitle: string) => Promise<{ success: boolean; error?: string }>;
      openExternal: (url: string) => Promise<void>;
      selectFileDialog: () => Promise<{ canceled: boolean; filePath?: string }>;
      parseFile: (filePath: string, hasHeaders: boolean) => Promise<{
        success: boolean;
        data?: { headers: string[]; rows: Record<string, string>[] };
        error?: string;
      }>;
      missionSyncStart: () => Promise<{ success: boolean; error?: string }>;
      missionSyncStatus: () => Promise<{
        status: 'idle' | 'syncing' | 'error';
        students_processed: number;
        total_students: number;
        last_synced_at: number | null;
      }>;
      missionGetDashboardData: (filters: any) => Promise<any>;
      missionGetProfessions: () => Promise<Array<{ icon: string; student_count: number }>>;
      missionGetStudents: (filters: any) => Promise<Array<{
        id: string;
        display_name: string;
        icon: string;
        color: string;
        mission_count: number;
        enterprise_name: string | null;
      }>>;
      onSyncProgress: (callback: (progress: any) => void) => () => void;
    };
  }
}
