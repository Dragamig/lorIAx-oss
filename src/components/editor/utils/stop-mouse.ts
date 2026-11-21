import { MouseEvent } from 'react';

/**
 * Prevents ProseMirror from intercepting mousedown events in draggable node-views.
 * Must be placed on every interactive field (input, textarea, select, contentEditable)
 * inside a TipTap node-view that has draggable=true.
 */
export function stopMouse(e: MouseEvent): void {
  e.stopPropagation();
  e.nativeEvent.stopImmediatePropagation();
}
