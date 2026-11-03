import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnchoredPosition, computeAnchoredPosition } from '../utils/anchoredPosition';

interface AnchoredPanelProps {
  /** The trigger the panel hangs from; its width is the panel's width. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Lets the caller treat clicks inside the portalled panel as "inside". */
  panelRef?: React.RefObject<HTMLDivElement | null>;
  preferredMaxHeight?: number;
  className?: string;
  children: React.ReactNode;
}

/**
 * A dropdown panel rendered into `document.body` with `position: fixed`, so a scrolling or
 * `overflow-hidden` ancestor can no longer clip it. It follows its trigger on scroll and
 * resize, and opens upward when there is more room above. Mount it only while open.
 */
export function AnchoredPanel({
  anchorRef,
  panelRef,
  preferredMaxHeight = 320,
  className = '',
  children,
}: AnchoredPanelProps) {
  const [position, setPosition] = useState<AnchoredPosition | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPosition(computeAnchoredPosition(rect, window.innerHeight, preferredMaxHeight));
    };
    update();
    // Capture phase, so scrolling any ancestor (not just the window) moves the panel too.
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchorRef, preferredMaxHeight]);

  if (!position) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={`fixed z-50 flex flex-col bg-white border border-gray-300 rounded-lg shadow-lg overflow-hidden ${className}`}
      style={{
        top: position.top,
        bottom: position.bottom,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
    >
      {children}
    </div>,
    document.body
  );
}
