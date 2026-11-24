import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotate } from '@fortawesome/free-solid-svg-icons';
import type { FormationSyncStatus, SchoolOverview } from '../../../shared/formation-types';
import { shouldReload } from './sync-logic';

const POLL_MS = 1000;

interface SyncHeaderProps {
  /** null before the overview has loaded. */
  overview: SchoolOverview | null;
  /** No formation data stored yet: the header says so instead of the date and counts. */
  empty: boolean;
  /** Called when the stored data is newer than `overview` (see `shouldReload`): reload the overview. */
  onSynced: () => void;
}

const formatDate = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleDateString('fr-CH'));

/**
 * Data date, « n lu·es, m en échec » (m = never read + read failed this run; the list opens on
 * click) and « Mettre à jour ». While a run is `syncing` the status is polled every second. The
 * overview is reloaded whenever the status is `idle` with a `lastSyncedAt` newer than the loaded
 * overview's — so a run that ended while this header was unmounted, or one already `idle` when
 * `formationSyncStart` returns, still reloads. An `error` keeps the old data.
 */
export function SyncHeader({ overview, empty, onSynced }: SyncHeaderProps) {
  const [status, setStatus] = useState<FormationSyncStatus | null>(null);
  const [showFailures, setShowFailures] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  const schedule = (fn: () => void) => {
    if (timer.current) clearTimeout(timer.current); // at most one pending poll
    timer.current = setTimeout(fn, POLL_MS);
  };

  const poll = useCallback(async () => {
    timer.current = null;
    let s: FormationSyncStatus;
    try {
      s = await window.electronAPI.formationSyncStatus();
    } catch (error) {
      console.error('Formation sync status failed:', error);
      if (mounted.current) schedule(poll);
      return;
    }
    if (!mounted.current) return;
    setStatus(s);
    if (s.status === 'syncing') schedule(poll);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void poll(); // picks up a run already in progress, and a stored error
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  const start = async () => {
    try {
      const s = await window.electronAPI.formationSyncStart();
      if (!mounted.current) return;
      setStatus(s);
      if (s.status === 'syncing') schedule(poll);
    } catch (error) {
      setStatus(prev => ({
        status: 'error', processed: 0, total: 0, failed: 0, lastSyncedAt: prev?.lastSyncedAt ?? null,
        lastError: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  // Reload once the loaded overview is older than the stored data. After a reload the overview's
  // syncedAt equals lastSyncedAt, so this settles; a failed reload leaves both unchanged (no loop).
  const loaded = overview !== null;
  const loadedSyncedAt = overview?.syncedAt ?? null;
  useEffect(() => {
    if (loaded && status && shouldReload(status, loadedSyncedAt)) onSyncedRef.current();
  }, [status, loaded, loadedSyncedAt]);

  const syncing = status?.status === 'syncing';
  const failed = overview?.failed ?? [];
  const stale = overview?.stale ?? [];
  const failures = failed.length + stale.length;
  const readCount = (overview?.students ?? 0) - stale.length;

  return (
    <div
      className="bg-white rounded-xl p-5"
      style={{ border: '1px solid var(--hazu-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm" style={{ color: 'var(--hazu-text-light)' }}>
          {!loaded ? (
            <span>Chargement…</span>
          ) : empty ? (
            <span className="text-base" style={{ color: 'var(--hazu-text)' }}>Aucune donnée — lancez Mettre à jour</span>
          ) : (
            <>
              Données du <span className="font-medium" style={{ color: 'var(--hazu-text)' }}>{formatDate(overview?.syncedAt ?? null)}</span>
              {' · '}{readCount} lu·es,{' '}
              {failures > 0 ? (
                <button
                  type="button"
                  className="underline decoration-dotted text-red-700"
                  onClick={() => setShowFailures(v => !v)}
                >
                  {failures} en échec
                </button>
              ) : (
                <span>0 en échec</span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          {syncing && (
            <span className="text-sm tabular-nums" style={{ color: 'var(--hazu-text-light)' }}>
              {status!.processed} / {status!.total}
            </span>
          )}
          <button
            type="button"
            onClick={start}
            disabled={syncing}
            className="px-5 py-2.5 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-2"
            style={{ backgroundColor: 'var(--hazu-primary)' }}
            onMouseEnter={e => { if (!syncing) e.currentTarget.style.backgroundColor = 'var(--hazu-primary-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--hazu-primary)'; }}
          >
            <FontAwesomeIcon icon={faRotate} spin={syncing} />
            {syncing ? 'Mise à jour…' : 'Mettre à jour'}
          </button>
        </div>
      </div>

      {status?.status === 'error' && status.lastError && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm">{status.lastError}</div>
      )}

      {showFailures && failures > 0 && (
        <div className="mt-4 text-sm space-y-3" style={{ color: 'var(--hazu-text)' }}>
          {failed.length > 0 && <FailureList title="jamais lu·es" items={failed} />}
          {stale.length > 0 && <FailureList title="données anciennes" items={stale} />}
        </div>
      )}
    </div>
  );
}

function FailureList({ title, items }: { title: string; items: SchoolOverview['failed'] }) {
  return (
    <div>
      <p className="font-medium mb-1" style={{ color: 'var(--hazu-text-light)' }}>{title} ({items.length})</p>
      <ul className="space-y-0.5">
        {items.map(f => (
          <li key={f.personId}>
            {f.name} <span style={{ color: 'var(--hazu-text-muted)' }}>— {f.error}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SyncHeader;
