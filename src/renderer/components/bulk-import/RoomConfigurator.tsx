import React from 'react';

interface Template {
  id: string;
  title: string;
  roomType: string;
}

interface RoomConfig {
  newName: string;
  templateId: string | null;
}

interface RoomConfiguratorProps {
  originalName: string;
  config: RoomConfig;
  templates: Template[];
  onConfigChange: (config: RoomConfig) => void;
  isLoadingTemplates: boolean;
}

export function RoomConfigurator({
  originalName,
  config,
  templates,
  onConfigChange,
  isLoadingTemplates,
}: RoomConfiguratorProps) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4">
      {/* Original name display */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Original Name (from file)
        </label>
        <div className="text-sm font-medium text-gray-900">{originalName}</div>
      </div>

      {/* New name input */}
      <div>
        <label htmlFor="newName" className="block text-xs font-medium text-gray-500 mb-1">
          Room Name (can be customized)
        </label>
        <input
          id="newName"
          type="text"
          value={config.newName}
          onChange={(e) => onConfigChange({ ...config, newName: e.target.value })}
          placeholder={originalName}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Template selection */}
      <div>
        <label htmlFor="template" className="block text-xs font-medium text-gray-500 mb-1">
          Template
        </label>
        {isLoadingTemplates ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
            Loading templates...
          </div>
        ) : templates.length === 0 ? (
          <div className="text-sm text-gray-500">
            No templates available. Select a room type first.
          </div>
        ) : (
          <select
            id="template"
            value={config.templateId || ''}
            onChange={(e) => onConfigChange({ ...config, templateId: e.target.value || null })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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

      {/* Status indicator */}
      {config.templateId && (
        <div className="flex items-center gap-2 text-sm text-green-700">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Ready to create
        </div>
      )}
    </div>
  );
}
