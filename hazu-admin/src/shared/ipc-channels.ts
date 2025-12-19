export const IPC_CHANNELS = {
  // Database operations
  DB_QUERY: 'db:query',
  DB_RUN: 'db:run',

  // Rooms
  ROOMS_GET_ALL: 'rooms:getAll',
  ROOMS_GET_BY_TYPE: 'rooms:getByType',
  ROOMS_GET_BY_ID: 'rooms:getById',
  ROOMS_SEARCH: 'rooms:search',

  // Persons
  PERSONS_GET_ALL: 'persons:getAll',
  PERSONS_GET_BY_TYPE: 'persons:getByType',
  PERSONS_GET_BY_ID: 'persons:getById',
  PERSONS_SEARCH: 'persons:search',

  // Assignments
  ASSIGNMENTS_GET_FOR_PERSON: 'assignments:getForPerson',
  ASSIGNMENTS_GET_FOR_ROOM: 'assignments:getForRoom',
  ASSIGNMENTS_CREATE: 'assignments:create',
  ASSIGNMENTS_DELETE: 'assignments:delete',
  ASSIGNMENTS_BULK_CREATE: 'assignments:bulkCreate',

  // Sync
  SYNC_START_FULL: 'sync:startFull',
  SYNC_GET_STATUS: 'sync:getStatus',
  SYNC_GET_PENDING_CHANGES: 'sync:getPendingChanges',
  SYNC_MARK_SYNCED: 'sync:markSynced',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
