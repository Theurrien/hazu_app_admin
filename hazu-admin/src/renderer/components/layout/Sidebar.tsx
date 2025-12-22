import React from 'react';

type Page = 'dashboard' | 'rooms' | 'persons' | 'matrix' | 'sync' | 'settings';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

interface NavItem {
  id: Page;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'rooms', label: 'Rooms', icon: '🏠' },
  { id: 'persons', label: 'Persons', icon: '👥' },
  { id: 'matrix', label: 'Matrix', icon: '📋' },
  { id: 'sync', label: 'Sync', icon: '🔄' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col">
      {/* App Title */}
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold">Hazu Admin</h1>
        <p className="text-xs text-gray-400 mt-1">Platform Management</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  currentPage === item.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
        <p>Version 1.0.0</p>
      </div>
    </aside>
  );
}

export default Sidebar;
