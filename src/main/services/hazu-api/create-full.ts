// Pure wire helpers for the full create (level change copy) — no IO, vitest-runnable.
// Wire format mirrors the Maintenance deep copy (Hazu-App-Maintenance/hazu-copy.ts:74-86 builds the
// options from the source snapshot; its api.ts:160-243 turns them into the body: description, colour
// and icon only when set, colour upper-cased, `event.rolesSettings` as a dotted key, tags as given).

export interface CreateFullOptions {
  parentId: string;
  type: string;
  title: string;
  description: string;
  icon: string | null;
  color: string | null;
  privacy: string | null;
  tags: string[];
  authorId: string;
  displayName: string;
  /** the source's `event.rolesSettings`, carried as is (Maintenance `preservePermissions: true`) */
  rolesSettings?: unknown | null;
}

export function buildCreateFullBody(o: CreateFullOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    parentId: o.parentId,
    title: o.title,
    authorId: o.authorId,
    displayName: o.displayName,
    tags: [...o.tags],
  };
  if (o.type) body.type = o.type;
  if (o.description) body.description = o.description;
  if (o.color) body.color = o.color.toUpperCase();
  if (o.icon) body.icon = o.icon;
  if (o.privacy) body.privacy = o.privacy;
  if (o.rolesSettings !== undefined && o.rolesSettings !== null) body['event.rolesSettings'] = o.rolesSettings;
  return body;
}

/** The new id from a /create response: `key | snapshot.key | id | data.key` (hazu-copy.ts:97-107). */
export function createdIdOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, any>;
  const id = d.key || d.snapshot?.key || d.id || d.data?.key;
  return typeof id === 'string' && id ? id : null;
}
