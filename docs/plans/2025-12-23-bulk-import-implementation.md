# Bulk Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Bulk Import page for uploading Excel/CSV files and batch-creating rooms with column mapping and template selection.

**Architecture:** New page in sidebar with file upload, data preview table, column mapping via clickable headers, unique values as tabs with per-item template configuration, and an evolving results list during batch creation. Reuses existing `createRoom` webhook.

**Tech Stack:** React, Tailwind CSS, `xlsx` npm package for file parsing, existing IPC patterns.

---

### Task 1: Install xlsx dependency

**Files:**
- Modify: `package.json`

**Step 1: Install xlsx package**

Run:
```bash
cd /Users/urs/Desktop/1\ -\ AI\ Stuff/25\ -\ App\ Admin\ Hazu/hazu-admin && npm install xlsx
```

Expected: Package installed successfully

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add xlsx dependency for bulk import file parsing"
```

---

### Task 2: Add PARSE_FILE IPC channel and handler

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/main/ipc/index.ts`

**Step 1: Add IPC channel constant**

In `src/shared/ipc-channels.ts`, add to the `IPC_CHANNELS` object:
```typescript
FILE_PARSE: 'file:parse',
```

**Step 2: Add preload bridge method**

In `src/main/preload.ts`, add to the inline `IPC_CHANNELS`:
```typescript
FILE_PARSE: 'file:parse',
```

Add to `contextBridge.exposeInMainWorld('electronAPI', {`:
```typescript
// File parsing
parseFile: (filePath: string, hasHeaders: boolean) =>
  ipcRenderer.invoke(IPC_CHANNELS.FILE_PARSE, filePath, hasHeaders),
```

Add to `Window` interface:
```typescript
parseFile: (filePath: string, hasHeaders: boolean) => Promise<{
  success: boolean;
  data?: { headers: string[]; rows: Record<string, string>[] };
  error?: string;
}>;
```

**Step 3: Add IPC handler**

In `src/main/ipc/index.ts`, add import at top:
```typescript
import * as XLSX from 'xlsx';
```

Add handler after FILE PARSING comment section:
```typescript
// ============================================================================
// FILE PARSING
// ============================================================================

ipcMain.handle(IPC_CHANNELS.FILE_PARSE, async (_event, filePath: string, hasHeaders: boolean) => {
  try {
    console.log('[FILE_PARSE] Parsing file:', filePath, 'hasHeaders:', hasHeaders);

    // Read file
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const rawData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
      header: hasHeaders ? undefined : 1, // Use column indices if no headers
      defval: '', // Default empty cells to empty string
    });

    if (rawData.length === 0) {
      return { success: false, error: 'File is empty or contains no data' };
    }

    // Extract headers
    let headers: string[];
    let rows: Record<string, string>[];

    if (hasHeaders) {
      // Headers come from first row (already handled by xlsx)
      headers = Object.keys(rawData[0]);
      rows = rawData.map(row => {
        const normalized: Record<string, string> = {};
        for (const key of headers) {
          normalized[key] = String(row[key] ?? '');
        }
        return normalized;
      });
    } else {
      // Generate column labels A, B, C, ...
      const firstRow = rawData[0];
      const numCols = Object.keys(firstRow).length;
      headers = Array.from({ length: numCols }, (_, i) => {
        const letter = String.fromCharCode(65 + (i % 26));
        const prefix = i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '';
        return `Column ${prefix}${letter}`;
      });

      rows = rawData.map(row => {
        const normalized: Record<string, string> = {};
        const values = Object.values(row);
        headers.forEach((header, i) => {
          normalized[header] = String(values[i] ?? '');
        });
        return normalized;
      });
    }

    console.log('[FILE_PARSE] Parsed', rows.length, 'rows with', headers.length, 'columns');
    return { success: true, data: { headers, rows } };
  } catch (error) {
    console.error('File parse error:', error);
    const message = error instanceof Error ? error.message : 'Failed to parse file';
    return { success: false, error: message };
  }
});
```

**Step 4: Add channel to shared ipc-channels.ts**

In `src/shared/ipc-channels.ts`, ensure the constant is exported:
```typescript
FILE_PARSE: 'file:parse',
```

**Step 5: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/preload.ts src/main/ipc/index.ts
git commit -m "feat: add FILE_PARSE IPC handler for Excel/CSV parsing"
```

---

### Task 3: Add 'import' to Page type and navigation

**Files:**
- Modify: `src/renderer/components/layout/Sidebar.tsx`
- Modify: `src/renderer/App.tsx`

**Step 1: Update Sidebar**

In `src/renderer/components/layout/Sidebar.tsx`:

Update the `Page` type:
```typescript
type Page = 'dashboard' | 'rooms' | 'persons' | 'matrix' | 'import' | 'sync' | 'settings';
```

Add to `navItems` array (after 'matrix', before 'sync'):
```typescript
{ id: 'import', label: 'Bulk Import', icon: '📥' },
```

**Step 2: Update App.tsx**

In `src/renderer/App.tsx`:

Add import:
```typescript
import BulkImportPage from './pages/BulkImportPage';
```

Update Page type:
```typescript
type Page = 'dashboard' | 'rooms' | 'persons' | 'matrix' | 'import' | 'sync' | 'settings';
```

Add case in `renderPage`:
```typescript
case 'import':
  return <BulkImportPage />;
```

**Step 3: Create placeholder page**

Create `src/renderer/pages/BulkImportPage.tsx`:
```typescript
import React from 'react';

function BulkImportPage() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-gray-500">Bulk Import Page - Coming Soon</div>
    </div>
  );
}

export default BulkImportPage;
```

**Step 4: Commit**

```bash
git add src/renderer/components/layout/Sidebar.tsx src/renderer/App.tsx src/renderer/pages/BulkImportPage.tsx
git commit -m "feat: add Bulk Import page to navigation"
```

---

### Task 4: Create FileUploader component

**Files:**
- Create: `src/renderer/components/bulk-import/FileUploader.tsx`

**Step 1: Create FileUploader component**

Create `src/renderer/components/bulk-import/FileUploader.tsx`:
```typescript
import React, { useCallback, useState } from 'react';

interface FileUploaderProps {
  onFileLoaded: (data: { headers: string[]; rows: Record<string, string>[]; fileName: string }) => void;
  hasHeaders: boolean;
  onHasHeadersChange: (value: boolean) => void;
  isLoading: boolean;
  setIsLoading: (value: boolean) => void;
}

export function FileUploader({
  onFileLoaded,
  hasHeaders,
  onHasHeadersChange,
  isLoading,
  setIsLoading,
}: FileUploaderProps) {
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setIsLoading(true);

    // Validate file type
    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!validExtensions.includes(extension)) {
      setError('Unsupported file format. Please upload .xlsx, .xls, or .csv files.');
      setIsLoading(false);
      return;
    }

    try {
      // Get file path - in Electron we can access the path property
      const filePath = (file as any).path;
      if (!filePath) {
        setError('Could not access file path. Please try again.');
        setIsLoading(false);
        return;
      }

      const result = await window.electronAPI.parseFile(filePath, hasHeaders);

      if (result.success && result.data) {
        onFileLoaded({
          headers: result.data.headers,
          rows: result.data.rows,
          fileName: file.name,
        });
      } else {
        setError(result.error || 'Failed to parse file');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setIsLoading(false);
    }
  }, [hasHeaders, onFileLoaded, setIsLoading]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  return (
    <div className="space-y-3">
      {/* Headers checkbox */}
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={hasHeaders}
          onChange={(e) => onHasHeadersChange(e.target.checked)}
          className="w-4 h-4 text-blue-600 rounded"
          disabled={isLoading}
        />
        First row contains column headers
      </label>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          border-2 border-dashed rounded-lg p-6 text-center transition-colors
          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
          ${isLoading ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 text-gray-600">
            <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
            <span>Parsing file...</span>
          </div>
        ) : (
          <>
            <div className="text-gray-600 mb-2">
              Drag and drop an Excel or CSV file here, or
            </div>
            <label className="inline-block">
              <span className="px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors">
                Browse Files
              </span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleInputChange}
                className="hidden"
              />
            </label>
            <div className="text-xs text-gray-400 mt-2">
              Supported: .xlsx, .xls, .csv
            </div>
          </>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
mkdir -p src/renderer/components/bulk-import
git add src/renderer/components/bulk-import/FileUploader.tsx
git commit -m "feat: add FileUploader component with drag-drop support"
```

---

### Task 5: Create DataPreviewTable component

**Files:**
- Create: `src/renderer/components/bulk-import/DataPreviewTable.tsx`

**Step 1: Create DataPreviewTable component**

Create `src/renderer/components/bulk-import/DataPreviewTable.tsx`:
```typescript
import React from 'react';

interface DataPreviewTableProps {
  headers: string[];
  rows: Record<string, string>[];
  mappedColumn: string | null;
  onColumnClick: (header: string) => void;
  maxRows?: number;
}

export function DataPreviewTable({
  headers,
  rows,
  mappedColumn,
  onColumnClick,
  maxRows = 100,
}: DataPreviewTableProps) {
  const displayRows = rows.slice(0, maxRows);
  const hasMore = rows.length > maxRows;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Info bar */}
      <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 border-b border-gray-200 flex justify-between">
        <span>
          {hasMore
            ? `Showing ${maxRows} of ${rows.length} rows`
            : `${rows.length} rows`}
        </span>
        <span>Click a column header to select the Name column</span>
      </div>

      {/* Table container with scroll */}
      <div className="overflow-auto max-h-64">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 sticky top-0">
            <tr>
              {headers.map((header) => (
                <th
                  key={header}
                  onClick={() => onColumnClick(header)}
                  className={`
                    px-3 py-2 text-left font-medium cursor-pointer transition-colors
                    ${mappedColumn === header
                      ? 'bg-blue-100 text-blue-800'
                      : 'text-gray-700 hover:bg-gray-200'}
                  `}
                >
                  <div className="flex items-center gap-2">
                    {mappedColumn === header && (
                      <span className="inline-flex items-center justify-center w-5 h-5 text-xs bg-blue-600 text-white rounded-full">
                        1
                      </span>
                    )}
                    <span className="truncate max-w-32">{header}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {displayRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-gray-50">
                {headers.map((header) => (
                  <td
                    key={header}
                    className={`
                      px-3 py-2 truncate max-w-48
                      ${mappedColumn === header ? 'bg-blue-50' : ''}
                    `}
                  >
                    {row[header]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/bulk-import/DataPreviewTable.tsx
git commit -m "feat: add DataPreviewTable component with column mapping"
```

---

### Task 6: Create RoomTypeSelector component

**Files:**
- Create: `src/renderer/components/bulk-import/RoomTypeSelector.tsx`

**Step 1: Create RoomTypeSelector component**

Create `src/renderer/components/bulk-import/RoomTypeSelector.tsx`:
```typescript
import React from 'react';
import type { RoomType } from '../../../shared/types';

interface RoomTypeSelectorProps {
  selectedType: RoomType | null;
  onTypeChange: (type: RoomType) => void;
  disabled?: boolean;
}

const roomTypes: { value: RoomType; label: string }[] = [
  { value: 'class', label: 'Class' },
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'state', label: 'State' },
  { value: 'cie', label: 'CIE' },
];

export function RoomTypeSelector({
  selectedType,
  onTypeChange,
  disabled = false,
}: RoomTypeSelectorProps) {
  return (
    <div className="flex flex-wrap gap-4">
      {roomTypes.map((type) => (
        <label
          key={type.value}
          className={`
            flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer transition-colors
            ${selectedType === type.value
              ? 'border-blue-500 bg-blue-50 text-blue-800'
              : 'border-gray-300 hover:border-gray-400'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <input
            type="radio"
            name="roomType"
            value={type.value}
            checked={selectedType === type.value}
            onChange={() => onTypeChange(type.value)}
            disabled={disabled}
            className="w-4 h-4 text-blue-600"
          />
          <span className="text-sm font-medium">{type.label}</span>
        </label>
      ))}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/bulk-import/RoomTypeSelector.tsx
git commit -m "feat: add RoomTypeSelector component"
```

---

### Task 7: Create VariableTabs component

**Files:**
- Create: `src/renderer/components/bulk-import/VariableTabs.tsx`

**Step 1: Create VariableTabs component**

Create `src/renderer/components/bulk-import/VariableTabs.tsx`:
```typescript
import React from 'react';

interface RoomConfig {
  newName: string;
  templateId: string | null;
}

interface VariableTabsProps {
  uniqueValues: string[];
  roomConfigs: Map<string, RoomConfig>;
  selectedValue: string | null;
  onSelectValue: (value: string) => void;
}

export function VariableTabs({
  uniqueValues,
  roomConfigs,
  selectedValue,
  onSelectValue,
}: VariableTabsProps) {
  if (uniqueValues.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {uniqueValues.map((value) => {
        const config = roomConfigs.get(value);
        const hasTemplate = !!config?.templateId;
        const isSelected = selectedValue === value;

        return (
          <button
            key={value}
            onClick={() => onSelectValue(value)}
            className={`
              flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors
              ${isSelected
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}
            `}
          >
            {hasTemplate && (
              <svg
                className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-green-600'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
            <span className="truncate max-w-32">{value}</span>
          </button>
        );
      })}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/bulk-import/VariableTabs.tsx
git commit -m "feat: add VariableTabs component with checkmark indicators"
```

---

### Task 8: Create RoomConfigurator component

**Files:**
- Create: `src/renderer/components/bulk-import/RoomConfigurator.tsx`

**Step 1: Create RoomConfigurator component**

Create `src/renderer/components/bulk-import/RoomConfigurator.tsx`:
```typescript
import React from 'react';

interface Template {
  id: string;
  title: string;
  roomType: string;
}

interface RoomConfig {
  newName: string;
  templateId: string | null;
}

interface RoomConfiguratorProps {
  originalName: string;
  config: RoomConfig;
  templates: Template[];
  onConfigChange: (config: RoomConfig) => void;
  isLoadingTemplates: boolean;
}

export function RoomConfigurator({
  originalName,
  config,
  templates,
  onConfigChange,
  isLoadingTemplates,
}: RoomConfiguratorProps) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4">
      {/* Original name display */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Original Name (from file)
        </label>
        <div className="text-sm font-medium text-gray-900">{originalName}</div>
      </div>

      {/* New name input */}
      <div>
        <label htmlFor="newName" className="block text-xs font-medium text-gray-500 mb-1">
          Room Name (can be customized)
        </label>
        <input
          id="newName"
          type="text"
          value={config.newName}
          onChange={(e) => onConfigChange({ ...config, newName: e.target.value })}
          placeholder={originalName}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Template selection */}
      <div>
        <label htmlFor="template" className="block text-xs font-medium text-gray-500 mb-1">
          Template
        </label>
        {isLoadingTemplates ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
            Loading templates...
          </div>
        ) : templates.length === 0 ? (
          <div className="text-sm text-gray-500">
            No templates available. Select a room type first.
          </div>
        ) : (
          <select
            id="template"
            value={config.templateId || ''}
            onChange={(e) => onConfigChange({ ...config, templateId: e.target.value || null })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select template...</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Status indicator */}
      {config.templateId && (
        <div className="flex items-center gap-2 text-sm text-green-700">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Ready to create
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/bulk-import/RoomConfigurator.tsx
git commit -m "feat: add RoomConfigurator component"
```

---

### Task 9: Create BulkImportProgress component

**Files:**
- Create: `src/renderer/components/bulk-import/BulkImportProgress.tsx`

**Step 1: Create BulkImportProgress component**

Create `src/renderer/components/bulk-import/BulkImportProgress.tsx`:
```typescript
import React from 'react';

export interface ImportResult {
  name: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  roomId?: string;
  error?: string;
}

interface BulkImportProgressProps {
  results: ImportResult[];
  onOpenRoom: (roomId: string) => void;
  onRetry: (name: string) => void;
}

export function BulkImportProgress({
  results,
  onOpenRoom,
  onRetry,
}: BulkImportProgressProps) {
  if (results.length === 0) {
    return null;
  }

  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;
  const pendingCount = results.filter(r => r.status === 'pending' || r.status === 'processing').length;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Summary header */}
      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Import Progress</span>
        <div className="flex items-center gap-3 text-xs">
          {successCount > 0 && (
            <span className="text-green-600">{successCount} created</span>
          )}
          {errorCount > 0 && (
            <span className="text-red-600">{errorCount} failed</span>
          )}
          {pendingCount > 0 && (
            <span className="text-gray-500">{pendingCount} pending</span>
          )}
        </div>
      </div>

      {/* Results list */}
      <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
        {results.map((result, index) => (
          <div
            key={`${result.name}-${index}`}
            className="px-4 py-3 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 min-w-0">
              {/* Status icon */}
              {result.status === 'pending' && (
                <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
              )}
              {result.status === 'processing' && (
                <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
              )}
              {result.status === 'success' && (
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {result.status === 'error' && (
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}

              {/* Name and status text */}
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {result.name}
                </div>
                {result.status === 'processing' && (
                  <div className="text-xs text-gray-500">Creating...</div>
                )}
                {result.status === 'success' && (
                  <div className="text-xs text-green-600">Created successfully</div>
                )}
                {result.status === 'error' && (
                  <div className="text-xs text-red-600 truncate">{result.error}</div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {result.status === 'success' && result.roomId && (
                <button
                  onClick={() => onOpenRoom(result.roomId!)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  Open
                </button>
              )}
              {result.status === 'error' && (
                <button
                  onClick={() => onRetry(result.name)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/bulk-import/BulkImportProgress.tsx
git commit -m "feat: add BulkImportProgress component with evolving results list"
```

---

### Task 10: Implement BulkImportPage with full integration

**Files:**
- Modify: `src/renderer/pages/BulkImportPage.tsx`

**Step 1: Implement full BulkImportPage**

Replace `src/renderer/pages/BulkImportPage.tsx` with:
```typescript
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { RoomType } from '../../shared/types';
import { FileUploader } from '../components/bulk-import/FileUploader';
import { DataPreviewTable } from '../components/bulk-import/DataPreviewTable';
import { RoomTypeSelector } from '../components/bulk-import/RoomTypeSelector';
import { VariableTabs } from '../components/bulk-import/VariableTabs';
import { RoomConfigurator } from '../components/bulk-import/RoomConfigurator';
import { BulkImportProgress, ImportResult } from '../components/bulk-import/BulkImportProgress';

interface Template {
  id: string;
  title: string;
  roomType: string;
}

interface RoomConfig {
  newName: string;
  templateId: string | null;
}

interface FileData {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
}

type Workflow = 'room' | 'person' | 'assignment';

function BulkImportPage() {
  // Workflow state
  const [activeWorkflow] = useState<Workflow>('room');

  // File state
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [hasHeaders, setHasHeaders] = useState(true);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  // Room configuration state
  const [roomType, setRoomType] = useState<RoomType | null>(null);
  const [mappedColumn, setMappedColumn] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [roomConfigs, setRoomConfigs] = useState<Map<string, RoomConfig>>(new Map());

  // Templates state
  const [allTemplates, setAllTemplates] = useState<Template[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);

  // Rooms for target lookup
  const [rooms, setRooms] = useState<Array<{ id: string; room_type: string; parent_id: string | null }>>([]);
  const [rootHazuId, setRootHazuId] = useState<string | null>(null);

  // Load rooms and root ID on mount
  useEffect(() => {
    const loadData = async () => {
      const [roomsData, config] = await Promise.all([
        window.electronAPI.getRooms(),
        window.electronAPI.getApiConfig(),
      ]);
      setRooms(roomsData);
      setRootHazuId(config.rootHazuId);
    };
    loadData();
  }, []);

  // Fetch templates when room type changes
  useEffect(() => {
    if (!roomType) {
      setAllTemplates([]);
      return;
    }

    const fetchTemplates = async () => {
      setIsLoadingTemplates(true);
      try {
        const result = await window.electronAPI.fetchTemplates();
        if (result.success && result.templates) {
          setAllTemplates(result.templates);
        }
      } catch (error) {
        console.error('Failed to fetch templates:', error);
      } finally {
        setIsLoadingTemplates(false);
      }
    };

    fetchTemplates();
  }, [roomType]);

  // Filter templates by selected room type
  const filteredTemplates = useMemo(() => {
    if (!roomType) return [];
    return allTemplates.filter(t => t.roomType === roomType);
  }, [allTemplates, roomType]);

  // Extract unique values when column is mapped
  const uniqueValues = useMemo(() => {
    if (!fileData || !mappedColumn) return [];
    const values = new Set<string>();
    for (const row of fileData.rows) {
      const value = row[mappedColumn]?.trim();
      if (value) {
        values.add(value);
      }
    }
    return Array.from(values).sort();
  }, [fileData, mappedColumn]);

  // Initialize room configs when unique values change
  useEffect(() => {
    const newConfigs = new Map<string, RoomConfig>();
    for (const value of uniqueValues) {
      const existing = roomConfigs.get(value);
      newConfigs.set(value, existing || { newName: value, templateId: null });
    }
    setRoomConfigs(newConfigs);

    // Select first value if none selected
    if (uniqueValues.length > 0 && !selectedValue) {
      setSelectedValue(uniqueValues[0]);
    }
  }, [uniqueValues]);

  // Handle file loaded
  const handleFileLoaded = useCallback((data: FileData) => {
    setFileData(data);
    setMappedColumn(null);
    setSelectedValue(null);
    setRoomConfigs(new Map());
    setResults([]);
  }, []);

  // Handle column click
  const handleColumnClick = useCallback((header: string) => {
    setMappedColumn(header);
    setSelectedValue(null);
  }, []);

  // Handle config change for selected value
  const handleConfigChange = useCallback((config: RoomConfig) => {
    if (!selectedValue) return;
    setRoomConfigs(prev => {
      const newMap = new Map(prev);
      newMap.set(selectedValue, config);
      return newMap;
    });
  }, [selectedValue]);

  // Find target ID for room type
  const findTargetId = useCallback((type: RoomType): string | null => {
    const targetRoom = rooms.find(
      room => room.room_type === type && room.parent_id === rootHazuId
    );
    return targetRoom?.id || null;
  }, [rooms, rootHazuId]);

  // Count rooms ready to create
  const readyCount = useMemo(() => {
    let count = 0;
    roomConfigs.forEach(config => {
      if (config.templateId) count++;
    });
    return count;
  }, [roomConfigs]);

  // Handle room creation
  const handleCreateRooms = useCallback(async () => {
    if (!roomType) return;

    const targetId = findTargetId(roomType);
    if (!targetId) {
      alert(`No parent location found for type: ${roomType}`);
      return;
    }

    // Get rooms to create (those with templates)
    const roomsToCreate: Array<{ name: string; templateId: string; newName: string }> = [];
    roomConfigs.forEach((config, name) => {
      if (config.templateId) {
        roomsToCreate.push({
          name,
          templateId: config.templateId,
          newName: config.newName || name,
        });
      }
    });

    if (roomsToCreate.length === 0) return;

    setIsProcessing(true);

    // Initialize results
    setResults(roomsToCreate.map(room => ({
      name: room.newName,
      status: 'pending' as const,
    })));

    // Process each room sequentially
    for (let i = 0; i < roomsToCreate.length; i++) {
      const room = roomsToCreate[i];

      // Update to processing
      setResults(prev => prev.map((r, idx) =>
        idx === i ? { ...r, status: 'processing' as const } : r
      ));

      try {
        const result = await window.electronAPI.createRoom(
          room.templateId,
          targetId,
          room.newName
        );

        if (result.success && result.room) {
          setResults(prev => prev.map((r, idx) =>
            idx === i ? { ...r, status: 'success' as const, roomId: result.room.id } : r
          ));
        } else {
          setResults(prev => prev.map((r, idx) =>
            idx === i ? { ...r, status: 'error' as const, error: result.error || 'Unknown error' } : r
          ));
        }
      } catch (error) {
        setResults(prev => prev.map((r, idx) =>
          idx === i ? { ...r, status: 'error' as const, error: error instanceof Error ? error.message : 'Unknown error' } : r
        ));
      }
    }

    setIsProcessing(false);
  }, [roomType, roomConfigs, findTargetId]);

  // Handle open room
  const handleOpenRoom = useCallback(async (roomId: string) => {
    const config = await window.electronAPI.getApiConfig();
    const env = config.environment || 'swiss';
    const baseUrl = env === 'swiss' ? 'https://hazu.swiss' : env === 'io' ? 'https://hazu.io' : 'https://dev.hazu.swiss';
    const url = `${baseUrl}/#/hazu/${roomId}`;
    window.electronAPI.openExternal(url);
  }, []);

  // Handle retry
  const handleRetry = useCallback(async (name: string) => {
    // Find the original config
    const config = roomConfigs.get(name);
    if (!config?.templateId || !roomType) return;

    const targetId = findTargetId(roomType);
    if (!targetId) return;

    // Update to processing
    setResults(prev => prev.map(r =>
      r.name === name ? { ...r, status: 'processing' as const, error: undefined } : r
    ));

    try {
      const result = await window.electronAPI.createRoom(
        config.templateId,
        targetId,
        config.newName || name
      );

      if (result.success && result.room) {
        setResults(prev => prev.map(r =>
          r.name === name ? { ...r, status: 'success' as const, roomId: result.room.id } : r
        ));
      } else {
        setResults(prev => prev.map(r =>
          r.name === name ? { ...r, status: 'error' as const, error: result.error || 'Unknown error' } : r
        ));
      }
    } catch (error) {
      setResults(prev => prev.map(r =>
        r.name === name ? { ...r, status: 'error' as const, error: error instanceof Error ? error.message : 'Unknown error' } : r
      ));
    }
  }, [roomConfigs, roomType, findTargetId]);

  // Handle start over
  const handleStartOver = useCallback(() => {
    setFileData(null);
    setMappedColumn(null);
    setSelectedValue(null);
    setRoomConfigs(new Map());
    setResults([]);
    setRoomType(null);
  }, []);

  const selectedConfig = selectedValue ? roomConfigs.get(selectedValue) : null;

  return (
    <div className="h-full flex flex-col bg-white rounded-lg shadow overflow-hidden">
      {/* Header with workflow tabs */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeWorkflow === 'room'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-500 cursor-not-allowed'
            }`}
          >
            Room Creation
          </button>
          <button
            disabled
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-400 cursor-not-allowed"
          >
            Person
          </button>
          <button
            disabled
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-400 cursor-not-allowed"
          >
            Assignment
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Room type selector */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">Room Type</h3>
          <RoomTypeSelector
            selectedType={roomType}
            onTypeChange={setRoomType}
            disabled={isProcessing}
          />
        </div>

        {/* Variable configuration section - only show when column is mapped */}
        {uniqueValues.length > 0 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">
                Rooms to Create ({readyCount} of {uniqueValues.length} configured)
              </h3>
              <VariableTabs
                uniqueValues={uniqueValues}
                roomConfigs={roomConfigs}
                selectedValue={selectedValue}
                onSelectValue={setSelectedValue}
              />
            </div>

            {selectedValue && selectedConfig && (
              <RoomConfigurator
                originalName={selectedValue}
                config={selectedConfig}
                templates={filteredTemplates}
                onConfigChange={handleConfigChange}
                isLoadingTemplates={isLoadingTemplates}
              />
            )}
          </div>
        )}

        {/* File upload section */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            {fileData ? `File: ${fileData.fileName}` : 'Upload File'}
          </h3>
          {!fileData ? (
            <FileUploader
              onFileLoaded={handleFileLoaded}
              hasHeaders={hasHeaders}
              onHasHeadersChange={setHasHeaders}
              isLoading={isLoadingFile}
              setIsLoading={setIsLoadingFile}
            />
          ) : (
            <div className="space-y-3">
              <DataPreviewTable
                headers={fileData.headers}
                rows={fileData.rows}
                mappedColumn={mappedColumn}
                onColumnClick={handleColumnClick}
              />
              <button
                onClick={handleStartOver}
                className="text-sm text-gray-600 hover:text-gray-800"
                disabled={isProcessing}
              >
                Upload different file
              </button>
            </div>
          )}
        </div>

        {/* Results section */}
        {results.length > 0 && (
          <BulkImportProgress
            results={results}
            onOpenRoom={handleOpenRoom}
            onRetry={handleRetry}
          />
        )}
      </div>

      {/* Footer with action button */}
      <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {readyCount > 0
            ? `${readyCount} room${readyCount !== 1 ? 's' : ''} ready to create`
            : 'Select templates for rooms to create'}
        </div>
        <div className="flex items-center gap-3">
          {results.length > 0 && !isProcessing && (
            <button
              onClick={handleStartOver}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Start Over
            </button>
          )}
          <button
            onClick={handleCreateRooms}
            disabled={readyCount === 0 || isProcessing || !roomType}
            className={`px-6 py-2 rounded-lg transition-colors flex items-center gap-2 ${
              readyCount > 0 && !isProcessing && roomType
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isProcessing && (
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
            )}
            Create {readyCount} Room{readyCount !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BulkImportPage;
```

**Step 2: Commit**

```bash
git add src/renderer/pages/BulkImportPage.tsx
git commit -m "feat: implement complete BulkImportPage with all integrations"
```

---

### Task 11: Test the bulk import feature

**Step 1: Build the application**

Run:
```bash
cd /Users/urs/Desktop/1\ -\ AI\ Stuff/25\ -\ App\ Admin\ Hazu/hazu-admin && npm run build
```

Expected: Build completes without errors

**Step 2: Start the application**

Run:
```bash
npm start
```

**Step 3: Test the flow**

1. Navigate to "Bulk Import" in sidebar
2. Select a room type (e.g., Class)
3. Upload an Excel or CSV file
4. Click a column header to map the Name column
5. Configure templates for unique values
6. Click "Create X Rooms" button
7. Verify rooms are created with evolving progress list

**Step 4: Commit any fixes if needed**

---

### Task 12: Final commit and push

**Step 1: Verify all changes**

Run:
```bash
git status
git log --oneline -15
```

**Step 2: Push to remote**

Run:
```bash
git push
```
