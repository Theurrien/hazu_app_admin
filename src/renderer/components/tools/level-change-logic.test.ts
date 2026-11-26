import { describe, it, expect } from 'vitest';
import {
  searchStudents, eligibility, levelLabel, hasApplicableChange, toggleTagAdd, toggleForced, toggleCopy, setDelete,
  descendantsLabel,
} from './level-change-logic';
import type { LevelChangeDecisions } from '../../../shared/level-change-decisions';
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
  const pl = (sections: SectionChange[], colorChange = false, extra: Partial<LevelChangePlan> = {}): LevelChangePlan => ({
    profileId: 'P', fromLevel: 'cfc', toLevel: 'afp', colorFrom: '#1A237E', colorTo: '#9AD9EA', colorChange,
    templates: [], sections, profileOnly: [], templateOnly: [], noSourceCounterpart: [],
    templateOnlyItems: [], profileOnlyItems: [], widget: { needed: false, profileEmpty: false }, ...extra,
  });
  const none = (): LevelChangeDecisions => ({
    acceptedTagAdds: [], forcedDescriptions: [], copySections: [], deleteSections: [], addWidget: false,
  });
  it('null plan or nothing to do', () => {
    expect(hasApplicableChange(null, none())).toBe(false);
    expect(hasApplicableChange(pl([]), none())).toBe(false);
  });
  it('a kept description unticked is not a change, ticked is', () => {
    const p = pl([sc({ descriptionKept: true, keptTargetDescription: 'x' })]);
    expect(hasApplicableChange(p, none())).toBe(false);
    expect(hasApplicableChange(p, { ...none(), forcedDescriptions: ['k'] })).toBe(true);
  });
  it('certain tags, description or colour are', () => {
    expect(hasApplicableChange(pl([sc({ addTags: ['x'] })]), none())).toBe(true);
    expect(hasApplicableChange(pl([sc({ removeTags: ['x'] })]), none())).toBe(true);
    expect(hasApplicableChange(pl([sc({ description: { from: 'a', to: 'b' } })]), none())).toBe(true);
    expect(hasApplicableChange(pl([sc({ descriptionKept: true })], true), none())).toBe(true);
  });
  it('an uncertain tag counts only when accepted', () => {
    const p = pl([sc({ uncertainTags: ['t'] })]);
    expect(hasApplicableChange(p, none())).toBe(false);
    expect(hasApplicableChange(p, { ...none(), acceptedTagAdds: [{ sectionKey: 'k', tag: 't' }] })).toBe(true);
  });
  it('a copy, a delete or the widget alone is a change', () => {
    const p = pl([]);
    expect(hasApplicableChange(p, { ...none(), copySections: ['c'] })).toBe(true);
    expect(hasApplicableChange(p, { ...none(), deleteSections: [{ sectionKey: 'd', sectionId: 'D' }] })).toBe(true);
    expect(hasApplicableChange(p, { ...none(), addWidget: true })).toBe(true);
  });
});

describe('toggles', () => {
  const d = (): LevelChangeDecisions => ({
    acceptedTagAdds: [], forcedDescriptions: [], copySections: [], deleteSections: [], addWidget: false,
  });
  it('toggleTagAdd adds then removes, without mutating', () => {
    const a = toggleTagAdd(d(), 'k', 't');
    expect(a.acceptedTagAdds).toEqual([{ sectionKey: 'k', tag: 't' }]);
    expect(d().acceptedTagAdds).toEqual([]);
    expect(toggleTagAdd(a, 'k', 't').acceptedTagAdds).toEqual([]);
  });
  it('toggleForced and toggleCopy', () => {
    expect(toggleForced(d(), 'k').forcedDescriptions).toEqual(['k']);
    expect(toggleForced(toggleForced(d(), 'k'), 'k').forcedDescriptions).toEqual([]);
    expect(toggleCopy(d(), 'c').copySections).toEqual(['c']);
    expect(toggleCopy(toggleCopy(d(), 'c'), 'c').copySections).toEqual([]);
  });
  it('setDelete adds once and removes by key', () => {
    const a = setDelete(setDelete(d(), 'k', 'S', true), 'k', 'S', true);
    expect(a.deleteSections).toEqual([{ sectionKey: 'k', sectionId: 'S' }]);
    expect(setDelete(a, 'k', 'S', false).deleteSections).toEqual([]);
  });
});

describe('descendantsLabel', () => {
  it('exact, lower bound, unknown', () => {
    expect(descendantsLabel(12, true)).toBe('12 éléments');
    expect(descendantsLabel(1, true)).toBe('1 élément');
    expect(descendantsLabel(40, false)).toBe('au moins 40');
    expect(descendantsLabel(null, false)).toBe('contenu inconnu');
  });
});
