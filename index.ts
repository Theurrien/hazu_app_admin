/**
 * Hazu API Starter Kit
 *
 * Main entry point - exports all API functions, types, and utilities.
 *
 * Usage:
 * import { sendApiRequestRead, CreateOptions, matchesFilters } from "./index";
 */

// ============================================================================
// API Functions
// ============================================================================
export {
  // Read operations
  sendApiRequestRead,
  sendApiRequestList,

  // Write operations
  sendApiRequestCreate,
  sendApiRequestUpdate,
  sendApiRequestRemove,

  // Tag operations
  sendApiRequestAddTags,
  sendApiRequestRemoveTags,

  // Group operations
  sendApiRequestAddGroup,
  sendApiRequestRemoveGroup,

  // User operations
  sendApiRequestCreateUser,
  sendApiRequestUpdateRole,
  sendApiRequestRemoveUser,

  // ACL operations
  sendApiRequestGetAclInfo,
  sendApiRequestPropagate,

  // Exports
  token,
  apiPath,
} from "./api";

// ============================================================================
// Configuration
// ============================================================================
export {
  env,
  SWISS_API_KEY,
  IO_API_KEY,
  DEV_API_KEY,
  API_ENDPOINTS,
  getApiKey,
  getApiEndpoint,
} from "./config";

// ============================================================================
// Type Definitions
// ============================================================================
export type {
  // Permission types
  HazuPermissionLevel,

  // Options interfaces
  CreateOptions,
  UpdateOptions,
  ApiParametersPropagate,
  HazuFilterOptions,

  // ACL types
  AclEntry,
  AclSnapshot,

  // Entity structures
  HazuEntity,
  RolesSettings,
  DefaultSettings,
  LayoutSettings,
  InteractionSettings,

  // Response types
  Snapshot,
  SnapshotWrapper,
  SnapshotCollection,
  SnapshotRead,
  SnapshotCollectionRead,

  // Result types
  OperationResult,
  BatchOperationSummary,
} from "./interfaces";

// ============================================================================
// Helper Utilities
// ============================================================================
export {
  // Text processing
  removeHTMLTags,

  // Date utilities
  parseEuropeanDate,
  formatEuropeanDate,
  getStartOfDay,
  getEndOfDay,

  // Filtering
  matchesFilters,

  // Tag utilities
  compareTagArrays,
  validateTags,
  normalizeTags,

  // Color utilities
  isValidHexColor,
  normalizeHexColor,

  // Result utilities
  summarizeResults,
  sleep,

  // Hierarchy utilities
  extractItemId,
  isContainer,
  isLeafItem,
} from "./helpers";
