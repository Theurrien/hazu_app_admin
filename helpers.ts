/**
 * Hazu Helper Utilities
 *
 * Common utility functions for working with Hazu data.
 * These functions are used across various workflows and operations.
 */

import { HazuFilterOptions } from "./interfaces";

// ============================================================================
// TEXT PROCESSING
// ============================================================================

/**
 * Remove HTML tags from a string
 *
 * @param str - Input string potentially containing HTML
 * @returns Clean string without HTML tags
 *
 * @example
 * removeHTMLTags("<p>Hello <strong>World</strong></p>")
 * // Returns: "Hello World"
 */
export function removeHTMLTags(str: string): string {
  return str
    .replace(/<[^>]*>/g, "")      // Remove HTML tags
    .replace(/&nbsp;/g, " ")      // Replace &nbsp; with spaces
    .replace(/&amp;/g, "&")       // Replace &amp; with &
    .replace(/&lt;/g, "<")        // Replace &lt; with <
    .replace(/&gt;/g, ">")        // Replace &gt; with >
    .replace(/&quot;/g, '"')      // Replace &quot; with "
    .trim();                       // Trim whitespace
}

// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Parse a European date format (dd.mm.yy or dd.mm.yyyy) to a Date object
 *
 * @param dateStr - Date string in European format
 * @returns Date object or null if invalid
 *
 * @example
 * parseEuropeanDate("15.03.24")  // March 15, 2024
 * parseEuropeanDate("01.12.2023") // December 1, 2023
 */
export function parseEuropeanDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  const parts = dateStr.split(".");
  if (parts.length !== 3) return null;

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // JavaScript months are 0-indexed
  let year = parseInt(parts[2], 10);

  // Handle 2-digit years
  if (year < 100) {
    year += year < 50 ? 2000 : 1900;
  }

  const date = new Date(year, month, day);

  // Validate the date
  if (isNaN(date.getTime())) return null;

  return date;
}

/**
 * Format a Date object to European format (dd.mm.yyyy)
 *
 * @param date - Date object to format
 * @returns Formatted date string
 *
 * @example
 * formatEuropeanDate(new Date(2024, 2, 15)) // "15.03.2024"
 */
export function formatEuropeanDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Get the start of a day (midnight) for a given date
 *
 * @param date - Input date
 * @returns Date set to midnight
 */
export function getStartOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get the end of a day (23:59:59.999) for a given date
 *
 * @param date - Input date
 * @returns Date set to end of day
 */
export function getEndOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

// ============================================================================
// FILTERING UTILITIES
// ============================================================================

/**
 * Check if a Hazu matches the given filter criteria
 *
 * @param hazu - The Hazu object to check (with snapshot property)
 * @param filters - Filter options to apply
 * @returns Object with matches boolean and reason if not matching
 *
 * @example
 * const result = matchesFilters(hazu, { icon: "fa-star", color: "#FF5733" });
 * if (result.matches) {
 *   // Process the hazu
 * } else {
 *   console.log("Skipped:", result.reason);
 * }
 */
export function matchesFilters(
  hazu: any,
  filters?: HazuFilterOptions
): { matches: boolean; reason?: string } {
  if (!filters) {
    return { matches: true };
  }

  const snapshot = hazu.snapshot || hazu;

  // Icon filter (exact match)
  if (filters.icon && snapshot.icon !== filters.icon) {
    return { matches: false, reason: `Icon mismatch: expected "${filters.icon}", got "${snapshot.icon}"` };
  }

  // Color filter (case-insensitive)
  if (filters.color) {
    const filterColor = filters.color.toUpperCase();
    const hazuColor = (snapshot.color || "").toUpperCase();
    if (hazuColor !== filterColor) {
      return { matches: false, reason: `Color mismatch: expected "${filterColor}", got "${hazuColor}"` };
    }
  }

  // Title filter with multiple match types
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

  // Date filters
  if (filters.createdAfter || filters.createdBefore || filters.createdOnDate) {
    const dateCreated = snapshot.dateCreated;
    if (!dateCreated) {
      return { matches: false, reason: "No creation date available" };
    }

    const creationDate = new Date(dateCreated);

    // Created after filter
    if (filters.createdAfter) {
      const afterDate = parseEuropeanDate(filters.createdAfter);
      if (afterDate && creationDate < getStartOfDay(afterDate)) {
        return { matches: false, reason: `Created before ${filters.createdAfter}` };
      }
    }

    // Created before filter
    if (filters.createdBefore) {
      const beforeDate = parseEuropeanDate(filters.createdBefore);
      if (beforeDate && creationDate > getEndOfDay(beforeDate)) {
        return { matches: false, reason: `Created after ${filters.createdBefore}` };
      }
    }

    // Created on specific date filter
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

// ============================================================================
// TAG UTILITIES
// ============================================================================

/**
 * Compare two tag arrays for equality (order-independent)
 *
 * @param tags1 - First tag array
 * @param tags2 - Second tag array
 * @returns True if arrays contain the same tags
 *
 * @example
 * compareTagArrays(["a", "b"], ["b", "a"]) // true
 * compareTagArrays(["a", "b"], ["a", "c"]) // false
 */
export function compareTagArrays(tags1: string[], tags2: string[]): boolean {
  if (tags1.length !== tags2.length) return false;
  const sorted1 = [...tags1].sort();
  const sorted2 = [...tags2].sort();
  return sorted1.every((tag, index) => tag === sorted2[index]);
}

/**
 * Validate tags (no whitespace, non-empty)
 *
 * @param tags - Array of tags to validate
 * @returns Object with valid boolean and invalid tags list
 *
 * @example
 * validateTags(["good-tag", "bad tag", ""]);
 * // { valid: false, invalidTags: ["bad tag", ""] }
 */
export function validateTags(tags: string[]): { valid: boolean; invalidTags: string[] } {
  const invalidTags = tags.filter((tag) => !tag || /\s/.test(tag));
  return {
    valid: invalidTags.length === 0,
    invalidTags,
  };
}

/**
 * Normalize tags (trim, lowercase, remove duplicates)
 *
 * @param tags - Array of tags to normalize
 * @returns Normalized tag array
 */
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

// ============================================================================
// COLOR UTILITIES
// ============================================================================

/**
 * Validate a hex color code
 *
 * @param color - Color string to validate
 * @returns True if valid hex color
 *
 * @example
 * isValidHexColor("#FF5733") // true
 * isValidHexColor("#FFF")    // true
 * isValidHexColor("red")     // false
 */
export function isValidHexColor(color: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);
}

/**
 * Normalize a hex color to 6-digit uppercase format
 *
 * @param color - Color string to normalize
 * @returns Normalized color or original if invalid
 *
 * @example
 * normalizeHexColor("#fff")    // "#FFFFFF"
 * normalizeHexColor("#ff5733") // "#FF5733"
 */
export function normalizeHexColor(color: string): string {
  if (!color.startsWith("#")) return color;

  const hex = color.slice(1).toUpperCase();

  // Expand 3-digit to 6-digit
  if (hex.length === 3) {
    return "#" + hex.split("").map((c) => c + c).join("");
  }

  return "#" + hex;
}

// ============================================================================
// RESULT UTILITIES
// ============================================================================

/**
 * Create a batch operation summary from results
 *
 * @param results - Array of operation results
 * @returns Summary with counts and details
 */
export function summarizeResults(
  results: Array<{ success: boolean; id: string; error?: string }>
): { total: number; successful: number; failed: number; errors: string[] } {
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const errors = results.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`);

  return {
    total: results.length,
    successful,
    failed,
    errors,
  };
}

/**
 * Sleep for a specified duration
 * Useful for rate limiting API calls
 *
 * @param ms - Milliseconds to sleep
 *
 * @example
 * await sleep(1000); // Wait 1 second
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// HIERARCHY UTILITIES
// ============================================================================

/**
 * Extract the item key/ID from various response formats
 *
 * @param item - API response item
 * @returns The item's ID/key
 */
export function extractItemId(item: any): string {
  return item.snapshot?.key || item.key || item.id || "";
}

/**
 * Check if a Hazu is a container (can have children)
 *
 * @param hazu - The Hazu object to check
 * @returns True if it's a container type
 */
export function isContainer(hazu: any): boolean {
  const type = hazu.snapshot?.type || hazu.type;
  return type === "hazu";
}

/**
 * Check if a Hazu is a leaf item (cannot have children)
 *
 * @param hazu - The Hazu object to check
 * @returns True if it's a leaf item
 */
export function isLeafItem(hazu: any): boolean {
  const type = hazu.snapshot?.type || hazu.type;
  return type === "item";
}
