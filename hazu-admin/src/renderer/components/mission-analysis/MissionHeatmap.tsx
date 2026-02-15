import React, { useMemo, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import type { CellSelection } from '../../pages/MissionAnalysisPage';

interface DistributionRow {
  profession_icon: string;
  level: 'AFP' | 'CFC';
  level_color: string;
  mission_count: number;
  student_count: number;
}

interface MissionHeatmapProps {
  data: DistributionRow[];
  onCellClick?: (selection: CellSelection) => void;
}

export function MissionHeatmap({ data, onCellClick }: MissionHeatmapProps) {
  const option = useMemo(() => {
    if (data.length === 0) return {};

    // Build Y-axis labels: unique "icon LEVEL" combinations
    const yLabels: string[] = [];
    const ySet = new Set<string>();
    for (const row of data) {
      const label = `${row.profession_icon} ${row.level}`;
      if (!ySet.has(label)) {
        ySet.add(label);
        yLabels.push(label);
      }
    }

    // Find max mission count for X-axis
    const maxMissions = Math.max(...data.map(r => r.mission_count), 0);
    const xLabels = Array.from({ length: maxMissions + 1 }, (_, i) => String(i));

    // Build heatmap data: [xIndex, yIndex, value]
    const heatmapData: number[][] = [];
    let maxValue = 0;

    for (const row of data) {
      const yLabel = `${row.profession_icon} ${row.level}`;
      const yIndex = yLabels.indexOf(yLabel);
      const xIndex = row.mission_count;
      heatmapData.push([xIndex, yIndex, row.student_count]);
      maxValue = Math.max(maxValue, row.student_count);
    }

    return {
      tooltip: {
        position: 'top',
        formatter: (params: any) => {
          const [x, y, val] = params.data;
          return `<strong>${yLabels[y]}</strong><br/>${x} missions: ${val} students`;
        },
      },
      grid: {
        top: 30,
        bottom: 60,
        left: 160,
        right: 40,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        name: 'Missions completed',
        nameLocation: 'center',
        nameGap: 35,
        splitArea: { show: true },
      },
      yAxis: {
        type: 'category',
        data: yLabels,
        splitArea: { show: true },
        axisLabel: {
          fontSize: 12,
          fontWeight: 'bold',
        },
      },
      visualMap: {
        min: 0,
        max: maxValue || 1,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        top: 0,
        inRange: {
          color: ['#f0f0f0', '#9AD9EA', '#1A237E'],
        },
      },
      series: [{
        type: 'heatmap',
        data: heatmapData,
        label: {
          show: true,
          formatter: (params: any) => {
            const val = params.data[2];
            return val > 0 ? String(val) : '';
          },
          fontSize: 11,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      }],
    };
  }, [data]);

  const handleClick = useCallback((params: any) => {
    if (!onCellClick) return;
    const [xIndex, yIndex, val] = params.data;
    if (val === 0) return; // Ignore empty cells

    // Parse yLabel to extract profession icon and level
    const yLabels: string[] = [];
    const ySet = new Set<string>();
    for (const row of data) {
      const label = `${row.profession_icon} ${row.level}`;
      if (!ySet.has(label)) {
        ySet.add(label);
        yLabels.push(label);
      }
    }

    const yLabel = yLabels[yIndex];
    if (!yLabel) return;

    // Split "icon LEVEL" — last word is level, rest is icon
    const parts = yLabel.split(' ');
    const level = parts[parts.length - 1];
    const professionIcon = parts.slice(0, -1).join(' ');
    const levelColor = level === 'AFP' ? '#9AD9EA' : '#1A237E';

    onCellClick({ professionIcon, level, levelColor, missionCount: xIndex });
  }, [onCellClick, data]);

  const onEvents = useMemo(() => ({
    click: handleClick,
  }), [handleClick]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-96" style={{ color: 'var(--hazu-text-muted)' }}>
        No data available. Run a sync first.
      </div>
    );
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: Math.max(300, data.length * 40 + 120) + 'px', width: '100%' }}
      notMerge
      onEvents={onEvents}
    />
  );
}
