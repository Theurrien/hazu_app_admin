import React, { useEffect, useRef } from 'react';

export type ColumnMapping = 'firstName' | 'lastName' | 'email' | 'grouping1' | 'grouping2' | 'templateGroup';

interface ColumnMappingDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (mapping: ColumnMapping | null) => void;
  currentMapping: ColumnMapping | null;
  usedMappings: ColumnMapping[];
  showTemplateGroup?: boolean;
}

const mappingLabels: Record<ColumnMapping, string> = {
  firstName: 'First Name',
  lastName: 'Last Name',
  email: 'Email',
  grouping1: 'Grouping 1',
  grouping2: 'Grouping 2',
  templateGroup: 'Template Group',
};

const ColumnMappingDropdown: React.FC<ColumnMappingDropdownProps> = ({
  isOpen,
  onClose,
  onSelect,
  currentMapping,
  usedMappings,
  showTemplateGroup = false,
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close dropdown
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelect = (mapping: ColumnMapping | null) => {
    onSelect(mapping);
    onClose();
  };

  const isDisabled = (mapping: ColumnMapping): boolean => {
    return usedMappings.includes(mapping) && currentMapping !== mapping;
  };

  const renderOption = (mapping: ColumnMapping) => {
    const disabled = isDisabled(mapping);
    const selected = currentMapping === mapping;

    return (
      <button
        key={mapping}
        type="button"
        onClick={() => !disabled && handleSelect(mapping)}
        disabled={disabled}
        className={`
          w-full flex items-center gap-2 px-3 py-2 text-left text-sm
          ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-100 cursor-pointer'}
          transition-colors
        `}
      >
        <span className="flex-shrink-0 w-4 h-4 rounded-full border border-gray-400 flex items-center justify-center">
          {selected && (
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
          )}
        </span>
        <span className={disabled ? 'text-gray-400' : 'text-gray-700'}>
          {mappingLabels[mapping]}
        </span>
      </button>
    );
  };

  const basicMappings: ColumnMapping[] = ['firstName', 'lastName', 'email'];
  const groupingMappings: ColumnMapping[] = ['grouping1', 'grouping2'];

  return (
    <div
      ref={dropdownRef}
      className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 min-w-[200px]"
    >
      <div className="py-1">
        {/* Basic mappings */}
        {basicMappings.map(renderOption)}

        {/* Separator */}
        <div className="border-t border-gray-200 my-1"></div>

        {/* Grouping mappings */}
        {groupingMappings.map(renderOption)}

        {/* Template Group (conditional) */}
        {showTemplateGroup && (
          <>
            <div className="border-t border-gray-200 my-1"></div>
            {renderOption('templateGroup')}
          </>
        )}

        {/* Separator before Clear */}
        <div className="border-t border-gray-200 my-1"></div>

        {/* Clear option */}
        <button
          type="button"
          onClick={() => handleSelect(null)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 cursor-pointer transition-colors"
        >
          <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-gray-500">
            ✕
          </span>
          <span className="text-gray-700">Clear</span>
        </button>
      </div>
    </div>
  );
};

export default ColumnMappingDropdown;
