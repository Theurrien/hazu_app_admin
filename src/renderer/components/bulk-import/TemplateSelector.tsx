import React from 'react';

interface TemplateSelectorProps {
  // Template data
  templates: Array<{ id: string; title: string }>;
  isLoadingTemplates: boolean;

  // Default mode (single template)
  selectedTemplateId: string | null;
  onTemplateChange: (templateId: string | null) => void;

  // Grouping mode
  useGrouping: boolean;
  onUseGroupingChange: (useGrouping: boolean) => void;
  groupingColumn: string | null;
  onGroupingColumnChange: (column: string | null) => void;
  templatesByGroup: Map<string, string>; // groupValue → templateId
  onTemplatesByGroupChange: (map: Map<string, string>) => void;

  // Available columns for grouping (from file headers)
  availableColumns: string[];

  // Unique values for selected grouping column
  uniqueGroupValues: string[];

  disabled?: boolean;
}

export function TemplateSelector({
  templates,
  isLoadingTemplates,
  selectedTemplateId,
  onTemplateChange,
  useGrouping,
  onUseGroupingChange,
  groupingColumn,
  onGroupingColumnChange,
  templatesByGroup,
  onTemplatesByGroupChange,
  availableColumns,
  uniqueGroupValues,
  disabled = false,
}: TemplateSelectorProps) {
  const [selectedGroupValue, setSelectedGroupValue] = React.useState<string | null>(null);

  // Auto-select first group value when column changes
  React.useEffect(() => {
    if (uniqueGroupValues.length > 0 && !selectedGroupValue) {
      setSelectedGroupValue(uniqueGroupValues[0]);
    } else if (uniqueGroupValues.length === 0) {
      setSelectedGroupValue(null);
    }
  }, [uniqueGroupValues]);

  // Auto-select template if only one option (default mode)
  React.useEffect(() => {
    if (!useGrouping && templates.length === 1 && !selectedTemplateId) {
      onTemplateChange(templates[0].id);
    }
  }, [templates, useGrouping]);

  const handleGroupValueClick = (value: string) => {
    setSelectedGroupValue(value);
  };

  const handleTemplateChangeForGroup = (templateId: string) => {
    if (!selectedGroupValue) return;

    const newMap = new Map(templatesByGroup);
    if (templateId) {
      newMap.set(selectedGroupValue, templateId);
    } else {
      newMap.delete(selectedGroupValue);
    }
    onTemplatesByGroupChange(newMap);
  };

  const hasTemplateForGroupValue = (value: string): boolean => {
    return templatesByGroup.has(value) && !!templatesByGroup.get(value);
  };

  return (
    <div className="space-y-4">
      {/* Default mode - single template selection */}
      {!useGrouping && (
        <div>
          <label htmlFor="template" className="block text-sm font-medium text-gray-700 mb-2">
            Template <span className="text-red-500">*</span>
          </label>

          {isLoadingTemplates ? (
            <div className="flex items-center gap-2 text-gray-600 py-2">
              <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
              <span className="text-sm">Loading templates...</span>
            </div>
          ) : templates.length === 0 ? (
            <div className="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg border border-gray-200">
              No templates available
            </div>
          ) : (
            <select
              id="template"
              value={selectedTemplateId || ''}
              onChange={(e) => onTemplateChange(e.target.value || null)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={disabled || isLoadingTemplates}
            >
              {templates.length > 1 && <option value="">Select template...</option>}
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.title}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Toggle for grouping mode */}
      <div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={useGrouping}
            onChange={(e) => onUseGroupingChange(e.target.checked)}
            className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            disabled={disabled}
          />
          <span className="text-sm font-medium text-gray-700">
            Different templates per group
          </span>
        </label>
      </div>

      {/* Grouping mode */}
      {useGrouping && (
        <div className="space-y-4 pl-7">
          {/* Column selector */}
          <div>
            <label htmlFor="groupingColumn" className="block text-sm font-medium text-gray-700 mb-2">
              Column
            </label>
            {availableColumns.length === 0 ? (
              <div className="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg border border-gray-200">
                No columns available
              </div>
            ) : (
              <select
                id="groupingColumn"
                value={groupingColumn || ''}
                onChange={(e) => onGroupingColumnChange(e.target.value || null)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={disabled}
              >
                <option value="">Select column...</option>
                {availableColumns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Group value tabs */}
          {groupingColumn && uniqueGroupValues.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2">
                {uniqueGroupValues.map((value) => {
                  const hasTemplate = hasTemplateForGroupValue(value);
                  const isSelected = selectedGroupValue === value;

                  return (
                    <button
                      key={value}
                      onClick={() => handleGroupValueClick(value)}
                      disabled={disabled}
                      className={`
                        flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                        ${isSelected
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}
                        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
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

              {/* Template selector for selected group value */}
              {selectedGroupValue && (
                <div>
                  <label htmlFor="groupTemplate" className="block text-sm font-medium text-gray-700 mb-2">
                    Template for "{selectedGroupValue}"
                  </label>

                  {isLoadingTemplates ? (
                    <div className="flex items-center gap-2 text-gray-600 py-2">
                      <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                      <span className="text-sm">Loading templates...</span>
                    </div>
                  ) : templates.length === 0 ? (
                    <div className="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      No templates available
                    </div>
                  ) : (
                    <select
                      id="groupTemplate"
                      value={templatesByGroup.get(selectedGroupValue) || ''}
                      onChange={(e) => handleTemplateChangeForGroup(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={disabled || isLoadingTemplates}
                    >
                      <option value="">Select template...</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
