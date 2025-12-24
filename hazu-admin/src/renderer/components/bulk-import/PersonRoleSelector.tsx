interface PersonRoleSelectorProps {
  selectedRole: string | null;
  onRoleChange: (role: string) => void;
  disabled?: boolean;
}

export const roleLabels: Record<string, string> = {
  student: 'Student',
  companymentor: 'Company Mentor',
  schoolteacher: 'School Teacher',
  courseteacher: 'Course Teacher',
  stateadvisor: 'State Advisor',
  guardian: 'Guardian',
};

export function PersonRoleSelector({ selectedRole, onRoleChange, disabled = false }: PersonRoleSelectorProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-3">
        Role <span className="text-red-500">*</span>
      </label>
      <div className="grid grid-cols-3 gap-2">
        {Object.entries(roleLabels).map(([role, label]) => (
          <label
            key={role}
            className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
              selectedRole === role
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              name="role"
              value={role}
              checked={selectedRole === role}
              onChange={(e) => onRoleChange(e.target.value)}
              className="w-4 h-4 text-blue-600"
              disabled={disabled}
            />
            <span className="text-sm font-medium text-gray-900">
              {label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
