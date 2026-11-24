import { describe, it, expect } from 'vitest';
import type { CompanyRow } from '../../../shared/formation-types';
import {
  shareOf, planLabel, reportsCell, isDangerRate, semesterLabel, slotDisplay, evaluationKnown, kindState,
  retiredLabel, panelFlags, latestReportLabel, hazuUrl, suiviState, semesterReportState,
} from './detail-logic';

const company = (o: Partial<CompanyRow> = {}): CompanyRow => ({
  id: 'co-001', title: 'Entreprise Test', students: 2, importRate: 0.5, evalRate: 0.5,
  plan: 'oui', retired: 0, reportsPublished: 1, reportsDue: 2, ...o,
});

describe('shareOf', () => {
  it('is the ratio of the two counts', () => { expect(shareOf(3, 4)).toBe(0.75); });
  it('is null on an empty base', () => { expect(shareOf(0, 0)).toBeNull(); });
});

describe('planLabel', () => {
  it('null → « inconnu »', () => { expect(planLabel(null)).toBe('inconnu'); });
  it('keeps the three known values', () => {
    expect(planLabel('oui')).toBe('oui');
    expect(planLabel('partiel')).toBe('partiel');
    expect(planLabel('non')).toBe('non');
  });
});

describe('reportsCell', () => {
  it('published / due', () => { expect(reportsCell(company())).toBe('1/2'); });
  it('nothing due and no Suivi read (plan unknown) → « — »', () => {
    expect(reportsCell(company({ plan: null, reportsDue: 0, reportsPublished: 0 }))).toBe('—');
  });
  it('nothing due with a read Suivi → « aucun dû »', () => {
    expect(reportsCell(company({ reportsDue: 0, reportsPublished: 0 }))).toBe('aucun dû');
  });
});

describe('isDangerRate', () => {
  it('under 20 % is danger', () => { expect(isDangerRate(0.19)).toBe(true); expect(isDangerRate(0)).toBe(true); });
  it('20 % and above is not', () => { expect(isDangerRate(0.2)).toBe(false); });
  it('unknown is not danger', () => { expect(isDangerRate(null)).toBe(false); });
});

describe('semesterLabel', () => {
  it('0 → before the start', () => { expect(semesterLabel(0)).toBe('avant S1'); });
  it('n → Sn', () => { expect(semesterLabel(3)).toBe('S3'); });
});

describe('slotDisplay', () => {
  it('known evaluation keeps the status', () => {
    expect(slotDisplay('tiers', true, true)).toEqual({ label: 'évalué par un tiers', color: '#1baf7a' });
    expect(slotDisplay('manquant', true, true).label).toBe('pas encore importé');
  });
  it('unknown evaluation: an imported slot is « importé, évaluation inconnue », never tiers', () => {
    expect(slotDisplay('tiers', true, false).label).toBe('importé, évaluation inconnue');
    expect(slotDisplay('encours', true, false).label).toBe('importé, évaluation inconnue');
    expect(slotDisplay('manquant', true, false).label).toBe('pas encore importé');
  });
  it('unreadable copies: every slot is « inconnu »', () => {
    expect(slotDisplay('manquant', false, true).label).toBe('inconnu');
  });
});

const st = (o: Partial<Parameters<typeof evaluationKnown>[0]> = {}) => ({
  timelineOk: true, timelineFound: true, identityKnown: true, mpeFound: true, mpcFound: true,
  suiviCompanyFound: true, suiviCieFound: true, failedParts: [] as Array<'timeline' | 'mpe' | 'mpc' | 'suivi-company' | 'suivi-cie' | 'acl'>, ...o,
});

describe('evaluationKnown', () => {
  it('needs a read timeline and a known identity', () => {
    expect(evaluationKnown(st())).toBe(true);
    expect(evaluationKnown(st({ timelineOk: false }))).toBe(false);
    expect(evaluationKnown(st({ identityKnown: false }))).toBe(false);
    expect(evaluationKnown(st({ failedParts: ['timeline'] }))).toBe(false);
  });
  it('a timeline not found is not a known evaluation', () => {
    expect(evaluationKnown(st({ timelineFound: false }))).toBe(false);
  });
});

describe('kindState', () => {
  it('ok / illisible / introuvable', () => {
    expect(kindState(st(), 'mpe')).toBe('ok');
    expect(kindState(st({ failedParts: ['mpc'] }), 'mpc')).toBe('illisible');
    expect(kindState(st({ mpeFound: false }), 'mpe')).toBe('introuvable');
  });
});

describe('suiviState', () => {
  it('ok / illisible / introuvable, per Suivi', () => {
    expect(suiviState(st(), 'company')).toBe('ok');
    expect(suiviState(st({ failedParts: ['suivi-company'] }), 'company')).toBe('illisible');
    expect(suiviState(st({ suiviCompanyFound: false }), 'company')).toBe('introuvable');
    expect(suiviState(st({ suiviCompanyFound: false }), 'cie')).toBe('ok');
    expect(suiviState(st({ failedParts: ['suivi-cie'] }), 'cie')).toBe('illisible');
    expect(suiviState(st({ suiviCieFound: false }), 'cie')).toBe('introuvable');
  });
});

describe('semesterReportState', () => {
  const reports = [{ semester: 1, state: 'missing' as const, reportId: null, publishedAt: null }];
  it('the semester report state when the company Suivi is known', () => {
    expect(semesterReportState({ ...st(), reports }, 1)).toBe('missing');
    expect(semesterReportState({ ...st(), reports }, 2)).toBeNull();
  });
  it('no state when the company Suivi is unreadable or not found', () => {
    expect(semesterReportState({ ...st({ failedParts: ['suivi-company'] }), reports }, 1)).toBeNull();
    expect(semesterReportState({ ...st({ suiviCompanyFound: false }), reports }, 1)).toBeNull();
  });
});

describe('retiredLabel', () => {
  it('slot key → semester and mandate', () => { expect(retiredLabel('cfc-3-12')).toBe('S3 · 12'); });
  it('an unusable key is shown as is', () => { expect(retiredLabel('weird')).toBe('weird'); });
});

describe('panelFlags', () => {
  it('keeps every flag and adds the skipped sub-folders', () => {
    expect(panelFlags(['identité inconnue', 'données anciennes'], 2))
      .toEqual(['identité inconnue', 'données anciennes', '2 sous-dossiers illisibles']);
  });
  it('singular, and nothing added at 0', () => {
    expect(panelFlags([], 1)).toEqual(['1 sous-dossier illisible']);
    expect(panelFlags(['timeline illisible'], 0)).toEqual(['timeline illisible']);
  });
});

describe('latestReportLabel', () => {
  it('labels the states', () => {
    expect(latestReportLabel('published', [])).toBe('publié');
    expect(latestReportLabel('draft', [])).toBe('brouillon');
    expect(latestReportLabel('missing', [])).toBe('à faire');
    expect(latestReportLabel('optional', [])).toBe('facultatif');
  });
  it('null: « inconnu » when the Suivi is unreadable, else « — »', () => {
    expect(latestReportLabel(null, ['suivi entreprise illisible'])).toBe('inconnu');
    expect(latestReportLabel(null, ['suivi entreprise introuvable'])).toBe('inconnu');
    expect(latestReportLabel(null, [])).toBe('—');
  });
});

describe('hazuUrl', () => {
  it('builds the widgets\' link', () => { expect(hazuUrl('prof-001')).toBe('https://hazu.swiss/prof-001'); });
});
