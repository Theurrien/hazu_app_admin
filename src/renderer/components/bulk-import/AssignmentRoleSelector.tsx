import React, { useEffect, useState } from 'react';

interface UserType {
  id: string;
  name: string;
  title: string;
}

interface AssignmentRoleSelectorProps {
  selectedRole: string | null;
  onRoleChange: (role: string) => void;
  disabled?: boolean;
}

export function AssignmentRoleSelector({
  selectedRole,
  onRoleChange,
  disabled = false,
}: AssignmentRoleSelectorProps) {
  const [userTypes, setUserTypes] = useState<UserType[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadUserTypes = async () => {
      setIsLoading(true);
      try {
        const types = await window.electronAPI.getUserTypes();
        setUserTypes(types);
      } catch (error) {
        console.error('Failed to load user types:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadUserTypes();
  }, []);

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-24 mb-3"></div>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-gray-200 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  if (userTypes.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No roles available. Please run sync first.
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-3">
        Role <span className="text-red-500">*</span>
      </label>
      <div className="grid grid-cols-3 gap-2">
        {userTypes.map((type) => (
          <label
            key={type.id}
            className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
              selectedRole === type.name
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              name="assignmentRole"
              value={type.name}
              checked={selectedRole === type.name}
              onChange={(e) => onRoleChange(e.target.value)}
              className="w-4 h-4 text-blue-600"
              disabled={disabled}
            />
            <span className="text-sm font-medium text-gray-900">
              {type.title}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
