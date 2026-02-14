import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTableCells, faChartPie } from '@fortawesome/free-solid-svg-icons';
import { MissionSyncButton } from '../components/mission-analysis/MissionSyncButton';
import { MissionFilterBar } from '../components/mission-analysis/MissionFilterBar';
import { MissionTreemap } from '../components/mission-analysis/MissionTreemap';
import { MissionHeatmap } from '../components/mission-analysis/MissionHeatmap';
import { MissionSummaryBar } from '../components/mission-analysis/MissionSummaryBar';

type ViewMode = 'treemap' | 'heatmap';
type LieuDeFormation = 'entreprise' | 'ecole' | 'cie';

function MissionAnalysisPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('treemap');

  // Filter state
  const [lieu, setLieu] = useState<LieuDeFormation | null>(null);
  const [selectedProfessions, setSelectedProfessions] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState<'afp' | 'cfc' | null>(null);
  const [classId, setClassId] = useState<string | null>(null);

  // Data state
  const [professions, setProfessions] = useState<Array<{ icon: string; student_count: number }>>([]);
  const [classes, setClasses] = useState<Array<{ id: string; title: string }>>([]);
  const [distribution, setDistribution] = useState<any[]>([]);
  const [summary, setSummary] = useState({ total_students: 0, avg_missions: 0, max_missions: 0 });

  // Load filter options
  useEffect(() => {
    window.electronAPI.missionGetProfessions().then(setProfessions);
    window.electronAPI.getRooms('class').then(rooms => {
      setClasses(rooms.map((r: any) => ({ id: r.id, title: r.title })));
    });
  }, []);

  // Fetch dashboard data when filters change
  const fetchData = useCallback(async () => {
    const filters: any = {};
    if (lieu) filters.lieu = lieu;
    if (selectedProfessions.size > 0) filters.professions = Array.from(selectedProfessions);
    if (level) filters.level = level;
    if (classId) filters.classId = classId;

    const result = await window.electronAPI.missionGetDashboardData(filters);
    setDistribution(result.distribution || []);
    setSummary(result.summary || { total_students: 0, avg_missions: 0, max_missions: 0 });
  }, [lieu, selectedProfessions, level, classId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleProfession = (icon: string) => {
    setSelectedProfessions(prev => {
      const next = new Set(prev);
      if (next.has(icon)) {
        next.delete(icon);
      } else {
        next.add(icon);
      }
      return next;
    });
  };

  const handleSyncComplete = () => {
    window.electronAPI.missionGetProfessions().then(setProfessions);
    fetchData();
  };

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold" style={{ color: 'var(--hazu-text)' }}>
          Mission Analysis
        </h2>
        <MissionSyncButton onSyncComplete={handleSyncComplete} />
      </div>

      {/* Filter bar */}
      <div
        className="rounded-xl p-4"
        style={{
          backgroundColor: 'var(--hazu-card-bg)',
          border: '1px solid var(--hazu-border)',
        }}
      >
        <MissionFilterBar
          lieu={lieu}
          onLieuChange={setLieu}
          selectedProfessions={selectedProfessions}
          onToggleProfession={handleToggleProfession}
          level={level}
          onLevelChange={setLevel}
          classId={classId}
          onClassChange={setClassId}
          classes={classes}
          professions={professions}
        />
      </div>

      {/* View toggle + Chart */}
      <div
        className="rounded-xl p-4"
        style={{
          backgroundColor: 'var(--hazu-card-bg)',
          border: '1px solid var(--hazu-border)',
        }}
      >
        {/* Toggle buttons */}
        <div className="flex justify-end gap-1 mb-3">
          <button
            onClick={() => setViewMode('treemap')}
            className="p-2 rounded-lg transition-colors"
            style={{
              backgroundColor: viewMode === 'treemap' ? 'var(--hazu-primary)' : 'transparent',
              color: viewMode === 'treemap' ? '#fff' : 'var(--hazu-text-muted)',
            }}
            title="Treemap view"
          >
            <FontAwesomeIcon icon={faChartPie} />
          </button>
          <button
            onClick={() => setViewMode('heatmap')}
            className="p-2 rounded-lg transition-colors"
            style={{
              backgroundColor: viewMode === 'heatmap' ? 'var(--hazu-primary)' : 'transparent',
              color: viewMode === 'heatmap' ? '#fff' : 'var(--hazu-text-muted)',
            }}
            title="Heatmap view"
          >
            <FontAwesomeIcon icon={faTableCells} />
          </button>
        </div>

        {/* Chart */}
        {viewMode === 'treemap' ? (
          <MissionTreemap data={distribution} />
        ) : (
          <MissionHeatmap data={distribution} />
        )}
      </div>

      {/* Summary bar */}
      <MissionSummaryBar
        totalStudents={summary.total_students}
        avgMissions={summary.avg_missions}
        maxMissions={summary.max_missions}
      />
    </div>
  );
}

export default MissionAnalysisPage;
