# CLAUDE.md - Hazu Admin Desktop App

This is the development guide for Claude and other AI assistants working on the Hazu Admin desktop application.

## Project Overview

Cross-platform Electron + React desktop app for managing the Hazu educational platform. Syncs data locally to SQLite for offline management of persons, rooms, and assignments.

## Quick Commands

```bash
# Install dependencies
npm install

# Development (runs Vite + Electron concurrently)
npm run dev

# Build for production
npm run build

# Start built app
npm start

# Package for distribution
npm run dist
```

## Project Structure

```
hazu-admin/
├── src/
│   ├── main/                    # Electron Main Process (Node.js)
│   │   ├── index.ts            # App entry, window creation
│   │   ├── preload.ts          # IPC bridge (contextBridge)
│   │   ├── database/
│   │   │   ├── index.ts        # SQLite initialization
│   │   │   └── schema.sql      # Database schema
│   │   ├── ipc/
│   │   │   └── index.ts        # All IPC handlers
│   │   └── services/
│   │       ├── hazu-api/       # Hazu API client
│   │       │   ├── api.ts      # HTTP functions
│   │       │   ├── config.ts   # Environment config
│   │       │   ├── helpers.ts  # Utilities
│   │       │   └── interfaces.ts
│   │       └── sync.service.ts # Hazu → SQLite sync
│   │
│   ├── renderer/               # React Frontend (Vite)
│   │   ├── App.tsx            # Main app with routing
│   │   ├── main.tsx           # React entry point
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── RoomsPage.tsx
│   │   │   ├── PersonsPage.tsx
│   │   │   └── SettingsPage.tsx
│   │   ├── components/
│   │   │   └── layout/
│   │   │       ├── Sidebar.tsx
│   │   │       └── Header.tsx
│   │   └── styles/
│   │       └── global.css      # Tailwind imports
│   │
│   └── shared/                 # Shared between main & renderer
│       ├── types.ts           # TypeScript interfaces
│       └── ipc-channels.ts    # IPC channel constants
│
├── dist/                       # Build output
├── package.json
├── tsconfig.json              # Renderer TypeScript config
├── tsconfig.main.json         # Main process TypeScript config
├── vite.config.ts             # Vite bundler config
├── tailwind.config.js
└── postcss.config.js
```

## Architecture

### Main Process (Electron)
- Runs in Node.js environment
- Handles SQLite database operations
- Makes HTTP requests to Hazu API
- Communicates with renderer via IPC

### Renderer Process (React)
- Runs in Chromium browser context
- No direct Node.js/filesystem access
- Uses `window.electronAPI` for all backend operations
- Styled with Tailwind CSS

### IPC Communication
All communication between renderer and main uses typed IPC channels:

```typescript
// Renderer calls:
const rooms = await window.electronAPI.getRooms();
const result = await window.electronAPI.runSync();

// Main handles via ipcMain.handle()
```

## Database Schema

### Core Tables
- `rooms` - Classes, companies, cantons, CIE locations
- `persons` - Students, teachers, mentors, advisors, guardians
- `person_room_assignments` - Many-to-many relationships
- `change_log` - Track local modifications for n8n sync
- `settings` - App configuration (API key, environment, etc.)
- `tag_mappings` - Hazu tag → semantic type mappings

### Room Types (identified by tags)
| Tag | Type |
|-----|------|
| `hz-config-room-state` | Canton/State |
| `hz-config-room-class` | School class |
| `hz-config-room-entreprise` | Training company |
| `hz-config-room-cie` | CIE location |

### Person Types (identified by tag prefixes)
| Tag Prefix | Type |
|------------|------|
| `hz-share-student-*` | Student |
| `hz-share-companymentor-*` | Company mentor |
| `hz-share-schoolteacher-*` | School teacher |
| `hz-share-courseteacher-*` | Course teacher |
| `hz-share-stateadvisor-*` | State advisor |
| `hz-share-guardian-*` | Parent/Guardian |

## Key Files to Know

### When modifying IPC communication:
1. `src/shared/ipc-channels.ts` - Add channel constant
2. `src/main/ipc/index.ts` - Add handler
3. `src/main/preload.ts` - Expose to renderer + update types

### When adding new pages:
1. Create `src/renderer/pages/NewPage.tsx`
2. Add route in `src/renderer/App.tsx`
3. Add nav item in `src/renderer/components/layout/Sidebar.tsx`

### When modifying database:
1. Update `src/main/database/schema.sql`
2. Update `src/shared/types.ts` interfaces
3. Add IPC handlers in `src/main/ipc/index.ts`

## Hazu API

The app integrates with the Hazu platform API. Key functions in `src/main/services/hazu-api/api.ts`:

```typescript
sendApiRequestRead(id)           // Read single entity
sendApiRequestList(parentId)     // List children
sendApiRequestCreate(options)    // Create entity
sendApiRequestUpdate(id, options)// Update entity
sendApiRequestGetAclInfo(id)     // Get access control list
sendApiRequestAddGroup(id, group)// Add group access
```

### API Configuration
Stored in SQLite settings table:
- `api_key` - Hazu API key
- `environment` - "swiss" | "io" | "dev"
- `root_hazu_id` - Root Hazu ID to sync from

## Common Tasks

### Adding a new database query
```typescript
// 1. In src/main/ipc/index.ts
ipcMain.handle('myChannel', async (_event, param) => {
  return query('SELECT * FROM table WHERE col = ?', [param]);
});

// 2. In src/shared/ipc-channels.ts
MY_CHANNEL: 'myChannel',

// 3. In src/main/preload.ts
myMethod: (param: string) => ipcRenderer.invoke(IPC_CHANNELS.MY_CHANNEL, param),
// Also add to Window interface
```

### Adding a new React component
```tsx
// Use Tailwind for styling
function MyComponent({ title }: { title: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}
```

## Build Notes

### Native Modules
`better-sqlite3` requires native compilation for Electron. After `npm install`:
```bash
npx @electron/rebuild
```

### TypeScript Configs
- `tsconfig.json` - Renderer (React/Vite)
- `tsconfig.main.json` - Main process (Node.js/CommonJS)

### Tailwind CSS v4
Uses new import syntax:
```css
@import "tailwindcss";
```
With `@tailwindcss/postcss` plugin (not direct tailwindcss).

## Testing the App

1. Run `npm run build`
2. Run `npm start`
3. Go to Settings → Enter API key and Root Hazu ID
4. Click "Sync Now" on Dashboard
5. View synced data in Rooms/Persons pages

## Future Development

### Phase 2: Full UI
- Room detail pages with assigned persons
- Person detail pages with room assignments
- Search and filtering
- Bulk assignment interface

### Phase 3: Change Tracking
- Local modifications logged to `change_log`
- Review pending changes before sync
- n8n webhook integration for pushing changes

### Phase 4: Excel Import
- Import persons from Excel templates
- Import bulk assignments
- Validation preview before processing
