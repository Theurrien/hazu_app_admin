import React, { useEffect, useState } from 'react';

function SettingsPage() {
  // User settings (visible to all)
  const [apiKey, setApiKey] = useState('');
  const [rootHazuId, setRootHazuId] = useState('');

  // Admin settings (behind password)
  const [environment, setEnvironment] = useState('swiss');
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userDisplayName, setUserDisplayName] = useState('');

  // Admin unlock state
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminPasswordError, setAdminPasswordError] = useState(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const config = await window.electronAPI.getApiConfig();
      if (config.apiKey) setApiKey(config.apiKey);
      if (config.environment) setEnvironment(config.environment);
      if (config.rootHazuId) setRootHazuId(config.rootHazuId);
      if (config.userId) setUserId(config.userId);
      if (config.userEmail) setUserEmail(config.userEmail);
      if (config.userDisplayName) setUserDisplayName(config.userDisplayName);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await window.electronAPI.setApiConfig({
        apiKey,
        environment,
        rootHazuId,
        userId,
        userEmail,
        userDisplayName,
      });
      setMessage({ type: 'success', text: 'Settings saved successfully!' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleAdminUnlock = async () => {
    try {
      const storedPassword = await window.electronAPI.getSetting('admin_password');
      if (adminPasswordInput === storedPassword) {
        setAdminUnlocked(true);
        setAdminPasswordError(false);
        setAdminPasswordInput('');
      } else {
        setAdminPasswordError(true);
      }
    } catch (error) {
      console.error('Failed to verify admin password:', error);
      setAdminPasswordError(true);
    }
  };

  return (
    <div className="max-w-2xl">
      {/* User Settings */}
      <div className="bg-white rounded-lg shadow p-6 space-y-6">
        <h3 className="text-lg font-semibold">Settings</h3>

        {message && (
          <div
            className={`p-4 rounded-lg ${
              message.type === 'success'
                ? 'bg-green-50 text-green-800'
                : 'bg-red-50 text-red-800'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your Hazu API key"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              Your API key for authenticating with the Hazu platform.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Root Hazu ID
            </label>
            <input
              type="text"
              value={rootHazuId}
              onChange={(e) => setRootHazuId(e.target.value)}
              placeholder="e.g., abc123XYZ..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              The ID of the root Hazu to sync from.
            </p>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200">
          <button
            onClick={saveSettings}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* Advanced Settings (Admin) */}
      <div className="bg-white rounded-lg shadow p-6 mt-6">
        <h3 className="text-lg font-semibold mb-4">Advanced Settings</h3>

        {!adminUnlocked ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Enter the admin password to access advanced configuration.
            </p>
            <div className="flex gap-3">
              <input
                type="password"
                value={adminPasswordInput}
                onChange={(e) => {
                  setAdminPasswordInput(e.target.value);
                  setAdminPasswordError(false);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleAdminUnlock()}
                placeholder="Admin password"
                className={`flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  adminPasswordError ? 'border-red-400' : 'border-gray-300'
                }`}
              />
              <button
                onClick={handleAdminUnlock}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                Unlock
              </button>
            </div>
            {adminPasswordError && (
              <p className="text-sm text-red-600">Incorrect password.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded">
                Admin unlocked
              </span>
              <button
                onClick={() => setAdminUnlocked(false)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Lock
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Environment
              </label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="swiss">Swiss (Production)</option>
                <option value="io">IO</option>
                <option value="dev">Development</option>
              </select>
              <p className="mt-1 text-sm text-gray-500">
                Select the Hazu environment to connect to.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                User ID
              </label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="e.g., uid123abc..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-sm text-gray-500">
                Firebase User ID (found in Hazu admin settings).
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="e.g., admin@example.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-sm text-gray-500">
                Email address for API requests.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={userDisplayName}
                onChange={(e) => setUserDisplayName(e.target.value)}
                placeholder="e.g., Admin Hazu"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-sm text-gray-500">
                Display name for API requests.
              </p>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <button
                onClick={saveSettings}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save All Settings'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Database Info */}
      <div className="bg-white rounded-lg shadow p-6 mt-6">
        <h3 className="text-lg font-semibold mb-4">Database</h3>
        <p className="text-sm text-gray-600">
          Data is stored locally in SQLite. The database is located in the application data directory.
        </p>
        <div className="mt-4 flex gap-4">
          <button
            onClick={() => {/* TODO: Export database */}}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Export Data
          </button>
          <button
            onClick={() => {/* TODO: Clear database */}}
            className="px-4 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors"
          >
            Clear Database
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
