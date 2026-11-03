/**
 * Where to put a dropdown panel so it is never clipped by the scroll box its trigger sits in.
 *
 * The Bulk Import matching lists are `overflow-hidden` / `max-h-* overflow-y-auto` boxes, so
 * a panel positioned `absolute` inside them was cut off at the box's edge. The panel is now
 * rendered `fixed` against the viewport instead; this works out where. Pure, so it is
 * tested without a DOM.
 */

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface AnchoredPosition {
  /** Set when the panel opens below the trigger. */
  top?: number;
  /** Set when the panel opens above the trigger (distance from the viewport's bottom). */
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

const GAP = 4;
const MARGIN = 8;

/**
 * Below the trigger when the preferred height fits there, or when there is at least as
 * much room below as above; otherwise above. Either way the height is capped to the room
 * actually available, so the panel's own list scrolls instead of running off screen.
 */
export function computeAnchoredPosition(
  anchor: AnchorRect,
  viewportHeight: number,
  preferredMaxHeight: number
): AnchoredPosition {
  const spaceBelow = Math.max(0, viewportHeight - anchor.bottom - GAP - MARGIN);
  const spaceAbove = Math.max(0, anchor.top - GAP - MARGIN);
  const base = { left: anchor.left, width: anchor.width };

  if (spaceBelow >= preferredMaxHeight || spaceBelow >= spaceAbove) {
    return { ...base, top: anchor.bottom + GAP, maxHeight: Math.min(preferredMaxHeight, spaceBelow) };
  }
  return {
    ...base,
    bottom: viewportHeight - anchor.top + GAP,
    maxHeight: Math.min(preferredMaxHeight, spaceAbove),
  };
}
