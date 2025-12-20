import React, { useEffect, useState } from 'react';

function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [environment, setEnvironment] = useState('swiss');
  const [rootHazuId, setRootHazuId] = useState('');
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
      });
      setMessage({ type: 'success', text: 'Settings saved successfully!' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="bg-white rounded-lg shadow p-6 space-y-6">
        <h3 className="text-lg font-semibold">API Configuration</h3>

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
              Root Hazu ID
            </label>
            <input
              type="text"
              value={rootHazuId}
              onChange={(e) => setRootHazuId(e.target.value)}
              placeholder="e.g., YznyEHgCGlZp9NueGJ1B"
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
