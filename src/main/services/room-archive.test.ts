import { describe, it, expect } from 'vitest';
import {
  ARCHIVE_ROOT_PRIVACY,
  ARCHIVE_ROOT_TAG,
  ArchiveDeps,
  ArchiveInput,
  ApiFailure,
  GROUPS_FOLDER_PRIVACY,
  GROUPS_FOLDER_TAG,
  HazuNode,
  ROOM_FOLDER_PRIVACY,
  ROOM_FOLDER_TAG,
  buildRecordTags,
  groupsOfClass,
  holderTagsToRemove,
  parseRecordTags,
  runArchive,
  runRestore,
  archivedEntry,
  RestoreInput,
} from './room-archive';

const ROLES = ['student', 'schoolteacher', 'companymentor', 'courseteacher', 'stateadvisor'];

type Op = 'read' | 'list' | 'create' | 'move' | 'addTags' | 'removeTags' | 'remove';
interface Call { op: Op; args: unknown[] }

/** In-memory Hazu. `failOn` may throw an ApiFailure for a given call; reusable for restore tests. */
function createFakeHazu(
  initial: HazuNode[],
  failOn: (call: Call, n: number) => ApiFailure | undefined = () => undefined,
  opts: { moveIsNoop?: boolean; removeTagsIsNoop?: boolean } = {},
) {
  const nodes = new Map<string, HazuNode>(initial.map(n => [n.id, { ...n, tags: [...n.tags] }]));
  const privacy = new Map<string, string>();
  const calls: Call[] = [];
  let seq = 0;
  const counts: Record<string, number> = {};
  const enter = (op: Op, ...args: unknown[]) => {
    const call = { op, args };
    calls.push(call);
    counts[op] = (counts[op] ?? 0) + 1;
    const f = failOn(call, counts[op]);
    if (f) throw f;
  };
  const deps: ArchiveDeps = {
    async read(id) {
      enter('read', id);
      const n = nodes.get(id);
      return n ? { ...n, tags: [...n.tags] } : null;
    },
    async list(parentId) {
      enter('list', parentId);
      return [...nodes.values()].filter(n => n.parentId === parentId).map(n => ({ ...n, tags: [...n.tags] }));
    },
    async create(parentId, title, tags, p) {
      enter('create', parentId, title, tags, p);
      const id = `new-${++seq}`;
      nodes.set(id, { id, parentId, title, tags: [...tags] });
      privacy.set(id, p);
      return id;
    },
    async move(id, targetId) {
      enter('move', id, targetId);
      if (opts.moveIsNoop) return;
      const n = nodes.get(id)!;
      n.parentId = targetId;
    },
    async addTags(id, tags) {
      enter('addTags', id, tags);
      const n = nodes.get(id)!;
      n.tags = [...new Set([...n.tags, ...tags])];
    },
    async removeTags(id, tags) {
      enter('removeTags', id, tags);
      if (opts.removeTagsIsNoop) return;
      const n = nodes.get(id)!;
      n.tags = n.tags.filter(t => !tags.includes(t));
    },
    async remove(id) {
      enter('remove', id);
      nodes.delete(id);
    },
    async sleep() {},
  };
  return { deps, nodes, calls, privacy, count: (op: Op) => calls.filter(c => c.op === op).length };
}

const node = (id: string, parentId: string | null, title: string, tags: string[] = []): HazuNode => ({
  id, parentId, title, tags,
});

/** A school with one class `cls1` (5 role groups) in category `cat1`, two holders, and one decoy class `cls1x`. */
function school(extra: HazuNode[] = []): HazuNode[] {
  return [
    node('admin', 'root', 'Admin', ['hz-config-admin']),
    node('share', 'admin', 'Partage', ['hz-config-sharing']),
    node('cat1', 'root', 'Classes', ['hz-config-room-category']),
    node('room1', 'cat1', 'Classe A', ['hz-config-room-class', 'hz-config-class-cls1']),
    ...ROLES.map(r => node(`g-${r}`, 'share', `grp ${r}`, [`hz-share-${r}-cls1`])),
    node('g-decoy', 'share', 'decoy', ['hz-share-student-cls1x']),
    node('p1', 'people', 'P1', ['hz-config-class-cls1-student', 'hz-config-class-cls1x-student', 'other']),
    node('p2', 'people', 'P2', ['hz-config-class-cls1-schoolteacher']),
    ...extra,
  ];
}

const input = (over: Partial<ArchiveInput> = {}): ArchiveInput => ({
  room: { id: 'room1', classId: 'cls1', title: 'Classe A', roomType: 'class' },
  expectedParentId: 'cat1',
  categoryIds: ['cat1'],
  adminId: 'admin',
  sharingContainerId: 'share',
  roles: ROLES,
  holders: [
    { personId: 'p1', tags: ['hz-config-class-cls1-student'] },
    { personId: 'p2', tags: ['hz-config-class-cls1-schoolteacher'] },
  ],
  now: 1700000000000,
  ...over,
});

describe('record tags', () => {
  const rec = { classId: 'cls1', fromParentId: 'cat1', roomType: 'cie' as const, archivedAt: 1700000000000 };

  it('builds exactly the five spec tags', () => {
    expect(buildRecordTags(rec)).toEqual([
      'hz-config-archive-room',
      'hz-config-archive-class-cls1',
      'hz-config-archive-from-cat1',
      'hz-config-archive-type-cie',
      'hz-config-archive-at-1700000000000',
    ]);
  });

  it('round-trips through parseRecordTags', () => {
    expect(parseRecordTags(buildRecordTags(rec))).toEqual(rec);
  });

  it('returns null when a part is missing', () => {
    const tags = buildRecordTags(rec).filter(t => !t.startsWith('hz-config-archive-from-'));
    expect(parseRecordTags(tags)).toBeNull();
  });
});

describe('holderTagsToRemove', () => {
  it('matches whole tags only: class id abc never matches abcd', () => {
    expect(
      holderTagsToRemove(
        ['hz-config-class-abc-student', 'hz-config-class-abcd-student', 'hz-config-class-abc'],
        'abc',
        ['student', 'schoolteacher'],
      ),
    ).toEqual(['hz-config-class-abc-student']);
  });
});

describe('groupsOfClass', () => {
  it('returns duplicate groups of a role and ignores a class id that merely starts the same', () => {
    const children = [
      node('a', 's', 'a', ['hz-share-student-abc']),
      node('b', 's', 'b', ['hz-share-student-abc']),
      node('c', 's', 'c', ['hz-share-student-abcd']),
      node('d', 's', 'd', ['hz-share-schoolteacher-abc']),
    ];
    expect(groupsOfClass(children, 'abc', ['student', 'schoolteacher'])).toEqual([
      { id: 'a', role: 'student' },
      { id: 'b', role: 'student' },
      { id: 'd', role: 'schoolteacher' },
    ]);
  });
});

describe('runArchive', () => {
  it('archives a fresh room: folders created once, groups and room inside, holders lose the tag', async () => {
    const f = createFakeHazu(school());
    const out = await runArchive(input(), f.deps);

    expect(out.success).toBe(true);
    expect(out.remaining).toEqual([]);
    const creates = f.calls.filter(c => c.op === 'create');
    expect(creates).toHaveLength(3);

    const archive = [...f.nodes.values()].find(n => n.tags.includes(ARCHIVE_ROOT_TAG))!;
    expect(archive.parentId).toBe('admin');
    expect(f.privacy.get(archive.id)).toBe(ARCHIVE_ROOT_PRIVACY);
    const folder = [...f.nodes.values()].find(n => n.tags.includes(ROOM_FOLDER_TAG))!;
    expect(folder.parentId).toBe(archive.id);
    expect(folder.title).toBe('Classe A');
    expect(f.privacy.get(folder.id)).toBe(ROOM_FOLDER_PRIVACY);
    expect(parseRecordTags(folder.tags)).toEqual({
      classId: 'cls1', fromParentId: 'cat1', roomType: 'class', archivedAt: 1700000000000,
    });
    const gf = [...f.nodes.values()].find(n => n.tags.includes(GROUPS_FOLDER_TAG))!;
    expect(gf.parentId).toBe(folder.id);
    expect(gf.title).toBe('Groupes de partage');
    expect(f.privacy.get(gf.id)).toBe(GROUPS_FOLDER_PRIVACY);

    expect(f.nodes.get('room1')!.parentId).toBe(folder.id);
    for (const r of ROLES) expect(f.nodes.get(`g-${r}`)!.parentId).toBe(gf.id);
    expect(f.nodes.get('g-decoy')!.parentId).toBe('share');

    expect(f.nodes.get('p1')!.tags).toEqual(['hz-config-class-cls1x-student', 'other']);
    expect(f.nodes.get('p2')!.tags).toEqual([]);
    expect(out.removedTags).toEqual([
      { personId: 'p1', tags: ['hz-config-class-cls1-student'] },
      { personId: 'p2', tags: ['hz-config-class-cls1-schoolteacher'] },
    ]);
    // the room's own tags and privacy are not touched
    expect(f.nodes.get('room1')!.tags).toEqual(['hz-config-room-class', 'hz-config-class-cls1']);
    expect(out.folderId).toBe(folder.id);
  });

  it('moves every duplicate group of a role', async () => {
    const f = createFakeHazu(school([node('g-dup', 'share', 'dup', ['hz-share-student-cls1'])]));
    const out = await runArchive(input(), f.deps);
    expect(out.success).toBe(true);
    const gf = [...f.nodes.values()].find(n => n.tags.includes(GROUPS_FOLDER_TAG))!;
    expect(f.nodes.get('g-dup')!.parentId).toBe(gf.id);
  });

  it('a second run creates nothing, moves nothing, and skips every step', async () => {
    const f = createFakeHazu(school());
    await runArchive(input(), f.deps);
    const before = f.calls.length;
    const out = await runArchive(input(), f.deps);

    expect(out.success).toBe(true);
    const second = f.calls.slice(before);
    expect(second.filter(c => ['create', 'move', 'addTags', 'removeTags'].includes(c.op))).toEqual([]);
    expect(out.steps.map(s => s.status).filter(s => s !== 'skipped')).toEqual(['done']); // room-read only
    expect(out.steps.filter(s => s.step !== 'room-read').every(s => s.status === 'skipped')).toBe(true);
  });

  it('finishes a run stopped after the groups moved, with one folder only', async () => {
    const broken = createFakeHazu(school(), call =>
      call.op === 'move' && call.args[0] === 'room1' ? { status: 403, networkOrTimeout: false, message: 'refus' } : undefined,
    );
    const first = await runArchive(input(), broken.deps);
    expect(first.success).toBe(false);
    expect(first.remaining).toEqual(['room1']);
    expect(broken.nodes.get('room1')!.parentId).toBe('cat1');

    const healthy = createFakeHazu([...broken.nodes.values()]);
    const second = await runArchive(input(), healthy.deps);
    expect(second.success).toBe(true);
    const folders = [...healthy.nodes.values()].filter(n => n.tags.includes(ROOM_FOLDER_TAG));
    expect(folders).toHaveLength(1);
    expect(healthy.count('create')).toBe(0);
    expect(healthy.nodes.get('room1')!.parentId).toBe(folders[0].id);
    expect(healthy.nodes.get('p1')!.tags).not.toContain('hz-config-class-cls1-student');
  });

  it('finishes a run stopped after the room moved but before the tags', async () => {
    const f = createFakeHazu(school());
    await runArchive(input(), f.deps);
    // put the tag back on p1 as if the tag step never ran
    f.nodes.get('p1')!.tags.push('hz-config-class-cls1-student');
    const out = await runArchive(input(), f.deps);
    expect(out.success).toBe(true);
    expect(f.nodes.get('p1')!.tags).not.toContain('hz-config-class-cls1-student');
    expect(out.steps.find(s => s.step === 'room')!.status).toBe('skipped');
  });

  it('refuses a room whose live parent is not the synced category, touching nothing', async () => {
    const f = createFakeHazu(school([node('elsewhere', 'root', 'Ailleurs')]));
    f.nodes.get('room1')!.parentId = 'elsewhere';
    const out = await runArchive(input(), f.deps);
    expect(out.success).toBe(false);
    expect(out.error).toBe('la salle a été déplacée depuis la dernière synchronisation');
    expect(f.count('move')).toBe(0);
    expect(f.count('create')).toBe(0);
  });

  it('fails when the room does not exist', async () => {
    const f = createFakeHazu(school());
    f.nodes.delete('room1');
    const out = await runArchive(input(), f.deps);
    expect(out.success).toBe(false);
    expect(out.error).toBe('salle introuvable');
    expect(f.count('create')).toBe(0);
  });

  it('fails the step when a move returns OK but the read-back shows the old parent', async () => {
    const f = createFakeHazu(school(), () => undefined, { moveIsNoop: true });
    const out = await runArchive(input(), f.deps);
    expect(out.success).toBe(false);
    expect(out.steps.find(s => s.status === 'failed')!.step).toBe('groups');
    expect(out.remaining.length).toBeGreaterThan(0);
  });

  it('retries a 503 on a move, then succeeds', async () => {
    const f = createFakeHazu(school(), (call, n) =>
      call.op === 'move' && n === 1 ? { status: 503, networkOrTimeout: false, message: 'indispo' } : undefined,
    );
    const out = await runArchive(input(), f.deps);
    expect(out.success).toBe(true);
    // first group move attempted twice
    expect(f.calls.filter(c => c.op === 'move' && c.args[0] === f.calls.find(x => x.op === 'move')!.args[0])).toHaveLength(2);
  });

  it('does not retry a 403', async () => {
    const f = createFakeHazu(school(), call =>
      call.op === 'move' ? { status: 403, networkOrTimeout: false, message: 'interdit' } : undefined,
    );
    const out = await runArchive(input(), f.deps);
    expect(out.success).toBe(false);
    expect(f.count('move')).toBe(ROLES.length); // one attempt per group, no retry
    expect(out.steps.find(s => s.status === 'failed')!.step).toBe('groups');
  });

  it('reports success false and names the person when a tag survives three re-reads', async () => {
    const f = createFakeHazu(school(), () => undefined, { removeTagsIsNoop: true });
    const out = await runArchive(input(), f.deps);
    expect(out.success).toBe(false);
    expect(out.remaining).toEqual(['p1', 'p2']);
    expect(out.steps.find(s => s.status === 'failed')!.step).toBe('tags');
    // 1 pre-read + 3 verify reads, per person
    expect(f.calls.filter(c => c.op === 'read' && c.args[0] === 'p1')).toHaveLength(4);
  });

  it('counts a failed removeTags call as success when the read shows the tag gone', async () => {
    const f = createFakeHazu(school());
    const real = f.deps.removeTags;
    f.deps.removeTags = async (id, tags) => {
      await real(id, tags);
      throw { status: 400, networkOrTimeout: false, message: 'réponse perdue' } as ApiFailure;
    };
    const out = await runArchive(input(), f.deps);
    expect(out.success).toBe(true);
  });

  it('a create that commits but answers 503 leaves exactly one Archive Hazu and one folder', async () => {
    const f = createFakeHazu(school());
    const real = f.deps.create;
    const failedOnce = new Set<string>();
    f.deps.create = async (parentId, title, tags, p) => {
      const id = await real(parentId, title, tags, p);
      if (!failedOnce.has(tags[0])) {
        failedOnce.add(tags[0]);
        throw { status: 503, networkOrTimeout: false, message: 'indispo' } as ApiFailure;
      }
      return id;
    };
    const out = await runArchive(input(), f.deps);
    expect(out.success).toBe(true);
    const all = [...f.nodes.values()];
    expect(all.filter(n => n.tags.includes(ARCHIVE_ROOT_TAG))).toHaveLength(1);
    expect(all.filter(n => n.tags.includes(ROOM_FOLDER_TAG))).toHaveLength(1);
    expect(all.filter(n => n.tags.includes(GROUPS_FOLDER_TAG))).toHaveLength(1);
    expect(f.count('create')).toBe(3);
  });

  it('uses the folder the room already sits in, even when another folder carries the class tag', async () => {
    const f = createFakeHazu(school());
    await runArchive(input(), f.deps);
    const folder = [...f.nodes.values()].find(n => n.tags.includes(ROOM_FOLDER_TAG))!;
    // a stray second folder with the same class tag, listed first
    f.nodes.set('stray', { id: 'stray', parentId: folder.parentId, title: 's', tags: [ROOM_FOLDER_TAG, 'hz-config-archive-class-cls1'] });
    const out = await runArchive(input(), f.deps);
    expect(out.success).toBe(true);
    expect(out.folderId).toBe(folder.id);
  });

  it('strips HTML from the per-room folder title', async () => {
    const f = createFakeHazu(school());
    await runArchive(input({ room: { id: 'room1', classId: 'cls1', title: '<p>Cui&nbsp;Test <b>2</b> &amp; co</p>', roomType: 'class' } }), f.deps);
    const folder = [...f.nodes.values()].find(n => n.tags.includes(ROOM_FOLDER_TAG))!;
    expect(folder.title).toBe('Cui Test 2 & co');
  });

  it('falls back to the class id when the stripped title is empty', async () => {
    const f = createFakeHazu(school());
    await runArchive(input({ room: { id: 'room1', classId: 'cls1', title: '<p> </p>', roomType: 'class' } }), f.deps);
    const folder = [...f.nodes.values()].find(n => n.tags.includes(ROOM_FOLDER_TAG))!;
    expect(folder.title).toBe('cls1');
  });

  it('refuses a room under a look-alike archive folder located outside the Archive Hazu', async () => {
    const f = createFakeHazu(
      school([
        node('fake', 'root', 'Faux', [ROOM_FOLDER_TAG, 'hz-config-archive-class-cls1']),
        node('archive0', 'admin', 'Archive', [ARCHIVE_ROOT_TAG]),
      ]),
    );
    f.nodes.get('room1')!.parentId = 'fake';
    const out = await runArchive(input(), f.deps);
    expect(out.success).toBe(false);
    expect(out.error).toBe('la salle a été déplacée depuis la dernière synchronisation');
    expect(f.count('move')).toBe(0);
    expect(f.count('create')).toBe(0);
    expect(f.nodes.get('room1')!.parentId).toBe('fake');
  });
});


describe('runRestore', () => {
  const WRITES = ['create', 'move', 'addTags', 'removeTags', 'remove'];

  /** Members per group id, as the service would resolve them from the group ACLs. */
  const membersByGroup: Record<string, string[]> = { 'g-student': ['p1'], 'g-schoolteacher': ['p2'] };
  const restoreInput = (f: ReturnType<typeof createFakeHazu>, over: Partial<RestoreInput> = {}, unresolved = 0): RestoreInput => {
    const folder = [...f.nodes.values()].find(n => n.tags.includes(ROOM_FOLDER_TAG))!;
    return {
      folderId: folder.id,
      adminId: 'admin',
      sharingContainerId: 'share',
      roles: ROLES,
      membersOf: async gid => ({ personIds: membersByGroup[gid] ?? [], unresolved }),
      ...over,
    };
  };
  const archived = async (extra: HazuNode[] = []) => {
    const f = createFakeHazu(school(extra));
    await runArchive(input(), f.deps);
    return f;
  };

  it('round trip: room and groups back, every member tag back, both folders gone', async () => {
    const f = await archived();
    const folderId = [...f.nodes.values()].find(n => n.tags.includes(ROOM_FOLDER_TAG))!.id;
    const out = await runRestore(restoreInput(f), f.deps);

    expect(out.success).toBe(true);
    expect(out.roomId).toBe('room1');
    expect(f.nodes.get('room1')!.parentId).toBe('cat1');
    for (const r of ROLES) expect(f.nodes.get(`g-${r}`)!.parentId).toBe('share');
    expect(f.nodes.get('p1')!.tags).toContain('hz-config-class-cls1-student');
    expect(f.nodes.get('p2')!.tags).toContain('hz-config-class-cls1-schoolteacher');
    expect(f.nodes.has(folderId)).toBe(false);
    expect([...f.nodes.values()].some(n => n.tags.includes(GROUPS_FOLDER_TAG))).toBe(false);
    expect(out.addedTags).toEqual([
      { personId: 'p1', tags: ['hz-config-class-cls1-student'] },
      { personId: 'p2', tags: ['hz-config-class-cls1-schoolteacher'] },
    ]);
    // the Archive Hazu itself stays
    expect([...f.nodes.values()].some(n => n.tags.includes(ARCHIVE_ROOT_TAG))).toBe(true);
  });

  it('origin category gone: fails before any move', async () => {
    const f = await archived();
    f.nodes.delete('cat1');
    const before = f.calls.length;
    const out = await runRestore(restoreInput(f), f.deps);
    expect(out.success).toBe(false);
    expect(out.error).toBe("catégorie d'origine introuvable");
    expect(f.calls.slice(before).filter(c => WRITES.includes(c.op))).toEqual([]);
  });

  it('a record with a missing part fails as incomplete', async () => {
    const f = await archived();
    const folder = [...f.nodes.values()].find(n => n.tags.includes(ROOM_FOLDER_TAG))!;
    folder.tags = folder.tags.filter(t => !t.startsWith('hz-config-archive-from-'));
    const out = await runRestore(restoreInput(f), f.deps);
    expect(out.success).toBe(false);
    expect(out.error).toBe("dossier d'archive incomplet");
  });

  it('refuses a folder that does not sit in the Archive Hazu, writing nothing', async () => {
    const f = await archived();
    const folder = [...f.nodes.values()].find(n => n.tags.includes(ROOM_FOLDER_TAG))!;
    folder.parentId = 'root';
    const before = f.calls.length;
    const out = await runRestore(restoreInput(f), f.deps);
    expect(out.success).toBe(false);
    expect(out.error).toBe("dossier d'archive introuvable");
    expect(f.calls.slice(before).filter(c => WRITES.includes(c.op))).toEqual([]);
  });

  it('refuses an id that is not a room folder', async () => {
    const f = await archived();
    const out = await runRestore(restoreInput(f, { folderId: 'cat1' }), f.deps);
    expect(out.success).toBe(false);
    expect(out.error).toBe("dossier d'archive introuvable");
  });

  it('a re-run on a restored room whose folders remain does only reads', async () => {
    const f = await archived();
    const input1 = restoreInput(f);
    // simulate a run stopped before the cleanup: everything moved and tagged, folders still there
    f.nodes.get('room1')!.parentId = 'cat1';
    for (const r of ROLES) f.nodes.get(`g-${r}`)!.parentId = 'share';
    f.nodes.get('p1')!.tags.push('hz-config-class-cls1-student');
    f.nodes.get('p2')!.tags.push('hz-config-class-cls1-schoolteacher');
    const before = f.calls.length;
    const out = await runRestore(input1, f.deps);
    expect(out.success).toBe(true);
    expect(out.addedTags).toEqual([]);
    const writes = f.calls.slice(before).filter(c => WRITES.includes(c.op));
    expect(writes.map(c => c.op)).toEqual(['remove', 'remove']); // only the empty folders
    // a third run: folders are gone, so it reports that instead of pretending
    const third = await runRestore(input1, f.deps);
    expect(third.success).toBe(false);
  });

  it('a groups folder holding an unknown child is kept, its step fails, the rest is done', async () => {
    const f = await archived();
    const gf = [...f.nodes.values()].find(n => n.tags.includes(GROUPS_FOLDER_TAG))!;
    f.nodes.set('stranger', { id: 'stranger', parentId: gf.id, title: 'Inconnu', tags: [] });
    const out = await runRestore(restoreInput(f), f.deps);
    expect(out.success).toBe(false);
    expect(f.nodes.has(gf.id)).toBe(true);
    expect(f.nodes.has('stranger')).toBe(true);
    const failed = out.steps.filter(s => s.status === 'failed');
    expect(failed.map(s => s.step)).toContain('groups-folder-remove');
    expect(failed[0].detail).toContain('stranger');
    expect(f.nodes.get('room1')!.parentId).toBe('cat1');
    expect(f.nodes.get('p1')!.tags).toContain('hz-config-class-cls1-student');
  });

  it('two student groups: both move back and both groups\' members are tagged', async () => {
    const f = await archived([node('g-dup', 'share', 'dup', ['hz-share-student-cls1']), node('p3', 'people', 'P3', [])]);
    membersByGroup['g-dup'] = ['p3'];
    try {
      const out = await runRestore(restoreInput(f), f.deps);
      expect(out.success).toBe(true);
      expect(f.nodes.get('g-dup')!.parentId).toBe('share');
      expect(f.nodes.get('g-student')!.parentId).toBe('share');
      expect(f.nodes.get('p3')!.tags).toContain('hz-config-class-cls1-student');
      expect(f.nodes.get('p1')!.tags).toContain('hz-config-class-cls1-student');
    } finally {
      delete membersByGroup['g-dup'];
    }
  });

  it('carries unresolved members to the outcome without failing', async () => {
    const f = await archived();
    const out = await runRestore(restoreInput(f, {}, 2), f.deps);
    expect(out.success).toBe(true);
    expect(out.unresolvedMembers).toBe(2 * ROLES.length);
  });

  it('does not re-add a tag a member already has', async () => {
    const f = await archived();
    f.nodes.get('p1')!.tags.push('hz-config-class-cls1-student');
    const out = await runRestore(restoreInput(f), f.deps);
    expect(out.success).toBe(true);
    expect(f.calls.filter(c => c.op === 'addTags' && c.args[0] === 'p1')).toEqual([]);
    expect(out.addedTags.map(a => a.personId)).toEqual(['p2']);
  });

  it('fails the tags step when an added tag does not show on re-read', async () => {
    const f = await archived();
    f.deps.addTags = async () => {};
    const out = await runRestore(restoreInput(f), f.deps);
    expect(out.success).toBe(false);
    expect(out.steps.find(s => s.status === 'failed')!.step).toBe('tags');
    expect(out.remaining).toEqual(['p1', 'p2']);
  });

  it('fails the room step when the move reads back unchanged, and keeps the folder', async () => {
    const f = await archived();
    const realMove = f.deps.move;
    f.deps.move = async (id, t) => { if (id !== 'room1') await realMove(id, t); };
    const out = await runRestore(restoreInput(f), f.deps);
    expect(out.success).toBe(false);
    expect(out.steps.find(s => s.status === 'failed')!.step).toBe('room');
    expect(out.remaining).toContain('room1');
    expect(f.nodes.get('room1')!.parentId).not.toBe('cat1');
  });
});

describe('archivedEntry', () => {
  const rec = { classId: 'cls1', fromParentId: 'cat1', roomType: 'cie' as const, archivedAt: 1700000000000 };
  it('builds the list row from a folder and its children', () => {
    const folder = node('f1', 'arch', 'Classe A', buildRecordTags(rec));
    const kids = [node('gf', 'f1', 'Groupes', [GROUPS_FOLDER_TAG]), node('room1', 'f1', 'Classe A', ['hz-config-class-cls1'])];
    expect(archivedEntry(folder, kids)).toEqual({
      folderId: 'f1', roomId: 'room1', title: 'Classe A', classId: 'cls1', roomType: 'cie', fromParentId: 'cat1', archivedAt: 1700000000000,
    });
  });
  it('roomId is null when the room is not in the folder', () => {
    const folder = node('f1', 'arch', 'Classe A', buildRecordTags(rec));
    expect(archivedEntry(folder, [])!.roomId).toBeNull();
  });
  it('returns null when the record lacks -from-', () => {
    const tags = buildRecordTags(rec).filter(t => !t.startsWith('hz-config-archive-from-'));
    expect(archivedEntry(node('f1', 'arch', 'x', tags), [])).toBeNull();
  });
});
