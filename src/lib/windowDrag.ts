import type { MouseEvent as ReactMouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Start dragging the desktop window only when the empty backdrop itself is pressed. */
export function startWindowDragFromBackdrop(event: ReactMouseEvent<HTMLElement>) {
  if (event.button !== 0 || event.target !== event.currentTarget) return;

  event.preventDefault();
  void getCurrentWindow().startDragging().catch(() => {});
}
