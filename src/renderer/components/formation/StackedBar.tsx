import React from 'react';
import type { Bar } from '../../../shared/formation-types';

/** Bar parts in display order, with the colours and labels used everywhere in the Missions tab. */
export const BAR_PARTS: Array<{ key: keyof Bar; color: string; label: string }> = [
  { key: 'tiers', color: '#1baf7a', label: 'évalué par un tiers' },
  { key: 'auto', color: '#eda100', label: 'auto-évalué seulement' },
  { key: 'encours', color: '#2a78d6', label: 'importé, en cours' },
  { key: 'manquant', color: '#d3d1c7', label: 'pas encore importé' },
];

const UNKNOWN_TRACK = '#ececec';

interface StackedBarProps {
  /** Known statuses only. `null` = the statuses are unknown — an empty grey track « inconnu ». */
  bar: Bar | null;
  height?: number;
}

/** Four-part status bar. Widths are shares of the bar's own total; no rate is derived from it. */
export function StackedBar({ bar, height = 10 }: StackedBarProps) {
  const total = bar ? bar.tiers + bar.auto + bar.encours + bar.manquant : 0;
  const track = { height, backgroundColor: UNKNOWN_TRACK };

  if (bar === null) {
    return (
      <div className="flex items-center gap-2 w-full" title="Statuts inconnus">
        <div className="flex-1 rounded-full" style={track} />
        <span className="text-xs italic" style={{ color: 'var(--hazu-text-muted)' }}>inconnu</span>
      </div>
    );
  }
  if (total === 0) {
    return <div className="w-full rounded-full" style={track} title="Aucun mandat attendu" />;
  }

  const tooltip = BAR_PARTS.map(p => `${p.label} : ${bar[p.key]}`).join('\n');
  return (
    <div className="flex w-full rounded-full overflow-hidden" style={{ height }} title={tooltip}>
      {BAR_PARTS.map(p => bar[p.key] > 0 && (
        <div key={p.key} style={{ width: `${(bar[p.key] / total) * 100}%`, backgroundColor: p.color }} />
      ))}
    </div>
  );
}

/** The legend for StackedBar, in bar order. */
export function BarLegend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm" style={{ color: 'var(--hazu-text-light)' }}>
      {BAR_PARTS.map(p => (
        <span key={p.key} className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: p.color }} />
          {p.label}
        </span>
      ))}
    </div>
  );
}

export { formatRate } from './sync-logic';

export default StackedBar;
