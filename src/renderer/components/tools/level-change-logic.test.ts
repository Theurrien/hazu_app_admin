import { describe, it, expect } from 'vitest';
import { searchStudents, eligibility, levelLabel, hasApplicableChange } from './level-change-logic';
import type { LevelChangePlan, LevelChangeStudent, SectionChange } from '../../../shared/level-change-types';

const st = (id: string, displayName: string, level: 'cfc' | 'afp' | null): LevelChangeStudent => ({
  id,
  displayName,
  icon: null,
  color: level === null ? '#C85E00' : '#000000',
  level,
});

describe('searchStudents', () => {
  const all = [st('1', 'Abc Def', 'cfc'), st('2', 'déf abc', 'afp'), st('3', 'Xyz Uvw', 'cfc')];
  it('matches names, accents stripped', () => {
    expect(searchStudents(all, 'ab').map((s) => s.id)).toEqual(['1', '2']);
    expect(searchStudents(all, 'def abc').map((s) => s.id)).toEqual(['1', '2']);
  });
  it('needs two characters', () => {
    expect(searchStudents(all, 'a')).toEqual([]);
    expect(searchStudents(all, '  a ')).toEqual([]);
  });
});

describe('eligibility', () => {
  it('CFC goes to AFP and back', () => {
    expect(eligibility(st('1', 'A B', 'cfc'))).toEqual({ ok: true, toLevel: 'afp' });
    expect(eligibility(st('1', 'A B', 'afp'))).toEqual({ ok: true, toLevel: 'cfc' });
  });
  it('unknown level is refused', () => {
    const r = eligibility(st('1', 'A B', null));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('niveau ni CFC ni AFP');
  });
});

describe('levelLabel', () => {
  it('upper-cases', () => {
    expect(levelLabel('cfc')).toBe('CFC');
    expect(levelLabel('afp')).toBe('AFP');
  });
});

describe('hasApplicableChange', () => {
  const sc = (over: Partial<SectionChange> = {}): SectionChange => ({
    sectionId: 's', sectionKey: 'k', title: 'S', description: null, descriptionKept: false, addTags: [], removeTags: [],
    uncertainTags: [], keptTargetDescription: null, ...over,
  });
  const pl = (sections: SectionChange[], colorChange = false): LevelChangePlan => ({
    profileId: 'P', fromLevel: 'cfc', toLevel: 'afp', colorFrom: '#1A237E', colorTo: '#9AD9EA', colorChange,
    templates: [], sections, profileOnly: [], templateOnly: [], noSourceCounterpart: [],
    templateOnlyItems: [], profileOnlyItems: [], widget: { needed: false, profileEmpty: false },
  });
  it('null plan or nothing to do', () => {
    expect(hasApplicableChange(null)).toBe(false);
    expect(hasApplicableChange(pl([]))).toBe(false);
  });
  it('a section with only descriptionKept is not a change', () => {
    expect(hasApplicableChange(pl([sc({ descriptionKept: true })]))).toBe(false);
  });
  it('tags, description or colour are', () => {
    expect(hasApplicableChange(pl([sc({ addTags: ['x'] })]))).toBe(true);
    expect(hasApplicableChange(pl([sc({ removeTags: ['x'] })]))).toBe(true);
    expect(hasApplicableChange(pl([sc({ description: { from: 'a', to: 'b' } })]))).toBe(true);
    expect(hasApplicableChange(pl([sc({ descriptionKept: true })], true))).toBe(true);
  });
});
