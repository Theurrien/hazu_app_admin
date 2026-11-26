import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnMapping } from '../ColumnMappingDropdown';
import { DataPreviewTable } from '../DataPreviewTable';
import { columnsReady, controleColumns, resetForNewFile, type ControleState } from './controle-logic';

interface FileData {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
}

interface ControleTabProps {
  fileData: FileData | null;
}

const STEPS: Array<{ n: 1 | 2 | 3; mark: string; label: string }> = [
  { n: 1, mark: '①', label: 'Colonnes' },
  { n: 2, mark: '②', label: 'Correspondances' },
  { n: 3, mark: '③', label: 'Résultats' },
];

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className="flex items-center gap-6 text-sm">
      {STEPS.map((s) => (
        <li
          key={s.n}
          className={s.n === step ? 'font-semibold text-blue-700' : s.n < step ? 'text-gray-700' : 'text-gray-400'}
        >
          {s.mark} {s.label}
        </li>
      ))}
    </ol>
  );
}

export function ControleTab({ fileData }: ControleTabProps) {
  const [state, setState] = useState<ControleState>(resetForNewFile);
  // Bumped on every file change; later steps use it to discard reloads that finish after the file changed.
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    setState(resetForNewFile());
  }, [fileData]);

  const ready = useMemo(() => columnsReady(controleColumns(state.mappings)), [state.mappings]);

  const handleMappingChange = (header: string, mapping: ColumnMapping | null) => {
    setState((prev) => {
      const mappings = { ...prev.mappings };
      if (mapping) mappings[header] = mapping;
      else delete mappings[header];
      return { ...prev, mappings };
    });
  };

  if (!fileData) {
    return <p className="text-sm text-gray-500">Chargez d'abord un fichier.</p>;
  }

  return (
    <div className="space-y-6">
      <Stepper step={state.step} />

      {state.step === 1 && (
        <>
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Colonnes</h3>
            <DataPreviewTable
              headers={fileData.headers}
              rows={fileData.rows}
              columnMappings={state.mappings}
              onColumnMappingChange={handleMappingChange}
              mode="controle"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!ready.ok}
              onClick={() => setState((prev) => ({ ...prev, step: 2 }))}
              className="px-4 py-2 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Continuer
            </button>
            {!ready.ok && <span className="text-sm text-gray-500">{ready.reason}</span>}
          </div>
        </>
      )}

      {state.step === 2 && <p className="text-sm text-gray-500">Correspondances — à venir</p>}
    </div>
  );
}
