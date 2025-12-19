# CLAUDE.md - Hazu API Starter Kit

This is the foundation for building integrations with the Hazu platform. This document provides everything you need to understand and work with the Hazu API.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env with your API keys

# 3. Set your environment in config.ts
# Change: export const env: "swiss" | "io" | "dev" = "swiss";

# 4. Run an example
npx ts-node examples/basic-usage.ts
```

## Project Structure

```
hazu_start/
├── config.ts          # Environment configuration
├── api.ts             # Core API functions (15+ endpoints)
├── interfaces.ts      # TypeScript type definitions
├── helpers.ts         # Utility functions
├── package.json       # Dependencies
├── tsconfig.json      # TypeScript config
├── .env.example       # Environment template
├── examples/
│   └── basic-usage.ts # Usage examples
└── CLAUDE.md          # This documentation
```

## Understanding Hazu

### What is a Hazu?

Hazu is a hierarchical content platform where:
- **Hazu** (type: `"hazu"`) = Container that can have children
- **Item** (type: `"item"`) = Leaf node, cannot have children

Think of it like a file system: Hazus are folders, Items are files.

### Entity Hierarchy

```
Root Hazu
├── Child Hazu
│   ├── Grandchild Hazu
│   │   └── Item
│   └── Item
└── Item
```

### Entity Properties

Every Hazu/Item has these core properties:
- `key` / `id` - Unique identifier
- `title` - Display name
- `description` - Short description
- `color` - Hex color code (e.g., "#FF5733")
- `icon` - Font Awesome class (e.g., "fa-star")
- `type` - "hazu" or "item"
- `parentId` - ID of parent entity
- `tags` - Array of string tags
- `privacy` - Privacy setting
- `dateCreated` - Creation timestamp

## Environment Configuration

### Three Environments

| Environment | Endpoint | Use Case |
|-------------|----------|----------|
| swiss | europe-west6-hazu-ch.cloudfunctions.net | Production |
| io | us-central1-blazing-torch-5326.cloudfunctions.net | IO environment |
| dev | europe-west6-hazu-ch-dev.cloudfunctions.net | Development |

### Setting Up

1. Create `.env` file with your API keys:
```env
HAZU_API_KEY_SUPPORT_SWISS=your-key-here
HAZU_API_KEY_SUPPORT_IO=your-key-here
HAZU_API_KEY_SUPPORT_DEV=your-key-here
```

2. Set active environment in `config.ts`:
```typescript
export const env: "swiss" | "io" | "dev" = "swiss";
```

### Authentication

The API uses dual authentication based on key length:
- **Legacy keys** (≤20 chars): `token` header
- **Modern keys** (>20 chars): `x-api-key` header

This is handled automatically by `api.ts`.

## Core API Functions

### Read Operations

```typescript
import { sendApiRequestRead, sendApiRequestList } from "./api";

// Read a single entity
const hazu = await sendApiRequestRead("hazu-id");
console.log(hazu.snapshot.title);

// List children of a parent
const children = await sendApiRequestList("parent-id");
children.forEach(child => console.log(child.snapshot.title));

// List with optional filters
const filtered = await sendApiRequestList(
  "parent-id",
  "filter",      // Filter string
  "title",       // Title filter
  "description", // Description filter
  "fulltext"     // Fulltext search
);
```

### Create Operations

```typescript
import { sendApiRequestCreate } from "./api";
import { CreateOptions } from "./interfaces";

const options: CreateOptions = {
  parentId: "parent-id",
  type: "hazu",              // or "item"
  title: "My New Hazu",
  description: "Description here",
  color: "#FF5733",
  icon: "fa-star",
  authorId: "author-id",
  displayName: "Author Name",
  privacy: "private",
  tags: ["tag1", "tag2"],
};

const result = await sendApiRequestCreate(options);
console.log("Created:", result.key);
```

### Update Operations

```typescript
import { sendApiRequestUpdate } from "./api";

await sendApiRequestUpdate("hazu-id", {
  title: "New Title",
  description: "New description",
  color: "#00FF00",
  linkName: "url-friendly-name",
  importFromHazu: "everybody",  // Permission level
  importIntoHazu: "reader",     // Permission level
});
```

### Delete Operations

```typescript
import { sendApiRequestRemove } from "./api";

await sendApiRequestRemove("hazu-id");
```

### Tag Operations

```typescript
import { sendApiRequestAddTags, sendApiRequestRemoveTags } from "./api";

// Add tags
await sendApiRequestAddTags("hazu-id", ["important", "reviewed"]);

// Remove tags
await sendApiRequestRemoveTags("hazu-id", ["obsolete"]);
```

### Group Operations

```typescript
import { sendApiRequestAddGroup, sendApiRequestRemoveGroup } from "./api";

// Add group access
await sendApiRequestAddGroup("hazu-id", "group-identifier");

// Remove group access
await sendApiRequestRemoveGroup("hazu-id", "group-identifier");
```

### User Operations

```typescript
import {
  sendApiRequestCreateUser,
  sendApiRequestUpdateRole,
  sendApiRequestRemoveUser
} from "./api";

// Create user with class assignments
await sendApiRequestCreateUser(
  "source-id",
  ["class1", "class2"],
  "John",
  "Doe",
  "target-id",
  "sharing-groups-id",
  "john@example.com"
);

// Update user role
await sendApiRequestUpdateRole("user-id", "hazu-id", "editor");

// Remove user access
await sendApiRequestRemoveUser("hazu-id", "user-id");
// or by email:
await sendApiRequestRemoveUser("hazu-id", undefined, "user@example.com");
```

### ACL Operations

```typescript
import { sendApiRequestGetAclInfo, sendApiRequestPropagate } from "./api";

// Get access control list
const acl = await sendApiRequestGetAclInfo("hazu-id");
acl.data.forEach(entry => {
  console.log(`${entry.displayName}: ${entry.role}`);
});

// Propagate permissions
await sendApiRequestPropagate({
  creatorId: "creator-id",
  currentLang: "en",
  link: "https://hazu.app/...",
  type: "all",           // "all", "public", "deleteAll", "deletePublic"
  userOrGroup: "user",   // "user" or "group"
  userIdOrEmail: "user@example.com",
});
```

## Permission Levels

Used in import settings and role assignments:

| Level | Description |
|-------|-------------|
| `admin` | Full administrative access |
| `editor` | Can edit content |
| `reader` | Read-only access |
| `owner` | Owner of the Hazu |
| `registered` | Registered users only |
| `verified` | Verified users only |
| `everybody` | Public access |

## Helper Functions

### Text Processing

```typescript
import { removeHTMLTags } from "./helpers";

const clean = removeHTMLTags("<p>Hello <strong>World</strong></p>");
// Returns: "Hello World"
```

### Date Utilities

```typescript
import { parseEuropeanDate, formatEuropeanDate } from "./helpers";

// Parse European format (dd.mm.yy or dd.mm.yyyy)
const date = parseEuropeanDate("15.03.24");  // March 15, 2024

// Format to European format
const str = formatEuropeanDate(new Date()); // "19.12.2024"
```

### Filtering

```typescript
import { matchesFilters } from "./helpers";
import { HazuFilterOptions } from "./interfaces";

const filters: HazuFilterOptions = {
  icon: "fa-book",
  color: "#FF5733",
  title: "Chapter",
  titleMatchType: "contains",  // "exact", "contains", or "regex"
  createdAfter: "01.01.24",    // European date format
  createdBefore: "31.12.24",
};

const result = matchesFilters(hazu, filters);
if (result.matches) {
  // Process the hazu
} else {
  console.log("Skipped:", result.reason);
}
```

### Tag Utilities

```typescript
import { compareTagArrays, validateTags, normalizeTags } from "./helpers";

// Compare tag arrays (order-independent)
compareTagArrays(["a", "b"], ["b", "a"]); // true

// Validate tags
const validation = validateTags(["good-tag", "bad tag"]);
// { valid: false, invalidTags: ["bad tag"] }

// Normalize tags
const normalized = normalizeTags(["TAG", "  tag  ", "Tag"]);
// ["tag"]
```

## Common Patterns

### Pattern 1: Fetch and Process Children

```typescript
const children = await sendApiRequestList(parentId);

if (!children) {
  console.error("Failed to fetch children");
  return;
}

for (const child of children) {
  const { matches, reason } = matchesFilters(child, filters);

  if (!matches) {
    console.log(`Skipping ${child.snapshot.title}: ${reason}`);
    continue;
  }

  // Process matching child
  await processChild(child);
}
```

### Pattern 2: Batch Updates with Results

```typescript
import { summarizeResults } from "./helpers";

const results: Array<{ success: boolean; id: string; error?: string }> = [];

for (const item of items) {
  try {
    await sendApiRequestUpdate(item.id, updateOptions);
    results.push({ success: true, id: item.id });
  } catch (error) {
    results.push({
      success: false,
      id: item.id,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

const summary = summarizeResults(results);
console.log(`Processed: ${summary.total}, Success: ${summary.successful}, Failed: ${summary.failed}`);
```

### Pattern 3: Recursive Hierarchy Traversal

```typescript
async function traverseHierarchy(hazuId: string, callback: (hazu: any) => Promise<void>) {
  const hazu = await sendApiRequestRead(hazuId);
  await callback(hazu);

  if (hazu.snapshot.type === "hazu") {
    const children = await sendApiRequestList(hazuId);
    if (children) {
      for (const child of children) {
        await traverseHierarchy(child.snapshot.key, callback);
      }
    }
  }
}

// Usage
await traverseHierarchy(rootId, async (hazu) => {
  console.log(hazu.snapshot.title);
});
```

### Pattern 4: Two-Level Filtering (Parent → Child → Target)

This pattern is useful when you need to:
1. Filter which parent children to process
2. Then filter which items within those children to update

```typescript
const parentChildren = await sendApiRequestList(parentId);

// First level: filter parent's children
const filteredChildren = parentChildren.filter(child =>
  matchesFilters(child, childFilters).matches
);

for (const child of filteredChildren) {
  // Get grandchildren
  const grandchildren = await sendApiRequestList(child.snapshot.key);

  // Second level: filter targets within each child
  const targets = grandchildren.filter(gc =>
    matchesFilters(gc, targetFilters).matches
  );

  for (const target of targets) {
    await sendApiRequestUpdate(target.snapshot.key, updateOptions);
  }
}
```

## API Response Formats

### Read Response

```typescript
{
  snapshot: {
    key: "abc123",
    title: "My Hazu",
    description: "Description",
    color: "#FF5733",
    icon: "fa-star",
    type: "hazu",
    parentId: "parent123",
    tags: ["tag1", "tag2"],
    dateCreated: 1703001234567,
    // ... more properties
  }
}
```

### List Response

```typescript
// Returns array of items with snapshot property
[
  { snapshot: { key: "...", title: "...", ... } },
  { snapshot: { key: "...", title: "...", ... } },
  // ...
]
```

## Error Handling

All API functions follow consistent error handling:
- Return `null` on error (for functions that return data)
- Log detailed error messages
- Include context (IDs, endpoints) in error logs

```typescript
const result = await sendApiRequestUpdate(id, options);

if (result === null) {
  console.log("Update failed - check logs for details");
  return;
}

// Success
console.log("Updated successfully");
```

## Building New Workflows

When creating new workflows, follow this structure:

### 1. Create Interface File (`my-workflow-interfaces.ts`)

```typescript
export interface MyWorkflowConfig {
  parentId: string;
  filters?: HazuFilterOptions;
  // workflow-specific options
}

export interface MyWorkflowResult {
  success: boolean;
  processed: number;
  errors: string[];
}
```

### 2. Create Main Function File (`my-workflow.ts`)

```typescript
import { sendApiRequestList, sendApiRequestUpdate } from "./api";
import { matchesFilters } from "./helpers";
import { MyWorkflowConfig, MyWorkflowResult } from "./my-workflow-interfaces";

export async function runMyWorkflow(config: MyWorkflowConfig): Promise<MyWorkflowResult> {
  const results: MyWorkflowResult = {
    success: true,
    processed: 0,
    errors: [],
  };

  // 1. Fetch children
  const children = await sendApiRequestList(config.parentId);
  if (!children) {
    results.success = false;
    results.errors.push("Failed to fetch children");
    return results;
  }

  // 2. Filter and process
  for (const child of children) {
    const { matches, reason } = matchesFilters(child, config.filters);
    if (!matches) continue;

    try {
      // 3. Perform operation
      await sendApiRequestUpdate(child.snapshot.key, {
        // updates
      });
      results.processed++;
    } catch (error) {
      results.errors.push(`Failed to update ${child.snapshot.key}`);
    }
  }

  return results;
}
```

### 3. Create Runner File (`my-workflow-run.ts`)

```typescript
import { runMyWorkflow } from "./my-workflow";
import { MyWorkflowConfig } from "./my-workflow-interfaces";

const config: MyWorkflowConfig = {
  parentId: "your-parent-id",
  filters: {
    icon: "fa-file",
  },
};

async function main() {
  console.log("Starting workflow...");
  const result = await runMyWorkflow(config);

  console.log(`Processed: ${result.processed}`);
  if (result.errors.length > 0) {
    console.log("Errors:", result.errors);
  }
}

main().catch(console.error);
```

## Tips for Claude Instances

1. **Always read before write**: Use `sendApiRequestRead()` to understand current state before making updates.

2. **Use dry-run patterns**: When building batch operations, add a `dryRun` option that logs what would happen without making changes.

3. **Preserve existing data**: When updating, only include fields you want to change. Omitted fields are not modified.

4. **Handle API response formats**: List responses may be arrays directly or wrapped in `{ data: [...] }`. Always check both formats.

5. **Colors are uppercased**: The API automatically uppercases colors, so "#ff5733" becomes "#FF5733".

6. **Tags have no spaces**: Tags should not contain whitespace. Use hyphens or underscores instead.

7. **European dates**: The platform uses European date format (dd.mm.yy or dd.mm.yyyy). Use the helper functions.

8. **Type-aware traversal**: Only `"hazu"` type entities have children. `"item"` types are leaf nodes.

9. **Rate limiting**: For large batch operations, consider adding small delays between API calls.

10. **Error recovery**: API functions return `null` on error, so always check return values.

## Useful Commands

```bash
# Run TypeScript directly
npx ts-node your-script.ts

# Format code
npm run format

# Install a new dependency
npm install package-name

# Run the example file
npm run example
```

## Extending This Starter Kit

To add new functionality:

1. Add new interfaces to `interfaces.ts`
2. Add new API functions to `api.ts`
3. Add new utilities to `helpers.ts`
4. Create workflow files in `src/` or at root level
5. Add examples to `examples/`
6. Update this CLAUDE.md with documentation

The goal is to keep this starter kit clean and minimal while providing all the foundational tools needed for Hazu integrations.
