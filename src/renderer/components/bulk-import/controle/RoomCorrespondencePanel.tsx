import React, { useMemo, useState } from 'react';
import { isResolved, resolvedId, type RoomCandidate, type RoomCategory, type RoomResolution } from '../../../../shared/correspondence';
import { normalizeName } from '../../../../shared/person-match';
import { roomLabel } from './controle-logic';

const panel = { border: '1px solid var(--hazu-border)' };

export const CATEGORY_TITLE: Record<RoomCategory, string> = {
  class: 'Classes',
  enterprise: 'Entreprises',
  state: 'Cantons',
};

const STATUS: Record<RoomResolution['kind'], string> = {
  saved: 'enregistré',
  exact: 'exact',
  ignored: 'ignoré',
  stale: 'lien périmé',
  open: 'à résoudre',
};

interface PickerProps {
  candidates: RoomCandidate[];
  /** Preselected room (the suggestion, or the current link); nothing is saved until « Confirmer ». */
  initialId: string | null;
  /** Shown first in the list (twins of the value). */
  firstIds?: string[];
  busy: boolean;
  onConfirm: (hazuId: string) => void;
  onIgnore: () => void;
  onCancel?: () => void;
}

/** Searchable dropdown of one type's rooms, with « Confirmer » and « Ignorer (pas dans Hazu) ». */
export function RoomPicker({ candidates, initialId, firstIds = [], busy, onConfirm, onIgnore, onCancel }: PickerProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(initialId);

  const options = useMemo(() => {
    const q = normalizeName(query);
    const first = new Set(firstIds);
    const sorted = [...candidates].sort(
      (a, b) => Number(first.has(b.id)) - Number(first.has(a.id)) || a.title.localeCompare(b.title, 'fr'),
    );
    const shown = q === '' ? sorted : sorted.filter((c) => normalizeName(roomLabel(c, candidates)).includes(q));
    // The selection stays visible even when the search hides it, so « Confirmer » never saves an unseen room.
    const sel = candidates.find((c) => c.id === selected);
    return sel && !shown.includes(sel) ? [sel, ...shown] : shown;
  }, [candidates, firstIds, query, selected]);

  return (
    <div className="mt-2 space-y-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Chercher une salle…"
        className="px-2 py-1 border border-gray-300 rounded w-full max-w-md text-sm"
      />
      <select
        size={Math.min(6, Math.max(2, options.length))}
        value={selected ?? ''}
        onChange={(e) => setSelected(e.target.value || null)}
        className="block w-full max-w-md border border-gray-300 rounded text-sm"
      >
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {roomLabel(c, candidates)}
          </option>
        ))}
      </select>
      {options.length === 0 && <p className="text-xs text-gray-500">Aucune salle ne correspond.</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || selected === null}
          onClick={() => selected && onConfirm(selected)}
          className="px-2 py-1 rounded text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Confirmer
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onIgnore}
          className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          Ignorer (pas dans Hazu)
        </button>
        {onCancel && (
          <button type="button" className="text-xs text-gray-500 hover:underline" onClick={onCancel}>
            Fermer
          </button>
        )}
      </div>
    </div>
  );
}

interface PanelProps {
  category: RoomCategory;
  values: Array<{ key: string; label: string }>;
  resolutions: Map<string, RoomResolution>;
  candidates: RoomCandidate[];
  open: number;
  busy: boolean;
  /** key = roomKey(value); hazuId null = ignored. */
  onDecide: (key: string, label: string, hazuId: string | null) => void;
}

/** One room column: every distinct value of the file, unresolved first. */
export function RoomCorrespondencePanel({ category, values, resolutions, candidates, open, busy, onDecide }: PanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);

  const rows = useMemo(
    () =>
      values
        .map((v) => ({ ...v, res: resolutions.get(v.key) }))
        .filter((v): v is { key: string; label: string; res: RoomResolution } => v.res !== undefined)
        .sort((a, b) => Number(isResolved(a.res)) - Number(isResolved(b.res)) || a.label.localeCompare(b.label, 'fr')),
    [values, resolutions],
  );

  const decide = (key: string, label: string, hazuId: string | null) => {
    setEditing(null);
    onDecide(key, label, hazuId);
  };

  return (
    <section className="bg-white rounded-lg" style={panel}>
      <h4 className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">
        {CATEGORY_TITLE[category]} — {open} à résoudre
      </h4>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-500">Aucune valeur dans cette colonne.</p>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-[32rem] overflow-y-auto">
          {rows.map(({ key, label, res }) => {
            const resolved = isResolved(res);
            const id = resolvedId(res);
            const target = id ? byId.get(id) : undefined;
            const twins = res.kind === 'open' ? res.twins : [];
            const showPicker = !resolved || editing === key;
            const initialId =
              res.kind === 'open' || res.kind === 'stale' ? res.suggestionId : id;
            return (
              <li key={key} className={`px-4 py-3 text-sm ${resolved && editing !== key ? 'text-gray-600' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-900">{label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs ${
                      resolved ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {twins.length > 1 ? 'plusieurs salles de ce nom' : STATUS[res.kind]}
                  </span>
                  {target && <span className="text-gray-700">→ {roomLabel(target, candidates)}</span>}
                  {resolved && editing !== key && (
                    <button
                      type="button"
                      className="ml-auto text-xs text-blue-600 hover:underline"
                      onClick={() => setEditing(key)}
                    >
                      Modifier
                    </button>
                  )}
                </div>
                {showPicker && (
                  <RoomPicker
                    key={`${key}|${res.kind}|${initialId ?? ''}`}
                    candidates={candidates}
                    initialId={initialId}
                    firstIds={twins}
                    busy={busy}
                    onConfirm={(hazuId) => decide(key, label, hazuId)}
                    onIgnore={() => decide(key, label, null)}
                    onCancel={resolved ? () => setEditing(null) : undefined}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
