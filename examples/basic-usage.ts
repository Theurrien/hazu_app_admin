/**
 * Hazu API Basic Usage Examples
 *
 * This file demonstrates common patterns for working with the Hazu API.
 * Run with: npx ts-node examples/basic-usage.ts
 */

import {
  sendApiRequestRead,
  sendApiRequestList,
  sendApiRequestCreate,
  sendApiRequestUpdate,
  sendApiRequestRemove,
  sendApiRequestAddTags,
  sendApiRequestRemoveTags,
} from "../api";
import { matchesFilters, removeHTMLTags, summarizeResults } from "../helpers";
import { CreateOptions, HazuFilterOptions } from "../interfaces";

// ============================================================================
// EXAMPLE 1: Reading a Hazu
// ============================================================================

async function exampleReadHazu() {
  console.log("\n=== Example: Read a Hazu ===\n");

  const hazuId = "your-hazu-id-here";

  try {
    const hazu = await sendApiRequestRead(hazuId);
    console.log("Title:", hazu.snapshot.title);
    console.log("Description:", removeHTMLTags(hazu.snapshot.description || ""));
    console.log("Color:", hazu.snapshot.color);
    console.log("Tags:", hazu.snapshot.tags);
  } catch (error) {
    console.error("Failed to read Hazu:", error);
  }
}

// ============================================================================
// EXAMPLE 2: Listing Children
// ============================================================================

async function exampleListChildren() {
  console.log("\n=== Example: List Children ===\n");

  const parentId = "your-parent-id-here";

  const children = await sendApiRequestList(parentId);

  if (children && Array.isArray(children)) {
    console.log(`Found ${children.length} children:`);
    children.forEach((child, index) => {
      console.log(`  ${index + 1}. ${child.snapshot.title} (${child.snapshot.type})`);
    });
  }
}

// ============================================================================
// EXAMPLE 3: Creating a New Hazu
// ============================================================================

async function exampleCreateHazu() {
  console.log("\n=== Example: Create a Hazu ===\n");

  const createOptions: CreateOptions = {
    parentId: "parent-hazu-id",
    type: "hazu",
    title: "My New Hazu",
    description: "This is a test Hazu created via API",
    color: "#FF5733",
    icon: "fa-star",
    authorId: "your-author-id",
    displayName: "Your Name",
    privacy: "private",
    tags: ["test", "api-created"],
  };

  const result = await sendApiRequestCreate(createOptions);

  if (result) {
    console.log("Created Hazu with ID:", result.key || result.id);
  }
}

// ============================================================================
// EXAMPLE 4: Updating a Hazu
// ============================================================================

async function exampleUpdateHazu() {
  console.log("\n=== Example: Update a Hazu ===\n");

  const hazuId = "your-hazu-id-here";

  const result = await sendApiRequestUpdate(hazuId, {
    title: "Updated Title",
    description: "This description was updated via API",
    color: "#00FF00",
    importFromHazu: "everybody",
    importIntoHazu: "reader",
  });

  if (result) {
    console.log("Hazu updated successfully");
  }
}

// ============================================================================
// EXAMPLE 5: Working with Tags
// ============================================================================

async function exampleManageTags() {
  console.log("\n=== Example: Manage Tags ===\n");

  const hazuId = "your-hazu-id-here";

  // Add tags
  await sendApiRequestAddTags(hazuId, ["important", "reviewed", "2024"]);

  // Remove tags
  await sendApiRequestRemoveTags(hazuId, ["obsolete", "draft"]);
}

// ============================================================================
// EXAMPLE 6: Filtering Children
// ============================================================================

async function exampleFilterChildren() {
  console.log("\n=== Example: Filter Children ===\n");

  const parentId = "your-parent-id-here";

  const children = await sendApiRequestList(parentId);

  if (!children) {
    console.log("No children found");
    return;
  }

  // Define filter criteria
  const filters: HazuFilterOptions = {
    icon: "fa-book",
    color: "#FF5733",
    title: "Chapter",
    titleMatchType: "contains",
  };

  // Apply filters
  const filtered = children.filter((child) => {
    const result = matchesFilters(child, filters);
    return result.matches;
  });

  console.log(`Found ${filtered.length} matching children out of ${children.length}`);

  filtered.forEach((child) => {
    console.log(`  - ${child.snapshot.title}`);
  });
}

// ============================================================================
// EXAMPLE 7: Batch Update Pattern
// ============================================================================

async function exampleBatchUpdate() {
  console.log("\n=== Example: Batch Update ===\n");

  const parentId = "your-parent-id-here";

  const children = await sendApiRequestList(parentId);

  if (!children) {
    console.log("No children found");
    return;
  }

  // Filter to only process certain items
  const filters: HazuFilterOptions = {
    icon: "fa-file",
  };

  const results: Array<{ success: boolean; id: string; error?: string }> = [];

  for (const child of children) {
    const { matches, reason } = matchesFilters(child, filters);

    if (!matches) {
      console.log(`Skipping ${child.snapshot.title}: ${reason}`);
      continue;
    }

    const id = child.snapshot.key;

    try {
      await sendApiRequestUpdate(id, {
        importFromHazu: "everybody",
      });

      results.push({ success: true, id });
      console.log(`Updated: ${child.snapshot.title}`);
    } catch (error) {
      results.push({
        success: false,
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Summarize results
  const summary = summarizeResults(results);
  console.log(`\nBatch Update Complete:`);
  console.log(`  Total: ${summary.total}`);
  console.log(`  Successful: ${summary.successful}`);
  console.log(`  Failed: ${summary.failed}`);

  if (summary.errors.length > 0) {
    console.log(`\nErrors:`);
    summary.errors.forEach((err) => console.log(`  - ${err}`));
  }
}

// ============================================================================
// EXAMPLE 8: Recursive Hierarchy Traversal
// ============================================================================

async function traverseHierarchy(hazuId: string, depth = 0): Promise<void> {
  const indent = "  ".repeat(depth);

  try {
    const hazu = await sendApiRequestRead(hazuId);
    console.log(`${indent}${hazu.snapshot.title} (${hazu.snapshot.type})`);

    // Only traverse children for container types
    if (hazu.snapshot.type === "hazu") {
      const children = await sendApiRequestList(hazuId);

      if (children && Array.isArray(children)) {
        for (const child of children) {
          await traverseHierarchy(child.snapshot.key, depth + 1);
        }
      }
    }
  } catch (error) {
    console.error(`${indent}Error reading ${hazuId}:`, error);
  }
}

async function exampleTraverseHierarchy() {
  console.log("\n=== Example: Traverse Hierarchy ===\n");

  const rootId = "your-root-hazu-id";
  await traverseHierarchy(rootId);
}

// ============================================================================
// MAIN: Run Examples
// ============================================================================

async function main() {
  console.log("Hazu API Usage Examples");
  console.log("=======================");
  console.log("\nNote: Replace placeholder IDs with real Hazu IDs to run examples.\n");

  // Uncomment the examples you want to run:

  // await exampleReadHazu();
  // await exampleListChildren();
  // await exampleCreateHazu();
  // await exampleUpdateHazu();
  // await exampleManageTags();
  // await exampleFilterChildren();
  // await exampleBatchUpdate();
  // await exampleTraverseHierarchy();

  console.log("\nUncomment examples in main() to run them.");
}

main().catch(console.error);
