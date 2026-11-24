// Pure display decisions of the formation drill-down and the apprentice panel — no React, no IO.
// Figures always come from the aggregate's own counts and rates; nothing is derived from a bar.
import type { Bar, CompanyRow, ReportState, StudentRaw } from '../../../shared/formation-types';
import { BAR_PARTS } from './StackedBar';

type BarKey = keyof Bar;

/** A count over its base as a ratio in 0..1; null when the base is 0. */
export function shareOf(n: number, base: number): number | null {
  return base > 0 ? n / base : null;
}

/** A company's Plan de formation cell; null = no apprentice's company Suivi could be read. */
export function planLabel(plan: CompanyRow['plan']): string {
  return plan ?? 'inconnu';
}

/** A company's reports cell. Nothing due with no Suivi read is unknown, not « 0/0 ». */
export function reportsCell(row: CompanyRow): string {
  if (row.reportsDue === 0) return row.plan === null ? '—' : 'aucun dû';
  return `${row.reportsPublished}/${row.reportsDue}`;
}

/** Company rows with an evaluation rate under 20 % are shown in the danger colour (spec §9). */
export function isDangerRate(rate: number | null): boolean {
  return rate !== null && rate < 0.2;
}

/** Current semester 0 = before the start of the apprenticeship. */
export function semesterLabel(n: number): string {
  return n === 0 ? 'avant S1' : `S${n}`;
}

const UNKNOWN_COLOR = '#ececec';
const IMPORTED_UNKNOWN_COLOR = '#9fb8d8';

/**
 * How one expected slot is shown in the panel. When the copies could not be read every slot is
 * « inconnu »; when the evaluation is unknown (timeline or identity), an imported slot is never
 * shown as evaluated — the model would otherwise call every linked item « tiers ».
 */
export function slotDisplay(status: BarKey, copiesKnown: boolean, evalKnown: boolean): { label: string; color: string } {
  if (!copiesKnown) return { label: 'inconnu', color: UNKNOWN_COLOR };
  if (!evalKnown && status !== 'manquant') return { label: 'importé, évaluation inconnue', color: IMPORTED_UNKNOWN_COLOR };
  const p = BAR_PARTS.find(x => x.key === status)!;
  return { label: p.label, color: p.color };
}

type Knowable = {
  timelineOk: boolean;
  timelineFound: boolean;
  identityKnown: boolean;
  mpeFound: boolean;
  mpcFound: boolean;
  suiviCompanyFound: boolean;
  suiviCieFound: boolean;
  failedParts: StudentRaw['failedParts'];
};

/** Same rule as the aggregate: the timeline was found and read, and the apprentice's identity is known. */
export function evaluationKnown(m: Knowable): boolean {
  return m.timelineOk && m.timelineFound && !m.failedParts.includes('timeline') && m.identityKnown && !m.failedParts.includes('acl');
}

/** Whether one mandate kind's copies were read. */
export function kindState(m: Knowable, kind: 'mpe' | 'mpc'): 'ok' | 'illisible' | 'introuvable' {
  if (m.failedParts.includes(kind)) return 'illisible';
  if (!(kind === 'mpe' ? m.mpeFound : m.mpcFound)) return 'introuvable';
  return 'ok';
}

/** Whether a Suivi was found and read (same rule as the aggregate's knownOf). */
export function suiviState(m: Knowable, which: 'company' | 'cie'): 'ok' | 'illisible' | 'introuvable' {
  if (m.failedParts.includes(which === 'company' ? 'suivi-company' : 'suivi-cie')) return 'illisible';
  if (!(which === 'company' ? m.suiviCompanyFound : m.suiviCieFound)) return 'introuvable';
  return 'ok';
}

/** A semester's company report state in the panel strip; null when none, or the company Suivi is unknown. */
export function semesterReportState(
  m: Knowable & { reports: Array<{ semester: number; state: ReportState }> }, semester: number,
): ReportState | null {
  if (suiviState(m, 'company') !== 'ok') return null;
  return m.reports.find(r => r.semester === semester)?.state ?? null;
}

/** A retired slot key « cfc-3-12 » → « S3 · 12 »; anything else is shown as is. */
export function retiredLabel(key: string): string {
  const m = /^(afp|cfc)-(\d+)-([A-Za-z0-9]+)$/.exec(key);
  return m ? `S${m[2]} · ${m[3]}` : key;
}

/** Every flag of the apprentice, plus the mandate sub-folders the read had to skip. */
export function panelFlags(flags: string[], skippedSubtrees: number): string[] {
  if (skippedSubtrees <= 0) return [...flags];
  const s = skippedSubtrees > 1 ? 's' : '';
  return [...flags, `${skippedSubtrees} sous-dossier${s} illisible${s}`];
}

const REPORT_LABEL: Record<ReportState, string> = {
  published: 'publié', draft: 'brouillon', missing: 'à faire', optional: 'facultatif', future: 'à venir',
};

/** A report state; the apprentice list's null = none due yet, or the Suivi was unreadable / not found. */
export function latestReportLabel(state: ReportState | null, flags: string[]): string {
  if (state !== null) return REPORT_LABEL[state];
  return flags.includes('suivi entreprise illisible') || flags.includes('suivi entreprise introuvable') ? 'inconnu' : '—';
}

/** The widgets' link to a Hazu item. */
export function hazuUrl(id: string): string {
  return `https://hazu.swiss/${id}`;
}
