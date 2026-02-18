import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { findIconDefinition, IconLookup } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { library } from '@fortawesome/fontawesome-svg-core';

// Register all solid icons so we can look them up dynamically
library.add(fas);

type LieuDeFormation = 'entreprise' | 'ecole' | 'cie';

interface MissionFilterBarProps {
  lieu: LieuDeFormation | null;
  onLieuChange: (lieu: LieuDeFormation | null) => void;
  selectedProfessions: Set<string>;
  onToggleProfession: (icon: string) => void;
  level: 'afp' | 'cfc' | null;
  onLevelChange: (level: 'afp' | 'cfc' | null) => void;
  classId: string | null;
  onClassChange: (classId: string | null) => void;
  classes: Array<{ id: string; title: string }>;
  professions: Array<{ icon: string; student_count: number }>;
}

function resolveIcon(faClass: string): IconLookup | null {
  const name = faClass.replace(/^fa-/, '');
  try {
    const def = findIconDefinition({ prefix: 'fas', iconName: name as any });
    return def ? { prefix: 'fas', iconName: name as any } : null;
  } catch {
    return null;
  }
}

export function MissionFilterBar({
  lieu, onLieuChange,
  selectedProfessions, onToggleProfession,
  level, onLevelChange,
  classId, onClassChange,
  classes, professions,
}: MissionFilterBarProps) {

  const lieuOptions: { value: LieuDeFormation; label: string }[] = [
    { value: 'entreprise', label: 'Entreprise' },
    { value: 'ecole', label: 'École' },
    { value: 'cie', label: 'CIE' },
  ];

  return (
    <div className="space-y-3">
      {/* Row 1: Lieu de formation */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider w-24" style={{ color: 'var(--hazu-text-muted)' }}>
          Lieu
        </span>
        <div className="flex gap-1">
          {lieuOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => onLieuChange(lieu === opt.value ? null : opt.value)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: lieu === opt.value ? 'var(--hazu-primary)' : 'var(--hazu-bg)',
                color: lieu === opt.value ? '#fff' : 'var(--hazu-text)',
                border: '1px solid var(--hazu-border)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: Profession icons + Level + Class */}
      <div className="flex items-center gap-4">
        {/* Professions */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider w-24" style={{ color: 'var(--hazu-text-muted)' }}>
            Profession
          </span>
          <div className="flex gap-1">
            {professions.map(prof => {
              const iconLookup = resolveIcon(prof.icon);
              const isActive = selectedProfessions.has(prof.icon);
              return (
                <button
                  key={prof.icon}
                  onClick={() => onToggleProfession(prof.icon)}
                  className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
                  style={{
                    backgroundColor: isActive ? 'var(--hazu-primary)' : 'var(--hazu-bg)',
                    color: isActive ? '#fff' : 'var(--hazu-text)',
                    border: '1px solid var(--hazu-border)',
                  }}
                  title={`${prof.icon} (${prof.student_count} students)`}
                >
                  {iconLookup ? (
                    <FontAwesomeIcon icon={iconLookup as any} className="text-sm" />
                  ) : (
                    <span className="text-xs">?</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Level */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--hazu-text-muted)' }}>
            Level
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => onLevelChange(level === 'afp' ? null : 'afp')}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: level === 'afp' ? '#9AD9EA' : 'var(--hazu-bg)',
                color: level === 'afp' ? '#1a1a1a' : 'var(--hazu-text)',
                border: '1px solid var(--hazu-border)',
              }}
            >
              AFP
            </button>
            <button
              onClick={() => onLevelChange(level === 'cfc' ? null : 'cfc')}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: level === 'cfc' ? '#1A237E' : 'var(--hazu-bg)',
                color: level === 'cfc' ? '#fff' : 'var(--hazu-text)',
                border: '1px solid var(--hazu-border)',
              }}
            >
              CFC
            </button>
          </div>
        </div>

        {/* Class dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--hazu-text-muted)' }}>
            Class
          </span>
          <select
            value={classId || ''}
            onChange={(e) => onClassChange(e.target.value || null)}
            className="px-3 py-1.5 rounded-lg text-sm border"
            style={{
              backgroundColor: 'var(--hazu-bg)',
              color: 'var(--hazu-text)',
              borderColor: 'var(--hazu-border)',
            }}
          >
            <option value="">All classes</option>
            {classes.map(c => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
