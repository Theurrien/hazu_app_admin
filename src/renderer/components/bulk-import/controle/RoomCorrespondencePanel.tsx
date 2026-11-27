import React, { useMemo, useState } from 'react';
import { isResolved, resolvedId, type RoomCandidate, type RoomCategory, type RoomResolution } from '../../../../shared/correspondence';
import { normalizeName } from '../../../../shared/person-match';
import { createNameProblem, roomLabel } from './controle-logic';

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

/** A room template of one type, as `fetchTemplates` returns it. */
export interface RoomTemplate {
  id: string;
  title: string;
}

export type TemplatesState =
  | { status: 'idle' | 'loading' }
  | { status: 'ok'; templates: RoomTemplate[] }
  | { status: 'error'; error: string };

/** What a panel needs to offer « Créer dans Hazu ». */
export interface RoomCreation {
  /** Category folder of this type found; without it nothing can be created. */
  available: boolean;
  /** value key → its creation task's state; a value with none was never created here. */
  status: Map<string, 'pending' | 'failed'>;
  templates: TemplatesState;
  loadTemplates: () => void;
  onCreate: (key: string, label: string, name: string, templateId: string) => void;
}

/** Stable default for `firstIds`, so the list memo does not rerun on every render. */
const NO_IDS: string[] = [];

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
  /** Shown as « Créer dans Hazu » when given. */
  onStartCreate?: () => void;
}

/** Searchable dropdown of one type's rooms, with « Confirmer » and « Ignorer (pas dans Hazu) ». */
export function RoomPicker({ candidates, initialId, firstIds = NO_IDS, busy, onConfirm, onIgnore, onCancel, onStartCreate }: PickerProps) {
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
      {/* A clickable list, not a <select>: a controlled <select> whose value matches no option shows
          its first option as selected, and clicking it then fires no change — the first room could
          not be picked. Every click here sets the selection. */}
      {options.length > 0 && (
        <ul
          role="listbox"
          aria-label="Salles"
          className="w-full max-w-md max-h-40 overflow-y-auto border border-gray-300 rounded text-sm bg-white"
        >
          {options.map((c) => {
            const isSel = c.id === selected;
            return (
              <li key={c.id} role="option" aria-selected={isSel}>
                <button
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={`w-full text-left px-2 py-1 ${isSel ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}
                >
                  {roomLabel(c, candidates)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
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
        {onStartCreate && (
          <button
            type="button"
            disabled={busy}
            onClick={onStartCreate}
            className="px-2 py-1 rounded text-xs bg-white border border-blue-600 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            Créer dans Hazu
          </button>
        )}
        {onCancel && (
          <button type="button" className="text-xs text-gray-500 hover:underline" onClick={onCancel}>
            Fermer
          </button>
        )}
      </div>
    </div>
  );
}

interface CreateFormProps {
  label: string;
  candidates: RoomCandidate[];
  templates: TemplatesState;
  onRetryTemplates: () => void;
  onCreate: (name: string, templateId: string) => void;
  onCancel: () => void;
}

/**
 * Name (the file's value, editable) and template of the room to create. One click queues one
 * `createRoom` task; the form closes at once, so it cannot be queued twice.
 */
function CreateRoomForm({ label, candidates, templates, onRetryTemplates, onCreate, onCancel }: CreateFormProps) {
  const [name, setName] = useState(label);
  const list = templates.status === 'ok' ? templates.templates : [];
  const [templateId, setTemplateId] = useState('');
  // A single template is chosen for the operator; several are left to choose.
  const chosen = templateId || (list.length === 1 ? list[0].id : '');
  const problem = createNameProblem(name, candidates);

  return (
    <div className="mt-2 space-y-2 rounded border border-blue-200 bg-blue-50/40 p-3">
      <label className="block text-xs text-gray-700">
        Nom dans Hazu
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 px-2 py-1 border border-gray-300 rounded w-full max-w-md text-sm bg-white"
        />
      </label>
      {problem && name.trim() !== '' && <p className="text-xs text-red-700">{problem}</p>}
      {templates.status === 'loading' || templates.status === 'idle' ? (
        <p className="text-xs text-gray-500">Chargement des modèles…</p>
      ) : templates.status === 'error' ? (
        <p className="text-xs text-red-700">
          Modèles illisibles : {templates.error}{' '}
          <button type="button" className="underline" onClick={onRetryTemplates}>
            Réessayer
          </button>
        </p>
      ) : list.length === 0 ? (
        <p className="text-xs text-red-700">Aucun modèle pour ce type de salle.</p>
      ) : (
        <label className="block text-xs text-gray-700">
          Modèle
          <select
            value={chosen}
            onChange={(e) => setTemplateId(e.target.value)}
            className="mt-1 px-2 py-1 border border-gray-300 rounded w-full max-w-md text-sm bg-white"
          >
            {list.length > 1 && <option value="">Choisir un modèle…</option>}
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={problem !== null || chosen === ''}
          onClick={() => onCreate(name.trim().replace(/\s+/g, ' '), chosen)}
          className="px-2 py-1 rounded text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Créer
        </button>
        <button type="button" className="text-xs text-gray-500 hover:underline" onClick={onCancel}>
          Annuler
        </button>
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
  /** « Créer dans Hazu » on open values; absent = not offered. */
  creation?: RoomCreation;
}

/** One room column: every distinct value of the file, unresolved first. */
export function RoomCorrespondencePanel({ category, values, resolutions, candidates, open, busy, onDecide, creation }: PanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  /** The value whose create form is open. */
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
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
            const createState = creation?.status.get(key);
            const pending = !resolved && createState === 'pending';
            const showForm = !resolved && !pending && creatingFor === key && !!creation;
            const showPicker = !pending && !showForm && (!resolved || editing === key);
            // No creation beside rooms that already carry this exact name (twins), nor for a resolved value.
            const canCreate = !!creation?.available && !resolved && twins.length === 0;
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
                    {pending
                      ? 'création en cours'
                      : twins.length > 1
                        ? 'plusieurs salles de ce nom'
                        : STATUS[res.kind]}
                  </span>
                  {!resolved && createState === 'failed' && (
                    <span className="text-xs text-red-700">création en échec — voir la file</span>
                  )}
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
                    onStartCreate={
                      canCreate && creation
                        ? () => {
                            setCreatingFor(key);
                            creation.loadTemplates();
                          }
                        : undefined
                    }
                  />
                )}
                {showForm && creation && (
                  <CreateRoomForm
                    label={label}
                    candidates={candidates}
                    templates={creation.templates}
                    onRetryTemplates={creation.loadTemplates}
                    onCreate={(name, templateId) => {
                      setCreatingFor(null);
                      creation.onCreate(key, label, name, templateId);
                    }}
                    onCancel={() => setCreatingFor(null)}
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
