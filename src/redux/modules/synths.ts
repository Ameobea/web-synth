/**
 * Maintains global array of synthesizers (`PolySynth`s) that can be accessed via Redux
 */

import { buildActionGroup, buildModule } from 'jantix';

import { PolySynth } from 'src/synth';

interface SynthsState {
  synths: PolySynth[];
  synthsByVCId: { [vcId: string]: PolySynth };
}

// This is necessary to work around a dumb Redux restriction that prevents us from calling `getState()` while reducers are running.
// We have a real need to do this since we're crossing the JS/Rust barrier.
let synthStateHandle: SynthsState['synthsByVCId'] | undefined = undefined;
export const getSynthsMap = (): SynthsState['synthsByVCId'] => synthStateHandle!;

const actionGroups = {
  SET_SYNTH: buildActionGroup({
    actionCreator: (uuid: string, synth: PolySynth) => ({ type: 'SET_SYNTH', uuid, synth }),
    subReducer: (state: SynthsState, { uuid, synth }) => {
      const synthsByVCId = { ...state.synthsByVCId, [uuid]: synth };
      synthStateHandle = synthsByVCId;

      return {
        ...state,
        synths: [...state.synths, synth],
        synthsByVCId,
      };
    },
  }),
};

export default buildModule<SynthsState, typeof actionGroups>(
  { synths: [], synthsByVCId: {} },
  actionGroups
);
