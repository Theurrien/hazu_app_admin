import React from 'react';
import type { MandateRow } from '../../../shared/formation-types';
import { formatRate } from './StackedBar';
import { shareOf } from './detail-logic';

interface MandateTableProps {
  rows: MandateRow[];
}

/**
 * One row per catalogue mandate of one level. The two columns have different bases:
 * « Importé » = imported / concerned; « Évalué par un tiers » = tiers / assessable (the concerned
 * apprentices whose evaluation is known).
 */
export function MandateTable({ rows }: MandateTableProps) {
  if (!rows.length) {
    return <p className="text-sm italic" style={{ color: 'var(--hazu-text-muted)' }}>Aucun mandat attendu à ce jour.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left" style={{ color: 'var(--hazu-text-light)' }}>
            <th className="py-2 pr-3 font-medium">Sem.</th>
            <th className="py-2 pr-3 font-medium">Mandat</th>
            <th className="py-2 pr-3 font-medium text-right">Concerné·es</th>
            <th className="py-2 pr-3 font-medium" title="importé / concerné·es">Importé</th>
            <th className="py-2 font-medium" title="évalué par un tiers / concerné·es dont l’évaluation est connue">Évalué par un tiers</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.semester}|${r.mandate}`} className="border-t" style={{ borderColor: 'var(--hazu-border)' }}>
              <td className="py-2 pr-3" style={{ color: 'var(--hazu-text-light)' }}>S{r.semester}</td>
              <td className="py-2 pr-3" style={{ color: 'var(--hazu-text)' }}>
                <span className="font-medium">{r.mandate}</span> {r.title}
              </td>
              <td className="py-2 pr-3 text-right" style={{ color: 'var(--hazu-text)' }}>{r.concerned}</td>
              <td className="py-2 pr-3"><Meter rate={shareOf(r.imported, r.concerned)} detail={`${r.imported}/${r.concerned}`} color="#2a78d6" /></td>
              <td className="py-2"><Meter rate={shareOf(r.tiers, r.assessable)} detail={`${r.tiers}/${r.assessable}`} color="#1baf7a" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A one-part meter of a rate with its formatted value; an unknown rate shows an empty track and « — ». */
function Meter({ rate, detail, color }: { rate: number | null; detail?: string; color: string }) {
  return (
    <div className="flex items-center gap-2 min-w-[140px]" title={detail}>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#ececec' }}>
        {rate !== null && <div className="h-full" style={{ width: `${rate * 100}%`, backgroundColor: color }} />}
      </div>
      <span className="w-12 text-right tabular-nums" style={{ color: 'var(--hazu-text)' }}>{formatRate(rate)}</span>
    </div>
  );
}

export default MandateTable;
