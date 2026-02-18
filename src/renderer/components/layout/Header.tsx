import React from 'react';

type Page = 'dashboard' | 'rooms' | 'persons' | 'matrix' | 'import' | 'settings';

interface HeaderProps {
  currentPage: Page;
}

const pageTitles: Record<Page, string> = {
  dashboard: 'Dashboard',
  rooms: 'Rooms',
  persons: 'Persons',
  matrix: 'Assignment Matrix',
  import: 'Bulk Import',
  settings: 'Settings',
};

function Header({ currentPage }: HeaderProps) {
  return (
    <header
      className="px-6 pb-4 pt-8 flex items-center justify-between"
      style={{
        WebkitAppRegion: 'drag',
        backgroundColor: 'var(--hazu-bg)',
        borderBottom: '1px solid var(--hazu-border)',
      } as React.CSSProperties}
    >
      <div>
        <h2
          className="text-2xl font-semibold"
          style={{ color: 'var(--hazu-text)' }}
        >
          {pageTitles[currentPage] || currentPage}
        </h2>
      </div>
      <div
        className="flex items-center gap-4"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Sync status indicator */}
        <div
          className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-full"
          style={{
            backgroundColor: 'var(--hazu-bg-subtle)',
            color: 'var(--hazu-text-light)',
          }}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: '#6B9B7A' }}
          ></span>
          <span>Connected</span>
        </div>
      </div>
    </header>
  );
}

export default Header;
