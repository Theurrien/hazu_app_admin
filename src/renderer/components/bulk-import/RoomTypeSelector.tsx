import React from 'react';
import type { RoomType } from '../../../shared/types';

interface RoomTypeSelectorProps {
  selectedType: RoomType | null;
  onTypeChange: (type: RoomType) => void;
  disabled?: boolean;
}

const roomTypes: { value: RoomType; label: string }[] = [
  { value: 'class', label: 'Class' },
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'state', label: 'State' },
  { value: 'cie', label: 'CIE' },
];

export function RoomTypeSelector({
  selectedType,
  onTypeChange,
  disabled = false,
}: RoomTypeSelectorProps) {
  return (
    <div className="flex flex-wrap gap-4">
      {roomTypes.map((type) => (
        <label
          key={type.value}
          className={`
            flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer transition-colors
            ${selectedType === type.value
              ? 'border-blue-500 bg-blue-50 text-blue-800'
              : 'border-gray-300 hover:border-gray-400'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <input
            type="radio"
            name="roomType"
            value={type.value}
            checked={selectedType === type.value}
            onChange={() => onTypeChange(type.value)}
            disabled={disabled}
            className="w-4 h-4 text-blue-600"
          />
          <span className="text-sm font-medium">{type.label}</span>
        </label>
      ))}
    </div>
  );
}
