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

  // Calculate total dimensions (content area only, headers are separate)
  const contentHeight = persons.length * ROW_HEIGHT;
  const contentWidth = rooms.length * COL_WIDTH;

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
      Math.ceil((scrollTop + containerSize.height - HEADER_HEIGHT) / ROW_HEIGHT) + BUFFER_ROWS
    );
    return { start: startRow, end: Math.max(startRow, endRow) };
  }, [scrollTop, containerSize.height, persons.length]);

  const visibleCols = useMemo(() => {
    const startCol = Math.max(0, Math.floor(scrollLeft / COL_WIDTH) - BUFFER_COLS);
    const endCol = Math.min(
      rooms.length,
      Math.ceil((scrollLeft + containerSize.width - PERSON_COL_WIDTH) / COL_WIDTH) + BUFFER_COLS
    );
    return { start: startCol, end: Math.max(startCol, endCol) };
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
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Fixed header row */}
      <div className="flex flex-shrink-0" style={{ height: HEADER_HEIGHT }}>
        {/* Corner cell - always visible */}
        <div
          className="flex-shrink-0 bg-gray-100 border-b border-r border-gray-300 flex items-center justify-center"
          style={{ width: PERSON_COL_WIDTH }}
        >
          <span className="text-xs text-gray-500">
            {persons.length} × {rooms.length}
          </span>
        </div>

        {/* Room headers - scroll horizontally */}
        <div className="flex-1 overflow-hidden">
          <div
            className="relative bg-gray-50 border-b border-gray-300"
            style={{
              width: contentWidth,
              height: HEADER_HEIGHT,
              transform: `translateX(-${scrollLeft}px)`,
            }}
          >
            {rooms.slice(visibleCols.start, visibleCols.end).map((room, idx) => {
              const colIndex = visibleCols.start + idx;
              const title = stripHtml(room.title);
              return (
                <div
                  key={room.id}
                  className="absolute border-r border-gray-200 px-1 py-1 bg-gray-50"
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
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Person column - scroll vertically */}
        <div
          className="flex-shrink-0 bg-white border-r border-gray-300 overflow-hidden"
          style={{ width: PERSON_COL_WIDTH }}
        >
          <div
            className="relative"
            style={{
              height: contentHeight,
              transform: `translateY(-${scrollTop}px)`,
            }}
          >
            {persons.slice(visibleRows.start, visibleRows.end).map((person, idx) => {
              const rowIndex = visibleRows.start + idx;
              return (
                <div
                  key={person.id}
                  className="absolute border-b border-gray-100 px-2 flex items-center bg-white"
                  style={{
                    top: rowIndex * ROW_HEIGHT,
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
        </div>

        {/* Matrix cells - scroll both directions */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto"
          onScroll={handleScroll}
        >
          <div
            className="relative"
            style={{
              width: contentWidth,
              height: contentHeight,
            }}
          >
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
                      top: rowIndex * ROW_HEIGHT,
                      left: colIndex * COL_WIDTH,
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
      </div>
    </div>
  );
}
