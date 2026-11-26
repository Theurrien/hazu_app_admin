import { describe, it, expect } from 'vitest';
import { runLevelChange, type LevelChangeDeps } from './level-change';
import {
  levelOfColor, studentTemplates, pickV3, sectionKey, normDesc, tagFamily, buildPlan,
  templatesFor, otherLevel, LEVEL_COLORS, STUDENT_TEMPLATE_TAG,
  type LcNode, type TemplateTree,
} from './level-change';
import { defaultDecisions, type LevelChangeDecisions } from '../../shared/level-change-decisions';
import type { LevelChangePlan } from '../../shared/level-change-types';
import type { AclRow, CopyNode } from './level-change-copy';

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
  profileDesc?: string; targetDesc?: string;
}) {
  const target = tree('T', opts.target ?? [], AFP);
  target.ref.description = opts.targetDesc ?? '';
  return buildPlan({
    profile: node({ id: 'P', title: 'p', color: opts.color ?? CFC, description: opts.profileDesc ?? '' }),
    profileChildren: opts.profile ?? [],
    toLevel: opts.toLevel ?? 'afp',
    target,
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
  it('counterparts exist, profile holds no tag of the family: target added', () => {
    const sk = (x: string) => fam + id20(x);
    const p = plan({
      source: [sec('s', { tags: ['A', sk('S')] })],
      target: [sec('t', { tags: ['A', sk('T')] })],
      profile: [sec('p', { tags: ['A'] })],
    });
    expect(p.sections).toHaveLength(1);
    expect(p.sections[0].addTags).toEqual([sk('T')]);
    expect(p.sections[0].removeTags).toEqual([]);
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

describe('buildPlan tag scope', () => {
  it('unpaired tag only on an older version is not removed', () => {
    const p = plan({
      source: [sec('s', { tags: ['A'] })],
      others: [[sec('o', { tags: ['A', 'hz-share-courseteacher-reader'] })]],
      target: [sec('t', { tags: ['A'] })],
      profile: [sec('p', { tags: ['A', 'hz-share-courseteacher-reader'] })],
    });
    expect(p.sections).toEqual([]);
  });
  it('family tag on source v3 with no target counterpart is removed', () => {
    const k = 'hz-config-old-' + id20('S');
    const p = plan({
      source: [sec('s', { tags: [k] })],
      target: [sec('t', { tags: [] })],
      profile: [sec('p', { tags: [k] })],
    });
    expect(p.sections[0].removeTags).toEqual([k]);
  });
  it('never a second tag of a family the profile holds', () => {
    const c = (x: string) => 'hz-config-carnet-' + id20(x);
    const p = plan({
      source: [sec('s', { tags: [] })],
      target: [sec('t', { tags: [c('T')] })],
      profile: [sec('p', { tags: [c('P')] })],
    });
    expect(p.sections).toEqual([]);
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
    expect(p.noSourceCounterpart).toEqual(['Both']);
    expect(p.sections).toEqual([]);
  });
  it('colour', () => {
    const a = plan({ color: CFC, toLevel: 'afp' });
    expect(a.colorChange).toBe(true);
    expect(a.colorTo).toBe(AFP);
    expect(a.colorFrom).toBe(CFC);
    const b = plan({ color: AFP, toLevel: 'afp' });
    expect(b.colorChange).toBe(false);
    expect(b.fromLevel).toBe('cfc');
    const c = plan({ color: '#9ad9ea', toLevel: 'afp' });
    expect(c.colorFrom).toBe('#9AD9EA');
    expect(c.colorChange).toBe(false);
    expect(c.fromLevel).toBe('cfc');
    expect(b.toLevel).toBe('afp');
  });
  it('templates listed', () => {
    const p = plan({ others: [[]] });
    expect(p.templates.map(t => t.role)).toEqual(['target', 'source', 'source-other']);
  });
});

describe('buildPlan decision additions', () => {
  const sk = (x: string) => fam + id20(x);
  it('a swap is certain; a family-absent add is uncertain', () => {
    const swap = plan({
      source: [sec('s', { tags: [sk('S')] })], target: [sec('t', { tags: [sk('T')] })], profile: [sec('p', { tags: [sk('S')] })],
    });
    expect(swap.sections[0].addTags).toEqual([sk('T')]);
    expect(swap.sections[0].uncertainTags).toEqual([]);
    expect(swap.sections[0].sectionKey).toBe('sec|fa-x|#111111');
    const absent = plan({
      source: [sec('s', { tags: [sk('S')] })], target: [sec('t', { tags: [sk('T')] })], profile: [sec('p')],
    });
    expect(absent.sections[0].uncertainTags).toEqual([sk('T')]);
    const unpaired = plan({ source: [sec('s')], target: [sec('t', { tags: [sk('T')] })], profile: [sec('p')] });
    expect(unpaired.sections[0].uncertainTags).toEqual([sk('T')]);
  });
  it('a target-only tag without a trailing id stays certain', () => {
    const p = plan({ source: [sec('s')], target: [sec('t', { tags: ['hz-plain'] })], profile: [sec('p')] });
    expect(p.sections[0].addTags).toEqual(['hz-plain']);
    expect(p.sections[0].uncertainTags).toEqual([]);
  });
  it('a kept description carries the template description it could take', () => {
    const p = plan({
      source: [sec('s', { description: '<p>S</p>' })], target: [sec('t', { description: '<p>T</p>' })],
      profile: [sec('p', { description: '<p>hand</p>' })],
    });
    expect(p.sections[0]).toMatchObject({ descriptionKept: true, keptTargetDescription: '<p>T</p>', description: null });
    const empty = plan({
      source: [sec('s', { description: '<p>S</p>' })], target: [sec('t', { description: '' })],
      profile: [sec('p', { description: '<p>hand</p>' })],
    });
    expect(empty.sections[0].keptTargetDescription).toBe('<p><br></p>');
    const none = plan({
      source: [sec('s', { description: '<p>S</p>' })], target: [sec('t', { description: '<p>T</p>' })],
      profile: [sec('p', { description: '<p>S</p>' })],
    });
    expect(none.sections[0].keptTargetDescription).toBeNull();
  });
  it('template-only and profile-only items carry keys and ids', () => {
    const p = plan({
      source: [],
      target: [node({ id: 't1', title: 'Both' }), node({ id: 't2', title: 'TplOnly' })],
      profile: [node({ id: 'p1', title: 'Both' }), node({ id: 'p2', title: 'ProfOnly' })],
    });
    expect(p.templateOnlyItems).toEqual([{ sectionKey: 'tplonly|fa-x|#111111', title: 'TplOnly', templateSectionId: 't2' }]);
    expect(p.profileOnlyItems).toEqual([
      { sectionKey: 'profonly|fa-x|#111111', title: 'ProfOnly', sectionId: 'p2', descendants: null, descendantsExact: false },
    ]);
    expect(p.profileOnly).toEqual(['ProfOnly']);
    expect(p.templateOnly).toEqual(['TplOnly']);
  });
  it('widget: needed unless the profile holds student_app.html; profileEmpty on empty descriptions', () => {
    const W = '<p>x</p><iframe src="https://h.example/student_app.html"></iframe>';
    expect(plan({ targetDesc: W, profileDesc: '' }).widget).toEqual({ needed: true, profileEmpty: true });
    expect(plan({ targetDesc: W, profileDesc: '<p><br></p>' }).widget).toEqual({ needed: true, profileEmpty: true });
    expect(plan({ targetDesc: W, profileDesc: '<p>mine</p>' }).widget).toEqual({ needed: true, profileEmpty: false });
    expect(plan({ targetDesc: W, profileDesc: W }).widget).toMatchObject({ needed: false });
    expect(plan({ targetDesc: '<p>no widget</p>', profileDesc: '' }).widget).toMatchObject({ needed: false });
  });
});

// ---------------------------------------------------------------------------------------------
describe('runLevelChange', () => {
  const ROOT = 'ROOT';
  const OLD = 'hz-config-skills-enable-' + id20('a');
  const NEW = 'hz-config-skills-enable-' + id20('b');
  const tpl = (id: string, title: string, color: string) =>
    node({ id, title, color, icon: 'fa-carrot', tags: [STUDENT_TEMPLATE_TAG], parentId: ROOT });

  function world() {
    const nodes = new Map<string, LcNode>();
    const kids = new Map<string, string[]>();
    const put = (n: LcNode, parent: string) => { nodes.set(n.id, { ...n, parentId: parent }); kids.set(parent, [...(kids.get(parent) ?? []), n.id]); };
    put(tpl('TA', 'Apprenti AFP v3', AFP), ROOT);
    put(tpl('TC', 'Apprenti CFC v3', CFC), ROOT);
    put(tpl('TC2', 'Apprenti CFC v2', CFC), ROOT);
    put(node({ id: 'P', title: 'p', color: CFC, icon: 'fa-carrot' }), 'CAT');
    put(node({ id: 'ta1', title: 'Sec', tags: [NEW], description: '<p>afp</p>' }), 'TA');
    put(node({ id: 'tc1', title: 'Sec', tags: [OLD], description: '<p>cfc</p>' }), 'TC');
    put(node({ id: 'tc21', title: 'Sec', tags: [OLD], description: '<p>cfc</p>' }), 'TC2');
    put(node({ id: 'p1', title: 'Sec', tags: [OLD], description: '<p>cfc</p>' }), 'P');
    return { nodes, kids };
  }

  type World = ReturnType<typeof world> & { acl?: Map<string, AclRow[]> };
  const toCopy = (n: LcNode): CopyNode => ({ ...n, tags: [...n.tags], type: 'hazu', privacy: null, rolesSettings: null });
  let seq = 0;
  /** CopyDeps + remove on the same fake world. A created node inherits the profile's ACL. */
  function copyDeps(w: World, calls: string[], opts: { failCreate?: string; failRemove?: boolean }) {
    const acl = (w.acl ??= new Map<string, AclRow[]>());
    const drop = (id: string) => {
      for (const k of w.kids.get(id) ?? []) drop(k);
      const n = w.nodes.get(id);
      if (n?.parentId) w.kids.set(n.parentId, (w.kids.get(n.parentId) ?? []).filter(x => x !== id));
      w.nodes.delete(id);
    };
    return {
      async readFull(id: string) { const n = w.nodes.get(id); return n ? toCopy(n) : null; },
      async listFull(pid: string) { return (w.kids.get(pid) ?? []).map(i => toCopy(w.nodes.get(i)!)); },
      async create(pid: string, from: CopyNode) {
        calls.push('create:' + from.id);
        if (opts.failCreate === from.id) throw { status: 400, networkOrTimeout: false, message: 'refusé' };
        const id = 'c' + ++seq;
        w.nodes.set(id, { id, parentId: pid, title: from.title, description: from.description, tags: [...from.tags], icon: from.icon, color: from.color });
        w.kids.set(pid, [...(w.kids.get(pid) ?? []), id]);
        acl.set(id, (acl.get('P') ?? []).map(r => ({ ...r })));
        return id;
      },
      async remove(id: string) {
        calls.push('remove:' + id);
        if (opts.failRemove) throw { status: 400, networkOrTimeout: false, message: 'refusé' };
        drop(id);
      },
      async acl(id: string) { return (acl.get(id) ?? []).map(r => ({ ...r })); },
      async setRole(item: string, principal: string, role: string) {
        calls.push('acl:' + item);
        const rows = acl.get(item) ?? [];
        const r = rows.find(x => x.authorId === principal);
        if (r) r.role = role; else rows.push({ authorId: principal, groupId: null, isGroup: false, role });
        acl.set(item, rows);
      },
      async removeFromAcl(item: string, principal: string) {
        calls.push('acl:' + item);
        acl.set(item, (acl.get(item) ?? []).filter(x => x.authorId !== principal));
      },
    };
  }

  function harness(w: World = world(), opts: {
    failList?: string; dropWrites?: boolean; failWrites?: boolean; mangleDesc?: boolean; noColor?: boolean;
    failAdd?: boolean; failCreate?: string; failRemove?: boolean; dropWidget?: boolean;
  } = {}) {
    const calls: string[] = [];
    const get = (id: string) => w.nodes.get(id)!;
    const deps: LevelChangeDeps = {
      ...copyDeps(w, calls, opts),
      async read(id) { const n = w.nodes.get(id); return n ? { ...n, tags: [...n.tags] } : null; },
      async list(pid) {
        if (opts.failList === pid) throw { networkOrTimeout: false, status: 403, message: 'interdit' };
        return (w.kids.get(pid) ?? []).map(i => ({ ...get(i), tags: [...get(i).tags] }));
      },
      async updateDescription(id, html) {
        calls.push('desc:' + id);
        if (opts.dropWidget && id === 'P') return;
        if (!opts.dropWrites) get(id).description = opts.mangleDesc ? `\n ${html.replace('><', '>\n<')} \n` : html;
        if (opts.failWrites) throw { status: 500, networkOrTimeout: false, message: 'boom' };
      },
      async updateColor(id, hex) { calls.push('color:' + id); if (!opts.noColor) get(id).color = hex; },
      async addTags(id, tags) {
        calls.push('add:' + id);
        if (opts.failAdd) throw { status: 400, networkOrTimeout: false, message: 'refusé' };
        if (!opts.dropWrites) get(id).tags.push(...tags.filter(t => !get(id).tags.includes(t)));
        if (opts.failWrites) throw { status: 500, networkOrTimeout: false, message: 'boom' };
      },
      async removeTags(id, tags) {
        calls.push('rm:' + id);
        if (!opts.dropWrites) get(id).tags = get(id).tags.filter(t => !tags.includes(t));
      },
      async sleep() {},
    };
    return { w, deps, calls, opts };
  }
  const ROLE_GROUPS = new Map([['gM', 'companymentor'], ['gT', 'schoolteacher']]);
  const NO_DECISIONS: LevelChangeDecisions = {
    acceptedTagAdds: [], forcedDescriptions: [], copySections: [], deleteSections: [], addWidget: false,
  };
  const input = (over: Record<string, unknown> = {}) =>
    ({ profileId: 'P', toLevel: 'afp' as const, targetTemplateId: 'TA', templateRootId: ROOT, dryRun: false,
       decisions: NO_DECISIONS, roleGroups: ROLE_GROUPS, studentId: 'stu' as string | null, ...over });
  /** the decisions the preview would send untouched */
  async function defaults(h: { deps: LevelChangeDeps }, over: Record<string, unknown> = {}) {
    const dry = await runLevelChange(input({ dryRun: true, ...over }), h.deps);
    return defaultDecisions(dry.plan as LevelChangePlan);
  }

  it('refuses a template node as profile (it sits in the templates folder), writing nothing', async () => {
    const h = harness();
    const out = await runLevelChange(input({ profileId: 'TC' }), h.deps);
    expect(out.success).toBe(false);
    expect(out.error).toContain('modèle');
    expect(h.calls).toEqual([]);
  });

  it('accepts a real student profile carrying the template tag (every copy of a template does)', async () => {
    const h = harness(); h.w.nodes.get('P')!.tags.push(STUDENT_TEMPLATE_TAG);
    const out = await runLevelChange(input(), h.deps);
    expect(out.error).toBeUndefined();
    expect(out.success).toBe(true);
  });

  it('refuses without writing', async () => {
    let h = harness();
    expect((await runLevelChange(input({ profileId: 'nope' }), h.deps)).error).toBe('profil introuvable');
    expect(h.calls).toEqual([]);
    h = harness(); h.w.nodes.get('P')!.color = '#C85E00';
    expect((await runLevelChange(input(), h.deps)).error).toContain('niveau');
    expect(h.calls).toEqual([]);
    h = harness();
    expect((await runLevelChange(input({ targetTemplateId: 'TC' }), h.deps)).error).toContain('modèle');
    expect(h.calls).toEqual([]);
    h = harness(); h.w.nodes.get('TC')!.title = 'Apprenti CFC';
    expect((await runLevelChange(input(), h.deps)).error).toContain('modèle source');
    expect(h.calls).toEqual([]);
  });

  it('aborts before any write when a listing throws or is empty', async () => {
    for (const id of ['P', 'TA', 'TC', 'TC2']) {
      const h = harness(world(), { failList: id });
      const o = await runLevelChange(input(), h.deps);
      expect(o.success).toBe(false);
      expect(h.calls).toEqual([]);
    }
    for (const id of ['P', 'TA', 'TC', 'TC2']) {
      const h = harness();
      h.w.kids.set(id, []);
      const o = await runLevelChange(input(), h.deps);
      expect(o.success).toBe(false);
      expect(o.error).toContain('liste vide');
      expect(h.calls).toEqual([]);
    }
  });

  it('dry run returns the plan and writes nothing', async () => {
    const h = harness();
    const o = await runLevelChange(input({ dryRun: true }), h.deps);
    expect(o.success).toBe(true);
    expect(o.plan?.sections).toHaveLength(1);
    expect(h.calls).toEqual([]);
  });

  it('happy path: tags, descriptions, colour last', async () => {
    const h = harness();
    const o = await runLevelChange(input(), h.deps);
    expect(o).toMatchObject({ success: true, applied: 2, remaining: [] });
    expect(h.calls).toEqual(['add:p1', 'rm:p1', 'desc:p1', 'color:P']);
    expect(h.w.nodes.get('p1')!.tags).toEqual([NEW]);
    expect(h.w.nodes.get('P')!.color).toBe(AFP);
  });

  it('a write failing 500 that landed counts as applied', async () => {
    const h = harness(world(), { failWrites: true });
    const o = await runLevelChange(input(), h.deps);
    expect(o.success).toBe(true);
    expect(h.calls.filter(c => c === 'add:p1')).toHaveLength(3);
  });

  it('a 2xx the read never shows fails, colour not written', async () => {
    const h = harness(world(), { dropWrites: true });
    const o = await runLevelChange(input(), h.deps);
    expect(o.success).toBe(false);
    expect(o.remaining.some(r => r.includes('Sec'))).toBe(true);
    expect(o.remaining).toContain('couleur du profil non modifiée — sections non confirmées');
    expect(h.calls.some(c => c.startsWith('color'))).toBe(false);
  });

  it('unconfirmed section with colour already target: no colour line', async () => {
    const h = harness(world(), { dropWrites: true });
    h.w.nodes.get('P')!.color = AFP;
    const o = await runLevelChange(input(), h.deps);
    expect(o.success).toBe(false);
    expect(o.remaining.some(r => r.startsWith('couleur'))).toBe(false);
  });

  it('whitespace-only description difference counts as applied', async () => {
    const h = harness(world(), { mangleDesc: true });
    expect((await runLevelChange(input(), h.deps)).success).toBe(true);
  });

  it('colour not confirmed is reported', async () => {
    const h = harness(world(), { noColor: true });
    const o = await runLevelChange(input(), h.deps);
    expect(o.success).toBe(false);
    expect(o.remaining).toContain('couleur du profil non confirmée');
  });

  it('re-run after success writes nothing', async () => {
    const h = harness();
    await runLevelChange(input(), h.deps);
    h.calls.length = 0;
    const o = await runLevelChange(input(), h.deps);
    expect(o).toMatchObject({ success: true, applied: 0 });
    expect(o.plan?.sections).toEqual([]);
    expect(o.plan?.colorChange).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('finishing run: colour already target, a section still old', async () => {
    const h = harness();
    h.w.nodes.get('P')!.color = AFP;
    const o = await runLevelChange(input(), h.deps);
    expect(o).toMatchObject({ success: true, applied: 1 });
    expect(h.calls.some(c => c.startsWith('color'))).toBe(false);
    expect(h.calls).toContain('add:p1');
  });

  it('partial swap: a failed addition is completed by the re-run, never reported done without it', async () => {
    const h = harness(world(), { failAdd: true });
    const o1 = await runLevelChange(input(), h.deps);
    expect(o1.success).toBe(false);
    expect(h.calls.some(c => c.startsWith('color'))).toBe(false);
    h.opts.failAdd = false;
    h.calls.length = 0;
    const o2 = await runLevelChange(input({ decisions: await defaults(h) }), h.deps);
    expect(h.w.nodes.get('p1')!.tags).toContain(NEW);
    expect(o2.success).toBe(true);
    expect(h.w.nodes.get('P')!.color).toBe(AFP);
  });

  it('a section left with neither tag by an earlier run gets the target tag', async () => {
    const h = harness();
    h.w.nodes.get('p1')!.tags = [];
    const o = await runLevelChange(input({ decisions: await defaults(h) }), h.deps);
    expect(o.success).toBe(true);
    expect(h.w.nodes.get('p1')!.tags).toEqual([NEW]);
  });

  describe('decisions', () => {
    const KEY = 'sec|fa-x|#111111';
    const withoutTags = () => { const h = harness(); h.w.nodes.get('p1')!.tags = []; return h; };

    it('dryRun false without decisions refuses and writes nothing', async () => {
      const h = harness();
      const o = await runLevelChange(input({ decisions: undefined }), h.deps);
      expect(o.success).toBe(false);
      expect(o.error).toContain('décisions');
      expect(h.calls).toEqual([]);
    });

    it('a dry run ignores decisions and reports no ignored item', async () => {
      const h = harness();
      const o = await runLevelChange(input({ dryRun: true, decisions: undefined }), h.deps);
      expect(o.success).toBe(true);
      expect(o.ignored).toEqual([]);
    });

    it('an uncertain add without a decision is not written and is reported ignored', async () => {
      const h = withoutTags();
      const o = await runLevelChange(input(), h.deps);
      expect(h.calls).not.toContain('add:p1');
      expect(h.w.nodes.get('p1')!.tags).toEqual([]);
      expect(o.ignored).toHaveLength(1);
      expect(o.ignored[0]).toContain('non vu à l\'aperçu — ignoré');
      expect(o.ignored[0]).toContain(NEW);
      // the refused tag is not "remaining"
      expect(o.remaining.some(r => r.includes('étiquettes'))).toBe(false);
    });

    it('an accepted uncertain add is written', async () => {
      const h = withoutTags();
      const o = await runLevelChange(input({ decisions: { ...NO_DECISIONS, acceptedTagAdds: [{ sectionKey: KEY, tag: NEW }] } }), h.deps);
      expect(o).toMatchObject({ success: true, ignored: [] });
      expect(h.w.nodes.get('p1')!.tags).toEqual([NEW]);
    });

    it('clear swaps are applied with empty decisions', async () => {
      const h = harness();
      const o = await runLevelChange(input(), h.deps);
      expect(o).toMatchObject({ success: true, ignored: [] });
      expect(h.w.nodes.get('p1')!.tags).toEqual([NEW]);
    });

    function handEdited() {
      const h = harness();
      h.w.nodes.get('p1')!.tags = [NEW];
      h.w.nodes.get('p1')!.description = '<p>hand</p>';
      return h;
    }

    it('a hand-edited description is left alone unless forced', async () => {
      const h = handEdited();
      const o = await runLevelChange(input(), h.deps);
      expect(h.calls.some(c => c.startsWith('desc'))).toBe(false);
      expect(h.w.nodes.get('p1')!.description).toBe('<p>hand</p>');
      expect(o.remaining).toEqual([]);
      expect(o.ignored).toEqual([]);
    });

    it('a forced description writes the target description', async () => {
      const h = handEdited();
      const o = await runLevelChange(input({ decisions: { ...NO_DECISIONS, forcedDescriptions: [KEY] } }), h.deps);
      expect(o).toMatchObject({ success: true, remaining: [] });
      expect(h.w.nodes.get('p1')!.description).toBe('<p>afp</p>');
      expect(h.calls).toContain('desc:p1');
    });

    it('a forced description that does not land is reported', async () => {
      const h = handEdited(); h.opts.dropWrites = true;
      const o = await runLevelChange(input({ decisions: { ...NO_DECISIONS, forcedDescriptions: [KEY] } }), h.deps);
      expect(o.success).toBe(false);
      expect(o.remaining.some(r => r.includes('description non confirmée'))).toBe(true);
    });

    it('decisions naming no item of the live plan are ignored and reported', async () => {
      const h = harness();
      const o = await runLevelChange(input({
        decisions: { ...NO_DECISIONS, acceptedTagAdds: [{ sectionKey: 'ghost|x|y', tag: 'z' }], forcedDescriptions: ['ghost2|x|y'] },
      }), h.deps);
      expect(o.success).toBe(true);
      expect(o.ignored).toHaveLength(2);
      expect(o.ignored.every(i => i.includes('décision sans objet — ignorée'))).toBe(true);
      expect(h.w.nodes.get('p1')!.tags).toEqual([NEW]);
    });

    it('everything refused: nothing written, colour still written when the rest holds', async () => {
      const h = withoutTags();
      h.w.nodes.get('p1')!.description = '<p>afp</p>';
      const o = await runLevelChange(input(), h.deps);
      expect(o.success).toBe(true);
      expect(h.calls).toEqual(['color:P']);
    });
  });

  describe('run order: copies, access, deletes, widget, colour', () => {
    const WIDGET = '<p><a href="x/student_app.html">app</a></p>';
    const BOX = node({ id: 'ta2', title: 'Boîte', tags: ['hz-invite-self-editor', 'hz-share-companymentor-editor', 'hz-config-legend'] });
    const BOX_KEY = sectionKey(BOX);
    const OLD_KEY = 'ancien|fa-x|#111111';
    /** target gains a template-only section with a child and the widget; the profile has a
     *  profile-only section with two levels inside, an empty description, and ACL rows */
    function richWorld(): World {
      const w: World = world();
      const put = (n: LcNode, parent: string) => { w.nodes.set(n.id, { ...n, parentId: parent }); w.kids.set(parent, [...(w.kids.get(parent) ?? []), n.id]); };
      w.nodes.get('TA')!.description = WIDGET;
      put(BOX, 'TA');
      put(node({ id: 'ta2a', title: 'Fiche', tags: ['hz-invite-self-editor'] }), 'ta2');
      put(node({ id: 'p2', title: 'Ancien' }), 'P');
      put(node({ id: 'p2a', title: 'Travail' }), 'p2');
      put(node({ id: 'p2b', title: 'Note' }), 'p2a');
      w.acl = new Map([['P', [
        { authorId: 'stu', groupId: null, isGroup: false, role: 'reader' },
        { authorId: 'grpM', groupId: 'gM', isGroup: true, role: 'reader' },
        { authorId: 'grpT', groupId: 'gT', isGroup: true, role: 'editor' },
        { authorId: 'own', groupId: 'gO', isGroup: true, role: 'owner' },
      ]]]);
      return w;
    }
    const withDelete = (d: LevelChangeDecisions): LevelChangeDecisions =>
      ({ ...d, deleteSections: [{ sectionKey: OLD_KEY, sectionId: 'p2' }] });
    const copiesOf = (w: World) => (w.kids.get('P') ?? []).filter(i => i.startsWith('c'));

    it('dry run counts the descendants of profile-only sections, writing nothing', async () => {
      const h = harness(richWorld());
      const o = await runLevelChange(input({ dryRun: true }), h.deps);
      expect(o.plan?.profileOnlyItems).toEqual([
        { sectionKey: OLD_KEY, title: 'Ancien', sectionId: 'p2', descendants: 2, descendantsExact: true },
      ]);
      expect(o.plan?.templateOnlyItems.map(i => i.sectionKey)).toEqual([BOX_KEY]);
      expect(o.plan?.widget.needed).toBe(true);
      expect(h.calls).toEqual([]);
    });

    it('full run: sections → creates → access → remove → description → colour', async () => {
      const h = harness(richWorld());
      const d = withDelete(await defaults(h));
      const o = await runLevelChange(input({ decisions: d }), h.deps);
      expect(o.remaining).toEqual([]);
      expect(o).toMatchObject({ success: true, applied: 5, ignored: [] });
      const kinds = h.calls.map(c => c.split(':')[0]);
      const firstOf = (k: string) => kinds.indexOf(k);
      const lastOf = (k: string) => kinds.lastIndexOf(k);
      expect(h.calls.slice(0, 3)).toEqual(['add:p1', 'rm:p1', 'desc:p1']);
      expect(h.calls.filter(c => c.startsWith('create'))).toEqual(['create:ta2', 'create:ta2a']);
      expect(lastOf('create')).toBeLessThan(firstOf('acl'));
      expect(lastOf('acl')).toBeLessThan(firstOf('remove'));
      expect(h.calls.filter(c => c.startsWith('remove'))).toEqual(['remove:p2']);
      expect(h.calls.slice(-2)).toEqual(['desc:P', 'color:P']);
      // copy present, delete gone, widget written into the empty description
      const [copy] = copiesOf(h.w);
      expect(h.w.nodes.get(copy)!.tags).toEqual(BOX.tags);
      expect(h.w.kids.get(copy)).toHaveLength(1);
      expect(h.w.nodes.has('p2')).toBe(false);
      expect(h.w.nodes.get('P')!.description).toBe(WIDGET);
      // access: student raised to editor, mentor group set to editor, teacher group removed, owner kept
      expect(h.w.acl!.get(copy)).toEqual([
        { authorId: 'stu', groupId: null, isGroup: false, role: 'editor' },
        { authorId: 'grpM', groupId: 'gM', isGroup: true, role: 'editor' },
        { authorId: 'own', groupId: 'gO', isGroup: true, role: 'owner' },
      ]);
      expect(h.w.nodes.get('P')!.color).toBe(AFP);
    });

    it('a non-empty profile description gets the widget appended', async () => {
      const w = richWorld(); w.nodes.get('P')!.description = '<p>mine</p>';
      const h = harness(w);
      const o = await runLevelChange(input({ decisions: await defaults(h) }), h.deps);
      expect(o.success).toBe(true);
      expect(h.w.nodes.get('P')!.description).toBe('<p>mine</p>' + WIDGET);
    });

    it('a failed copy: colour not written, remaining names it, other actions still run', async () => {
      const h = harness(richWorld(), { failCreate: 'ta2a' });
      const o = await runLevelChange(input({ decisions: withDelete(await defaults(h)) }), h.deps);
      expect(o.success).toBe(false);
      expect(o.remaining.some(r => r.includes('Boîte') && r.includes('copie incomplète'))).toBe(true);
      expect(o.remaining).toContain('couleur du profil non modifiée — étapes précédentes non confirmées');
      expect(h.calls.some(c => c.startsWith('color'))).toBe(false);
      expect(copiesOf(h.w)).toEqual([]); // the partial copy was removed again
      expect(h.w.nodes.has('p2')).toBe(false);
      expect(h.calls).toContain('desc:P');
    });

    it('a failed delete: colour not written, remaining names it', async () => {
      const h = harness(richWorld(), { failRemove: true });
      const o = await runLevelChange(input({ decisions: withDelete(await defaults(h)) }), h.deps);
      expect(o.success).toBe(false);
      expect(o.remaining.some(r => r.includes('Ancien') && r.includes('suppression non confirmée'))).toBe(true);
      expect(h.calls.some(c => c.startsWith('color'))).toBe(false);
      expect(h.w.nodes.has('p2')).toBe(true);
    });

    it('a widget the read-back never shows: colour not written', async () => {
      const h = harness(richWorld(), { dropWidget: true });
      const o = await runLevelChange(input({ decisions: await defaults(h) }), h.deps);
      expect(o.success).toBe(false);
      expect(o.remaining.some(r => r.includes('widget'))).toBe(true);
      expect(h.calls.some(c => c.startsWith('color'))).toBe(false);
    });

    it('studentId null with an invite-tagged copy: grant unconfirmed, colour withheld, copy kept', async () => {
      const h = harness(richWorld());
      const d = await defaults(h);
      const o = await runLevelChange(input({ decisions: d, studentId: null }), h.deps);
      expect(o.success).toBe(false);
      expect(o.remaining.some(r => r.includes('accès non confirmés'))).toBe(true);
      expect(h.calls.some(c => c.startsWith('color'))).toBe(false);
      expect(copiesOf(h.w)).toHaveLength(1);
    });

    it('a template-only section that appeared after the preview is not copied, and is reported', async () => {
      const h = harness(richWorld());
      const d = await defaults(h);
      const late = node({ id: 'ta3', title: 'Nouveau', tags: [] });
      h.w.nodes.set('ta3', { ...late, parentId: 'TA' }); h.w.kids.set('TA', [...h.w.kids.get('TA')!, 'ta3']);
      const o = await runLevelChange(input({ decisions: d }), h.deps);
      expect(h.calls).not.toContain('create:ta3');
      expect(o.ignored).toEqual(['« Nouveau » : copie — non vu à l\'aperçu — ignoré']);
      expect(o.success).toBe(true);
    });

    it('decisions without object: copy, delete and widget are skipped and reported by title', async () => {
      const w = richWorld();
      // « Ancien » now exists in the target too: no longer profile-only
      w.nodes.set('ta4', { ...node({ id: 'ta4', title: 'Ancien' }), parentId: 'TA' }); w.kids.set('TA', [...w.kids.get('TA')!, 'ta4']);
      w.nodes.get('P')!.description = WIDGET;
      const h = harness(w);
      const d: LevelChangeDecisions = {
        ...withDelete(await defaults(h)), copySections: [BOX_KEY, 'fantôme|fa-x|#111111'], addWidget: true,
      };
      const o = await runLevelChange(input({ decisions: d }), h.deps);
      expect(h.calls.some(c => c.startsWith('remove'))).toBe(false);
      expect(h.calls).not.toContain('desc:P');
      expect(h.w.nodes.has('p2')).toBe(true);
      expect(o.ignored).toEqual(expect.arrayContaining([
        '« fantôme » : copie — décision sans objet — ignorée',
        '« ancien » : suppression — décision sans objet — ignorée',
        'widget : décision sans objet — ignorée',
      ]));
      expect(o.success).toBe(true);
    });

    it('sections not confirmed: no copy, delete or widget is attempted', async () => {
      const h = harness(richWorld(), { dropWrites: true });
      const o = await runLevelChange(input({ decisions: withDelete(await defaults(h)) }), h.deps);
      expect(o.success).toBe(false);
      expect(h.calls.filter(c => /^(create|remove|acl|color)/.test(c) || c === 'desc:P')).toEqual([]);
      expect(o.remaining).toContain('actions supplémentaires non faites — sections non confirmées');
    });

    it('re-run after success writes nothing and succeeds', async () => {
      const h = harness(richWorld());
      const d = withDelete(await defaults(h));
      expect((await runLevelChange(input({ decisions: d }), h.deps)).success).toBe(true);
      h.calls.length = 0;
      const again = await runLevelChange(input({ decisions: await defaults(h) }), h.deps);
      expect(again).toMatchObject({ success: true, applied: 0, remaining: [], ignored: [] });
      expect(again.plan?.templateOnlyItems).toEqual([]);
      expect(again.plan?.widget.needed).toBe(false);
      expect(h.calls).toEqual([]);
    });
  });
});
