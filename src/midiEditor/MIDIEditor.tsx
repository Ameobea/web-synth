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
  );
};

export default MIDIEditor;
