import { describe, it, expect } from 'vitest';
import {
  ArchiveDeps,
  ApiFailure,
  HazuNode,
  ARCHIVE_ROOT_TAG,
  ARCHIVE_ROOT_PRIVACY,
} from './room-archive';
import {
  PERSONS_FOLDER_TAG,
  PERSONS_FOLDER_TITLE,
  PERSON_FOLDER_TAG,
  PersonArchiveDeps,
  PersonArchiveInput,
  archivedPersonEntry,
  buildPersonRecordTags,
  parsePersonRecordTags,
  runPersonArchive,
  runPersonRestore,
  syncState,
} from './person-archive';

type Op = 'read' | 'list' | 'create' | 'move' | 'addTags' | 'removeTags' | 'remove';
interface Call { op: Op; args: unknown[] }

function createFakeHazu(
  initial: HazuNode[],
  failOn: (call: Call, n: number) => ApiFailure | undefined = () => undefined,
  opts: { moveLandsThenThrows?: ApiFailure } = {},
) {
  const nodes = new Map<string, HazuNode>(initial.map(n => [n.id, { ...n, tags: [...n.tags] }]));
  const privacy = new Map<string, string>();
  const calls: Call[] = [];
  let seq = 0;
  const counts: Record<string, number> = {};
  const enter = (op: Op, ...args: unknown[]) => {
    calls.push({ op, args });
    counts[op] = (counts[op] ?? 0) + 1;
    const f = failOn({ op, args }, counts[op]);
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
      nodes.get(id)!.parentId = targetId;
      if (opts.moveLandsThenThrows) throw opts.moveLandsThenThrows;
    },
    async addTags(id, tags) {
      enter('addTags', id, tags);
      const n = nodes.get(id)!;
      n.tags = [...new Set([...n.tags, ...tags])];
    },
    async removeTags(id, tags) {
      enter('removeTags', id, tags);
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

function school(profileTags: string[] = [], extra: HazuNode[] = []): HazuNode[] {
  return [
    node('admin', 'root', 'Admin', ['hz-config-admin']),
    node('pcat', 'root', 'Apprentis', ['hz-config-profile-student']),
    node('p1', 'pcat', 'Alice Test', profileTags),
    ...extra,
  ];
}

const baseInput = (over: Partial<PersonArchiveInput> = {}): PersonArchiveInput => ({
  person: { id: 'p1', displayName: 'Alice Test' },
  categoryIds: ['pcat'],
  adminId: 'admin',
  assignments: [],
  liveRooms: [],
  now: 1700000000000,
  ...over,
});

function scripted(
  fake: ReturnType<typeof createFakeHazu>,
  roleOutcome: (roomId: string) => { success: boolean; error?: string } = () => ({ success: true }),
) {
  const roleCalls: Array<{ roomId: string; role: string }> = [];
  const deps: PersonArchiveDeps = {
    ...fake.deps,
    async removeRole(roomId, role) {
      roleCalls.push({ roomId, role });
      return roleOutcome(roomId);
    },
  };
  return { deps, roleCalls };
}

const rooms = [
  { roomId: 'room-a', classId: 'cls-a', title: 'Classe A' },
  { roomId: 'room-b', classId: 'cls-b', title: 'Classe B' },
];

describe('person record tags', () => {
  it('round-trips', () => {
    const r = { profileId: 'p1', fromParentId: 'pcat', archivedAt: 1700000000000 };
    const tags = buildPersonRecordTags(r);
    expect(tags).toContain(PERSON_FOLDER_TAG);
    expect(tags).toHaveLength(4);
    expect(parsePersonRecordTags(tags)).toEqual(r);
  });
  it('is null when one tag is missing', () => {
    const tags = buildPersonRecordTags({ profileId: 'p1', fromParentId: 'pcat', archivedAt: 5 });
    for (const t of tags) {
      expect(parsePersonRecordTags(tags.filter(x => x !== t))).toBeNull();
    }
  });
  it('is null when the timestamp is not numeric', () => {
    expect(parsePersonRecordTags([
      PERSON_FOLDER_TAG, 'hz-config-archive-profile-p1', 'hz-config-archive-from-pcat', 'hz-config-archive-at-xyz',
    ])).toBeNull();
  });
  it('archivedPersonEntry builds the list row', () => {
    const tags = buildPersonRecordTags({ profileId: 'p1', fromParentId: 'pcat', archivedAt: 9 });
    const folder = node('f1', 'persons', 'Alice Test', tags);
    expect(archivedPersonEntry(folder, [node('p1', 'f1', 'Alice Test')])).toEqual({
      folderId: 'f1', profileId: 'p1', inFolder: true, displayName: 'Alice Test', fromParentId: 'pcat', archivedAt: 9,
    });
    expect(archivedPersonEntry(folder, [])?.inFolder).toBe(false);
    expect(archivedPersonEntry(node('f2', 'persons', 'x', [PERSON_FOLDER_TAG]), [])).toBeNull();
  });
});

describe('runPersonArchive', () => {
  it('happy path: two assignments, folder created unlisted under a private Personnes', async () => {
    const fake = createFakeHazu(school());
    const { deps, roleCalls } = scripted(fake);
    const out = await runPersonArchive(baseInput({
      assignments: [
        { roomId: 'room-a', role: 'student', title: 'Classe A' },
        { roomId: 'room-b', role: 'student', title: 'Classe B' },
      ],
      liveRooms: rooms,
    }), deps);
    expect(out.success).toBe(true);
    expect(roleCalls.map(c => c.roomId)).toEqual(['room-a', 'room-b']);
    const creates = fake.calls.filter(c => c.op === 'create');
    expect(creates).toHaveLength(3);
    const [root, persons, folder] = creates.map(c => c.args);
    expect(root).toEqual(['admin', 'Archive', [ARCHIVE_ROOT_TAG], ARCHIVE_ROOT_PRIVACY]);
    expect(persons[1]).toBe(PERSONS_FOLDER_TITLE);
    expect(persons[3]).toBe('private');
    expect(folder[1]).toBe('Alice Test');
    expect(folder[3]).toBe('unlisted');
    expect(folder[2]).toEqual(buildPersonRecordTags({ profileId: 'p1', fromParentId: 'pcat', archivedAt: 1700000000000 }));
    expect(fake.nodes.get('p1')!.parentId).toBe(out.folderId);
    expect(fake.nodes.get(out.folderId!)!.tags).toContain(PERSON_FOLDER_TAG);
  });

  it('a tag-only live room gets a removeRole call; a tag of an unknown class does not and is not removed', async () => {
    const fake = createFakeHazu(school(['hz-config-class-cls-a-student', 'hz-config-class-cls-zzz-student']));
    const { deps, roleCalls } = scripted(fake, () => ({ success: true }));
    const out = await runPersonArchive(baseInput({ liveRooms: rooms }), deps);
    expect(out.success).toBe(true);
    expect(roleCalls).toEqual([{ roomId: 'room-a', role: 'student' }]);
    // the fake's removeRole does not touch tags, so the leftover live tag is removed in step 4
    expect(fake.calls.filter(c => c.op === 'removeTags').map(c => c.args)).toEqual([
      ['p1', ['hz-config-class-cls-a-student']],
    ]);
    expect(fake.nodes.get('p1')!.tags).toEqual(['hz-config-class-cls-zzz-student']);
  });

  it('a room already in assignments is not removed twice for its tag', async () => {
    const fake = createFakeHazu(school(['hz-config-class-cls-a-student']));
    const { deps, roleCalls } = scripted(fake);
    await runPersonArchive(baseInput({
      assignments: [{ roomId: 'room-a', role: 'student', title: 'Classe A' }],
      liveRooms: rooms,
    }), deps);
    expect(roleCalls).toHaveLength(1);
  });

  it('a second role in an assigned room, named only by a tag, gets its own removeRole call', async () => {
    const fake = createFakeHazu(school(['hz-config-class-cls-a-student', 'hz-config-class-cls-a-courseteacher']));
    const { deps, roleCalls } = scripted(fake);
    const out = await runPersonArchive(baseInput({
      assignments: [{ roomId: 'room-a', role: 'student', title: 'Classe A' }],
      liveRooms: rooms,
    }), deps);
    expect(out.success).toBe(true);
    expect(roleCalls).toEqual([
      { roomId: 'room-a', role: 'student' },
      { roomId: 'room-a', role: 'courseteacher' },
    ]);
  });

  it('one removeRole unconfirmed: failure, remaining names the room, nothing created or moved', async () => {
    const fake = createFakeHazu(school());
    const { deps, roleCalls } = scripted(fake, id => (id === 'room-b' ? { success: false, error: 'non confirmé' } : { success: true }));
    const out = await runPersonArchive(baseInput({
      assignments: [
        { roomId: 'room-a', role: 'student', title: 'Classe A' },
        { roomId: 'room-b', role: 'student', title: 'Classe B' },
      ],
      liveRooms: rooms,
    }), deps);
    expect(out.success).toBe(false);
    expect(out.remaining).toEqual(['Classe B']);
    expect(roleCalls).toHaveLength(2);
    expect(fake.count('create')).toBe(0);
    expect(fake.count('move')).toBe(0);
    expect(fake.count('removeTags')).toBe(0);
  });

  it('a removeRole that throws counts as unconfirmed', async () => {
    const fake = createFakeHazu(school());
    const { deps } = scripted(fake, () => { throw new Error('boom'); });
    const out = await runPersonArchive(baseInput({
      assignments: [{ roomId: 'room-a', role: 'student', title: 'Classe A' }],
      liveRooms: rooms,
    }), deps);
    expect(out.success).toBe(false);
    expect(out.remaining).toEqual(['Classe A']);
    expect(fake.count('move')).toBe(0);
  });

  it('a leftover tag that cannot be removed: failure naming the tag, no move', async () => {
    const fake = createFakeHazu(school(['hz-config-class-cls-a-student']));
    fake.deps.removeTags = async () => {};
    const { deps } = scripted({ ...fake, deps: fake.deps } as typeof fake);
    const out = await runPersonArchive(baseInput({ liveRooms: rooms }), deps);
    expect(out.success).toBe(false);
    expect(out.remaining).toEqual(['hz-config-class-cls-a-student']);
    expect(fake.count('create')).toBe(0);
    expect(fake.count('move')).toBe(0);
  });

  it('a person with no assignment and no class tag is moved', async () => {
    const fake = createFakeHazu(school());
    const { deps, roleCalls } = scripted(fake);
    const out = await runPersonArchive(baseInput({ liveRooms: rooms }), deps);
    expect(out.success).toBe(true);
    expect(roleCalls).toHaveLength(0);
    expect(fake.count('move')).toBe(1);
    expect(fake.nodes.get('p1')!.parentId).toBe(out.folderId);
  });

  it('re-run on an archived person: success, no create, no move, no removeRole', async () => {
    const fake = createFakeHazu(school());
    const first = scripted(fake);
    const a = await runPersonArchive(baseInput({ liveRooms: rooms }), first.deps);
    expect(a.success).toBe(true);
    const before = { create: fake.count('create'), move: fake.count('move') };
    const second = scripted(fake);
    const b = await runPersonArchive(baseInput({
      assignments: [{ roomId: 'room-a', role: 'student', title: 'Classe A' }],
      liveRooms: rooms,
    }), second.deps);
    expect(b.success).toBe(true);
    expect(fake.count('create')).toBe(before.create);
    expect(fake.count('move')).toBe(before.move);
    expect(second.roleCalls).toHaveLength(0);
    expect(b.steps.every(s => s.status === 'skipped')).toBe(true);
  });

  it('re-run after a stop between folder creation and move reuses the folder', async () => {
    const tags = buildPersonRecordTags({ profileId: 'p1', fromParentId: 'pcat', archivedAt: 5 });
    const fake = createFakeHazu(school([], [
      node('arch', 'admin', 'Archive', [ARCHIVE_ROOT_TAG]),
      node('pers', 'arch', 'Personnes', [PERSONS_FOLDER_TAG]),
      node('pf', 'pers', 'Alice Test', tags),
    ]));
    const { deps } = scripted(fake);
    const out = await runPersonArchive(baseInput(), deps);
    expect(out.success).toBe(true);
    expect(fake.count('create')).toBe(0);
    expect(out.folderId).toBe('pf');
    expect(fake.nodes.get('p1')!.parentId).toBe('pf');
  });

  it('move throws a transient failure but landed: success, move called once', async () => {
    const fake = createFakeHazu(school(), () => undefined, {
      moveLandsThenThrows: { status: 502, networkOrTimeout: false, message: 'bad gateway' },
    });
    const { deps } = scripted(fake);
    const out = await runPersonArchive(baseInput(), deps);
    expect(out.success).toBe(true);
    expect(fake.count('move')).toBe(1);
  });

  it('a move that never lands is a failure', async () => {
    const fake = createFakeHazu(school());
    fake.deps.move = async () => {};
    const { deps } = scripted(fake);
    const out = await runPersonArchive(baseInput(), deps);
    expect(out.success).toBe(false);
  });

  it('profile not under a known category: fail, nothing written', async () => {
    const fake = createFakeHazu(school());
    const { deps, roleCalls } = scripted(fake);
    const out = await runPersonArchive(baseInput({ categoryIds: ['other'] }), deps);
    expect(out.success).toBe(false);
    expect(out.error).toBe("le profil n'est plus dans son dossier d'origine");
    expect(roleCalls).toHaveLength(0);
    for (const op of ['create', 'move', 'removeTags'] as Op[]) expect(fake.count(op)).toBe(0);
  });

  it('unknown profile: fail', async () => {
    const fake = createFakeHazu(school());
    const { deps } = scripted(fake);
    const out = await runPersonArchive(baseInput({ person: { id: 'nope', displayName: 'X' } }), deps);
    expect(out.success).toBe(false);
    expect(fake.count('create')).toBe(0);
  });

  it('a record-looking folder that is not inside Personnes does not count as archived', async () => {
    const tags = buildPersonRecordTags({ profileId: 'p1', fromParentId: 'pcat', archivedAt: 5 });
    const fake = createFakeHazu([
      node('admin', 'root', 'Admin', ['hz-config-admin']),
      node('stray', 'root', 'Stray', tags),
      node('p1', 'stray', 'Alice Test', []),
    ]);
    const { deps } = scripted(fake);
    const out = await runPersonArchive(baseInput(), deps);
    expect(out.success).toBe(false);
    expect(fake.count('move')).toBe(0);
  });
});

describe('runPersonRestore', () => {
  const archived = (profileParent = 'pf', extra: HazuNode[] = []) => [
    node('admin', 'root', 'Admin', ['hz-config-admin']),
    node('pcat', 'root', 'Apprentis', ['hz-config-profile-student']),
    node('arch', 'admin', 'Archive', [ARCHIVE_ROOT_TAG]),
    node('pers', 'arch', 'Personnes', [PERSONS_FOLDER_TAG]),
    node('pf', 'pers', 'Alice Test', buildPersonRecordTags({ profileId: 'p1', fromParentId: 'pcat', archivedAt: 5 })),
    node('p1', profileParent, 'Alice Test', []),
    ...extra,
  ];
  const rin = { folderId: 'pf', adminId: 'admin', categoryIds: ['pcat'] };

  it('happy path: profile back, empty folder removed', async () => {
    const fake = createFakeHazu(archived());
    const out = await runPersonRestore(rin, fake.deps);
    expect(out.success).toBe(true);
    expect(fake.nodes.get('p1')!.parentId).toBe('pcat');
    expect(fake.nodes.has('pf')).toBe(false);
  });

  it('origin gone: fail and folder kept', async () => {
    const fake = createFakeHazu(archived());
    const out = await runPersonRestore({ ...rin, categoryIds: [] }, fake.deps);
    expect(out.success).toBe(false);
    expect(out.error).toBe("dossier d'origine introuvable");
    expect(fake.count('move')).toBe(0);
    expect(fake.nodes.has('pf')).toBe(true);
  });

  it('origin deleted in Hazu: fail and folder kept', async () => {
    const fake = createFakeHazu(archived().filter(n => n.id !== 'pcat'));
    const out = await runPersonRestore(rin, fake.deps);
    expect(out.success).toBe(false);
    expect(fake.nodes.has('pf')).toBe(true);
  });

  it('folder not under Personnes: fail', async () => {
    const nodes = archived().map(n => (n.id === 'pf' ? { ...n, parentId: 'arch' } : n));
    const fake = createFakeHazu(nodes);
    const out = await runPersonRestore(rin, fake.deps);
    expect(out.success).toBe(false);
    expect(fake.count('move')).toBe(0);
    expect(fake.count('remove')).toBe(0);
  });

  it('record incomplete: fail', async () => {
    const nodes = archived().map(n => (n.id === 'pf' ? { ...n, tags: [PERSON_FOLDER_TAG] } : n));
    const fake = createFakeHazu(nodes);
    const out = await runPersonRestore(rin, fake.deps);
    expect(out.success).toBe(false);
    expect(fake.count('move')).toBe(0);
  });

  it('profile already back: no move, folder removed, success', async () => {
    const fake = createFakeHazu(archived('pcat'));
    const out = await runPersonRestore(rin, fake.deps);
    expect(out.success).toBe(true);
    expect(fake.count('move')).toBe(0);
    expect(fake.nodes.has('pf')).toBe(false);
  });

  it('folder not empty after the move: kept, success false', async () => {
    const fake = createFakeHazu(archived('pf', [node('other', 'pf', 'Stray', [])]));
    const out = await runPersonRestore(rin, fake.deps);
    expect(out.success).toBe(false);
    expect(fake.nodes.has('pf')).toBe(true);
    expect(fake.count('remove')).toBe(0);
  });

  it('move never lands: folder kept, success false', async () => {
    const fake = createFakeHazu(archived());
    fake.deps.move = async () => {};
    const out = await runPersonRestore(rin, fake.deps);
    expect(out.success).toBe(false);
    expect(fake.nodes.has('pf')).toBe(true);
  });
});

describe('syncState', () => {
  const now = 1700000000000;
  const H = 60 * 60 * 1000;
  it('a recent completed sync: complete, not stale', () => {
    expect(syncState(String(now - H), false, now)).toEqual({ incomplete: false, stale: false, lastSyncAt: now - H });
  });
  it('older than 24 h: complete but stale (a warning, not a refusal)', () => {
    expect(syncState(String(now - 25 * H), false, now)).toEqual({ incomplete: false, stale: true, lastSyncAt: now - 25 * H });
  });
  it("'0' (seed, or a sync that started and never finished): incomplete", () => {
    expect(syncState('0', false, now)).toEqual({ incomplete: true, stale: true, lastSyncAt: null });
  });
  it('null, empty or not a number: incomplete', () => {
    for (const raw of [null, '', 'abc', '-5']) {
      expect(syncState(raw, false, now).incomplete).toBe(true);
    }
  });
  it('a sync running now: incomplete even with a good timestamp', () => {
    expect(syncState(String(now - H), true, now)).toEqual({ incomplete: true, stale: false, lastSyncAt: now - H });
  });
});
