import React, { useMemo, useState } from 'react';
import type { CorrCategory, RoomCandidate, RoomCategory, SavedLink } from '../../../../shared/correspondence';
import type { HazuPerson } from '../../../../shared/person-match';
import { CATEGORY_TITLE, RoomPicker } from './RoomCorrespondencePanel';
import { roomLabel } from './controle-logic';
import { StudentPicker } from './StudentCorrespondencePanel';

const ORDER: CorrCategory[] = ['student', 'class', 'enterprise', 'state'];
const TITLE: Record<CorrCategory, string> = { student: 'Élèves', ...CATEGORY_TITLE };

interface DrawerProps {
  saved: SavedLink[];
  rooms: Record<RoomCategory, RoomCandidate[]>;
  students: HazuPerson[];
  busy: boolean;
  error: string | null;
  /** hazuId null = ignored. */
  onChange: (link: SavedLink, hazuId: string | null) => void;
  onDelete: (link: SavedLink) => void;
  onClose: () => void;
}

const keyOf = (l: SavedLink) => `${l.category}|${l.fileKey}`;

/** « Correspondances enregistrées » — every saved link, not only those of the current file. */
export function SavedCorrespondencesDrawer({ saved, rooms, students, busy, error, onChange, onDelete, onClose }: DrawerProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const studentsById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const roomsById = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(rooms) as RoomCategory[]).map((c) => [c, new Map(rooms[c].map((r) => [r.id, r]))]),
      ) as Record<RoomCategory, Map<string, RoomCandidate>>,
    [rooms],
  );

  const groups = ORDER.map((category) => ({
    category,
    links: saved
      .filter((l) => l.category === category)
      .sort((a, b) => a.fileLabel.localeCompare(b.fileLabel, 'fr')),
  })).filter((g) => g.links.length > 0);

  const target = (l: SavedLink): { text: string; stale: boolean } => {
    if (l.hazuId === null) return { text: 'ignoré', stale: false };
    if (l.category === 'student') {
      const p = studentsById.get(l.hazuId);
      return p ? { text: p.displayName, stale: false } : { text: 'lien périmé', stale: true };
    }
    const r = roomsById[l.category].get(l.hazuId);
    return r ? { text: roomLabel(r, rooms[l.category]), stale: false } : { text: 'lien périmé', stale: true };
  };

  const change = (l: SavedLink, hazuId: string | null) => {
    setEditing(null);
    onChange(l, hazuId);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="h-full w-full max-w-xl bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        aria-label="Correspondances enregistrées"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Correspondances enregistrées</h3>
          <button type="button" className="text-sm text-gray-500 hover:underline" onClick={onClose}>
            Fermer
          </button>
        </header>
        {error && <p className="px-4 py-2 text-sm text-red-700 bg-red-50">{error}</p>}
        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 && <p className="px-4 py-3 text-sm text-gray-500">Aucune correspondance enregistrée.</p>}
          {groups.map((g) => (
            <section key={g.category}>
              <h4 className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 bg-gray-50">
                {TITLE[g.category]} ({g.links.length})
              </h4>
              <ul className="divide-y divide-gray-100">
                {g.links.map((l) => {
                  const t = target(l);
                  const k = keyOf(l);
                  return (
                    <li key={k} className="px-4 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 truncate">{l.fileLabel}</span>
                        <span className={t.stale ? 'text-amber-700' : l.hazuId === null ? 'text-gray-500' : 'text-gray-700'}>
                          → {t.text}
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-gray-400">
                          {new Date(l.decidedAt).toLocaleDateString('fr-CH')}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-xs text-blue-600 hover:underline"
                          onClick={() => setEditing(editing === k ? null : k)}
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className="shrink-0 text-xs text-red-600 hover:underline disabled:text-gray-400"
                          onClick={() => onDelete(l)}
                        >
                          Supprimer
                        </button>
                      </div>
                      {editing === k &&
                        (l.category === 'student' ? (
                          <StudentPicker
                            students={students}
                            studentsById={studentsById}
                            candidateIds={l.hazuId && studentsById.has(l.hazuId) ? [l.hazuId] : []}
                            busy={busy}
                            onPick={(id) => change(l, id)}
                            onIgnore={() => change(l, null)}
                            onCancel={() => setEditing(null)}
                          />
                        ) : (
                          <RoomPicker
                            candidates={rooms[l.category]}
                            initialId={l.hazuId && roomsById[l.category].has(l.hazuId) ? l.hazuId : null}
                            busy={busy}
                            onConfirm={(id) => change(l, id)}
                            onIgnore={() => change(l, null)}
                            onCancel={() => setEditing(null)}
                          />
                        ))}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}
