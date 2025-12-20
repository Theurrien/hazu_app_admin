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
- **Assignment Tracking**: Track person-to-room assignments
- **Change Logging**: Local changes tracked for future n8n integration
- **Sync from Hazu**: Pull latest data from the Hazu platform

## Screenshots

*Coming soon*

## Installation

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
# Clone the repository
git clone https://github.com/your-org/hazu-admin.git
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
2. Go to Dashboard
3. Click "Sync Now" to pull data from Hazu
4. View synced rooms and persons in their respective pages

### Managing Assignments

- View room assignments from the Rooms page
- View person assignments from the Persons page
- Create/remove assignments (changes tracked locally)

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Electron 39 |
| Frontend | React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| State | Zustand |
| Database | better-sqlite3 |
| Bundler | Vite 7 |
| Packaging | electron-builder |

## Project Structure

```
hazu-admin/
├── src/
│   ├── main/           # Electron main process
│   │   ├── database/   # SQLite setup & schema
│   │   ├── ipc/        # IPC handlers
│   │   └── services/   # Hazu API & sync
│   ├── renderer/       # React frontend
│   │   ├── pages/      # App pages
│   │   └── components/ # UI components
│   └── shared/         # Shared types & constants
├── dist/               # Build output
└── release/            # Packaged apps
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

- [x] Phase 1: Foundation (Electron + React + SQLite + API)
- [ ] Phase 2: Full UI (detail pages, search, filtering)
- [ ] Phase 3: Assignment management with change tracking
- [ ] Phase 4: n8n webhook integration
- [ ] Phase 5: Excel import/export

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built for the [Hazu](https://hazu.ch) educational platform
- Hazu API starter kit for API integration patterns
