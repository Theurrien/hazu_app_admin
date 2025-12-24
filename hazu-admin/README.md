# Hazu Admin

A cross-platform desktop application for managing the Hazu educational platform. Built with Electron, React, and SQLite for offline-first data management.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
![Electron](https://img.shields.io/badge/electron-39+-blue)
![React](https://img.shields.io/badge/react-19-61dafb)
![TypeScript](https://img.shields.io/badge/typescript-5.9-3178c6)

## Features

- **Offline-First**: All data synced locally to SQLite for fast, offline access
- **Cross-Platform**: Single codebase for macOS and Windows
- **Room Management**: View and manage classes, companies, cantons, and CIE locations
- **Person Management**: Manage students, teachers, mentors, advisors, and guardians
- **Assignment Matrix**: View all person-room assignments in a matrix view
- **Bulk Import**: Import rooms and persons from Excel files with column mapping
- **Task Queue**: Background processing for bulk operations with progress tracking
- **Hazu Design System**: UI aligned with the Hazu platform using Font Awesome icons
- **Sync from Hazu**: Pull latest data from the Hazu platform API

## Installation

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
# Clone the repository
git clone https://github.com/Theurrien/hazu_app_admin.git
cd hazu-admin

# Install dependencies
npm install

# Rebuild native modules for Electron
npx @electron/rebuild

# Build the application
npm run build

# Start the application
npm start
```

## Development

```bash
# Run in development mode (hot reload)
npm run dev

# Build for production
npm run build

# Package for distribution
npm run dist
```

## Configuration

On first launch, configure the app in **Settings**:

1. **API Key**: Your Hazu platform API key
2. **Environment**: Select swiss (production), io, or dev
3. **Root Hazu ID**: The ID of the root Hazu to sync from

## Usage

### Syncing Data

1. Configure your API settings in the Settings page
2. Go to Dashboard and click "Sync Now"
3. View synced rooms and persons in their respective pages

### Bulk Import

1. Go to **Bulk Import** page
2. Select workflow: **Create Rooms** or **Create Persons**
3. Upload an Excel file
4. Map columns to fields (Room Name, First Name, Last Name, Email, etc.)
5. Configure options (room category, person role, template)
6. Review and execute - tasks run in background via Task Queue

### Assignment Matrix

- View all assignments in a grid format
- Filter by room type or person type
- Quick overview of who is assigned where

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Electron 39 |
| Frontend | React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| Icons | Font Awesome 6 |
| State | Zustand |
| Database | better-sqlite3 |
| Bundler | Vite 7 |
| Packaging | electron-builder |

## Project Structure

```
hazu-admin/
├── src/
│   ├── main/              # Electron main process
│   │   ├── database/      # SQLite setup & schema
│   │   ├── ipc/           # IPC handlers
│   │   └── services/      # Hazu API & sync
│   ├── renderer/          # React frontend
│   │   ├── pages/         # App pages
│   │   ├── components/    # UI components
│   │   └── contexts/      # React contexts (TaskQueue)
│   └── shared/            # Shared types & constants
├── docs/
│   └── plans/             # Design documents
├── dist/                  # Build output
└── release/               # Packaged apps
```

## Entity Types

### Rooms
- **State**: Cantons/geographic regions
- **Class**: School classes
- **Enterprise**: Training companies
- **CIE**: Inter-company course locations

### Persons
- **Student**: Apprentices/students
- **School Teacher**: School-based instructors
- **Course Teacher**: Course instructors
- **Company Mentor**: Workplace supervisors
- **State Advisor**: Government advisors
- **Guardian**: Parents/legal guardians

## Database

Data is stored in SQLite at:
- **macOS**: `~/Library/Application Support/hazu-admin/hazu-admin.db`
- **Windows**: `%APPDATA%/hazu-admin/hazu-admin.db`

## Roadmap

- [x] Phase 1: Foundation (Electron + React + SQLite + API sync)
- [x] Phase 2: Room & Person pages with assignments view
- [x] Phase 3: Assignment Matrix view
- [x] Phase 4: Bulk Import (Rooms & Persons from Excel)
- [ ] Phase 5: Bulk Assignment import
- [ ] Phase 6: n8n webhook integration for change sync

## License

MIT License

## Acknowledgments

- Built for the [Hazu](https://hazu.ch) educational platform
- UI design aligned with Hazu platform design language
