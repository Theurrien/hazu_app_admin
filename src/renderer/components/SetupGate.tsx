import React, { useState } from 'react';
import type { ProbeResult } from '../../shared/config-probe';

interface SetupGateProps {
  initialApiKey?: string;
  initialRootHazuId?: string;
  /** Called once the configuration is saved and the user is done here. */
  onConfigured: () => void;
}

export function SetupGate({ initialApiKey = '', initialRootHazuId = '', onConfigured }: SetupGateProps) {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [rootHazuId, setRootHazuId] = useState(initialRootHazuId);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const handleConnect = async () => {
    setBusy(true);
    setResult(null);
    try {
      const probe = await window.electronAPI.validateApiConfig({
        apiKey,
        environment: 'swiss',
        rootHazuId,
      });
      setResult(probe);
      // Only a confirmed 200 writes anything.
      if (!probe.ok) return;

      await window.electronAPI.setApiConfig({
        apiKey: apiKey.trim(),
        environment: 'swiss',
        rootHazuId: rootHazuId.trim(),
      });
      setSaved(true);
    } catch (error) {
      setResult({
        outcome: 'unknown',
        ok: false,
        message:
          'Something went wrong saving the settings. Try again, and tell your administrator if it keeps happening.',
        field: null,
      });
      console.error('[setup-gate] connect failed:', error);
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await window.electronAPI.runSync();
    } catch (error) {
      console.error('[setup-gate] first sync failed:', error);
    } finally {
      setSyncing(false);
      onConfigured();
    }
  };

  const borderFor = (field: 'apiKey' | 'rootHazuId') =>
    result && !result.ok && result.field === field ? '#dc2626' : 'var(--hazu-border, #d1d5db)';

  return (
    <div
      className="h-screen flex items-center justify-center p-6"
      style={{ backgroundColor: 'var(--hazu-bg-subtle)' }}
    >
      <div className="bg-white rounded-lg shadow max-w-lg w-full p-8">
        <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--hazu-text)' }}>
          Connect to Hazu
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          Paste the two values you were sent. They are stored on this computer only.
        </p>

        {!saved && (
          <>
            <label className="block text-sm font-medium mb-1" htmlFor="setup-key">
              Access key
            </label>
            <input
              id="setup-key"
              type="password"
              className="w-full mb-4 px-3 py-2 border rounded"
              style={{ borderColor: borderFor('apiKey') }}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />

            <label className="block text-sm font-medium mb-1" htmlFor="setup-root">
              Root Hazu ID
            </label>
            <input
              id="setup-root"
              type="text"
              className="w-full mb-6 px-3 py-2 border rounded"
              style={{ borderColor: borderFor('rootHazuId') }}
              value={rootHazuId}
              onChange={(e) => setRootHazuId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />

            <button
              type="button"
              className="w-full py-2 rounded text-white font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--hazu-school, #E57B4D)' }}
              onClick={handleConnect}
              disabled={busy}
            >
              {busy ? 'Checking…' : 'Connect'}
            </button>
          </>
        )}

        {result && !result.ok && (
          <div className="mt-4 p-3 rounded bg-red-50 text-red-800 text-sm">{result.message}</div>
        )}

        {saved && (
          <>
            <div className="p-3 rounded bg-green-50 text-green-800 text-sm mb-6">
              Connected. Now load the data from Hazu — this takes a few minutes.
            </div>
            <button
              type="button"
              className="w-full py-2 rounded text-white font-medium disabled:opacity-50 mb-3"
              style={{ backgroundColor: 'var(--hazu-school, #E57B4D)' }}
              onClick={handleSyncNow}
              disabled={syncing}
            >
              {syncing ? 'Loading data…' : 'Load data now'}
            </button>
            <button
              type="button"
              className="w-full py-2 rounded border text-sm disabled:opacity-50"
              onClick={onConfigured}
              disabled={syncing}
            >
              Skip for now
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default SetupGate;
