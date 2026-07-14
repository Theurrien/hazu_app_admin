import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChartLine,
  faBuilding,
  faUsers,
  faTableCells,
  faFileImport,
  faBullseye,
  faTriangleExclamation,
  faCog,
  IconDefinition,
} from '@fortawesome/free-solid-svg-icons';

type Page = 'dashboard' | 'rooms' | 'persons' | 'matrix' | 'import' | 'missions' | 'discrepancies' | 'settings';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

interface NavItem {
  id: Page;
  label: string;
  icon: IconDefinition;
}

// Clean Font Awesome icons like Hazu platform
const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: faChartLine },
  { id: 'rooms', label: 'Rooms', icon: faBuilding },
  { id: 'persons', label: 'Persons', icon: faUsers },
  { id: 'matrix', label: 'Matrix', icon: faTableCells },
  { id: 'import', label: 'Bulk Import', icon: faFileImport },
  { id: 'missions', label: 'Missions', icon: faBullseye },
  { id: 'discrepancies', label: 'Discrepancies', icon: faTriangleExclamation },
  { id: 'settings', label: 'Settings', icon: faCog },
];

function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside
      className="w-64 flex flex-col"
      style={{ backgroundColor: 'var(--hazu-sidebar-bg)' }}
    >
      {/* App Title - with macOS traffic light clearance */}
      <div
        className="px-4 pb-4 pt-12"
        style={{
          WebkitAppRegion: 'drag',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        } as React.CSSProperties}
      >
        <div className="flex items-center gap-3">
          {/* Hazu logo */}
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'var(--hazu-primary)' }}
          >
            <FontAwesomeIcon icon={faBuilding} className="text-white text-base" />
          </div>
          <div>
            <h1
              className="text-lg font-semibold tracking-tight"
              style={{ color: 'var(--hazu-sidebar-text)' }}
            >
              Hazu Admin
            </h1>
            <p
              className="text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--hazu-sidebar-text-muted)' }}
            >
              Platform Management
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = currentPage === item.id;
            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150"
                  style={{
                    backgroundColor: isActive
                      ? 'var(--hazu-sidebar-active)'
                      : 'transparent',
                    color: isActive
                      ? 'var(--hazu-sidebar-text)'
                      : 'var(--hazu-sidebar-text-muted)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'var(--hazu-sidebar-hover)';
                      e.currentTarget.style.color = 'var(--hazu-sidebar-text)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--hazu-sidebar-text-muted)';
                    }
                  }}
                >
                  {/* Clean icon without background - Hazu style */}
                  <FontAwesomeIcon
                    icon={item.icon}
                    className="w-5 text-base"
                    fixedWidth
                  />
                  <span className="font-medium text-sm">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div
        className="px-4 py-3 text-xs"
        style={{
          borderTop: '1px solid rgba(255,255,255,0.1)',
          color: 'var(--hazu-sidebar-text-muted)',
        }}
      >
        <p>Version 1.0.0</p>
      </div>
    </aside>
  );
}

export default Sidebar;
