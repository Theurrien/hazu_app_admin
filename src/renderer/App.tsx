import React, { useEffect, useState } from 'react';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import Dashboard from './pages/Dashboard';
import RoomsPage from './pages/RoomsPage';
import PersonsPage from './pages/PersonsPage';
import MatrixPage from './pages/MatrixPage';
import BulkImportPage from './pages/BulkImportPage';
import SettingsPage from './pages/SettingsPage';
import MissionAnalysisPage from './pages/MissionAnalysisPage';
import DiscrepanciesPage from './pages/DiscrepanciesPage';
import { TaskQueueProvider } from './contexts/TaskQueueContext';
import { AppModeProvider, useAppMode } from './contexts/AppModeContext';
import { TaskQueuePanel } from './components/TaskQueuePanel';
import { isPageVisible, fallbackPage, type PageId } from '../shared/app-mode';

function AppShell() {
  const { mode, ready } = useAppMode();
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');

  // A mode change can leave currentPage on a page the sidebar no longer offers.
  useEffect(() => {
    if (!ready) return;
    if (!isPageVisible(mode, currentPage)) {
      setCurrentPage(fallbackPage(mode));
    }
  }, [mode, ready, currentPage]);

  const renderPage = () => {
    // Guard the render too: the effect above lands one frame later.
    if (ready && !isPageVisible(mode, currentPage)) {
      return <Dashboard />;
    }

    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />;
      case 'rooms':
        return <RoomsPage />;
      case 'persons':
        return <PersonsPage />;
      case 'matrix':
        return <MatrixPage />;
      case 'import':
        return <BulkImportPage />;
      case 'missions':
        return <MissionAnalysisPage />;
      case 'discrepancies':
        return <DiscrepanciesPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div
      className="flex h-screen"
      style={{ backgroundColor: 'var(--hazu-bg-subtle)' }}
    >
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header currentPage={currentPage} />
        <main className="flex-1 overflow-auto p-6">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <AppModeProvider>
      <TaskQueueProvider>
        <AppShell />
        <TaskQueuePanel />
      </TaskQueueProvider>
    </AppModeProvider>
  );
}

export default App;
