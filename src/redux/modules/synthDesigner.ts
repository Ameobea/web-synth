import { buildModule, buildActionGroup } from 'jantix';

import OscillatorBank from 'src/synthDesigner/oscillatorBank';

export enum Waveform {
  Sine = 'sine',
  Square = 'square',
  Sawtooth = 'sawtooth',
  Triangle = 'triangle',
  Custom = 'custom',
}

export interface AudioMechanism {
  oscillatorBank: OscillatorBank;
}

export interface SynthDesignerState {
  waveform: Waveform;
  audioMechanism: AudioMechanism;
}

const getInitialState = (): SynthDesignerState => ({
  waveform: Waveform.Sine,
  audioMechanism: {
    oscillatorBank: new OscillatorBank(),
  },
});

const actionGroups = {
  SET_STATE: buildActionGroup({
    actionCreator: (state: SynthDesignerState) => ({ type: 'SET_STATE', state }),
    subReducer: (_state: SynthDesignerState, { state }) => state,
  }),
  SET_WAVEFORM: buildActionGroup({
    actionCreator: (waveform: Waveform) => ({ type: 'SET_WAVEFORM', waveform }),
    subReducer: (state: SynthDesignerState, { waveform }) => ({ ...state, waveform }),
  }),
};

export default buildModule<SynthDesignerState, typeof actionGroups>(
  getInitialState(),
  actionGroups
);
