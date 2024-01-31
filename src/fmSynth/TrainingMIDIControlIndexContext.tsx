import React from 'react';

import type MIDIControlValuesCache from 'src/graphEditor/nodes/CustomAudio/FMSynth/MIDIControlValuesCache';
import type { MIDINode } from 'src/patchNetwork/midiNode';

const TrainingMIDIControlIndexContext = React.createContext<{
  midiNode?: MIDINode | null;
  midiControlValuesCache: MIDIControlValuesCache;
}>(undefined as any);

export default TrainingMIDIControlIndexContext;
