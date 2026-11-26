import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LevelChangeCandidates,
  LevelChangeOutcome,
  LevelChangeStudent,
} from '../../../shared/level-change-types';
import { useTaskQueue } from '../../contexts/TaskQueueContext';
import { eligibility, hasApplicableChange, levelLabel, searchStudents } from './level-change-logic';

const panel = { border: '1px solid var(--hazu-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Preview {
  studentId: string;
  templateId: string;
  outcome: LevelChangeOutcome;
}

/** « Changement de niveau » — move a student between CFC and AFP (spec: level-change-design). */
function LevelChangeSection() {
  const { addLevelChangeTask } = useTaskQueue();
  const [students, setStudents] = useState<LevelChangeStudent[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<LevelChangeStudent | null>(null);
  const [candidates, setCandidates] = useState<LevelChangeCandidates | null>(null);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [queued, setQueued] = useState(false);
  const [applyFailed, setApplyFailed] = useState(false);
  // The student the answers on screen must belong to; late answers for another one are dropped.
  const selectedRef = useRef<string | null>(null);

  const loadStudents = useCallback(async () => {
    try {
      setStudents(await window.electronAPI.getLevelChangeStudents());
      setListError(null);
    } catch (e) {
      setListError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  const results = useMemo(() => searchStudents(students, query), [students, query]);

  const pick = async (s: LevelChangeStudent) => {
    selectedRef.current = s.id;
    setSelected(s);
    setCandidates(null);
    setCandidatesError(null);
    setTemplateId('');
    setPreview(null);
    setQueued(false);
    setApplyFailed(false);
    try {
      const c = await window.electronAPI.getLevelChangeCandidates(s.id);
      if (selectedRef.current !== s.id) return;
      setCandidates(c);
      setTemplateId(c.preselectedId ?? '');
    } catch (e) {
      if (selectedRef.current !== s.id) return;
      setCandidatesError(errMsg(e));
    }
  };

  const changeTemplate = (id: string) => {
    setTemplateId(id);
    setPreview(null);
  };

  const runPreview = async () => {
    if (!selected || !candidates || !templateId) return;
    const studentId = selected.id;
    const tpl = templateId;
    setPreviewing(true);
    setPreview(null);
    setApplyFailed(false);
    try {
      const outcome = await window.electronAPI.planLevelChange(studentId, candidates.toLevel, tpl);
      if (selectedRef.current !== studentId) return;
      setPreview({ studentId, templateId: tpl, outcome });
    } catch (e) {
      if (selectedRef.current !== studentId) return;
      setPreview({
        studentId,
        templateId: tpl,
        outcome: { success: false, dryRun: true, plan: null, applied: 0, remaining: [], ignored: [], error: errMsg(e) },
      });
    } finally {
      setPreviewing(false);
    }
  };

  const plan = preview?.outcome.plan ?? null;
  const previewCurrent = !!preview && !!selected && preview.studentId === selected.id && preview.templateId === templateId;
  const hasChange = hasApplicableChange(plan);
  const canApply = previewCurrent && !preview!.outcome.error && hasChange && !queued;

  const apply = () => {
    if (!selected || !candidates || !canApply) return;
    setQueued(true);
    setApplyFailed(false);
    addLevelChangeTask({
      personId: selected.id,
      displayName: selected.displayName,
      toLevel: candidates.toLevel,
      targetTemplateId: templateId,
      onDone: () => {
        void loadStudents();
        if (selectedRef.current === selected.id) {
          selectedRef.current = null;
          setSelected(null);
          setCandidates(null);
          setPreview(null);
          setTemplateId('');
          setQueued(false);
        }
      },
      onError: () => {
        if (selectedRef.current === selected.id) {
          setQueued(false);
          setApplyFailed(true);
        }
      },
    });
  };

  const localColourDiffers =
    !!plan && !!selected?.color && selected.color.toUpperCase() !== plan.colorFrom.toUpperCase();

  return (
    <section className="bg-white rounded-xl p-6 space-y-4" style={panel}>
      <div>
        <h2 className="text-lg font-semibold">Changement de niveau</h2>
        <p className="text-sm text-gray-500">Faire passer un élève de CFC à AFP, ou de AFP à CFC.</p>
      </div>

      {listError && <p className="text-sm text-red-600">{listError}</p>}

      <div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un élève (2 lettres minimum)"
          className="w-full px-3 py-2 border rounded-lg text-sm"
          style={{ borderColor: 'var(--hazu-border)' }}
        />
        {results.length > 0 && (
          <ul className="mt-2 max-h-56 overflow-auto divide-y rounded-lg" style={{ border: '1px solid var(--hazu-border)' }}>
            {results.map((s) => {
              const el = eligibility(s);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={!el.ok}
                    onClick={() => void pick(s)}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                      el.ok ? 'hover:bg-gray-50' : 'text-gray-400 cursor-not-allowed'
                    } ${selected?.id === s.id ? 'bg-gray-100' : ''}`}
                  >
                    <span>{s.displayName}</span>
                    <span className="text-xs">{el.ok ? levelLabel(s.level!) : el.reason}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {query.trim().length >= 2 && results.length === 0 && (
          <p className="mt-2 text-sm text-gray-500">Aucun élève trouvé.</p>
        )}
      </div>

      {selected && (
        <div className="space-y-3 pt-2" style={{ borderTop: '1px solid var(--hazu-border)' }}>
          <p className="text-sm font-medium">{selected.displayName}</p>
          {candidatesError && <p className="text-sm text-red-600">{candidatesError}</p>}
          {candidates && (
            <>
              <p className="text-sm">
                {levelLabel(candidates.currentLevel)} → {levelLabel(candidates.toLevel)}
              </p>
              <label className="block text-sm">
                <span className="text-gray-600">Modèle</span>
                <select
                  value={templateId}
                  onChange={(e) => changeTemplate(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border rounded-lg text-sm bg-white"
                  style={{ borderColor: 'var(--hazu-border)' }}
                >
                  {candidates.preselectedId === null && <option value="">choisir un modèle</option>}
                  {candidates.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void runPreview()}
                  disabled={!templateId || previewing}
                  className="px-4 py-2 rounded-lg text-sm border disabled:opacity-50"
                  style={{ borderColor: 'var(--hazu-border)' }}
                >
                  {previewing ? 'Calcul…' : 'Aperçu'}
                </button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={!canApply}
                  className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--hazu-primary)' }}
                >
                  Appliquer
                </button>
              </div>
              {!previewCurrent && !previewing && !applyFailed && (
                <p className="text-sm text-gray-500">Faites d'abord un aperçu — « Appliquer » s'active ensuite.</p>
              )}
              {applyFailed && (
                <p className="text-sm text-red-600">Échec — voir la file des tâches, puis refaire l'aperçu.</p>
              )}
            </>
          )}

          {previewCurrent && preview && (
            <div className="rounded-lg bg-gray-50 p-4 text-sm space-y-3">
              {preview.outcome.error && <p className="text-red-600">{preview.outcome.error}</p>}
              {plan && (
                <>
                  <div>
                    <p className="font-medium">Modèles consultés</p>
                    <ul className="list-disc ml-5">
                      {plan.templates.map((t) => (
                        <li key={t.id}>{t.title}</li>
                      ))}
                    </ul>
                  </div>

                  {!hasChange && (
                    <p className="text-gray-600">Aucun changement à appliquer.</p>
                  )}

                  {plan.sections.map((s) => (
                    <div key={s.sectionId}>
                      <p className="font-medium">{s.title}</p>
                      <ul className="ml-5 space-y-0.5">
                        {s.addTags.map((t) => (
                          <li key={`+${t}`} className="text-green-700 font-mono text-xs">+ {t}</li>
                        ))}
                        {s.removeTags.map((t) => (
                          <li key={`-${t}`} className="text-red-700 font-mono text-xs">− {t}</li>
                        ))}
                        {s.description && <li>description remplacée</li>}
                        {s.descriptionKept && <li className="text-gray-600">modifiée à la main — non changée</li>}
                      </ul>
                    </div>
                  ))}

                  {plan.profileOnly.length > 0 && (
                    <p>
                      <span className="font-medium">Sections seulement dans le profil : </span>
                      {plan.profileOnly.join(', ')}
                    </p>
                  )}
                  {plan.templateOnly.length > 0 && (
                    <p>
                      <span className="font-medium">Sections seulement dans le modèle : </span>
                      {plan.templateOnly.join(', ')}
                    </p>
                  )}

                  {plan.noSourceCounterpart.length > 0 && (
                    <p>
                      <span className="font-medium">Sections sans équivalent dans le modèle actuel — non changées : </span>
                      {plan.noSourceCounterpart.join(', ')}
                    </p>
                  )}

                  {plan.colorChange && (
                    <p>
                      <span className="font-medium">Couleur : </span>
                      {plan.colorFrom} → {plan.colorTo}
                    </p>
                  )}
                  {localColourDiffers && <p className="text-amber-700">couleur locale différente de Hazu</p>}

                  <p className="text-gray-600">
                    Les classes et rôles ne changent pas — déplacez l'élève dans Matrix.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default LevelChangeSection;
