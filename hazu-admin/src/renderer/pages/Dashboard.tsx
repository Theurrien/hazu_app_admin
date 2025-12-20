import React, { useEffect, useState } from 'react';

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
      const configured = await window.electronAPI.isApiConfigured();
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
          icon="🏠"
          color="blue"
        />
        <StatCard
          title="Persons"
          value={status?.personCount || 0}
          icon="👥"
          color="green"
        />
        <StatCard
          title="Assignments"
          value={status?.assignmentCount || 0}
          icon="🔗"
          color="purple"
        />
        <StatCard
          title="Pending Changes"
          value={status?.pendingChanges || 0}
          icon="📝"
          color={status?.pendingChanges ? 'orange' : 'gray'}
        />
      </div>

      {/* Sync Status */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Sync Status</h3>

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
            <p className="text-gray-600">Last synchronized:</p>
            <p className="text-lg font-medium">{formatDate(status?.lastSyncAt || null)}</p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing || !isConfigured}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <ActionButton label="View Rooms" icon="🏠" onClick={() => {}} />
          <ActionButton label="View Persons" icon="👥" onClick={() => {}} />
          <ActionButton label="Manage Assignments" icon="🔗" onClick={() => {}} />
          <ActionButton label="View Changes" icon="📝" onClick={() => {}} />
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: number;
  icon: string;
  color: 'blue' | 'green' | 'purple' | 'orange' | 'gray';
}

function StatCard({ title, value, icon, color }: StatCardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
    gray: 'bg-gray-50 text-gray-600',
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-3xl font-bold mt-1">{value}</p>
        </div>
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-2xl ${colorClasses[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

interface ActionButtonProps {
  label: string;
  icon: string;
  onClick: () => void;
}

function ActionButton({ label, icon, onClick }: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-sm font-medium text-gray-700">{label}</span>
    </button>
  );
}

export default Dashboard;
