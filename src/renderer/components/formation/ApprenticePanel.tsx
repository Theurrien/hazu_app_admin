import React, { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowUpRightFromSquare, faTriangleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { FormationStudent } from '../../../shared/formation-types';
import {
  evaluationKnown, hazuUrl, kindState, latestReportLabel, panelFlags, retiredLabel, semesterLabel, semesterReportState, slotDisplay, suiviState,
} from './detail-logic';

interface ApprenticePanelProps {
  personId: string;
  /** The apprentice's flags as the drill-down lists them (including « données anciennes »). */
  flags: string[];
  onClose: () => void;
}

const LEVEL_LABEL: Record<FormationStudent['level'], string> = { cfc: 'CFC', afp: 'AFP', other: 'Autre niveau' };

const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString('fr-CH') : '—');

/** Opens a Hazu item in the browser through the app's external-link handling. */
function HazuLink({ id, label = 'Ouvrir dans Hazu' }: { id: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => { void window.electronAPI.openExternal(hazuUrl(id)); }}
      className="inline-flex items-center gap-1 text-xs hover:underline"
      style={{ color: 'var(--hazu-primary)' }}
    >
      {label} <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
    </button>
  );
}

/** Apprentice detail (spec §5.3): a side panel over the drill-down. Read-only. */
export function ApprenticePanel({ personId, flags, onClose }: ApprenticePanelProps) {
  const [student, setStudent] = useState<FormationStudent | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setStudent(undefined);
    window.electronAPI.getFormationStudent(personId)
      .then(s => { if (alive) { setStudent(s); setError(null); } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [personId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.2)' }} onClick={onClose}>
      <aside
        className="h-full w-full max-w-xl bg-white overflow-y-auto shadow-xl p-6 space-y-6"
        onClick={e => e.stopPropagation()}
        aria-label="Détail de l’apprenti·e"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold" data-person-name style={{ color: 'var(--hazu-text)' }}>
              {student ? student.name : '…'}
            </h2>
            {student && (
              <p className="text-sm" data-company-name style={{ color: 'var(--hazu-text-light)' }}>
                {[student.formationTitle ?? 'formation non reconnue', LEVEL_LABEL[student.level], student.companies.join(', ') || 'sans entreprise'].join(' · ')}
              </p>
            )}
            <div className="mt-1"><HazuLink id={personId} label="Profil — ouvrir dans Hazu" /></div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-lg" style={{ color: 'var(--hazu-text-light)' }}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        {error && <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{error}</div>}
        {student === undefined && !error && <p className="text-sm" style={{ color: 'var(--hazu-text-light)' }}>Chargement…</p>}
        {student === null && (
          <p className="text-sm" style={{ color: 'var(--hazu-text-light)' }}>Aucune lecture réussie enregistrée pour cet apprenti·e.</p>
        )}
        {student && <Body student={student} flags={panelFlags(flags, student.skippedSubtrees)} />}
      </aside>
    </div>
  );
}

function Body({ student, flags }: { student: FormationStudent; flags: string[] }) {
  const evalKnown = evaluationKnown(student);
  const suiviCompany = suiviState(student, 'company');
  const suiviCie = suiviState(student, 'cie');
  const estimated = student.startSource !== 'plan';
  return (
    <>
      {flags.length > 0 && (
        <ul className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3 space-y-0.5">
          {flags.map(f => <li key={f}><FontAwesomeIcon icon={faTriangleExclamation} className="mr-2" />{f}</li>)}
        </ul>
      )}

      <PanelSection title="Semestres">
        <p className="text-sm mb-2" style={{ color: 'var(--hazu-text-light)' }}>
          Début {fmtDate(student.startMs)}
          {estimated && <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-gray-100" title="date non saisie par l’entreprise">estimé</span>}
          {' · '}actuel : {semesterLabel(student.currentSemester)}
        </p>
        {student.semesters.length === 0 ? <Muted>Pas de semestres (autre niveau).</Muted> : (
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${student.semesters.length}, minmax(0, 1fr))` }}>
            {student.semesters.map(s => {
              const current = s.n === student.currentSemester;
              const report = semesterReportState(student, s.n);
              return (
                <div
                  key={s.n}
                  className="rounded-md p-2 text-xs"
                  style={current
                    ? { backgroundColor: 'var(--hazu-primary)', color: '#fff' }
                    : { backgroundColor: 'var(--hazu-bg-subtle)', color: 'var(--hazu-text)' }}
                >
                  <div className="font-semibold">S{s.n}</div>
                  <div>{fmtDate(s.startMs)}</div>
                  <div>{fmtDate(s.endMs)}</div>
                  {report && <div className="mt-1 italic">{latestReportLabel(report, [])}</div>}
                </div>
              );
            })}
          </div>
        )}
      </PanelSection>

      <SlotList title="Mandats Entreprise (MPE)" kind="mpe" student={student} evalKnown={evalKnown} />
      <SlotList title="Mandats CIE (MPC)" kind="mpc" student={student} evalKnown={evalKnown} />

      {student.ahead.length > 0 && (
        <PanelSection title="En avance">
          <ul className="space-y-1 text-sm">
            {student.ahead.map(c => (
              <li key={c.id} className="flex items-center justify-between gap-3">
                <span style={{ color: 'var(--hazu-text)' }}>
                  {c.kind.toUpperCase()} {c.semester !== null ? `S${c.semester}` : ''} {c.mandate ?? ''} — {c.title}
                </span>
                <HazuLink id={c.id} label="Ouvrir" />
              </li>
            ))}
          </ul>
        </PanelSection>
      )}

      {student.retired.length > 0 && (
        <PanelSection title="Retirés du plan">
          <p className="text-sm" style={{ color: 'var(--hazu-text)' }}>{student.retired.map(retiredLabel).join(', ')}</p>
        </PanelSection>
      )}

      <PanelSection title="Rapports">
        {suiviCompany !== 'ok'
          ? <Muted>Suivi entreprise {suiviCompany}.</Muted>
          : student.reports.length === 0 ? <Muted>Aucun semestre.</Muted> : (
            <ul className="space-y-1 text-sm">
              {student.reports.map(r => (
                <li key={r.semester} className="flex items-center justify-between gap-3">
                  <span style={{ color: 'var(--hazu-text)' }}>
                    S{r.semester} — {latestReportLabel(r.state, [])}{r.publishedAt ? ` le ${fmtDate(r.publishedAt)}` : ''}
                  </span>
                  {r.reportId && <HazuLink id={r.reportId} label="Ouvrir" />}
                </li>
              ))}
            </ul>
          )}
        {student.untaggedReports > 0 && (
          <p className="mt-1 text-xs" style={{ color: 'var(--hazu-text-light)' }}>{student.untaggedReports} sans semestre</p>
        )}
        <p className="mt-2 text-sm" style={{ color: 'var(--hazu-text-light)' }}>
          {suiviCie !== 'ok'
            ? `Rapports de CIE : suivi CIE ${suiviCie}`
            : `Rapports de CIE : ${student.cieReports.sent} envoyé(s) · ${student.cieReports.draft} brouillon(s)`}
        </p>
      </PanelSection>
    </>
  );
}

function SlotList({ title, kind, student, evalKnown }: { title: string; kind: 'mpe' | 'mpc'; student: FormationStudent; evalKnown: boolean }) {
  const state = kindState(student, kind);
  const slots = student[kind];
  return (
    <PanelSection title={title}>
      {state !== 'ok' && <p className="text-sm text-amber-800 mb-2">Mandats {state} — statuts inconnus.</p>}
      {student.profession === null && student.level !== 'other' ? <Muted>pas de catalogue MPE</Muted>
        : slots.length === 0 ? <Muted>Aucun mandat attendu à ce jour.</Muted> : (
          <ul className="space-y-2">
            {slots.map(s => {
              const d = slotDisplay(s.status, state === 'ok', evalKnown);
              return (
                <li key={`${s.slot.semester}|${s.slot.mandate}`} className="text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span style={{ color: 'var(--hazu-text)' }}>
                      <span style={{ color: 'var(--hazu-text-light)' }}>S{s.slot.semester}</span>{' '}
                      <span className="font-medium">{s.slot.mandate}</span> {s.slot.title}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0 text-xs" style={{ color: 'var(--hazu-text-light)' }}>
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: d.color }} />{d.label}
                    </span>
                  </div>
                  {(s.assessments.length > 0 || s.copyIds.length > 0) && (
                    <div className="ml-6 mt-0.5 space-y-0.5 text-xs" style={{ color: 'var(--hazu-text-light)' }}>
                      {s.assessments.map((a, i) => (
                        <div key={i} data-person-name>
                          {a.authorName}{a.isSelf ? ' (auto)' : ''} · {a.points} pt{a.points === 1 ? '' : 's'} · {fmtDate(a.dateMs)}
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-3">
                        {s.copyIds.map((id, i) => <HazuLink key={id} id={id} label={s.copyIds.length > 1 ? `Copie ${i + 1}` : 'Ouvrir dans Hazu'} />)}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
    </PanelSection>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--hazu-text)' }}>{title}</h3>
      {children}
    </section>
  );
}

const Muted = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm italic" style={{ color: 'var(--hazu-text-muted)' }}>{children}</p>
);

export default ApprenticePanel;
