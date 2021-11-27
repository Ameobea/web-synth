import React from 'react';

import MIDIControlValuesCache from 'src/graphEditor/nodes/CustomAudio/FMSynth/MIDIControlValuesCache';
import { MIDINode } from 'src/patchNetwork/midiNode';

const TrainingMIDIControlIndexContext = React.createContext<{
  midiNode?: MIDINode | null;
  midiControlValuesCache: MIDIControlValuesCache;
}>(undefined as any);

export default TrainingMIDIControlIndexContext;
