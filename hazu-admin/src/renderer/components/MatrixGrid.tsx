import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { Person, Room } from '../../shared/types';

// Layout constants
const ROW_HEIGHT = 36;
const COL_WIDTH = 90;
const PERSON_COL_WIDTH = 180;
const HEADER_HEIGHT = 72;
const BUFFER_ROWS = 10;
const BUFFER_COLS = 5;

// Role display labels
const roleLabels: Record<string, string> = {
  student: 'Student',
  companymentor: 'Mentor',
  schoolteacher: 'Teacher',
  courseteacher: 'Course T.',
  stateadvisor: 'Advisor',
  guardian: 'Guardian',
};

interface MatrixGridProps {
  persons: Person[];
  rooms: Room[];
  getAssignment: (personId: string, roomId: string) => string | null;
}

export function MatrixGrid({ persons, rooms, getAssignment }: MatrixGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Calculate total dimensions
  const totalHeight = persons.length * ROW_HEIGHT + HEADER_HEIGHT;
  const totalWidth = rooms.length * COL_WIDTH + PERSON_COL_WIDTH;

  // Update container dimensions
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    setScrollTop(target.scrollTop);
    setScrollLeft(target.scrollLeft);
  }, []);

  // Calculate visible ranges with buffer
  const visibleRows = useMemo(() => {
    const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    const endRow = Math.min(
      persons.length,
      Math.ceil((scrollTop + containerSize.height) / ROW_HEIGHT) + BUFFER_ROWS
    );
    return { start: startRow, end: endRow };
  }, [scrollTop, containerSize.height, persons.length]);

  const visibleCols = useMemo(() => {
    const startCol = Math.max(0, Math.floor(scrollLeft / COL_WIDTH) - BUFFER_COLS);
    const endCol = Math.min(
      rooms.length,
      Math.ceil((scrollLeft + containerSize.width) / COL_WIDTH) + BUFFER_COLS
    );
    return { start: startCol, end: endCol };
  }, [scrollLeft, containerSize.width, rooms.length]);

  // Strip HTML tags
  const stripHtml = (str: string) => str?.replace(/<[^>]*>/g, '').trim() || '';

  if (persons.length === 0 || rooms.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        {persons.length === 0 && rooms.length === 0
          ? 'No data. Run a sync to fetch data from Hazu.'
          : persons.length === 0
          ? 'No persons match the current filters.'
          : 'No rooms match the current filters.'}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto"
      onScroll={handleScroll}
    >
      <div style={{ width: totalWidth, height: totalHeight, position: 'relative' }}>
        {/* Sticky corner cell */}
        <div
          className="sticky top-0 left-0 z-30 bg-gray-100 border-b border-r border-gray-300 flex items-center justify-center"
          style={{
            width: PERSON_COL_WIDTH,
            height: HEADER_HEIGHT,
          }}
        >
          <span className="text-xs text-gray-500">
            {persons.length} × {rooms.length}
          </span>
        </div>

        {/* Sticky header row */}
        <div
          className="sticky top-0 z-20"
          style={{
            marginLeft: PERSON_COL_WIDTH,
            marginTop: -HEADER_HEIGHT,
            height: HEADER_HEIGHT,
          }}
        >
          {rooms.slice(visibleCols.start, visibleCols.end).map((room, idx) => {
            const colIndex = visibleCols.start + idx;
            const title = stripHtml(room.title);
            return (
              <div
                key={room.id}
                className="absolute bg-gray-50 border-r border-b border-gray-200 px-1 py-1"
                style={{
                  left: colIndex * COL_WIDTH,
                  width: COL_WIDTH,
                  height: HEADER_HEIGHT,
                }}
                title={title}
              >
                <div className="text-xs text-gray-700 font-medium leading-tight line-clamp-3">
                  {title}
                </div>
              </div>
            );
          })}
        </div>

        {/* Sticky person column */}
        <div
          className="sticky left-0 z-10"
          style={{
            marginTop: 0,
            width: PERSON_COL_WIDTH,
          }}
        >
          {persons.slice(visibleRows.start, visibleRows.end).map((person, idx) => {
            const rowIndex = visibleRows.start + idx;
            return (
              <div
                key={person.id}
                className="absolute bg-white border-r border-b border-gray-100 px-2 flex items-center"
                style={{
                  top: HEADER_HEIGHT + rowIndex * ROW_HEIGHT,
                  width: PERSON_COL_WIDTH,
                  height: ROW_HEIGHT,
                }}
                title={person.display_name}
              >
                <span className="text-sm text-gray-800 truncate">
                  {person.display_name}
                </span>
              </div>
            );
          })}
        </div>

        {/* Matrix cells */}
        {persons.slice(visibleRows.start, visibleRows.end).map((person, rowIdx) => {
          const rowIndex = visibleRows.start + rowIdx;
          return rooms.slice(visibleCols.start, visibleCols.end).map((room, colIdx) => {
            const colIndex = visibleCols.start + colIdx;
            const role = getAssignment(person.id, room.id);
            return (
              <div
                key={`${person.id}-${room.id}`}
                className={`absolute border-r border-b border-gray-100 flex items-center justify-center ${
                  role ? 'bg-blue-50' : 'bg-white'
                }`}
                style={{
                  top: HEADER_HEIGHT + rowIndex * ROW_HEIGHT,
                  left: PERSON_COL_WIDTH + colIndex * COL_WIDTH,
                  width: COL_WIDTH,
                  height: ROW_HEIGHT,
                }}
              >
                {role && (
                  <span className="text-xs text-blue-700">
                    {roleLabels[role] || role}
                  </span>
                )}
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}
