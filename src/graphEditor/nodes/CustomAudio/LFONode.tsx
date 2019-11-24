import React from 'react';
import { Map } from 'immutable';
import * as R from 'ramda';
import ReactDOM from 'react-dom';
import ControlPanel, { Range } from 'react-control-panel';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';

const LFOSmallView: React.FC<{
  onChange: (frequency: number, gain: number) => void;
  initialState: { frequency: number; gain: number };
}> = ({ onChange, initialState }) => (
  <ControlPanel
    style={{ width: 500 }}
    initialState={initialState}
    onChange={(
      _key: string,
      _val: number,
      { frequency, gain }: { frequency: number | undefined; gain: number | undefined }
    ) =>
      onChange(
        R.isNil(frequency) ? initialState.frequency : frequency,
        R.isNil(gain) ? initialState.gain : gain
      )
    }
  >
    <Range label='frequency' min={0.001} max={10000} scale='log' steps={1000} />
    <Range label='gain' min={0.001} max={100} steps={1000} scale='log' />
  </ControlPanel>
);

export class LFONode implements ForeignNode {
  private vcId: string;
  public gainNode: GainNode;
  public oscillatorNode: OscillatorNode;
  public nodeType = 'customAudio/LFO';
  public name = 'LFO';

  private frequencyOverrideCSN: ConstantSourceNode;
  private amplitudeOverrideCSN: ConstantSourceNode;

  /**
   * See the docs for `enhanceAudioNode`.
   */
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  };

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.gainNode = new GainNode(ctx);
    this.oscillatorNode = new OscillatorNode(ctx);

    // These will always be connected, even if this node is disconnected.  So, if we ever want to garbage collect
    // the inner `oscillatorNode` and `gainNode`, they will have to be disconnected explicitly.
    this.oscillatorNode.connect(this.gainNode);
    this.oscillatorNode.start();

    this.frequencyOverrideCSN = new ConstantSourceNode(ctx);
    this.frequencyOverrideCSN.start();
    this.amplitudeOverrideCSN = new ConstantSourceNode(ctx);
    this.amplitudeOverrideCSN.start();

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
    };

    if (params) {
      this.deserialize(params);
    }
  }

  public deserialize(params: { [key: string]: any }) {
    if (!R.isNil(params.gain)) {
      this.amplitudeOverrideCSN.offset.value = params.gain;
    }
    if (!R.isNil(params.frequency)) {
      this.frequencyOverrideCSN.offset.value = params.frequency;
    }
  }

  public serialize(): { [key: string]: any } {
    return {
      gain: this.amplitudeOverrideCSN.offset.value,
      frequency: this.frequencyOverrideCSN.offset.value,
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
        .set('amplitude', { node: this.paramOverrides.amplitude.param, type: 'number' }),
      outputs: Map<string, ConnectableOutput>().set('signal', {
        node: this.gainNode,
        type: 'number',
      }),
      node: this,
    };
  }

  public renderSmallView(domId: string) {
    console.log('rendering');
    ReactDOM.render(
      <LFOSmallView
        onChange={(frequency: number, gain: number) => {
          this.frequencyOverrideCSN.offset.value = frequency;
          this.amplitudeOverrideCSN.offset.value = gain;
        }}
        initialState={{
          frequency: this.frequencyOverrideCSN.offset.value,
          gain: this.amplitudeOverrideCSN.offset.value,
        }}
      />,
      document.getElementById(domId)!
    );
  }

  public cleanupSmallView(domId: string) {
    console.log('cleaning up');
    ReactDOM.unmountComponentAtNode(document.getElementById(domId)!);
  }
}
