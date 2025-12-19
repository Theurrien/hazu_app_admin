/**
 * Hazu API Core Functions
 *
 * This file provides all HTTP communication with the Hazu platform.
 * It automatically handles authentication, environment routing, and error handling.
 *
 * Authentication:
 * - Legacy API keys (<=20 chars): Uses 'token' header
 * - Modern API keys (>20 chars): Uses 'x-api-key' header
 *
 * All functions return null on error and log detailed error information.
 */

import axios from "axios";
import { CreateOptions, UpdateOptions, ApiParametersPropagate } from "./interfaces";
import { getApiKey, getApiEndpoint } from "./config";

// Initialize API configuration
const token = getApiKey();
const apiPath = getApiEndpoint();

// Export for use in other modules
export { token, apiPath };

/**
 * Determine the correct authentication header based on token length
 */
function getAuthHeaders(): Record<string, string> {
  return token.length <= 20 ? { token } : { "x-api-key": token };
}

// ============================================================================
// READ OPERATIONS
// ============================================================================

/**
 * Read a single Hazu entity by ID
 *
 * @param id - The unique identifier of the Hazu to read
 * @returns The Hazu data or throws an error
 *
 * @example
 * const hazu = await sendApiRequestRead("abc123");
 * console.log(hazu.snapshot.title);
 */
export const sendApiRequestRead = async (id: string): Promise<any> => {
  try {
    const response = await axios.get(`https://${apiPath}/read`, {
      headers: getAuthHeaders(),
      params: { id },
    });
    return response.data;
  } catch (error) {
    console.error("Error reading Hazu:", error);
    throw error;
  }
};

/**
 * List children of a Hazu with optional filtering
 *
 * @param parentId - The ID of the parent Hazu
 * @param filter - Optional filter string
 * @param title - Optional title filter
 * @param description - Optional description filter
 * @param fulltext - Optional fulltext search
 * @returns Array of child Hazus or null on error
 *
 * @example
 * const children = await sendApiRequestList("parent123");
 * children.forEach(child => console.log(child.snapshot.title));
 */
export const sendApiRequestList = async (
  parentId: string,
  filter = "",
  title = "",
  description = "",
  fulltext = ""
): Promise<any[] | null> => {
  try {
    const response = await axios.get(`https://${apiPath}/readChildren`, {
      headers: getAuthHeaders(),
      params: {
        parentId,
        filter: filter || undefined,
        title: title || undefined,
        description: description || undefined,
        fulltext: fulltext || undefined,
      },
    });
    return response.data;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      console.error(
        "Error listing children:",
        (error as any).response?.data ?? (error as any).message,
        "Parent ID:",
        parentId
      );
    } else {
      console.error("Unexpected error:", error);
    }
    return null;
  }
};

// ============================================================================
// WRITE OPERATIONS
// ============================================================================

/**
 * Create a new Hazu entity
 *
 * @param options - Creation options including parentId, type, title, etc.
 * @returns The created entity data or null on error
 *
 * @example
 * const newHazu = await sendApiRequestCreate({
 *   parentId: "parent123",
 *   type: "hazu",
 *   title: "My New Hazu",
 *   authorId: "author123",
 *   displayName: "John Doe",
 *   privacy: "private",
 *   color: "#FF5733",
 *   icon: "fa-star"
 * });
 */
export const sendApiRequestCreate = async (options: CreateOptions): Promise<any> => {
  try {
    const body: Record<string, any> = {
      ...(options.key && { key: options.key }),
      ...(options.parentId && { parentId: options.parentId }),
      ...(options.type && { type: options.type }),
      ...(options.title && { title: options.title }),
      ...(options.description && { description: options.description }),
      ...(options.color && { color: options.color.toUpperCase() }),
      ...(options.icon && { icon: options.icon }),
      ...(options.authorId && { authorId: options.authorId }),
      ...(options.displayName && { displayName: options.displayName }),
      ...(options.priority && { priority: options.priority }),
      ...(options.longDescription && { longdescription: options.longDescription }),
      ...(options.timelineDate !== undefined && { timelineDate: options.timelineDate }),
      ...(options.timelineDuration !== undefined && { timelineDuration: options.timelineDuration }),
      ...(options.isPlaced !== undefined && { isPlaced: options.isPlaced }),
      ...(options.interaction && { interaction: options.interaction }),
      ...(options.privacy && { privacy: options.privacy }),
      ...(options.itemsPerPage !== undefined && { "layout.itemsPerPage": options.itemsPerPage }),
      ...(options.defaultView && { "layout.defaultView": options.defaultView }),
      ...(options.level !== undefined && { "layout.level": options.level }),
      ...(options.sortOrder !== undefined && { "layout.sortOrder": options.sortOrder }),
      ...(options.timelinePosition !== undefined && { "module.layout.timelinePosition": options.timelinePosition }),
      ...(options.hideHazuTitle !== undefined && { "layout.hideHazuTitle": options.hideHazuTitle }),
      ...(options.showSidebar !== undefined && { "layout.showSidebar": options.showSidebar }),
      ...(options.showTimeline !== undefined && { "layout.showTimeline": options.showTimeline }),
      ...(options.showDate !== undefined && { "layout.showDate": options.showDate }),
      ...(options.showAuthor !== undefined && { "layout.showAuthor": options.showAuthor }),
      ...(options.showAssigned !== undefined && { "module.layout.showAssigned": options.showAssigned }),
      ...(options.showLocation !== undefined && { "module.layout.showLocation": options.showLocation }),
      ...(options.showShareButtons !== undefined && { "layout.showShareButtons": options.showShareButtons }),
      ...(options.minimizeVideo !== undefined && { "layout.minimizeVideo": options.minimizeVideo }),
      ...(options.messengerMode !== undefined && { "layout.messengerMode": options.messengerMode }),
      ...(options.autoDate !== undefined && { "layout.autoDate": options.autoDate }),
      ...(options.videoId && { "event.videoId": options.videoId }),
      ...(options.isChatTabVisible !== undefined && { "event.isChatTabVisible": options.isChatTabVisible }),
      ...(options.isQuestionTabVisible !== undefined && { "event.isQuestionTabVisible": options.isQuestionTabVisible }),
      ...(options.rolesSettings && { "event.rolesSettings": options.rolesSettings }),
      ...(options.tableSettings && { "event.tableSettings": options.tableSettings }),
      ...(options.tags && { tags: options.tags }),
      ...(options.main && { main: options.main }),
      ...(options.extra && { extra: options.extra }),
    };

    const response = await axios.post(`https://${apiPath}/create`, body, {
      headers: getAuthHeaders(),
    });

    return response.data;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      console.error("Error creating Hazu:", (error as any).response?.data ?? (error as any).message);
    } else {
      console.error("Unexpected error:", error);
    }
    return null;
  }
};

/**
 * Update an existing Hazu entity
 *
 * @param id - The ID of the Hazu to update
 * @param options - Update options (title, description, color, etc.)
 * @returns The updated entity data or null on error
 *
 * @example
 * await sendApiRequestUpdate("hazu123", {
 *   title: "Updated Title",
 *   color: "#00FF00",
 *   importFromHazu: "everybody"
 * });
 */
export const sendApiRequestUpdate = async (
  id: string,
  options: UpdateOptions = {}
): Promise<any> => {
  try {
    const {
      description,
      year,
      title,
      color,
      linkName,
      timelinePosition,
      startDate,
      endDate,
      importFromHazu,
      importIntoHazu,
      tableView,
    } = options;

    const body: Record<string, any> = {
      ...(title && { title }),
      ...(description && { description }),
      ...(linkName && { linkName }),
      ...(color && { color: color.toUpperCase() }),
      ...(importFromHazu !== undefined && { "event.rolesSettings.import.fromHazu": importFromHazu }),
      ...(importIntoHazu !== undefined && { "event.rolesSettings.import.intoHazu": importIntoHazu }),
      ...(startDate && endDate && {
        timelineDate: new Date(startDate).getTime(),
        timelineDuration: new Date(endDate).getTime() - new Date(startDate).getTime(),
      }),
      ...(timelinePosition !== undefined && { "module.layout.timelinePosition": timelinePosition }),
      ...(tableView && { "event.rolesSettings.views.table": tableView }),
    };

    const response = await axios.put(`https://${apiPath}/update`, body, {
      headers: getAuthHeaders(),
      params: { id },
    });

    return response.data;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      console.error("Error updating Hazu:", (error as any).response?.data ?? (error as any).message);
    } else {
      console.error("Unexpected error:", error);
    }
    return null;
  }
};

/**
 * Remove/delete a Hazu entity
 *
 * @param id - The ID of the Hazu to delete
 * @returns Response data or null on error
 *
 * @example
 * await sendApiRequestRemove("hazu123");
 */
export const sendApiRequestRemove = async (id: string): Promise<any> => {
  try {
    const response = await axios.delete(`https://${apiPath}/remove`, {
      headers: getAuthHeaders(),
      params: { id },
    });
    return response.data;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      console.error("Error removing Hazu:", (error as any).response?.data ?? (error as any).message);
    } else {
      console.error("Unexpected error:", error);
    }
    return null;
  }
};

// ============================================================================
// TAG OPERATIONS
// ============================================================================

/**
 * Add tags to a Hazu entity
 *
 * @param itemId - The ID of the item to tag
 * @param tags - Array of tag strings to add
 *
 * @example
 * await sendApiRequestAddTags("hazu123", ["important", "reviewed"]);
 */
export const sendApiRequestAddTags = async (itemId: string, tags: string[]): Promise<void> => {
  try {
    await axios.post(
      `https://${apiPath}/api-v2-items/${itemId}/tags`,
      { tags },
      {
        headers: {
          "x-api-key": token,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Tags added successfully:", tags);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      console.error("Error adding tags:", (error as any).response?.data ?? (error as any).message);
    } else {
      console.error("Unexpected error:", error);
    }
  }
};

/**
 * Remove tags from a Hazu entity
 *
 * @param itemId - The ID of the item
 * @param tags - Array of tag strings to remove
 *
 * @example
 * await sendApiRequestRemoveTags("hazu123", ["obsolete"]);
 */
export const sendApiRequestRemoveTags = async (itemId: string, tags: string[]): Promise<void> => {
  try {
    await axios({
      method: "DELETE",
      url: `https://${apiPath}/api-v2-items/${itemId}/tags`,
      headers: {
        "x-api-key": token,
        "Content-Type": "application/json",
      },
      data: { tags },
    });
    console.log("Tags removed successfully:", tags);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      console.error("Error removing tags:", (error as any).response?.data ?? (error as any).message);
    } else {
      console.error("Unexpected error:", error);
    }
  }
};

// ============================================================================
// GROUP OPERATIONS
// ============================================================================

/**
 * Add a group to a Hazu
 *
 * @param hazuId - The ID of the Hazu
 * @param groupIdentifier - The group identifier to add
 *
 * @example
 * await sendApiRequestAddGroup("hazu123", "group-students");
 */
export const sendApiRequestAddGroup = async (hazuId: string, groupIdentifier: string): Promise<void> => {
  try {
    await axios.post(
      `https://${apiPath}/api-v2-hazus/${hazuId}/groups`,
      { groupIdentifier },
      {
        headers: {
          "x-api-key": token,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Group added successfully:", groupIdentifier);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      console.error("Error adding group:", (error as any).response?.data ?? (error as any).message);
    } else {
      console.error("Unexpected error:", error);
    }
  }
};

/**
 * Remove a group from a Hazu
 *
 * @param hazuId - The ID of the Hazu
 * @param groupIdentifier - The group identifier to remove
 * @returns Response data or null on error
 *
 * @example
 * await sendApiRequestRemoveGroup("hazu123", "group-old");
 */
export const sendApiRequestRemoveGroup = async (hazuId: string, groupIdentifier: string): Promise<any> => {
  try {
    const response = await axios({
      method: "DELETE",
      url: `https://${apiPath}/api-v2-hazus/${hazuId}/groups`,
      headers: {
        "x-api-key": token,
        "Content-Type": "application/json",
      },
      data: { groupIdentifier },
    });
    console.log("Group removed successfully:", groupIdentifier);
    return response.data;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      console.error("Error removing group:", (error as any).response?.data ?? (error as any).message);
    } else {
      console.error("Unexpected error:", error);
    }
    return null;
  }
};

// ============================================================================
// USER OPERATIONS
// ============================================================================

/**
 * Create a new user with class assignments
 *
 * @param sourceId - Source template ID
 * @param classId - Array of class IDs to assign
 * @param firstName - User's first name
 * @param lastName - User's last name
 * @param targetId - Target Hazu ID
 * @param sharingGroupsId - Sharing groups ID
 * @param userEmail - User's email address
 * @returns Created user data or undefined on error
 *
 * @example
 * await sendApiRequestCreateUser(
 *   "source123",
 *   ["class1", "class2"],
 *   "John",
 *   "Doe",
 *   "target123",
 *   "sharing123",
 *   "john.doe@example.com"
 * );
 */
export const sendApiRequestCreateUser = async (
  sourceId: string,
  classId: string[],
  firstName: string,
  lastName: string,
  targetId: string,
  sharingGroupsId: string,
  userEmail: string
): Promise<any> => {
  try {
    const response = await axios.post(
      `https://${apiPath}/api-v2-admin/add-user`,
      {
        sourceId,
        classId,
        firstName,
        lastName,
        targetId,
        sharingGroupsId,
        userEmail,
      },
      {
        headers: {
          "x-api-key": token,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      console.error("Error creating user:", (error as any).response?.data ?? (error as any).message);
    } else {
      console.error("Unexpected error:", error);
    }
  }
};

/**
 * Update a user's role/permission on an item
 *
 * @param userId - The user's ID
 * @param itemId - The item ID
 * @param role - The new role to assign
 *
 * @example
 * await sendApiRequestUpdateRole("user123", "hazu123", "editor");
 */
export const sendApiRequestUpdateRole = async (
  userId: string,
  itemId: string,
  role: "editor" | "reader" | "admin" | "owner"
): Promise<void> => {
  try {
    await axios.put(
      `https://${apiPath}/acl`,
      { userId, itemId, role },
      {
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Role updated successfully:", userId, "->", role);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      console.error("Error updating role:", (error as any).response?.data ?? (error as any).message);
    } else {
      console.error("Unexpected error:", error);
    }
  }
};

/**
 * Remove a user's access from an item
 *
 * @param itemId - The item ID
 * @param userId - Optional user ID
 * @param userEmail - Optional user email (alternative to userId)
 * @returns Response data or null on error
 *
 * @example
 * await sendApiRequestRemoveUser("hazu123", "user123");
 * // or by email:
 * await sendApiRequestRemoveUser("hazu123", undefined, "user@example.com");
 */
export const sendApiRequestRemoveUser = async (
  itemId: string,
  userId?: string,
  userEmail?: string
): Promise<any> => {
  try {
    const body: Record<string, string> = { itemId };
    if (userId) body.userId = userId;
    if (userEmail) body.userEmail = userEmail;

    const response = await axios({
      method: "DELETE",
      url: `https://${apiPath}/acl`,
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "application/json",
      },
      data: body,
    });
    console.log("User removed successfully from item:", itemId);
    return response.data;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      console.error("Error removing user:", (error as any).response?.data ?? (error as any).message);
    } else {
      console.error("Unexpected error:", error);
    }
    return null;
  }
};

// ============================================================================
// ACL & PERMISSION OPERATIONS
// ============================================================================

/**
 * Get Access Control List information for an item
 *
 * @param itemId - The item ID to query
 * @returns ACL data
 *
 * @example
 * const acl = await sendApiRequestGetAclInfo("hazu123");
 * acl.data.forEach(entry => console.log(entry.displayName, entry.role));
 */
export const sendApiRequestGetAclInfo = async (itemId: string): Promise<any> => {
  try {
    const response = await axios.get(`https://${apiPath}/acl`, {
      headers: getAuthHeaders(),
      params: { id: itemId },
    });
    return response.data;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      console.error("Error fetching ACL:", (error as any).response?.data ?? (error as any).message);
    } else {
      console.error("Unexpected error:", error);
    }
    throw error;
  }
};

/**
 * Propagate permissions to child items
 *
 * @param parameters - Propagation parameters
 * @returns Propagation result
 *
 * @example
 * await sendApiRequestPropagate({
 *   creatorId: "creator123",
 *   currentLang: "en",
 *   link: "https://hazu.app/...",
 *   type: "all",
 *   userOrGroup: "user",
 *   userIdOrEmail: "user@example.com"
 * });
 */
export const sendApiRequestPropagate = async (parameters: ApiParametersPropagate): Promise<any> => {
  const isRemove = parameters.type === "deleteAll" || parameters.type === "deletePublic";
  const onlyPublic = parameters.type === "public" || parameters.type === "deletePublic";

  const body = {
    creatorId: parameters.creatorId,
    currentLang: parameters.currentLang,
    link: parameters.link,
    isRemove,
    onlyPublic,
    userIdOrEmail: parameters.userIdOrEmail,
    type: parameters.userOrGroup,
  };

  try {
    const response = await fetch(`https://${apiPath}/propagatePermissionsApi`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error propagating permissions:", error);
    throw error;
  }
};
