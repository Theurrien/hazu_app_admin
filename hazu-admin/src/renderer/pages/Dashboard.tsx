import React, { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBuilding,
  faUsers,
  faLink,
  faFileLines,
  IconDefinition,
} from '@fortawesome/free-solid-svg-icons';

interface SyncStatus {
  roomCount: number;
  personCount: number;
  assignmentCount: number;
  pendingChanges: number;
  lastSyncAt: number | null;
}

interface SyncProgress {
  status: 'idle' | 'syncing' | 'completed' | 'error';
  message: string;
  roomsProcessed: number;
  personsProcessed: number;
  assignmentsProcessed: number;
  errors: string[];
}

function Dashboard() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncProgress | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    loadStatus();
    checkConfig();
  }, []);

  const checkConfig = async () => {
    try {
      // Load config from DB into memory first, then check if configured
      const config = await window.electronAPI.getApiConfig();
      const configured = !!(config.apiKey && config.rootHazuId);
      setIsConfigured(configured);
    } catch (error) {
      console.error('Failed to check config:', error);
    }
  };

  const loadStatus = async () => {
    try {
      const result = await window.electronAPI.getSyncStatus();
      setStatus(result);
    } catch (error) {
      console.error('Failed to load status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await window.electronAPI.runSync();
      setSyncResult(result);
      // Reload status after sync
      await loadStatus();
    } catch (error) {
      console.error('Sync failed:', error);
      setSyncResult({
        status: 'error',
        message: 'Sync failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
        roomsProcessed: 0,
        personsProcessed: 0,
        assignmentsProcessed: 0,
        errors: [],
      });
    } finally {
      setSyncing(false);
    }
  };

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Rooms"
          value={status?.roomCount || 0}
          icon={faBuilding}
          color="orange"
        />
        <StatCard
          title="Persons"
          value={status?.personCount || 0}
          icon={faUsers}
          color="teal"
        />
        <StatCard
          title="Assignments"
          value={status?.assignmentCount || 0}
          icon={faLink}
          color="purple"
        />
        <StatCard
          title="Pending Changes"
          value={status?.pendingChanges || 0}
          icon={faFileLines}
          color={status?.pendingChanges ? 'blue' : 'gray'}
        />
      </div>

      {/* Sync Status */}
      <div
        className="bg-white rounded-xl p-6"
        style={{
          border: '1px solid var(--hazu-border)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <h3
          className="text-lg font-semibold mb-4"
          style={{ color: 'var(--hazu-text)' }}
        >
          Sync Status
        </h3>

        {!isConfigured && (
          <div className="mb-4 p-4 bg-yellow-50 text-yellow-800 rounded-lg">
            API not configured. Please go to Settings to configure your API key and Root Hazu ID.
          </div>
        )}

        {syncResult && (
          <div className={`mb-4 p-4 rounded-lg ${
            syncResult.status === 'completed' ? 'bg-green-50 text-green-800' :
            syncResult.status === 'error' ? 'bg-red-50 text-red-800' :
            'bg-blue-50 text-blue-800'
          }`}>
            <p className="font-medium">{syncResult.message}</p>
            {syncResult.status === 'completed' && (
              <p className="text-sm mt-1">
                Synced {syncResult.roomsProcessed} rooms, {syncResult.personsProcessed} persons, {syncResult.assignmentsProcessed} assignments
              </p>
            )}
            {syncResult.errors.length > 0 && (
              <ul className="mt-2 text-sm list-disc list-inside">
                {syncResult.errors.slice(0, 5).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <p style={{ color: 'var(--hazu-text-light)' }}>Last synchronized:</p>
            <p
              className="text-lg font-medium"
              style={{ color: 'var(--hazu-text)' }}
            >
              {formatDate(status?.lastSyncAt || null)}
            </p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing || !isConfigured}
            className="px-5 py-2.5 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            style={{
              backgroundColor: 'var(--hazu-primary)',
            }}
            onMouseEnter={(e) => {
              if (!syncing && isConfigured) {
                e.currentTarget.style.backgroundColor = 'var(--hazu-primary-hover)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--hazu-primary)';
            }}
          >
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div
        className="bg-white rounded-xl p-6"
        style={{
          border: '1px solid var(--hazu-border)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <h3
          className="text-lg font-semibold mb-4"
          style={{ color: 'var(--hazu-text)' }}
        >
          Quick Actions
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <ActionButton label="View Rooms" icon={faBuilding} color="bg-[#E57B4D]" onClick={() => {}} />
          <ActionButton label="View Persons" icon={faUsers} color="bg-[#5B9B8C]" onClick={() => {}} />
          <ActionButton label="Manage Assignments" icon={faLink} color="bg-[#7B6B9B]" onClick={() => {}} />
          <ActionButton label="View Changes" icon={faFileLines} color="bg-[#5B7BA5]" onClick={() => {}} />
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: number;
  icon: IconDefinition;
  color: 'blue' | 'teal' | 'purple' | 'orange' | 'gray';
}

function StatCard({ title, value, icon, color }: StatCardProps) {
  // Hazu-style solid colored backgrounds
  const colorClasses = {
    blue: 'bg-[#5B7BA5]',
    teal: 'bg-[#5B9B8C]',
    purple: 'bg-[#7B6B9B]',
    orange: 'bg-[#E57B4D]',
    gray: 'bg-[#9B9B9B]',
  };

  return (
    <div
      className="bg-white rounded-xl p-5 transition-shadow hover:shadow-md"
      style={{
        border: '1px solid var(--hazu-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <div className="flex items-center justify-between">
        <div>
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--hazu-text-light)' }}
          >
            {title}
          </p>
          <p
            className="text-3xl font-semibold mt-1"
            style={{ color: 'var(--hazu-text)' }}
          >
            {value.toLocaleString()}
          </p>
        </div>
        {/* Hazu-style rounded square icon */}
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-sm ${colorClasses[color]}`}
        >
          <FontAwesomeIcon icon={icon} className="text-white text-xl" />
        </div>
      </div>
    </div>
  );
}

interface ActionButtonProps {
  label: string;
  icon: IconDefinition;
  color: string;
  onClick: () => void;
}

function ActionButton({ label, icon, color, onClick }: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-3 p-5 rounded-xl transition-all hover:shadow-md"
      style={{
        backgroundColor: 'var(--hazu-bg-subtle)',
        border: '1px solid var(--hazu-border)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--hazu-bg-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--hazu-bg-subtle)';
      }}
    >
      {/* Hazu-style colored icon */}
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${color}`}
      >
        <FontAwesomeIcon icon={icon} className="text-white text-lg" />
      </div>
      <span
        className="text-sm font-medium"
        style={{ color: 'var(--hazu-text)' }}
      >
        {label}
      </span>
    </button>
  );
}

export default Dashboard;
