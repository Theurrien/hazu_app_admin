import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

interface DistributionRow {
  profession_icon: string;
  level: 'AFP' | 'CFC';
  level_color: string;
  mission_count: number;
  student_count: number;
}

interface MissionTreemapProps {
  data: DistributionRow[];
}

export function MissionTreemap({ data }: MissionTreemapProps) {
  const option = useMemo(() => {
    // Group by profession -> level -> mission count
    const professionMap = new Map<string, Map<string, Array<{ mission_count: number; student_count: number }>>>();

    for (const row of data) {
      if (!professionMap.has(row.profession_icon)) {
        professionMap.set(row.profession_icon, new Map());
      }
      const levelMap = professionMap.get(row.profession_icon)!;
      if (!levelMap.has(row.level)) {
        levelMap.set(row.level, []);
      }
      levelMap.get(row.level)!.push({
        mission_count: row.mission_count,
        student_count: row.student_count,
      });
    }

    const treemapData = Array.from(professionMap.entries()).map(([icon, levelMap]) => ({
      name: icon,
      children: Array.from(levelMap.entries()).map(([level, entries]) => ({
        name: level,
        children: entries.map(e => ({
          name: `${e.mission_count} MPE`,
          value: e.student_count,
        })),
      })),
    }));

    return {
      tooltip: {
        formatter: (info: any) => {
          const { treePathInfo, value } = info;
          if (treePathInfo.length === 4) {
            const profession = treePathInfo[1]?.name || '';
            const level = treePathInfo[2]?.name || '';
            const mpe = treePathInfo[3]?.name || '';
            return `<strong>${profession}</strong> ${level}<br/>${mpe}: ${value} students`;
          }
          return `${info.name}: ${value || ''} students`;
        },
      },
      series: [{
        type: 'treemap',
        data: treemapData,
        top: 35,
        left: 0,
        right: 0,
        bottom: 0,
        roam: false,
        nodeClick: 'zoomToNode',
        breadcrumb: {
          show: true,
          top: 5,
          left: 10,
        },
        levels: [
          {
            // Level 0: profession
            itemStyle: {
              borderColor: '#fff',
              borderWidth: 3,
              gapWidth: 3,
            },
            upperLabel: {
              show: true,
              height: 30,
              color: '#333',
              fontWeight: 'bold',
              fontSize: 14,
              align: 'center',
              verticalAlign: 'middle',
              overflow: 'truncate',
            },
          },
          {
            // Level 1: AFP / CFC
            itemStyle: {
              borderColor: '#fff',
              borderWidth: 2,
              gapWidth: 2,
            },
            upperLabel: {
              show: true,
              height: 24,
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 12,
              align: 'center',
              verticalAlign: 'middle',
              overflow: 'truncate',
            },
            colorMappingBy: 'value',
            color: ['#9AD9EA', '#1A237E'],
          },
          {
            // Level 2: mission count leaves
            itemStyle: {
              borderColor: 'rgba(255,255,255,0.5)',
              borderWidth: 1,
              gapWidth: 1,
            },
            label: {
              show: true,
              formatter: '{b}\n{c}',
              fontSize: 11,
              color: '#fff',
              align: 'center',
              verticalAlign: 'middle',
              overflow: 'truncate',
              ellipsis: '..',
            },
          },
        ],
      }],
    };
  }, [data]);

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
      style={{ height: '500px', width: '100%' }}
      notMerge
    />
  );
}
