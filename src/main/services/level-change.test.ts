import { describe, it, expect } from 'vitest';
import {
  levelOfColor, studentTemplates, pickV3, sectionKey, normDesc, tagFamily, buildPlan,
  templatesFor, otherLevel, LEVEL_COLORS, STUDENT_TEMPLATE_TAG,
  type LcNode, type TemplateTree,
} from './level-change';

const CFC = '#1A237E';
const AFP = '#9AD9EA';
const fam = 'hz-config-skills-enable-';
const id20 = (c: string) => c.repeat(20);

function node(p: Partial<LcNode> & { id: string; title: string }): LcNode {
  return { parentId: null, description: '', tags: [], icon: 'fa-x', color: '#111111', ...p };
}
function tree(id: string, children: LcNode[], color = CFC): TemplateTree {
  return { ref: node({ id, title: id, color }), children };
}
function plan(opts: {
  profile?: LcNode[]; target?: LcNode[]; source?: LcNode[]; others?: LcNode[][]; color?: string; toLevel?: 'cfc' | 'afp';
}) {
  return buildPlan({
    profile: node({ id: 'P', title: 'p', color: opts.color ?? CFC }),
    profileChildren: opts.profile ?? [],
    toLevel: opts.toLevel ?? 'afp',
    target: tree('T', opts.target ?? [], AFP),
    source: tree('S', opts.source ?? [], CFC),
    sourceOthers: (opts.others ?? []).map((c, i) => tree('O' + i, c, CFC)),
  });
}
const sec = (id: string, over: Partial<LcNode> = {}) => node({ id, title: 'Sec', ...over });

describe('basics', () => {
  it('levelOfColor', () => {
    expect(levelOfColor('#1A237E')).toBe('cfc');
    expect(levelOfColor('#1a237e')).toBe('cfc');
    expect(levelOfColor('#9AD9EA')).toBe('afp');
    expect(levelOfColor('#C85E00')).toBeNull();
    expect(levelOfColor(null)).toBeNull();
    expect(LEVEL_COLORS).toEqual({ cfc: CFC, afp: AFP });
    expect(otherLevel('cfc')).toBe('afp');
  });
  it('studentTemplates', () => {
    const kids = [
      node({ id: 'root', title: 'root', tags: [STUDENT_TEMPLATE_TAG] }),
      node({ id: 'tpl', title: 't', tags: [STUDENT_TEMPLATE_TAG] }),
      node({ id: 'folder', title: 'f' }),
      node({ id: 'room', title: 'r', tags: ['hz-config-room-class'] }),
    ];
    expect(studentTemplates('root', kids).map(n => n.id)).toEqual(['tpl']);
  });
  it('templatesFor', () => {
    const a = node({ id: 'a', title: 'a', icon: 'fa-carrot', color: CFC });
    const b = node({ id: 'b', title: 'b', icon: 'fa-carrot', color: AFP });
    const c = node({ id: 'c', title: 'c', icon: 'fa-glass', color: AFP });
    expect(templatesFor([a, b, c], 'fa-carrot', 'afp').map(n => n.id)).toEqual(['b']);
  });
  it('pickV3', () => {
    const n = (...t: string[]) => t.map((title, i) => node({ id: 'id' + i, title }));
    expect(pickV3(n('M- Apprenti CUI CFC v3', 'M- Apprenti CUI CFC v2'))).toBe('id0');
    expect(pickV3(n('A v3', 'B v3'))).toBeNull();
    expect(pickV3(n('A v30'))).toBeNull();
    expect(pickV3(n('A v2'))).toBeNull();
    expect(pickV3(n('<p>M - Apprenti·e RES CFC&nbsp;v3</p>'))).toBe('id0');
  });
  it('sectionKey', () => {
    expect(sectionKey({ title: 'CIE - Suivi&nbsp;', icon: 'fa-info', color: '#9ad9ea' }))
      .toBe(sectionKey({ title: '<b>cie - suivi</b>', icon: 'fa-info', color: '#9AD9EA' }));
  });
  it('normDesc', () => {
    expect(normDesc('')).toBe(normDesc('<p><br></p>'));
    expect(normDesc('  <p><br></p>\n')).toBe(normDesc(''));
    expect(normDesc('<p>a  b</p>\n')).toBe(normDesc('<p>a b</p>'));
  });
  it('tagFamily', () => {
    expect(tagFamily('hz-config-skills-enable-Y9sz6viZhHOvYKOEf9XX')).toBe(fam);
    expect(tagFamily('hz-config-suivi-cie')).toBeNull();
  });
});

describe('buildPlan tags', () => {
  it('skills swap, extra untouched', () => {
    const sk = (x: string) => fam + id20(x);
    const p = plan({
      source: [sec('s', { tags: ['A', sk('S')] })],
      target: [sec('t', { tags: ['A', sk('T')] })],
      profile: [sec('p', { tags: ['A', sk('S'), 'extra'] })],
    });
    expect(p.sections).toHaveLength(1);
    expect(p.sections[0].sectionId).toBe('p');
    expect(p.sections[0].addTags).toEqual([sk('T')]);
    expect(p.sections[0].removeTags).toEqual([sk('S')]);
  });
  it('per-student tag kept', () => {
    const c = (x: string) => 'hz-config-carnet-' + id20(x);
    const p = plan({
      source: [sec('s', { tags: [c('S')] })],
      target: [sec('t', { tags: [c('T')] })],
      profile: [sec('p', { tags: [c('P')] })],
    });
    expect(p.sections).toEqual([]);
  });
  it('unpaired add and remove', () => {
    const p = plan({
      source: [sec('s', { tags: ['hz-config-y'] })],
      target: [sec('t', { tags: ['hz-config-x'] })],
      profile: [sec('p', { tags: ['hz-config-y'] })],
    });
    expect(p.sections[0].addTags).toEqual(['hz-config-x']);
    expect(p.sections[0].removeTags).toEqual(['hz-config-y']);
  });
  it('other source version removed', () => {
    const sk = (x: string) => fam + id20(x);
    const p = plan({
      source: [sec('s', { tags: [sk('S')] })],
      others: [[sec('o', { tags: [sk('O')] })]],
      target: [sec('t', { tags: [sk('T')] })],
      profile: [sec('p', { tags: [sk('O')] })],
    });
    expect(p.sections[0].addTags).toEqual([sk('T')]);
    expect(p.sections[0].removeTags).toEqual([sk('O')]);
  });
});

describe('buildPlan descriptions', () => {
  const mk = (pd: string, sd = '<p>S</p>', td = '<p>T</p>') => plan({
    source: [sec('s', { description: sd })],
    target: [sec('t', { description: td })],
    profile: [sec('p', { description: pd })],
  });
  it('replaced when profile equals source', () => {
    const p = mk('<p>S</p>');
    expect(p.sections[0].description).toEqual({ from: '<p>S</p>', to: '<p>T</p>' });
    expect(p.sections[0].descriptionKept).toBe(false);
  });
  it('hand-edited kept', () => {
    const p = mk('<p>mine</p>');
    expect(p.sections[0].description).toBeNull();
    expect(p.sections[0].descriptionKept).toBe(true);
  });
  it('already target: no change', () => {
    expect(mk('<p>T</p>').sections).toEqual([]);
  });
  it('empty target written as empty paragraph', () => {
    expect(mk('<p>S</p>', '<p>S</p>', '').sections[0].description?.to).toBe('<p><br></p>');
  });
  it('same source and target, hand-edited: no change', () => {
    const p = mk('<p>mine</p>', '<p>Z</p>', '<p>Z</p>');
    expect(p.sections).toEqual([]);
  });
});

describe('buildPlan structure', () => {
  it('already done', () => {
    const sk = (x: string) => fam + id20(x);
    const p = plan({
      source: [sec('s', { tags: [sk('S')], description: '<p>S</p>' })],
      target: [sec('t', { tags: [sk('T')], description: '<p>T</p>' })],
      profile: [sec('p', { tags: [sk('T')], description: '<p>T</p>' })],
    });
    expect(p.sections).toEqual([]);
  });
  it('profileOnly, templateOnly, no source counterpart', () => {
    const p = plan({
      source: [],
      target: [node({ id: 't1', title: 'Both' }), node({ id: 't2', title: 'TplOnly' })],
      profile: [node({ id: 'p1', title: 'Both' }), node({ id: 'p2', title: 'ProfOnly' })],
    });
    expect(p.profileOnly).toEqual(['ProfOnly']);
    expect(p.templateOnly).toEqual(['TplOnly']);
    expect(p.sections).toEqual([]);
  });
  it('colour', () => {
    const a = plan({ color: CFC, toLevel: 'afp' });
    expect(a.colorChange).toBe(true);
    expect(a.colorTo).toBe(AFP);
    const b = plan({ color: AFP, toLevel: 'afp' });
    expect(b.colorChange).toBe(false);
    expect(b.fromLevel).toBe('cfc');
    expect(b.toLevel).toBe('afp');
  });
  it('templates listed', () => {
    const p = plan({ others: [[]] });
    expect(p.templates.map(t => t.role)).toEqual(['target', 'source', 'source-other']);
  });
});
