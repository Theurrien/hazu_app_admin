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
  ASSIGNMENTS_GET_ALL: 'assignments:getAll',
  ASSIGNMENTS_GET_FOR_PERSON: 'assignments:getForPerson',
  ASSIGNMENTS_GET_FOR_ROOM: 'assignments:getForRoom',
  ASSIGNMENTS_CREATE: 'assignments:create',
  ASSIGNMENTS_DELETE: 'assignments:delete',
  ASSIGNMENTS_BULK_CREATE: 'assignments:bulkCreate',

  // Sync
  SYNC_RUN: 'sync:run',
  SYNC_GET_STATUS: 'sync:getStatus',
  SYNC_GET_PENDING_CHANGES: 'sync:getPendingChanges',
  SYNC_GET_PROGRESS: 'sync:getProgress',
  SYNC_MARK_SYNCED: 'sync:markSynced',

  // API Config
  API_SET_CONFIG: 'api:setConfig',
  API_GET_CONFIG: 'api:getConfig',
  API_IS_CONFIGURED: 'api:isConfigured',
  API_VALIDATE_CONFIG: 'api:validateConfig',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_WEBHOOK_CONFIG: 'settings:getWebhookConfig',

  // Templates
  TEMPLATES_FETCH: 'templates:fetch',

  // Profile Categories
  PROFILE_CATEGORIES_FETCH: 'profileCategories:fetch',
  PROFILE_TEMPLATES_FETCH: 'profileTemplates:fetch',

  // User Types (for assignment workflow)
  USER_TYPES_GET_ALL: 'userTypes:getAll',

  // Distribution Groups
  DISTRIBUTION_GROUPS_GET: 'distributionGroups:get',

  // Discrepancies (S2 report)
  DISCREPANCIES_GET: 'discrepancies:get',

  // Tag healing (S3)
  TAG_HEAL_PLAN_GET: 'tagHeal:plan',
  TAG_HEAL: 'tagHeal:apply',

  // Orphan access removal (S6)
  ORPHAN_ACCESS_PLAN: 'orphanAccess:plan',
  ORPHAN_ACCESS_REVOKE: 'orphanAccess:revoke',

  // Dead-tag pruning (S7)
  TAG_PRUNE_PLAN: 'tagPrune:plan',
  TAG_PRUNE_EXECUTE: 'tagPrune:execute',
  ARCHIVE_LIST_ROOMS: 'archive:listRooms',
  ARCHIVE_LIST_ARCHIVED: 'archive:listArchived',
  ARCHIVE_PLAN: 'archive:plan',
  ARCHIVE_EXECUTE: 'archive:execute',
  ARCHIVE_RESTORE_PLAN: 'archive:restorePlan',
  ARCHIVE_RESTORE_EXECUTE: 'archive:restoreExecute',
  ARCHIVE_PERSON_PLAN: 'archive:person:plan',
  ARCHIVE_PERSON_LIST_ARCHIVED: 'archive:person:listArchived',
  ARCHIVE_PERSON_EXECUTE: 'archive:person:execute',
  ARCHIVE_PERSON_RESTORE_EXECUTE: 'archive:person:restoreExecute',

  // Level change (CFC <-> AFP)
  LEVEL_CHANGE_STUDENTS: 'levelChange:students',
  LEVEL_CHANGE_CANDIDATES: 'levelChange:candidates',
  LEVEL_CHANGE_PLAN: 'levelChange:plan',
  LEVEL_CHANGE_EXECUTE: 'levelChange:execute',

  // Webhooks
  WEBHOOK_UPDATE_USER_ROLE: 'webhook:updateUserRole',
  WEBHOOK_CREATE_ROOM: 'webhook:createRoom',
  WEBHOOK_CREATE_PERSON: 'webhook:createPerson',
  WEBHOOK_DELETE_ROOM: 'webhook:deleteRoom',
  WEBHOOK_DELETE_PERSON: 'webhook:deletePerson',
  WEBHOOK_RENAME_ROOM: 'webhook:renameRoom',

  // Shell
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',

  // File operations
  FILE_PARSE: 'file:parse',
  FILE_SELECT_DIALOG: 'file:selectDialog',

  // Missions — formation overview
  FORMATION_SYNC_START: 'formation:sync:start',
  FORMATION_SYNC_STATUS: 'formation:sync:status',
  FORMATION_OVERVIEW: 'formation:overview',
  FORMATION_DETAIL: 'formation:detail',
  FORMATION_STUDENT: 'formation:student',
  CORRESPONDENCE_LIST: 'correspondence:list',
  CORRESPONDENCE_SAVE: 'correspondence:save',
  CORRESPONDENCE_DELETE: 'correspondence:delete',
  CONTROLE_SYNC_STATE: 'controle:syncState',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
