import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { autoUpdater } from 'electron-updater';
import { initDatabase } from './database';
import { registerIpcHandlers } from './ipc';


let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false, // Don't show until ready
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // macOS only. Both options exist to inset the traffic lights; on Windows a non-default
    // titleBarStyle hides the title bar, and this app draws no window controls of its own —
    // the user would get a window with no close, minimise or maximise button.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 15, y: 15 } }
      : {}),
  });

  // Show window when ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // Open DevTools in development or when debugging
  if (isDev || process.env.DEBUG) {
    mainWindow.webContents.openDevTools();
  }

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function initAutoUpdater(): void {
  // Never in development: there is no packaged app to replace, and the check throws.
  if (!app.isPackaged) return;

  autoUpdater.on('error', (error) => {
    // Never surfaced to the user: a failed update check is not their problem, and this
    // app's user has no way to act on it. It must also never crash the app.
    console.error('[updater] check failed:', error);
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded, installs on quit:', info.version);
  });

  // electron-updater rethrows after emitting 'error', and checkForUpdatesAndNotify adds
  // no catch of its own — without this, every failed check is an unhandled rejection. The
  // 'error' listener above already logs it.
  void autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

app.whenReady().then(async () => {
  // Initialize database
  await initDatabase();

  // Register IPC handlers
  registerIpcHandlers();

  // Create window
  createWindow();

  // After the window, so a slow or failing check never delays startup.
  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Export for type safety
export { mainWindow };
