/**
 * Hazu API Core Functions
 */

import axios from "axios";
import { CreateOptions, UpdateOptions, ApiParametersPropagate, HazuEntity } from "./interfaces";
import { getApiKey, getApiEndpoint } from "./config";

function getAuthHeaders(): Record<string, string> {
  const token = getApiKey();
  return token.length <= 20 ? { token } : { "x-api-key": token };
}

// READ OPERATIONS

export const sendApiRequestRead = async (id: string): Promise<any> => {
  try {
    const response = await axios.get(`https://${getApiEndpoint()}/read`, {
      headers: getAuthHeaders(),
      params: { id },
    });
    return response.data;
  } catch (error) {
    console.error("Error reading Hazu:", error);
    throw error;
  }
};

export const sendApiRequestList = async (
  parentId: string,
  filter = "",
  title = "",
  description = "",
  fulltext = ""
): Promise<HazuEntity[] | null> => {
  try {
    const response = await axios.get(`https://${getApiEndpoint()}/readChildren`, {
      headers: getAuthHeaders(),
      params: {
        parentId,
        filter: filter || undefined,
        title: title || undefined,
        description: description || undefined,
        fulltext: fulltext || undefined,
      },
    });
    // Handle both array and { data: [...] } response formats
    const data = response.data;
    return Array.isArray(data) ? data : data?.data || [];
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

// WRITE OPERATIONS

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

    const response = await axios.post(`https://${getApiEndpoint()}/create`, body, {
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

export const sendApiRequestUpdate = async (
  id: string,
  options: UpdateOptions = {}
): Promise<any> => {
  try {
    const { description, year, title, color, linkName, timelinePosition, startDate, endDate, importFromHazu, importIntoHazu, tableView } = options;

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

    const response = await axios.put(`https://${getApiEndpoint()}/update`, body, {
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

export const sendApiRequestRemove = async (id: string): Promise<any> => {
  try {
    const response = await axios.delete(`https://${getApiEndpoint()}/remove`, {
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

// TAG OPERATIONS

export const sendApiRequestAddTags = async (itemId: string, tags: string[]): Promise<void> => {
  try {
    await axios.post(
      `https://${getApiEndpoint()}/api-v2-items/${itemId}/tags`,
      { tags },
      {
        headers: {
          "x-api-key": getApiKey(),
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

// Checked variant of sendApiRequestAddTags: same POST, but it does NOT swallow errors —
// a non-2xx rejects so callers (tag healing) can detect failure. The original
// swallow-and-void sendApiRequestAddTags is left unchanged for its existing callers.
export const sendApiRequestAddTagsChecked = async (itemId: string, tags: string[]): Promise<void> => {
  await axios.post(
    `https://${getApiEndpoint()}/api-v2-items/${itemId}/tags`,
    { tags },
    {
      headers: {
        "x-api-key": getApiKey(),
        "Content-Type": "application/json",
      },
    }
  );
};

export const sendApiRequestRemoveTags = async (itemId: string, tags: string[]): Promise<void> => {
  try {
    await axios({
      method: "DELETE",
      url: `https://${getApiEndpoint()}/api-v2-items/${itemId}/tags`,
      headers: {
        "x-api-key": getApiKey(),
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

// GROUP OPERATIONS

export const sendApiRequestAddGroup = async (hazuId: string, groupIdentifier: string): Promise<void> => {
  try {
    await axios.post(
      `https://${getApiEndpoint()}/api-v2-hazus/${hazuId}/groups`,
      { groupIdentifier },
      {
        headers: {
          "x-api-key": getApiKey(),
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

export const sendApiRequestRemoveGroup = async (hazuId: string, groupIdentifier: string): Promise<any> => {
  try {
    const response = await axios({
      method: "DELETE",
      url: `https://${getApiEndpoint()}/api-v2-hazus/${hazuId}/groups`,
      headers: {
        "x-api-key": getApiKey(),
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

// USER OPERATIONS

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
      `https://${getApiEndpoint()}/api-v2-admin/add-user`,
      { sourceId, classId, firstName, lastName, targetId, sharingGroupsId, userEmail },
      {
        headers: {
          "x-api-key": getApiKey(),
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

export const sendApiRequestUpdateRole = async (
  userId: string,
  itemId: string,
  role: "editor" | "reader" | "admin" | "owner"
): Promise<void> => {
  try {
    await axios.put(
      `https://${getApiEndpoint()}/acl`,
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
      url: `https://${getApiEndpoint()}/acl`,
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

export interface RemoveUserResult {
  ok: boolean;
  status?: number;
  networkOrTimeout: boolean;
  error?: string;
}

// Checked variant of sendApiRequestRemoveUser: same DELETE, but instead of swallowing the
// error into a bare `null`, it classifies the failure — a real HTTP status (from an axios
// error with a `response`) vs. a network failure or timeout (no `response`, or
// ECONNABORTED/ETIMEDOUT) — the same split role-write.service.ts uses for the S4 write path.
// Callers with a retryable-vs-not predicate (e.g. S6 orphan removal) need this distinction;
// a 4xx must never be classified as networkOrTimeout or it gets retried like a 5xx.
// The original swallow-and-return-null sendApiRequestRemoveUser is left unchanged for its
// existing caller.
export const sendApiRequestRemoveUserChecked = async (
  itemId: string,
  userId?: string,
  userEmail?: string
): Promise<RemoveUserResult> => {
  const body: Record<string, string> = { itemId };
  if (userId) body.userId = userId;
  if (userEmail) body.userEmail = userEmail;

  try {
    await axios({
      method: "DELETE",
      url: `https://${getApiEndpoint()}/acl`,
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "application/json",
      },
      data: body,
    });
    console.log("User removed successfully from item:", itemId);
    return { ok: true, networkOrTimeout: false };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const networkOrTimeout = !error.response || error.code === "ECONNABORTED" || error.code === "ETIMEDOUT";
      console.error(
        "Error removing user from item:", itemId,
        "status=", status, "code=", error.code,
        (error.response?.data as any) ?? error.message,
      );
      return { ok: false, status, networkOrTimeout, error: (error.response?.data as any)?.message || error.message };
    }
    console.error("Unexpected error removing user:", error);
    return { ok: false, networkOrTimeout: false, error: error instanceof Error ? error.message : String(error) };
  }
};

// ACL & PERMISSION OPERATIONS

export const sendApiRequestGetAclInfo = async (itemId: string): Promise<any> => {
  try {
    const response = await axios.get(`https://${getApiEndpoint()}/acl`, {
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
    const response = await fetch(`https://${getApiEndpoint()}/propagatePermissionsApi`, {
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
