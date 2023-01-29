import { get, writable, type Writable } from 'svelte/store';

import { AdsrLengthMode, type Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { get_midi_editor_audio_connectables } from 'src/midiEditor';
import { updateConnectables } from 'src/patchNetwork/interface';
import { ADSR2Module, type ADSR2Params } from 'src/synthDesigner/ADSRModule';

export interface CVOutputUIState {
  isExpanded: boolean;
}

export interface SerializedCVOutputState {
  name: string;
  adsr: Adsr;
  minValue: number;
  maxValue: number;
  uiState: CVOutputUIState;
}

export const buildDefaultCVOutputState = (
  midiEditorVcId: string,
  name: string
): SerializedCVOutputState => ({
  name,
  adsr: {
    audioThreadData: {
      phaseIndex: 0,
      debugName: `MIDI editor CV output for MIDI editor ${midiEditorVcId}`,
    },
    // temp value that will be changed when steps are added to the envelope
    lenSamples: 44_100 * 100,
    steps: [
      { x: 0, y: 0, ramper: { type: 'linear' } },
      { x: 1, y: 1, ramper: { type: 'linear' } },
    ],
    loopPoint: null,
    releasePoint: 1,
    lengthMode: AdsrLengthMode.Samples,
    logScale: false,
  },
  minValue: 0,
  maxValue: 1,
  uiState: { isExpanded: true },
});

export class CVOutput {
  public name: string;
  public backend: ADSR2Module;
  private ctx: AudioContext;
  public dummyOutput: DummyNode = new DummyNode('MIDI editor CV dummy output');

  public uiState: Writable<CVOutputUIState>;
  private minValue: number;
  private maxValue: number;

  constructor(
    ctx: AudioContext,
    midiEditorVCId: string,
    name: string,
    state: SerializedCVOutputState
  ) {
    this.ctx = ctx;
    this.name = name;

    this.uiState = writable(state.uiState);
    this.minValue = state.minValue;
    this.maxValue = state.maxValue;

    const params: ADSR2Params = {
      // TODO: will have to be dynamic
      length: 44_100 * 100,
      lengthMode: AdsrLengthMode.Samples,
      releaseStartPhase: state.adsr.releasePoint,
      steps: state.adsr.steps,
      loopPoint: null,
      maxValue: state.maxValue,
      minValue: state.minValue,
      logScale: state.adsr.logScale,
    };

    this.backend = new ADSR2Module(ctx, params, 1, state.adsr.audioThreadData);
    this.backend
      .onInit()
      .then(() =>
        updateConnectables(midiEditorVCId, get_midi_editor_audio_connectables(midiEditorVCId))
      );
  }

  public serialize(): SerializedCVOutputState {
    const adsr = this.backend.serialize();

    return {
      name: this.name,
      adsr,
      minValue: this.minValue,
      maxValue: this.maxValue,
      uiState: get(this.uiState),
    };
  }
}
