import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  AppMode,
  APP_MODE_SETTING_KEY,
  DEFAULT_APP_MODE,
  parseAppMode,
} from '../../shared/app-mode';

interface AppModeContextValue {
  mode: AppMode;
  /** False until the stored mode has been read, so the UI does not flash the wrong surface. */
  ready: boolean;
  /** Resolves true when the mode became 'complete'. */
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
}

const AppModeContext = createContext<AppModeContextValue | null>(null);

export function AppModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AppMode>(DEFAULT_APP_MODE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .getSetting(APP_MODE_SETTING_KEY)
      .then((stored) => {
        if (!cancelled) setMode(parseAppMode(stored));
      })
      .catch((error) => {
        console.error('[app-mode] failed to read the stored mode:', error);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: AppMode) => {
    setMode(next);
    try {
      await window.electronAPI.setSetting(APP_MODE_SETTING_KEY, next);
    } catch (error) {
      // The mode still changed for this session; it just will not survive a restart.
      console.error('[app-mode] failed to persist the mode:', error);
    }
  }, []);

  const unlock = useCallback(
    async (password: string): Promise<boolean> => {
      let stored: string | null = null;
      try {
        stored = await window.electronAPI.getSetting('admin_password');
      } catch (error) {
        console.error('[app-mode] failed to read the admin password:', error);
        return false;
      }

      // Lockout guard: with no password configured, a fresh install would default to
      // CIE mode with no way back to the full surface.
      if (!stored) {
        await persist('complete');
        return true;
      }

      if (password !== stored) return false;

      await persist('complete');
      return true;
    },
    [persist]
  );

  const lock = useCallback(() => {
    void persist('cie');
  }, [persist]);

  return (
    <AppModeContext.Provider value={{ mode, ready, unlock, lock }}>
      {children}
    </AppModeContext.Provider>
  );
}

export function useAppMode(): AppModeContextValue {
  const context = useContext(AppModeContext);
  if (!context) {
    throw new Error('useAppMode must be used inside an AppModeProvider');
  }
  return context;
}
