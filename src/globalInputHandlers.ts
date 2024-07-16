import { getEngine } from 'src/util';

export const handleGlobalMouseDown = (evt: MouseEvent) => {
  if (evt.button === 3) {
    evt.preventDefault();
    getEngine()?.undo_view_change();
  } else if (evt.button === 4) {
    evt.preventDefault();
    getEngine()?.redo_view_change();
  }
};

// Match my VS code experience with mouse buttons for "go back" and "go forward"
export const registerBackForwardsMouseHandlers = () => {
  document.addEventListener('mouseup', evt => {
    handleGlobalMouseDown(evt);
  });
};
