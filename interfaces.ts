/**
 * Hazu API Type Definitions
 *
 * This file contains all TypeScript interfaces for interacting with the Hazu API.
 * These types ensure type safety when working with API requests and responses.
 */

// ============================================================================
// PERMISSION LEVELS
// ============================================================================

/**
 * Permission levels for Hazu access control
 * Used in import settings, role assignments, and view permissions
 */
export type HazuPermissionLevel =
  | "admin"      // Full administrative access
  | "editor"     // Can edit content
  | "reader"     // Read-only access
  | "owner"      // Owner of the Hazu
  | "registered" // Registered users only
  | "verified"   // Verified users only
  | "everybody"; // Public access

// ============================================================================
// CREATE OPTIONS
// ============================================================================

/**
 * Options for creating a new Hazu entity
 * Used with sendApiRequestCreate()
 */
export interface CreateOptions {
  // Required fields
  parentId: string;           // ID of the parent Hazu
  type: string;               // Entity type: "hazu" (container) or "item" (leaf)
  title: string;              // Display title
  authorId: string;           // ID of the author/creator
  displayName: string;        // Display name of the author
  privacy: string;            // Privacy setting

  // Optional identification
  key?: string;               // Custom key/ID

  // Optional display properties
  description?: string;       // Short description
  longDescription?: string;   // Extended description
  color?: string;             // Hex color code (e.g., "#FF5733")
  icon?: string;              // Font Awesome icon class (e.g., "fa-star")
  priority?: string;          // Priority level

  // Timeline properties
  timelineDate?: number;      // Start timestamp in milliseconds
  timelineDuration?: number;  // Duration in milliseconds
  timelinePosition?: number;  // Position on timeline
  isPlaced?: boolean;         // Whether placed on timeline
  endDate?: string;           // End date string

  // Layout options
  itemsPerPage?: number;      // Items per page in list view
  defaultView?: string;       // Default view mode
  level?: number;             // Nesting level
  sortOrder?: number;         // Sort order position

  // Display toggles
  hideHazuTitle?: boolean;    // Hide the Hazu title
  showSidebar?: boolean;      // Show sidebar
  showTimeline?: boolean;     // Show timeline view
  showDate?: boolean;         // Show date information
  showAuthor?: boolean;       // Show author information
  showAssigned?: boolean;     // Show assigned users
  showLocation?: boolean;     // Show location
  showShareButtons?: boolean; // Show share buttons
  minimizeVideo?: boolean;    // Minimize video player
  messengerMode?: boolean;    // Enable messenger mode
  autoDate?: boolean;         // Auto-set date

  // Media and interaction
  videoId?: string;           // Associated video ID
  isChatTabVisible?: boolean; // Show chat tab
  isQuestionTabVisible?: boolean; // Show Q&A tab
  interaction?: string;       // Interaction mode

  // Advanced settings
  rolesSettings?: RolesSettings; // Role-based permissions
  tableSettings?: any;        // Table view settings
  tags?: string[];            // Tags array
  main?: any;                 // Main content object
  extra?: any;                // Extra data object
}

// ============================================================================
// UPDATE OPTIONS
// ============================================================================

/**
 * Options for updating an existing Hazu entity
 * Used with sendApiRequestUpdate()
 */
export interface UpdateOptions {
  title?: string;             // New title
  description?: string;       // New description
  color?: string;             // New color (hex, auto-uppercased)
  linkName?: string;          // New URL-friendly name
  year?: string;              // Year value

  // Timeline updates
  timelinePosition?: number;  // New timeline position
  startDate?: string;         // New start date
  endDate?: string;           // New end date

  // Import permission settings
  importFromHazu?: HazuPermissionLevel; // Who can import FROM this Hazu
  importIntoHazu?: HazuPermissionLevel; // Who can import INTO this Hazu

  // View permissions
  tableView?: "reader" | "editor" | "owner" | "everybody" | "admin";
}

// ============================================================================
// PROPAGATE PARAMETERS
// ============================================================================

/**
 * Parameters for propagating permissions
 * Used with sendApiRequestPropagate()
 */
export interface ApiParametersPropagate {
  creatorId: string;          // ID of the creator initiating propagation
  currentLang: string;        // Current language code
  link: string;               // Link to the Hazu
  type: "all" | "public" | "deleteAll" | "deletePublic"; // Propagation type
  userOrGroup: "user" | "group"; // Target type
  userIdOrEmail: string;      // Target user ID or email
}

// ============================================================================
// ACL (ACCESS CONTROL LIST)
// ============================================================================

/**
 * Access Control List entry
 * Represents a single permission entry
 */
export interface AclEntry {
  description: string;        // Entry description
  displayName: string;        // Display name
  key: string;                // Entry key
  authorId: string;           // Author ID
  role: string;               // Assigned role
  groupId: string;            // Group ID (if group-based)
  isGroup: boolean;           // Whether this is a group entry
}

/**
 * ACL API response structure
 */
export interface AclSnapshot {
  data: AclEntry[];
}

// ============================================================================
// ROLES SETTINGS
// ============================================================================

/**
 * Comprehensive role-based permission settings
 * Controls what each role can do within a Hazu
 */
export interface RolesSettings {
  view: {
    viewPrivate: string;      // Who can view private content
  };
  import: {
    fromHazu: string;         // Who can import from this Hazu
    intoHazu: string;         // Who can import into this Hazu
  };
  edit: {
    item: string;             // Who can edit items
    question: string;         // Who can edit questions
    hazu: string;             // Who can edit Hazu settings
    comment: string;          // Who can edit comments
    authorCanEdit: boolean;   // Whether author can always edit
  };
  create: {
    item: string;             // Who can create items
    question: string;         // Who can create questions
    hazu: string;             // Who can create sub-Hazus
    comment: string;          // Who can create comments
    vote: string;             // Who can vote
  };
  global: {
    import: string;           // Global import permission
    editIcon: string;         // Who can edit icons
    sharing: string;          // Who can share
    changeSettings: string;   // Who can change settings
  };
  delete: {
    item: string;             // Who can delete items
    question: string;         // Who can delete questions
    hazu: string;             // Who can delete Hazus
    comment: string;          // Who can delete comments
    authorCanDelete: boolean; // Whether author can always delete
  };
  views: {
    calendar: string;         // Calendar view permission
    presentation: string;     // Presentation view permission
    diagram: string;          // Diagram view permission
    geo: string;              // Geo view permission
    default: string;          // Default view permission
    boards: string;           // Boards view permission
    map: string;              // Map view permission
    table: string;            // Table view permission
  };
}

// ============================================================================
// HAZU ENTITY STRUCTURES
// ============================================================================

/**
 * Complete Hazu entity structure
 * Represents a full Hazu object as returned by the API
 */
export interface HazuEntity {
  type: string;               // "hazu" or "item"
  path: string;               // Full path to entity
  createTimeMillis: number;   // Creation timestamp
  updateTimeMillis: number;   // Last update timestamp
  id: string;                 // Unique identifier

  data: {
    // Basic properties
    key: string;
    title: string;
    description: string;
    longdescription: string;
    color: string;
    icon: string;
    type: string;
    privacy: string;

    // Hierarchy
    parentId: string;
    rootId: string;
    link: string;
    linkName: string;

    // Author info
    authorId: string;
    displayName: string;
    user: {
      displayName: string;
    };

    // Timestamps
    dateCreated: number;
    order: number;

    // Timeline
    timelineDate: string | null;
    timelineDuration: number | null;
    timelineEndTimestampInMillis: number;
    isPlaced: boolean;

    // Tags and metadata
    tags: string[];
    priority: number;
    canSelect: boolean;

    // Editor state
    editorSession: string | null;

    // Group membership (optional)
    isGroup?: boolean;
    itemId?: string;
    baseItemId?: string;

    // Nested settings objects
    event: {
      rolesSettings: RolesSettings;
      isChatTabVisible: boolean;
      isQuestionTabVisible: boolean;
      defaultsSettings: {
        hazuDefaults: DefaultSettings;
        itemDefaults: DefaultSettings;
      };
    };

    module: {
      layout: {
        showAssigned: boolean;
        gmail: string | null;
        showLocation: boolean;
        hidePast: boolean;
        timelinePosition: number;
        showTags: boolean;
      };
    };

    layout: LayoutSettings;
    interaction: InteractionSettings;
  };
}

/**
 * Default settings for Hazus and items
 */
export interface DefaultSettings {
  isDirty: boolean;
  color: string;
  icon: string;
  privacy: string;
  location: string;
  priority: number;
  locationGeoCode: string;
}

/**
 * Layout configuration settings
 */
export interface LayoutSettings {
  level: number;
  sortOrder: number;
  itemsPerPage: number;
  defaultView: string;
  hideHazuTitle: boolean;
  showSidebar: boolean;
  showTimeline: boolean;
  showDate: boolean;
  showAuthor: boolean;
  showShareButtons: boolean;
  minimizeVideo: boolean;
  messengerMode: boolean;
  autoDate: boolean;
  showAssistant: boolean;
  whiteLabelling: number;
  openStreetMap: boolean;
  osmServer: string;
  osmApiKey: string;
  logo: string | null;
  logoLink: string | null;
  favicon: string | null;
}

/**
 * Interaction and engagement settings
 */
export interface InteractionSettings {
  commentsEnabled: boolean;
  totalComments: number;
  votesEnabled: boolean;
  votesRole: string;
  votesViewType: string;
  totalScore: number;
  showResults: boolean;
  authorLocation: string;
  authorGeocodeLocation: string;
  voteOptions: {
    showLikes: boolean;
    showNeutrals: boolean;
    showDislikes: boolean;
  };
}

// ============================================================================
// API RESPONSE STRUCTURES
// ============================================================================

/**
 * Snapshot structure from read operations
 */
export interface Snapshot {
  key: string;
  title: string;
  description: string;
  longdescription: string;
  color: string;
  icon: string;
  type: string;
  privacy: string;
  parentId: string;
  rootId: string;
  dateCreated: number;
  order: number;
  isPlaced: boolean;
  tags: string[];
  user: {
    displayName: string;
  };
  interaction: {
    totalScore: number;
    totalComments: number;
    authorGeocodeLocation: string;
    authorLocation: string;
    votesEnabled?: boolean;
    commentsEnabled?: boolean;
  };
  editorSession: any;
  event?: {
    defaultsSettings?: {
      hazuDefaults?: DefaultSettings;
      itemDefaults?: DefaultSettings;
    };
  };
}

/**
 * Wrapper for snapshot in API responses
 */
export interface SnapshotWrapper {
  snapshot: Snapshot;
}

/**
 * Collection of snapshots from list operations
 */
export interface SnapshotCollection {
  data: SnapshotWrapper[];
}

/**
 * Extended snapshot from read operations
 */
export interface SnapshotRead {
  key: string;
  title: string;
  description: string;
  color: string;
  icon: string;
  type: string;
  privacy: string;
  parentId: string;
  rootId: string;
  authorId: string;
  displayName: string;
  link: string;
  dateCreated: number;
  order: number;
  priority: number;
  isPlaced: boolean;
  tags: string[];
  timelineDate: number;
  timelineDuration: number | null;
  timelineEndTimestampInMillis: number;
  user: {
    displayName: string;
  };
  interaction: {
    authorLocation: string;
    totalComments: number;
    totalScore: number;
    authorGeocodeLocation: string;
  };
  layout: {
    showAssistant: boolean;
  };
  event: {
    rolesSettings: Record<string, any>;
  };
}

/**
 * Read operation response wrapper
 */
export interface SnapshotCollectionRead {
  snapshot: SnapshotRead;
}

// ============================================================================
// FILTER OPTIONS
// ============================================================================

/**
 * Filter options for querying and selecting Hazus
 * Used in bulk operations and workflows
 */
export interface HazuFilterOptions {
  icon?: string;                                    // Filter by icon (exact match)
  color?: string;                                   // Filter by color (case-insensitive)
  title?: string;                                   // Filter by title
  titleMatchType?: "exact" | "contains" | "regex"; // How to match title
  createdAfter?: string;                           // Created after date (dd.mm.yy)
  createdBefore?: string;                          // Created before date (dd.mm.yy)
  createdOnDate?: string;                          // Created on specific date
}

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Standard result type for operations
 */
export interface OperationResult {
  success: boolean;
  id: string;
  title?: string;
  error?: string;
  details?: any;
}

/**
 * Summary of batch operation results
 */
export interface BatchOperationSummary {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
  results: OperationResult[];
}
