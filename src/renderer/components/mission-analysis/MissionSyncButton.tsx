import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSync } from '@fortawesome/free-solid-svg-icons';

interface MissionSyncButtonProps {
  onSyncComplete: () => void;
}

export function MissionSyncButton({ onSyncComplete }: MissionSyncButtonProps) {
  const [status, setStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [lastSynced, setLastSynced] = useState<number | null>(null);

  const pollStatus = useCallback(async () => {
    const result = await window.electronAPI.missionSyncStatus();
    setStatus(result.status);
    setProgress({ processed: result.students_processed, total: result.total_students });
    setLastSynced(result.last_synced_at);
    return result.status;
  }, []);

  useEffect(() => {
    pollStatus();
  }, [pollStatus]);

  useEffect(() => {
    if (status !== 'syncing') return;
    const interval = setInterval(async () => {
      const currentStatus = await pollStatus();
      if (currentStatus !== 'syncing') {
        clearInterval(interval);
        onSyncComplete();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [status, pollStatus, onSyncComplete]);

  const handleSync = async () => {
    setStatus('syncing');
    setProgress({ processed: 0, total: 0 });
    await window.electronAPI.missionSyncStart();
  };

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}, ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-3">
      {status === 'syncing' ? (
        <span className="text-sm" style={{ color: 'var(--hazu-text-muted)' }}>
          <FontAwesomeIcon icon={faSync} spin className="mr-2" />
          Syncing {progress.processed}/{progress.total} students...
        </span>
      ) : (
        <>
          {lastSynced && (
            <span className="text-xs" style={{ color: 'var(--hazu-text-muted)' }}>
              Last: {formatDate(lastSynced)}
            </span>
          )}
          <button
            onClick={handleSync}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              backgroundColor: status === 'error' ? '#FEE2E2' : 'var(--hazu-bg)',
              color: status === 'error' ? '#DC2626' : 'var(--hazu-primary)',
              border: '1px solid var(--hazu-border)',
            }}
          >
            <FontAwesomeIcon icon={faSync} />
            {status === 'error' ? 'Retry Sync' : 'Sync'}
          </button>
        </>
      )}
    </div>
  );
}
