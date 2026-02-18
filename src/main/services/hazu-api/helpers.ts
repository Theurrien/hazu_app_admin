/**
 * Hazu Helper Utilities
 */

import { HazuFilterOptions } from "./interfaces";

export function removeHTMLTags(str: string): string {
  return str
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

export function parseEuropeanDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  const parts = dateStr.split(".");
  if (parts.length !== 3) return null;

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  let year = parseInt(parts[2], 10);

  if (year < 100) {
    year += year < 50 ? 2000 : 1900;
  }

  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) return null;

  return date;
}

export function formatEuropeanDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

export function getStartOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function getEndOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function matchesFilters(
  hazu: any,
  filters?: HazuFilterOptions
): { matches: boolean; reason?: string } {
  if (!filters) {
    return { matches: true };
  }

  const snapshot = hazu.snapshot || hazu;

  if (filters.icon && snapshot.icon !== filters.icon) {
    return { matches: false, reason: `Icon mismatch: expected "${filters.icon}", got "${snapshot.icon}"` };
  }

  if (filters.color) {
    const filterColor = filters.color.toUpperCase();
    const hazuColor = (snapshot.color || "").toUpperCase();
    if (hazuColor !== filterColor) {
      return { matches: false, reason: `Color mismatch: expected "${filterColor}", got "${hazuColor}"` };
    }
  }

  if (filters.title) {
    const hazuTitle = removeHTMLTags(snapshot.title || "");
    const filterTitle = filters.title;
    const matchType = filters.titleMatchType || "contains";

    let titleMatches = false;

    switch (matchType) {
      case "exact":
        titleMatches = hazuTitle === filterTitle;
        break;
      case "contains":
        titleMatches = hazuTitle.toLowerCase().includes(filterTitle.toLowerCase());
        break;
      case "regex":
        try {
          const regex = new RegExp(filterTitle, "i");
          titleMatches = regex.test(hazuTitle);
        } catch (e) {
          return { matches: false, reason: `Invalid regex pattern: "${filterTitle}"` };
        }
        break;
    }

    if (!titleMatches) {
      return { matches: false, reason: `Title "${hazuTitle}" does not match "${filterTitle}" (${matchType})` };
    }
  }

  if (filters.createdAfter || filters.createdBefore || filters.createdOnDate) {
    const dateCreated = snapshot.dateCreated;
    if (!dateCreated) {
      return { matches: false, reason: "No creation date available" };
    }

    const creationDate = new Date(dateCreated);

    if (filters.createdAfter) {
      const afterDate = parseEuropeanDate(filters.createdAfter);
      if (afterDate && creationDate < getStartOfDay(afterDate)) {
        return { matches: false, reason: `Created before ${filters.createdAfter}` };
      }
    }

    if (filters.createdBefore) {
      const beforeDate = parseEuropeanDate(filters.createdBefore);
      if (beforeDate && creationDate > getEndOfDay(beforeDate)) {
        return { matches: false, reason: `Created after ${filters.createdBefore}` };
      }
    }

    if (filters.createdOnDate) {
      const onDate = parseEuropeanDate(filters.createdOnDate);
      if (onDate) {
        const startOfDay = getStartOfDay(onDate);
        const endOfDay = getEndOfDay(onDate);
        if (creationDate < startOfDay || creationDate > endOfDay) {
          return { matches: false, reason: `Not created on ${filters.createdOnDate}` };
        }
      }
    }
  }

  return { matches: true };
}

export function compareTagArrays(tags1: string[], tags2: string[]): boolean {
  if (tags1.length !== tags2.length) return false;
  const sorted1 = [...tags1].sort();
  const sorted2 = [...tags2].sort();
  return sorted1.every((tag, index) => tag === sorted2[index]);
}

export function validateTags(tags: string[]): { valid: boolean; invalidTags: string[] } {
  const invalidTags = tags.filter((tag) => !tag || /\s/.test(tag));
  return { valid: invalidTags.length === 0, invalidTags };
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => {
      if (!tag || seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });
}

export function isValidHexColor(color: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);
}

export function normalizeHexColor(color: string): string {
  if (!color.startsWith("#")) return color;
  const hex = color.slice(1).toUpperCase();
  if (hex.length === 3) {
    return "#" + hex.split("").map((c) => c + c).join("");
  }
  return "#" + hex;
}

export function summarizeResults(
  results: Array<{ success: boolean; id: string; error?: string }>
): { total: number; successful: number; failed: number; errors: string[] } {
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const errors = results.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`);
  return { total: results.length, successful, failed, errors };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractItemId(item: any): string {
  return item.snapshot?.key || item.key || item.id || "";
}

export function isContainer(hazu: any): boolean {
  const type = hazu.snapshot?.type || hazu.type;
  return type === "hazu";
}

export function isLeafItem(hazu: any): boolean {
  const type = hazu.snapshot?.type || hazu.type;
  return type === "item";
}
