import { Map } from 'immutable';
import * as R from 'ramda';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import LFOSmallView, { ALL_WAVEFORMS } from './LFONodeUI';
import { mkContainerRenderHelper, mkContainerCleanupHelper } from 'src/reactUtils';

export interface LFOParams {
  frequency: number;
  gain: number;
  offset: number;
  waveform: OscillatorType;
}

export class LFONode implements ForeignNode {
  private vcId: string;
  public gainNode: GainNode;
  private offsetNode: ConstantSourceNode;
  public oscillatorNode: OscillatorNode;
  public nodeType = 'customAudio/LFO';
  public name = 'LFO';

  private frequencyOverrideCSN: ConstantSourceNode;
  private amplitudeOverrideCSN: ConstantSourceNode;
  private offsetOverrideCSN: ConstantSourceNode;

  /**
   * See the docs for `enhanceAudioNode`.
   */
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  };

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.gainNode = new GainNode(ctx);
    this.gainNode.gain.value = 0;
    this.offsetNode = new ConstantSourceNode(ctx);
    this.offsetNode.offset.value = 0;
    this.offsetNode.start();
    this.oscillatorNode = new OscillatorNode(ctx);

    // Oscillator -> Gain -> Offset -> Output
    this.oscillatorNode.connect(this.gainNode);
    this.gainNode.connect(this.offsetNode.offset);
    this.oscillatorNode.start();
    this.oscillatorNode.frequency.value = 0;

    this.frequencyOverrideCSN = new ConstantSourceNode(ctx);
    this.frequencyOverrideCSN.start();
    this.amplitudeOverrideCSN = new ConstantSourceNode(ctx);
    this.amplitudeOverrideCSN.start();
    this.offsetOverrideCSN = new ConstantSourceNode(ctx);
    this.offsetOverrideCSN.start();

    if (params) {
      this.deserialize(params);
    } else {
      this.frequencyOverrideCSN.offset.value = 1;
      this.offsetOverrideCSN.offset.value = 0;
    }

    this.paramOverrides = {
      frequency: {
        param: new OverridableAudioParam(
          ctx,
          this.oscillatorNode.frequency,
          this.frequencyOverrideCSN
        ),
        override: this.frequencyOverrideCSN,
      },
      amplitude: {
        param: new OverridableAudioParam(ctx, this.gainNode.gain, this.amplitudeOverrideCSN),
        override: this.amplitudeOverrideCSN,
      },
      offset: {
        param: new OverridableAudioParam(ctx, this.offsetNode.offset, this.offsetOverrideCSN),
        override: this.offsetOverrideCSN,
      },
    };

    this.renderSmallView = mkContainerRenderHelper({
      Comp: LFOSmallView,
      getProps: () => ({
        onChange: ({ frequency, gain, offset, waveform }: LFOParams) => {
          this.frequencyOverrideCSN.offset.value = frequency;
          this.amplitudeOverrideCSN.offset.value = gain;
          this.offsetOverrideCSN.offset.value = offset;
          this.oscillatorNode.type = waveform;
        },
        initialState: {
          frequency: this.frequencyOverrideCSN.offset.value,
          gain: this.amplitudeOverrideCSN.offset.value,
          offset: this.offsetOverrideCSN.offset.value,
          waveform: this.oscillatorNode.type,
        },
      }),
    });

    this.cleanupSmallView = mkContainerCleanupHelper();
  }

  public deserialize(params: { [key: string]: any }) {
    if (!R.isNil(params.gain)) {
      this.amplitudeOverrideCSN.offset.value = params.gain;
    }
    if (!R.isNil(params.frequency)) {
      this.frequencyOverrideCSN.offset.value = params.frequency;
    }
    if (!R.isNil(params.offset)) {
      this.offsetOverrideCSN.offset.value = params.offset;
    }
    if (ALL_WAVEFORMS.includes(params.waveform)) {
      this.oscillatorNode.type = params.waveform;
    }
  }

  public serialize(): { [key: string]: any } {
    return {
      gain: this.amplitudeOverrideCSN.offset.value,
      frequency: this.frequencyOverrideCSN.offset.value,
      offset: this.offsetOverrideCSN.offset.value,
      waveform: this.oscillatorNode.type,
    };
  }

  public buildConnectables(): AudioConnectables & { node: ForeignNode } {
    return {
      vcId: this.vcId,
      inputs: Map<string, ConnectableInput>()
        .set('frequency', {
          node: this.paramOverrides.frequency.param,
          type: 'number',
        })
        .set('amplitude', { node: this.paramOverrides.amplitude.param, type: 'number' })
        .set('offset', { node: this.paramOverrides.offset.param, type: 'number' }),
      outputs: Map<string, ConnectableOutput>().set('signal', {
        node: this.offsetNode,
        type: 'number',
      }),
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
