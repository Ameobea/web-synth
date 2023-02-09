import { Map } from 'immutable';
import * as R from 'ramda';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import LFOSmallView, { ALL_WAVEFORMS } from './LFONodeUI';

export interface LFOParams {
  frequency: number;
  waveform: OscillatorType;
}

export class LFONode implements ForeignNode {
  private vcId: string;
  public oscillatorNode: OscillatorNode;
  public nodeType = 'customAudio/LFO';
  static typeName = 'LFO';

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
    this.oscillatorNode = new OscillatorNode(ctx);

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
    };

    this.renderSmallView = mkContainerRenderHelper({
      Comp: LFOSmallView,
      getProps: () => ({
        onChange: ({ frequency, waveform }: LFOParams) => {
          this.frequencyOverrideCSN.offset.value = frequency;
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

    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
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
      inputs: Map<string, ConnectableInput>().set('frequency', {
        node: this.paramOverrides.frequency.param,
        type: 'number',
      }),
      outputs: Map<string, ConnectableOutput>().set('signal', {
        node: this.oscillatorNode,
        type: 'number',
      }),
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
