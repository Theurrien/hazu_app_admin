import React, { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { FormationDetail, FormationDetailFilters, LevelCode } from '../../../shared/formation-types';
import { StackedBar, BarLegend, formatRate } from './StackedBar';
import { MandateTable } from './MandateTable';
import { ApprenticePanel } from './ApprenticePanel';
import { isDangerRate, latestReportLabel, mpeCell, planLabel, reportsCell, semesterLabel, shareOf } from './detail-logic';

type Level = LevelCode | 'both';

const LEVELS: Array<{ value: Level; label: string }> = [
  { value: 'cfc', label: 'CFC' },
  { value: 'afp', label: 'AFP' },
  { value: 'both', label: 'les deux' },
];
const LEVEL_NAME: Record<LevelCode, string> = { cfc: 'CFC', afp: 'AFP' };

const panel = { border: '1px solid var(--hazu-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
const REPORT_PARTS = [
  { key: 'published', color: '#1baf7a', label: 'publié' },
  { key: 'draft', color: '#eda100', label: 'brouillon' },
  { key: 'missing', color: '#d3d1c7', label: 'manquant' },
] as const;

interface FormationDetailViewProps {
  formationKey: string;
  title: string;
  hasCatalogue: boolean;
  level: Level;
  onLevelChange: (level: Level) => void;
  onBack: () => void;
  /** Changes when the stored data changes (a finished sync): the detail reloads. */
  dataVersion: number | null;
}

/** Formation drill-down (spec §5.2), in the spec's order. Read-only. */
export function FormationDetailView({ formationKey, title, hasCatalogue, level, onLevelChange, onBack, dataVersion }: FormationDetailViewProps) {
  const [filters, setFilters] = useState<FormationDetailFilters>({});
  const [detail, setDetail] = useState<FormationDetail | null>(null);
  const [base, setBase] = useState<FormationDetail | null>(null); // unfiltered, for the filter options
  const [error, setError] = useState<string | null>(null);
  const [classTitles, setClassTitles] = useState<Map<string, string>>(new Map());
  const [classesOf, setClassesOf] = useState<Map<string, string[]>>(new Map());
  const [open, setOpen] = useState<{ personId: string; flags: string[] } | null>(null);

  // Filters belong to one level: a company or class of CFC may have no AFP apprentice.
  const changeLevel = (l: Level) => { setFilters({}); onLevelChange(l); };

  const filtered = filters.classId !== undefined || filters.companyId !== undefined || filters.semester !== undefined;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const unfiltered = await window.electronAPI.getFormationDetail(formationKey, level, {});
        const d = filtered ? await window.electronAPI.getFormationDetail(formationKey, level, filters) : unfiltered;
        if (!alive) return;
        setBase(unfiltered);
        setDetail(d);
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formationKey, level, filters, dataVersion]);

  // Class options: the class rooms of the formation's apprentices, from the synced assignments.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [rooms, assignments] = await Promise.all([window.electronAPI.getRooms('class'), window.electronAPI.getAllAssignments()]);
      if (!alive) return;
      const titles = new Map<string, string>(rooms.map((r: { id: string; title: string }) => [r.id, r.title]));
      const of = new Map<string, string[]>();
      for (const a of assignments) {
        if (!titles.has(a.room_id)) continue;
        if (!of.has(a.person_id)) of.set(a.person_id, []);
        of.get(a.person_id)!.push(a.room_id);
      }
      setClassTitles(titles);
      setClassesOf(of);
    })().catch(() => { /* no class filter options; the rest of the page is unaffected */ });
    return () => { alive = false; };
  }, [dataVersion]);

  const options = useMemo(() => {
    if (!base) return { classes: [], companies: [], semesters: [] };
    const classIds = new Set(base.students.flatMap(s => classesOf.get(s.personId) ?? []));
    const classes = [...classIds].map(id => ({ id, title: classTitles.get(id) ?? id })).sort((a, b) => a.title.localeCompare(b.title));
    const companies = base.companies.filter(c => c.id !== null).map(c => ({ id: c.id as string, title: c.title }));
    const semesters = [...new Set(base.students.map(s => s.currentSemester))].sort((a, b) => a - b);
    return { classes, companies, semesters };
  }, [base, classesOf, classTitles]);

  const tableNote = level === 'both'
    ? `Niveau ${LEVEL_NAME[detail?.tableLevel ?? 'cfc']} affiché — les catalogues diffèrent par niveau.`
    : null;

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="text-sm flex items-center gap-2" style={{ color: 'var(--hazu-primary)' }}>
        <FontAwesomeIcon icon={faArrowLeft} /> Retour
      </button>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="text-xl font-semibold" style={{ color: 'var(--hazu-text)' }}>{title}</h2>
          <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--hazu-border)' }}>
            {LEVELS.map(l => (
              <button
                key={l.value}
                type="button"
                onClick={() => changeLevel(l.value)}
                className="px-3 py-1 text-sm"
                style={level === l.value
                  ? { backgroundColor: 'var(--hazu-primary)', color: '#fff' }
                  : { backgroundColor: '#fff', color: 'var(--hazu-text)' }}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <FilterSelect label="Classe" value={filters.classId ?? ''} options={options.classes.map(c => ({ value: c.id, label: c.title }))}
            onChange={v => setFilters(f => ({ ...f, classId: v || undefined }))} />
          <FilterSelect label="Entreprise" value={filters.companyId ?? ''} options={options.companies.map(c => ({ value: c.id, label: c.title }))}
            onChange={v => setFilters(f => ({ ...f, companyId: v || undefined }))} />
          <FilterSelect label="Semestre" value={filters.semester === undefined ? '' : String(filters.semester)}
            options={options.semesters.map(n => ({ value: String(n), label: semesterLabel(n) }))}
            onChange={v => setFilters(f => ({ ...f, semester: v === '' ? undefined : Number(v) }))} />
        </div>
      </div>

      {error && <div className="p-4 rounded-lg bg-red-50 text-red-800 text-sm">{error}</div>}
      {!detail && !error && <p className="text-sm" style={{ color: 'var(--hazu-text-light)' }}>Chargement…</p>}

      {detail && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <Tile title="Import" value={formatRate(detail.importRate)} />
            <Tile title="Évalués par un tiers" value={formatRate(detail.evalRate)} />
            <Tile title="Début saisi" value={formatRate(detail.startEnteredShare)} note="sinon estimé" />
            <Tile title="Entreprises sans éval. tiers" value={`${detail.companiesWithoutTiers.count}/${detail.companiesWithoutTiers.total}`} />
          </div>

          <BarLegend />

          <Section title="Progression par semestre">
            {!hasCatalogue ? <NoCatalogue /> : detail.bySemester.length === 0 ? <Empty /> : (
              <div className="space-y-2">
                {detail.bySemester.map(s => (
                  <div key={s.semester} className="grid items-center gap-3 text-sm" style={{ gridTemplateColumns: '5rem 6rem 1fr' }}>
                    <span style={{ color: 'var(--hazu-text)' }}>{semesterLabel(s.semester)}</span>
                    <span style={{ color: 'var(--hazu-text-light)' }}>{s.students} appr.</span>
                    <StackedBar bar={s.bar} />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Mandats Entreprise (MPE)" note={hasCatalogue ? tableNote : null}>
            {hasCatalogue ? <MandateTable rows={detail.mpe} /> : <NoCatalogue />}
          </Section>

          <Section title="Mandats CIE (MPC)" note={tableNote}>
            <MandateTable rows={detail.mpc} />
            <p className="mt-3 text-sm" style={{ color: 'var(--hazu-text-light)' }}>
              Rapports de CIE : {detail.cieReports.sent} envoyé{detail.cieReports.sent > 1 ? 's' : ''} · {detail.cieReports.draft} brouillon{detail.cieReports.draft > 1 ? 's' : ''}
            </p>
          </Section>

          <Section title="Entreprises formatrices">
            {detail.companies.length === 0 ? <Empty /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left" style={{ color: 'var(--hazu-text-light)' }}>
                      <th className="py-2 pr-3 font-medium">Entreprise</th>
                      <th className="py-2 pr-3 font-medium text-right">Appr.</th>
                      <th className="py-2 pr-3 font-medium">Import</th>
                      <th className="py-2 pr-3 font-medium">Éval. tiers</th>
                      <th className="py-2 pr-3 font-medium">Plan</th>
                      <th className="py-2 pr-3 font-medium text-right">Retirés</th>
                      <th className="py-2 font-medium text-right" title="publiés / dus">Rapports</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.companies.map(c => {
                      const danger = isDangerRate(c.evalRate);
                      return (
                        <tr key={c.id ?? 'none'} className={`border-t ${danger ? 'text-red-700 bg-red-50' : ''}`} style={{ borderColor: 'var(--hazu-border)' }}>
                          <td className="py-2 pr-3" style={danger ? undefined : { color: 'var(--hazu-text)' }}>{c.title}</td>
                          <td className="py-2 pr-3 text-right">{c.students}</td>
                          <td className="py-2 pr-3 tabular-nums">{formatRate(c.importRate)}</td>
                          <td className="py-2 pr-3 tabular-nums font-medium">{formatRate(c.evalRate)}</td>
                          <td className="py-2 pr-3">{planLabel(c.plan)}</td>
                          <td className="py-2 pr-3 text-right">{c.retired}</td>
                          <td className="py-2 text-right tabular-nums">{reportsCell(c)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Rapports de formation">
            {detail.reportsBySemester.length === 0 ? <Empty /> : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm" style={{ color: 'var(--hazu-text-light)' }}>
                  {REPORT_PARTS.map(p => (
                    <span key={p.key} className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: p.color }} />{p.label}
                    </span>
                  ))}
                </div>
                {detail.reportsBySemester.map(r => {
                  const total = r.published + r.draft + r.missing;
                  return (
                    <div key={r.semester} className="grid items-center gap-3 text-sm" style={{ gridTemplateColumns: '5rem 1fr 9rem' }}>
                      <span style={{ color: 'var(--hazu-text)' }}>S{r.semester}</span>
                      <div className="flex h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: '#ececec' }}
                        title={`publié : ${r.published}\nbrouillon : ${r.draft}\nmanquant : ${r.missing}`}>
                        {total > 0 && REPORT_PARTS.map(p => r[p.key] > 0 && (
                          <div key={p.key} style={{ width: `${(r[p.key] / total) * 100}%`, backgroundColor: p.color }} />
                        ))}
                      </div>
                      <span className="tabular-nums" style={{ color: 'var(--hazu-text-light)' }}>
                        {formatRate(shareOf(r.published, total))} publiés
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title={`Apprenti·es (${detail.students.length})`}>
            {detail.students.length === 0 ? <Empty /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left" style={{ color: 'var(--hazu-text-light)' }}>
                      <th className="py-2 pr-3 font-medium">Nom</th>
                      <th className="py-2 pr-3 font-medium">Entreprise</th>
                      <th className="py-2 pr-3 font-medium">Sem.</th>
                      <th className="py-2 pr-3 font-medium w-48">MPE</th>
                      <th className="py-2 pr-3 font-medium">Rapport</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.students.map(s => (
                      <tr
                        key={s.personId}
                        onClick={() => setOpen({ personId: s.personId, flags: s.flags })}
                        className="border-t cursor-pointer hover:bg-gray-50"
                        style={{ borderColor: 'var(--hazu-border)' }}
                      >
                        <td className="py-2 pr-3" data-person-name style={{ color: 'var(--hazu-text)' }}>{s.name}</td>
                        <td className="py-2 pr-3" data-company-name style={{ color: 'var(--hazu-text-light)' }}>{s.company}</td>
                        <td className="py-2 pr-3" style={{ color: 'var(--hazu-text-light)' }}>{semesterLabel(s.currentSemester)}</td>
                        <td className="py-2 pr-3">{mpeCell(hasCatalogue, s.level) === 'bar' ? <StackedBar bar={s.bar} height={8} /> : <span className="italic" style={{ color: 'var(--hazu-text-muted)' }}>—</span>}</td>
                        <td className="py-2 pr-3" style={{ color: 'var(--hazu-text)' }}>{latestReportLabel(s.latestReport, s.flags)}</td>
                        <td className="py-2">
                          {s.flags.length > 0 && (
                            <span className="text-amber-700 text-xs flex items-center gap-1" title={s.flags.join('\n')}>
                              <FontAwesomeIcon icon={faTriangleExclamation} /> {s.flags.length}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}

      {open && <ApprenticePanel personId={open.personId} flags={open.flags} onClose={() => setOpen(null)} />}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: {
  label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="rounded-lg px-2 py-1 bg-white max-w-[14rem]"
      style={{ border: '1px solid var(--hazu-border)', color: 'var(--hazu-text)' }}
    >
      <option value="">{label} : toutes</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Section({ title, note, children }: { title: string; note?: string | null; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl p-5" style={panel}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="text-base font-semibold" style={{ color: 'var(--hazu-text)' }}>{title}</h3>
        {note && <span className="text-xs" style={{ color: 'var(--hazu-text-light)' }}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Tile({ title, value, note }: { title: string; value: string; note?: string }) {
  return (
    <div className="bg-white rounded-xl p-5" style={panel}>
      <p className="text-sm font-medium" style={{ color: 'var(--hazu-text-light)' }}>{title}</p>
      <p className="text-3xl font-semibold mt-1" style={{ color: 'var(--hazu-text)' }}>{value}</p>
      {note && <p className="text-xs mt-1" style={{ color: 'var(--hazu-text-muted)' }}>{note}</p>}
    </div>
  );
}

const NoCatalogue = () => <p className="text-sm italic" style={{ color: 'var(--hazu-text-muted)' }}>pas de catalogue MPE</p>;
const Empty = () => <p className="text-sm italic" style={{ color: 'var(--hazu-text-muted)' }}>Aucune donnée.</p>;

export default FormationDetailView;
