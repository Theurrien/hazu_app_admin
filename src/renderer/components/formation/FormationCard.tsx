import React from 'react';
import type { FormationAgg, LevelAgg } from '../../../shared/formation-types';
import { StackedBar, formatRate } from './StackedBar';

const LEVEL_LABEL: Record<LevelAgg['level'], string> = { cfc: 'CFC', afp: 'AFP', other: 'Autre niveau' };

interface FormationCardProps {
  formation: FormationAgg;
  onSelect: () => void;
}

/**
 * One formation: a CFC and an AFP line (count, bar, the aggregate's own rates), « Autre niveau »
 * with a count only. A formation without an MPE catalogue shows its level counts only.
 */
export function FormationCard({ formation, onSelect }: FormationCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="text-left bg-white rounded-xl p-5 transition-shadow hover:shadow-md flex flex-col gap-4"
      style={{ border: '1px solid var(--hazu-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold" style={{ color: 'var(--hazu-text)' }}>{formation.title}</h3>
        <span className="text-2xl font-semibold" style={{ color: 'var(--hazu-text)' }}>{formation.students}</span>
      </div>

      {formation.levels.map(l => (
        <LevelLine key={l.level} level={l} hasCatalogue={formation.hasCatalogue} />
      ))}

      {!formation.hasCatalogue && (
        <p className="text-sm italic" style={{ color: 'var(--hazu-text-muted)' }}>pas de catalogue MPE</p>
      )}
    </button>
  );
}

function LevelLine({ level, hasCatalogue }: { level: LevelAgg; hasCatalogue: boolean }) {
  const head = (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="font-medium" style={{ color: 'var(--hazu-text)' }}>{LEVEL_LABEL[level.level]}</span>
      <span style={{ color: 'var(--hazu-text-light)' }}>{level.students}</span>
    </div>
  );
  if (level.level === 'other' || !hasCatalogue) return head;

  return (
    <div className="flex flex-col gap-1.5">
      {head}
      <StackedBar bar={level.bar} />
      <div className="text-xs" style={{ color: 'var(--hazu-text-light)' }}>
        Import {formatRate(level.importRate)} · Éval. {formatRate(level.evalRate)}
      </div>
    </div>
  );
}

export default FormationCard;
