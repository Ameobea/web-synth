/**
 * Maintains global array of synthesizers (`PolySynth`s) that can be accessed via Redux
 */

import { buildActionGroup, buildModule } from 'jantix';

import { PolySynth } from 'src/synth';

interface SynthsState {
  synths: PolySynth[];
  synthsByVCId: { [vcId: string]: PolySynth };
}

const actionGroups = {
  SET_SYNTH: buildActionGroup({
    actionCreator: (uuid: string, synth: PolySynth) => ({ type: 'SET_SYNTH', uuid, synth }),
    subReducer: (state: SynthsState, { uuid, synth }) => ({
      ...state,
      synths: [...state.synths, synth],
      synthsByVCId: { ...state.synthsByVCId, [uuid]: synth },
    }),
  }),
};

export default buildModule<SynthsState, typeof actionGroups>(
  { synths: [], synthsByVCId: {} },
  actionGroups
);
