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
      onSyncProgress: (callback: (progress: any) => void) => () => void;
    };
  }
}
