import React, { useCallback } from 'react';

import { MidiKeyboard } from 'src/midiKeyboard/MidiKeyboard';
import { useDraggable } from 'src/reactUtils';
import { actionCreators, dispatch, getState } from 'src/redux';
import {
  maybeSnapToGrid,
  type ControlPanelMidiKeyboardDescriptor,
} from 'src/redux/modules/controlPanel';

interface ControlPanelMidiKeyboardProps extends ControlPanelMidiKeyboardDescriptor {
  vcId: string;
  isEditing: boolean;
}

const ControlPanelMidiKeyboard: React.FC<ControlPanelMidiKeyboardProps> = ({
  vcId,
  name,
  octaveOffset,
  position,
  midiNode,
  isEditing,
}) => {
  const onDrag = useCallback(
    (newPos: { x: number; y: number }) =>
      dispatch(
        actionCreators.controlPanel.UPDATE_CONTROL_PANEL_MIDI_KEYBOARD(vcId, name, {
          position: maybeSnapToGrid(
            newPos,
            getState().controlPanel.stateByPanelInstance[vcId].snapToGrid
          ),
        })
      ),
    [name, vcId]
  );
  const { isDragging, onMouseDown } = useDraggable(onDrag, position);

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
        onMouseDown={isEditing ? onMouseDown : undefined}
        className='top-drag-bar'
        style={
          isEditing ? (isDragging ? { cursor: 'grabbing' } : undefined) : { cursor: 'default' }
        }
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
