import React, { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExternalLinkAlt, faXmark } from '@fortawesome/free-solid-svg-icons';

interface Student {
  id: string;
  display_name: string;
  icon: string;
  color: string;
  mission_count: number;
  enterprise_name: string | null;
}

interface MissionStudentListProps {
  selection: {
    professionIcon: string;
    level: string;
    levelColor: string;
    missionCount: number;
  } | null;
  lieu: string | null;
  classId: string | null;
  onClose: () => void;
}

export function MissionStudentList({ selection, lieu, classId, onClose }: MissionStudentListProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selection) {
      setStudents([]);
      return;
    }

    setLoading(true);
    window.electronAPI.missionGetStudents({
      professionIcon: selection.professionIcon,
      levelColor: selection.levelColor,
      missionCount: selection.missionCount,
      lieu,
      classId,
    }).then(result => {
      setStudents(result);
      setLoading(false);
    });
  }, [selection, lieu, classId]);

  if (!selection) return null;

  const handleOpenProfile = async (studentId: string) => {
    const config = await window.electronAPI.getApiConfig();
    const env = config.environment || 'swiss';
    const baseUrl = env === 'swiss' ? 'https://hazu.swiss' : env === 'io' ? 'https://hazu.io' : 'https://dev.hazu.swiss';
    window.electronAPI.openExternal(`${baseUrl}/${studentId}`);
  };

  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: 'var(--hazu-card-bg)',
        border: '1px solid var(--hazu-border)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--hazu-text)' }}>
          {selection.professionIcon} {selection.level} — {selection.missionCount} MPE
          <span className="ml-2 font-normal" style={{ color: 'var(--hazu-text-muted)' }}>
            ({students.length} students)
          </span>
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 transition-colors"
          style={{ color: 'var(--hazu-text-muted)' }}
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--hazu-text-muted)' }}>Loading...</p>
      ) : students.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--hazu-text-muted)' }}>No students found.</p>
      ) : (
        <div className="overflow-auto max-h-80">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-left text-xs uppercase tracking-wider"
                style={{ color: 'var(--hazu-text-muted)' }}
              >
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Enterprise</th>
                <th className="pb-2 pr-4">Missions</th>
                <th className="pb-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {students.map(student => (
                <tr
                  key={student.id}
                  className="border-t"
                  style={{ borderColor: 'var(--hazu-border)' }}
                >
                  <td className="py-2 pr-4" style={{ color: 'var(--hazu-text)' }}>
                    {student.display_name}
                  </td>
                  <td className="py-2 pr-4" style={{ color: 'var(--hazu-text-muted)' }}>
                    {student.enterprise_name || '—'}
                  </td>
                  <td className="py-2 pr-4" style={{ color: 'var(--hazu-text-muted)' }}>
                    {student.mission_count}
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => handleOpenProfile(student.id)}
                      className="p-1 rounded hover:bg-gray-100 transition-colors"
                      style={{ color: 'var(--hazu-primary)' }}
                      title="Open profile"
                    >
                      <FontAwesomeIcon icon={faExternalLinkAlt} className="text-xs" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
