import React, { useCallback, useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { LevelCode, SchoolOverview } from '../../shared/formation-types';
import { SyncHeader } from '../components/formation/SyncHeader';
import { FormationCard } from '../components/formation/FormationCard';
import { BarLegend, formatRate } from '../components/formation/StackedBar';

type Selected = { key: string; level: LevelCode | 'both' } | null;

const panel = { border: '1px solid var(--hazu-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };

/** Missions — school-wide overview of the apprentices' mandates and reports (spec §5.1). Read-only. */
function FormationPage() {
  const [overview, setOverview] = useState<SchoolOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [showUnclassified, setShowUnclassified] = useState(false);

  const load = useCallback(async () => {
    try {
      setOverview(await window.electronAPI.getFormationOverview());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Before the first run every apprentice is listed in `failed` (« pas encore lu »), so `failed` is not tested.
  const empty = overview !== null && overview.syncedAt === null && overview.students === 0;

  const detail = selected && overview?.formations.find(x => x.key === selected.key);

  return (
    <div className="space-y-6">
      <SyncHeader overview={overview} empty={empty} onSynced={load} />

      {loadError && <div className="p-4 rounded-lg bg-red-50 text-red-800 text-sm">{loadError}</div>}

      {/* The header stays mounted above both views, so a run's progress and its reload carry on in the drill-down. */}
      {selected ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="text-sm flex items-center gap-2"
            style={{ color: 'var(--hazu-primary)' }}
          >
            <FontAwesomeIcon icon={faArrowLeft} /> Toutes les formations
          </button>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--hazu-text)' }}>{detail ? detail.title : selected.key}</h2>
        </div>
      ) : overview && !empty && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <Tile title="Apprenti·es" value={String(overview.students)} />
            <Tile title="MPE importés" value={formatRate(overview.importRate)} />
            <Tile title="Évalués par un tiers" value={formatRate(overview.evalRate)} />
            <Tile title="Rapports publiés" value={formatRate(overview.reportsPublishedRate)} />
          </div>

          <BarLegend />

          <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {overview.formations.map(f => (
              <FormationCard key={f.key} formation={f} onSelect={() => setSelected({ key: f.key, level: 'both' })} />
            ))}
          </div>

          {overview.unclassified.length > 0 && (
            <div className="text-sm">
              <button
                type="button"
                onClick={() => setShowUnclassified(v => !v)}
                className="flex items-center gap-2 text-amber-700"
              >
                <FontAwesomeIcon icon={faTriangleExclamation} />
                {overview.unclassified.length} apprenti·e{overview.unclassified.length > 1 ? 's' : ''} à classer (formation non reconnue)
              </button>
              {showUnclassified && (
                <ul className="mt-2 ml-6 space-y-0.5" style={{ color: 'var(--hazu-text)' }}>
                  {overview.unclassified.map(u => <li key={u.personId}>{u.name}</li>)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-white rounded-xl p-5" style={panel}>
      <p className="text-sm font-medium" style={{ color: 'var(--hazu-text-light)' }}>{title}</p>
      <p className="text-3xl font-semibold mt-1" style={{ color: 'var(--hazu-text)' }}>{value}</p>
    </div>
  );
}

export default FormationPage;
