/**
 * Contrôle, step 1 — pure decisions about the column mapping and the sheet rows. No IO, no React.
 */
import type { SheetPerson } from '../../../../shared/person-match';
import type { RoomCategory } from '../../../../shared/correspondence';
import type { ColumnMapping } from '../ColumnMappingDropdown';

export interface ControleColumns {
  email?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  class?: string;
  company?: string;
  canton?: string;
}

const KEY_OF: Record<string, keyof ControleColumns> = {
  ctlEmail: 'email',
  ctlFirstName: 'firstName',
  ctlLastName: 'lastName',
  ctlFullName: 'fullName',
  ctlClass: 'class',
  ctlCompany: 'company',
  ctlCanton: 'canton',
};

/** Header names by meaning, read from the header → mapping record. */
export function controleColumns(mappings: Record<string, ColumnMapping>): ControleColumns {
  const out: ControleColumns = {};
  for (const [header, mapping] of Object.entries(mappings)) {
    const key = KEY_OF[mapping];
    if (key) out[key] = header;
  }
  return out;
}

export function columnsReady(c: ControleColumns): { ok: true } | { ok: false; reason: string } {
  const named = !!c.fullName || !!c.email;
  if (!c.email && !c.fullName && !c.firstName && !c.lastName) {
    return { ok: false, reason: 'Choisissez une colonne e-mail ou nom.' };
  }
  if (!named && (!c.firstName || !c.lastName)) {
    return { ok: false, reason: 'Prénom et nom vont ensemble.' };
  }
  if (!c.class && !c.company && !c.canton) {
    return { ok: false, reason: 'Choisissez au moins une colonne classe, entreprise ou canton.' };
  }
  return { ok: true };
}

/** The room categories that have a column, always in the order class, enterprise, state. */
export function mappedCategories(c: ControleColumns): RoomCategory[] {
  const out: RoomCategory[] = [];
  if (c.class) out.push('class');
  if (c.company) out.push('enterprise');
  if (c.canton) out.push('state');
  return out;
}

/**
 * Sheet rows as SheetPerson (rowIndex = index in `rows`; rows with no e-mail and no name are left
 * out) plus, per row index, the trimmed non-empty room cells. A row without identity can still
 * have cells in the map; a row without cells is absent from it.
 */
export function checkRows(
  rows: Record<string, string>[],
  c: ControleColumns,
): { sheet: SheetPerson[]; cells: Map<number, Partial<Record<RoomCategory, string>>> } {
  const cell = (row: Record<string, string>, col: string | undefined): string | undefined => {
    if (!col) return undefined;
    const v = (row[col] ?? '').toString().trim();
    return v === '' ? undefined : v;
  };
  const sheet: SheetPerson[] = [];
  const cells = new Map<number, Partial<Record<RoomCategory, string>>>();
  rows.forEach((row, rowIndex) => {
    const p: SheetPerson = {
      rowIndex,
      email: cell(row, c.email),
      firstName: cell(row, c.firstName),
      lastName: cell(row, c.lastName),
      fullName: cell(row, c.fullName),
    };
    if (p.email || p.firstName || p.lastName || p.fullName) sheet.push(p);
    const found: Partial<Record<RoomCategory, string>> = {};
    const cls = cell(row, c.class);
    const ent = cell(row, c.company);
    const st = cell(row, c.canton);
    if (cls) found.class = cls;
    if (ent) found.enterprise = ent;
    if (st) found.state = st;
    if (Object.keys(found).length > 0) cells.set(rowIndex, found);
  });
  return { sheet, cells };
}

export interface ControleState {
  step: 1 | 2 | 3;
  mappings: Record<string, ColumnMapping>;
  ticked: Set<string>;
}

/** A new (or cleared) file: back to step 1, nothing mapped or ticked. Saved links are never touched. */
export function resetForNewFile(): ControleState {
  return { step: 1, mappings: {}, ticked: new Set() };
}
