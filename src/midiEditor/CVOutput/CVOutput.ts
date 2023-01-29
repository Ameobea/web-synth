import { get, writable, type Unsubscriber, type Writable } from 'svelte/store';

import { AdsrLengthMode, type Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { get_midi_editor_audio_connectables } from 'src/midiEditor';
import { updateConnectables } from 'src/patchNetwork/interface';
import { ADSR2Module, type ADSR2Params } from 'src/synthDesigner/ADSRModule';

export interface CVOutputState {
  name: string;
  adsr: Adsr;
  minValue: number;
  maxValue: number;
  isExpanded: boolean;
}

export type SerializedCVOutputState = CVOutputState;

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
  isExpanded: true,
});

export class CVOutput {
  public name: string;
  public backend: ADSR2Module;
  private ctx: AudioContext;
  public dummyOutput: DummyNode = new DummyNode('MIDI editor CV dummy output');
  private onChangeUnsub: Unsubscriber;

  public state: Writable<CVOutputState>;

  constructor(
    ctx: AudioContext,
    midiEditorVCId: string,
    name: string,
    state: SerializedCVOutputState
  ) {
    this.ctx = ctx;
    this.name = name;

    this.state = writable(state);

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

    this.onChangeUnsub = this.state.subscribe(newState => {
      this.backend.setState(newState.adsr);
    });
  }

  public serialize(): SerializedCVOutputState {
    const adsr = this.backend.serialize();
    console.log({ adsr: JSON.stringify(adsr) });

    return {
      ...get(this.state),
      adsr,
    };
  }

  public destroy() {
    this.backend.destroy();
    this.onChangeUnsub();
  }
}
