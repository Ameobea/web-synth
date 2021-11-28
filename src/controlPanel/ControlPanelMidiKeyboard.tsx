import React, { useCallback, useEffect, useRef, useState } from 'react';

import { actionCreators, dispatch, getState } from 'src/redux';
import { MidiKeyboard } from 'src/midiKeyboard/MidiKeyboard';
import {
  ControlPanelMidiKeyboardDescriptor,
  maybeSnapToGrid,
} from 'src/redux/modules/controlPanel';

interface ControlPanelMidiKeyboardProps extends ControlPanelMidiKeyboardDescriptor {
  vcId: string;
}

const ControlPanelMidiKeyboard: React.FC<ControlPanelMidiKeyboardProps> = ({
  vcId,
  name,
  octaveOffset,
  position,
  midiNode,
}) => {
  const dragDownPos = useRef<{
    originalPos: { x: number; y: number };
    downPos: { x: number; y: number };
  }>({
    originalPos: { x: 0, y: 0 },
    downPos: { x: 0, y: 0 },
  });
  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const upCb = () => setIsDragging(false);
    const moveCb = (e: MouseEvent) => {
      const { originalPos, downPos } = dragDownPos.current;
      const deltaX = e.clientX - downPos.x;
      const deltaY = e.clientY - downPos.y;
      dispatch(
        actionCreators.controlPanel.UPDATE_CONTROL_PANEL_MIDI_KEYBOARD(vcId, name, {
          position: maybeSnapToGrid(
            { x: originalPos.x + deltaX, y: originalPos.y + deltaY },
            getState().controlPanel.stateByPanelInstance[vcId].snapToGrid
          ),
        })
      );
    };
    window.addEventListener('mousemove', moveCb);
    window.addEventListener('mouseup', upCb);

    return () => {
      window.removeEventListener('mousemove', moveCb);
      window.removeEventListener('mouseup', upCb);
    };
  }, [isDragging, name, vcId]);

  const handleOctaveOffsetChange = useCallback(
    (newOctaveOffset: number) =>
      dispatch(
        actionCreators.controlPanel.UPDATE_CONTROL_PANEL_MIDI_KEYBOARD(vcId, name, {
          octaveOffset: newOctaveOffset,
        })
      ),
    [name, vcId]
  );
  const onAttack = useCallback((note: number) => midiNode.onAttack(note, 255), [midiNode]);
  const onRelease = useCallback((note: number) => midiNode.onRelease(note, 255), [midiNode]);

  return (
    <div className='control-panel-midi-keyboard' style={{ top: position.y, left: position.x }}>
      <div
        onMouseDown={evt => {
          if (evt.button !== 0) {
            return;
          }

          dragDownPos.current = {
            originalPos: { x: position.x, y: position.y },
            downPos: { x: evt.clientX, y: evt.clientY },
          };
          setIsDragging(true);
        }}
        className='top-drag-bar'
        style={isDragging ? { cursor: 'grabbing' } : undefined}
      >
        <div
          className='delete-input-button'
          onClick={() => {
            const shouldDelete = confirm(`Really delete this MIDI keyboard named "${name}"?`);
            if (!shouldDelete) {
              return;
            }
            dispatch(actionCreators.controlPanel.DELETE_CONTROL_PANEL_MIDI_KEYBOARD(vcId, name));
          }}
        >
          🗑️
        </div>
        <div className='midi-keyboard-name'>{name}</div>
      </div>
      <MidiKeyboard
        octaveOffset={octaveOffset}
        onOctaveOffsetChange={handleOctaveOffsetChange}
        onAttack={onAttack}
        onRelease={onRelease}
      />
    </div>
  );
};

export default ControlPanelMidiKeyboard;
