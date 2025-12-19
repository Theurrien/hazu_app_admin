import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';

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
  startFullSync: (rootId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_START_FULL, rootId),
  getSyncStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_GET_STATUS),
  getPendingChanges: () =>
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_GET_PENDING_CHANGES),

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
      startFullSync: (rootId: string) => Promise<any>;
      getSyncStatus: () => Promise<any>;
      getPendingChanges: () => Promise<any[]>;
      getSetting: (key: string) => Promise<string | null>;
      setSetting: (key: string, value: string) => Promise<void>;
      onSyncProgress: (callback: (progress: any) => void) => () => void;
    };
  }
}
