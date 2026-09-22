import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLock, faLockOpen } from '@fortawesome/free-solid-svg-icons';
import { useAppMode } from '../../contexts/AppModeContext';

export function ModeLock() {
  const { mode, unlock, lock } = useAppMode();
  const [promptOpen, setPromptOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);

  const locked = mode === 'cie';

  const closePrompt = () => {
    setPromptOpen(false);
    setPassword('');
    setFailed(false);
  };

  const handleToggle = () => {
    if (locked) {
      setPromptOpen(true);
    } else {
      lock();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setFailed(false);
    const ok = await unlock(password);
    setChecking(false);
    if (ok) {
      closePrompt();
    } else {
      setFailed(true);
      setPassword('');
    }
  };

  return (
    <>
      <button
        onClick={handleToggle}
        title={locked ? 'CIE mode — click to unlock the full app' : 'Full app — click to return to CIE mode'}
        aria-label={locked ? 'Unlock the full app' : 'Return to CIE mode'}
        className="p-1.5 rounded-md transition-colors hover:bg-black/5"
        style={{ color: 'var(--hazu-text-light)' }}
      >
        <FontAwesomeIcon icon={locked ? faLock : faLockOpen} className="text-sm" fixedWidth />
      </button>

      {promptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-lg shadow-xl p-6 w-80 space-y-4"
          >
            <h3 className="text-lg font-semibold">Unlock the full app</h3>
            <p className="text-sm text-gray-500">
              Enter the admin password to leave CIE mode.
            </p>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {failed && <p className="text-sm text-red-600">Incorrect password.</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closePrompt}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={checking}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {checking ? 'Checking…' : 'Unlock'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
