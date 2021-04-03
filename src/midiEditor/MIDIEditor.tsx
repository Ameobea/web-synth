import React, { useEffect, useRef } from 'react';
import { MIDIEditorInstance } from 'src/midiEditor';

import MIDIEditorUIInstance, {
  SerializedMIDIEditorState,
} from 'src/midiEditor/MIDIEditorUIInstance';

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
    <canvas
      style={{ width, height }}
      ref={ref => {
        if (!ref) {
          instance.current?.destroy();
          instance.current = undefined;
          return;
        }

        instance.current = new MIDIEditorUIInstance(width, height, ref, initialState);
        parentInstance.registerUI(instance.current);
      }}
    />
  );
};

export default MIDIEditor;
