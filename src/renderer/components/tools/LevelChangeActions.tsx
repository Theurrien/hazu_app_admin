import React, { useState } from 'react';
import type { LevelChangePlan, ProfileOnlyItem } from '../../../shared/level-change-types';
import type { LevelChangeDecisions } from '../../../shared/level-change-decisions';
import { DeleteSectionsConfirmModal } from './DeleteSectionsConfirmModal';
import { descendantsLabel, setDelete, toggleCopy } from './level-change-logic';

interface Props {
  plan: LevelChangePlan;
  decisions: LevelChangeDecisions;
  onChange: (d: LevelChangeDecisions) => void;
  /** every box locked while the task is queued: the task holds a snapshot of the decisions */
  disabled?: boolean;
}

/** « Actions supplémentaires »: copy template-only sections, delete profile-only ones, add the widget. */
export function LevelChangeActions({ plan, decisions, onChange, disabled = false }: Props) {
  const [pending, setPending] = useState<ProfileOnlyItem | null>(null);
  const { templateOnlyItems, profileOnlyItems, widget } = plan;
  if (templateOnlyItems.length === 0 && profileOnlyItems.length === 0 && !widget.needed) return null;

  return (
    <div className="space-y-2">
      <p className="font-medium">Actions supplémentaires</p>

      {templateOnlyItems.length > 0 && (
        <div className="ml-2">
          <p className="text-gray-600">Copier les sections manquantes</p>
          {templateOnlyItems.map((i) => (
            <label key={i.sectionKey} className="flex items-center gap-2 ml-3">
              <input
                type="checkbox"
                disabled={disabled}
                checked={decisions.copySections.includes(i.sectionKey)}
                onChange={() => onChange(toggleCopy(decisions, i.sectionKey))}
              />
              <span>{i.title}</span>
            </label>
          ))}
        </div>
      )}

      {profileOnlyItems.length > 0 && (
        <div className="ml-2">
          <p className="text-gray-600">Supprimer les sections seulement dans le profil</p>
          {profileOnlyItems.map((i) => (
            <label key={i.sectionKey} className="flex items-center gap-2 ml-3">
              <input
                type="checkbox"
                disabled={disabled}
                checked={decisions.deleteSections.some((d) => d.sectionKey === i.sectionKey)}
                onChange={(e) =>
                  e.target.checked ? setPending(i) : onChange(setDelete(decisions, i.sectionKey, i.sectionId, false))
                }
              />
              <span>{i.title}</span>
              <span className="text-xs text-gray-500">({descendantsLabel(i.descendants, i.descendantsExact)})</span>
            </label>
          ))}
        </div>
      )}

      {widget.needed && (
        <label className="flex items-center gap-2 ml-2">
          <input
            type="checkbox"
            disabled={disabled}
            checked={decisions.addWidget}
            onChange={() => onChange({ ...decisions, addWidget: !decisions.addWidget })}
          />
          <span>Ajouter le widget à la description du profil</span>
        </label>
      )}

      <DeleteSectionsConfirmModal
        items={pending ? [pending] : null}
        onConfirm={() => {
          if (pending) onChange(setDelete(decisions, pending.sectionKey, pending.sectionId, true));
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
