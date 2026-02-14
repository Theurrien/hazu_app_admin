import React from 'react';

interface MissionSummaryBarProps {
  totalStudents: number;
  avgMissions: number;
  maxMissions: number;
}

export function MissionSummaryBar({ totalStudents, avgMissions, maxMissions }: MissionSummaryBarProps) {
  return (
    <div
      className="flex items-center gap-6 px-4 py-2 rounded-lg text-sm"
      style={{
        backgroundColor: 'var(--hazu-bg)',
        color: 'var(--hazu-text-muted)',
        border: '1px solid var(--hazu-border)',
      }}
    >
      <span><strong>{totalStudents}</strong> students</span>
      <span><strong>{avgMissions}</strong> avg missions</span>
      <span><strong>{maxMissions}</strong> max missions</span>
    </div>
  );
}
