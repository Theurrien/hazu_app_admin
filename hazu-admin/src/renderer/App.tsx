import React, { useState } from 'react';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import Dashboard from './pages/Dashboard';
import RoomsPage from './pages/RoomsPage';
import PersonsPage from './pages/PersonsPage';
import MatrixPage from './pages/MatrixPage';
import BulkImportPage from './pages/BulkImportPage';
import SettingsPage from './pages/SettingsPage';
import { TaskQueueProvider } from './contexts/TaskQueueContext';
import { TaskQueuePanel } from './components/TaskQueuePanel';

type Page = 'dashboard' | 'rooms' | 'persons' | 'matrix' | 'import' | 'sync' | 'settings';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');

  const renderPage = () => {
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
      case 'settings':
        return <SettingsPage />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <TaskQueueProvider>
      <div className="flex h-screen bg-gray-100">
        <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header currentPage={currentPage} />
          <main className="flex-1 overflow-auto p-6">
            {renderPage()}
          </main>
        </div>
      </div>
      <TaskQueuePanel />
    </TaskQueueProvider>
  );
}

export default App;
