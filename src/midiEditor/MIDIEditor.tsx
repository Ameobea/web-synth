import React, { useEffect, useRef } from 'react';

import { useIsGlobalBeatCounterStarted } from 'src/eventScheduler';
import { MIDIEditorInstance } from 'src/midiEditor';
import MIDIEditorUIInstance, {
  SerializedMIDIEditorState,
} from 'src/midiEditor/MIDIEditorUIInstance';
import './MIDIEditor.scss';

const ctx = new AudioContext();

const MIDIEditorControlButton: React.FC<{
  onClick: () => void;
  label: React.ReactNode;
  disabled?: boolean;
}> = ({ onClick, label, disabled }) => (
  <div
    className='midi-editor-control-button'
    style={disabled ? { color: '#666' } : undefined}
    onClick={disabled ? undefined : onClick}
  >
    {label}
  </div>
);

interface MIDIEditorControlsState {
  bpm: number;
}

const MIDIEditorControls: React.FC<{
  inst: React.MutableRefObject<MIDIEditorUIInstance | undefined>;
  value: MIDIEditorControlsState;
  onChange: (newState: MIDIEditorControlsState) => void;
}> = ({ inst, value: { bpm }, onChange }) => {
  const isGlobalBeatCounterStarted = useIsGlobalBeatCounterStarted();

  return (
    <div className='midi-editor-controls'>
      <MIDIEditorControlButton
        disabled={isGlobalBeatCounterStarted}
        onClick={() => {
          if (!inst.current) {
            return;
          }
          const playbackHandler = inst.current.parentInstance.playbackHandler;

          if (playbackHandler.isPlaying) {
            playbackHandler.stopPlayback();
          } else {
            playbackHandler.startPlayback({ type: 'localTempo', bpm, startTime: ctx.currentTime });
          }
        }}
        label='⏯'
      />
    </div>
  );
};

const MIDIEditor: React.FC<{
  initialState: SerializedMIDIEditorState;
  width: number;
  height: number;
  instance: MIDIEditorInstance;
}> = ({ initialState, width, height, instance: parentInstance }) => {
  const instance = useRef<MIDIEditorUIInstance | undefined>();
  useEffect(() => {
    return () => {
      if (!instance.current) {
        return;
      }
      instance.current.destroy();
    };
  }, []);

  return (
    <div className='midi-editor'>
      <MIDIEditorControls
        inst={instance}
        value={{ bpm: 120 }}
        onChange={newState => {
          // TODO
        }}
      />
      <canvas
        style={{ width, height }}
        ref={ref => {
          if (!ref) {
            instance.current?.destroy();
            instance.current = undefined;
            return;
          }

          instance.current = new MIDIEditorUIInstance(
            width,
            height,
            ref,
            initialState,
            parentInstance
          );
          parentInstance.registerUI(instance.current);
        }}
        onMouseDown={evt => {
          // Prevent clicks on the canvas from selecting text and stuff in the rest of the page
          evt.preventDefault();
          evt.stopPropagation();
        }}
        onContextMenu={evt => {
          evt.preventDefault();
          evt.stopPropagation();
        }}
      />
    </div>
  );
};

export default MIDIEditor;
