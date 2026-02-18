/**
 * Hazu API Type Definitions
 */

export type HazuPermissionLevel =
  | "admin"
  | "editor"
  | "reader"
  | "owner"
  | "registered"
  | "verified"
  | "everybody";

export type HazuEnvironment = "swiss" | "io" | "dev";

export interface CreateOptions {
  parentId: string;
  type: string;
  title: string;
  authorId: string;
  displayName: string;
  privacy: string;
  key?: string;
  description?: string;
  longDescription?: string;
  color?: string;
  icon?: string;
  priority?: string;
  timelineDate?: number;
  timelineDuration?: number;
  timelinePosition?: number;
  isPlaced?: boolean;
  endDate?: string;
  itemsPerPage?: number;
  defaultView?: string;
  level?: number;
  sortOrder?: number;
  hideHazuTitle?: boolean;
  showSidebar?: boolean;
  showTimeline?: boolean;
  showDate?: boolean;
  showAuthor?: boolean;
  showAssigned?: boolean;
  showLocation?: boolean;
  showShareButtons?: boolean;
  minimizeVideo?: boolean;
  messengerMode?: boolean;
  autoDate?: boolean;
  videoId?: string;
  isChatTabVisible?: boolean;
  isQuestionTabVisible?: boolean;
  interaction?: string;
  rolesSettings?: RolesSettings;
  tableSettings?: any;
  tags?: string[];
  main?: any;
  extra?: any;
}

export interface UpdateOptions {
  title?: string;
  description?: string;
  color?: string;
  linkName?: string;
  year?: string;
  timelinePosition?: number;
  startDate?: string;
  endDate?: string;
  importFromHazu?: HazuPermissionLevel;
  importIntoHazu?: HazuPermissionLevel;
  tableView?: "reader" | "editor" | "owner" | "everybody" | "admin";
}

export interface ApiParametersPropagate {
  creatorId: string;
  currentLang: string;
  link: string;
  type: "all" | "public" | "deleteAll" | "deletePublic";
  userOrGroup: "user" | "group";
  userIdOrEmail: string;
}

export interface AclEntry {
  description: string;
  displayName: string;
  key: string;
  authorId: string;
  role: string;
  groupId: string;
  isGroup: boolean;
}

export interface AclSnapshot {
  data: AclEntry[];
}

export interface RolesSettings {
  view: { viewPrivate: string };
  import: { fromHazu: string; intoHazu: string };
  edit: {
    item: string;
    question: string;
    hazu: string;
    comment: string;
    authorCanEdit: boolean;
  };
  create: {
    item: string;
    question: string;
    hazu: string;
    comment: string;
    vote: string;
  };
  global: {
    import: string;
    editIcon: string;
    sharing: string;
    changeSettings: string;
  };
  delete: {
    item: string;
    question: string;
    hazu: string;
    comment: string;
    authorCanDelete: boolean;
  };
  views: {
    calendar: string;
    presentation: string;
    diagram: string;
    geo: string;
    default: string;
    boards: string;
    map: string;
    table: string;
  };
}

export interface HazuSnapshot {
  key: string;
  title: string;
  description: string;
  longdescription?: string;
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
  user?: { displayName: string };
  authorId?: string;
  displayName?: string;
  link?: string;
  priority?: number;
  timelineDate?: number;
  timelineDuration?: number | null;
  timelineEndTimestampInMillis?: number;
  interaction?: {
    totalScore: number;
    totalComments: number;
    authorGeocodeLocation: string;
    authorLocation: string;
    votesEnabled?: boolean;
    commentsEnabled?: boolean;
  };
  event?: {
    rolesSettings?: Record<string, any>;
    defaultsSettings?: any;
  };
  layout?: {
    showAssistant?: boolean;
  };
}

export interface HazuEntity {
  snapshot: HazuSnapshot;
}

export interface HazuFilterOptions {
  icon?: string;
  color?: string;
  title?: string;
  titleMatchType?: "exact" | "contains" | "regex";
  createdAfter?: string;
  createdBefore?: string;
  createdOnDate?: string;
}

export interface OperationResult {
  success: boolean;
  id: string;
  title?: string;
  error?: string;
  details?: any;
}

export interface BatchOperationSummary {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
  results: OperationResult[];
}
