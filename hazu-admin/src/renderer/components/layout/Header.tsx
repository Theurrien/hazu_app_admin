import React from 'react';

type Page = 'dashboard' | 'rooms' | 'persons' | 'assignments' | 'sync' | 'settings';

interface HeaderProps {
  currentPage: Page;
}

const pageTitles: Record<Page, string> = {
  dashboard: 'Dashboard',
  rooms: 'Rooms Management',
  persons: 'Persons Management',
  assignments: 'Assignments',
  sync: 'Synchronization',
  settings: 'Settings',
};

function Header({ currentPage }: HeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
      <div>
        <h2 className="text-2xl font-semibold text-gray-800">
          {pageTitles[currentPage]}
        </h2>
      </div>
      <div className="flex items-center gap-4">
        {/* Sync status indicator */}
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
          <span>Connected</span>
        </div>
      </div>
    </header>
  );
}

export default Header;
