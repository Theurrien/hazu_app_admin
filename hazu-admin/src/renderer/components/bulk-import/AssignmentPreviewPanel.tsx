import React, { useState } from 'react';

export interface PreviewAssignment {
  personId: string;
  personName: string;
  personEmail: string;
  roomId: string;
  roomName: string;
  role: string;
  existingRole: string | null; // null = new assignment, string = already has this role
}

interface AssignmentPreviewPanelProps {
  assignments: PreviewAssignment[];
  availableRoles: string[];
  excludedKeys: Set<string>; // Set of "personId:roomId" keys
  roleOverrides: Map<string, string>; // Map of "personId:roomId" -> overridden role
  onToggleExclude: (key: string) => void;
  onRoleChange: (key: string, newRole: string) => void;
  onToggleAll: (included: boolean) => void;
}

function makeKey(personId: string, roomId: string) {
  return `${personId}:${roomId}`;
}

export function AssignmentPreviewPanel({
  assignments,
  availableRoles,
  excludedKeys,
  roleOverrides,
  onToggleExclude,
  onRoleChange,
  onToggleAll,
}: AssignmentPreviewPanelProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const includedCount = assignments.filter(
    (a) => !excludedKeys.has(makeKey(a.personId, a.roomId))
  ).length;

  const newCount = assignments.filter((a) => !a.existingRole).length;
  const existingCount = assignments.length - newCount;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-800">Assignment Preview</h3>
        </div>
        <span className="text-sm text-gray-500">
          {includedCount} of {assignments.length} selected
          {existingCount > 0 && (
            <span className="ml-2 text-amber-600">
              ({existingCount} already assigned)
            </span>
          )}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-2 text-left w-10">
                <input
                  type="checkbox"
                  checked={includedCount === assignments.length}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Person
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Room
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Role
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {assignments.map((a) => {
              const key = makeKey(a.personId, a.roomId);
              const excluded = excludedKeys.has(key);
              const currentRole = roleOverrides.get(key) || a.role;
              const isEditing = editingKey === key;

              return (
                <tr
                  key={key}
                  className={excluded ? 'opacity-50 bg-gray-50' : ''}
                >
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={!excluded}
                      onChange={() => onToggleExclude(key)}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                  </td>
                  <td className="px-4 py-2 text-gray-900">{a.personName}</td>
                  <td className="px-4 py-2 text-gray-700">{a.roomName}</td>
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <select
                        value={currentRole}
                        onChange={(e) => {
                          onRoleChange(key, e.target.value);
                          setEditingKey(null);
                        }}
                        onBlur={() => setEditingKey(null)}
                        autoFocus
                        className="text-sm border border-gray-300 rounded px-2 py-1"
                      >
                        {availableRoles.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <button
                        onClick={() => setEditingKey(key)}
                        className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                        title="Click to change role"
                      >
                        {currentRole}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {a.existingRole ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                        Already: {a.existingRole}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                        New
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
