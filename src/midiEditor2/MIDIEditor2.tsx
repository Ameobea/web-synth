import React, { useEffect, useRef } from 'react';

import MIDIEditor2Instance, {
  SerializedMIDIEditor2State,
} from 'src/midiEditor2/MIDIEditor2Instance';

const MIDIEditor2: React.FC<{
  initialState: SerializedMIDIEditor2State;
  width: number;
  height: number;
}> = ({ initialState, width, height }) => {
  const instance = useRef<MIDIEditor2Instance | undefined>();
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

        instance.current = new MIDIEditor2Instance(width, height, ref, initialState);
      }}
    />
  );
};

export default MIDIEditor2;
