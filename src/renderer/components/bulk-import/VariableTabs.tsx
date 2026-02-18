import React from 'react';

interface RoomConfig {
  newName: string;
  templateId: string | null;
}

interface VariableTabsProps {
  uniqueValues: string[];
  roomConfigs: Map<string, RoomConfig>;
  selectedValue: string | null;
  onSelectValue: (value: string) => void;
}

export function VariableTabs({
  uniqueValues,
  roomConfigs,
  selectedValue,
  onSelectValue,
}: VariableTabsProps) {
  if (uniqueValues.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {uniqueValues.map((value) => {
        const config = roomConfigs.get(value);
        const hasTemplate = !!config?.templateId;
        const isSelected = selectedValue === value;

        return (
          <button
            key={value}
            onClick={() => onSelectValue(value)}
            className={`
              flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors
              ${isSelected
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}
            `}
          >
            {hasTemplate && (
              <svg
                className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-green-600'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
            <span className="truncate max-w-32">{value}</span>
          </button>
        );
      })}
    </div>
  );
}
