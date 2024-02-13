import React from 'react';
import { Map } from 'immutable';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import type {
  ResponsePlotData,
  ScaleAndShiftSmallViewProps,
  ScaleAndShiftUIState,
} from 'src/graphEditor/nodes/CustomAudio/ScaleAndShift/ScaleAndShiftUI';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { AsyncOnce } from 'src/util';
import { type Writable, writable } from 'svelte/store';

const ScaleAndShiftAWPRegistered = new AsyncOnce(
  () =>
    new AudioContext().audioWorklet.addModule(
      process.env.ASSET_PATH +
        'ScaleAndShiftAWP.js?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);

export const computeScaleAndShift = ({
  input_range: inputRange,
  output_range: outputRange,
}: Pick<ScaleAndShiftUIState, 'input_range' | 'output_range'>) => {
  const inputRangeSize = inputRange[1] - inputRange[0];
  const firstMultiplier = inputRangeSize === 0 ? 0 : 1 / inputRangeSize;
  const firstOffset = -inputRange[0];
  const secondMultiplier = outputRange[1] - outputRange[0];
  const secondOffset = outputRange[0];

  return { firstOffset, multiplier: firstMultiplier * secondMultiplier, secondOffset };
};

const LazyScaleAndShiftSmallView = React.lazy(
  () => import('src/graphEditor/nodes/CustomAudio/ScaleAndShift/ScaleAndShiftUI')
);

const ScaleAndShiftSmallView: React.FC<ScaleAndShiftSmallViewProps> = props => (
  <React.Suspense fallback={<div>Loading...</div>}>
    <LazyScaleAndShiftSmallView {...props} />
  </React.Suspense>
);

export class ScaleAndShiftNode implements ForeignNode {
  static typeName = 'Scale + Shift';
  public nodeType = 'customAudio/scaleAndShift';

  private ctx: AudioContext;
  private vcId: string;
  private firstShifter: OverridableAudioParam;
  private firstShifterNode: ConstantSourceNode;
  private scaler: OverridableAudioParam;
  private secondShifter: OverridableAudioParam;
  private secondShifterNode: ConstantSourceNode;
  private uiState: ScaleAndShiftUIState;
  private awpHandle: AudioWorkletNode | null = null;
  /**
   * If the scale+shift node is in linear-to-exponential mode, the AWP will compute a response
   * plot for full input range to the output range and send it here.
   */
  private responsePlot: Writable<ResponsePlotData | null> = writable(null);

  public paramOverrides = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;
    const scalerNode = new GainNode(ctx);
    scalerNode.gain.value = 0;
    this.scaler = new OverridableAudioParam(ctx, scalerNode.gain);
    this.firstShifterNode = new ConstantSourceNode(ctx);
    this.firstShifterNode.offset.value = 0;
    this.firstShifterNode.start();
    this.firstShifter = new OverridableAudioParam(ctx, this.firstShifterNode.offset);
    this.secondShifterNode = new ConstantSourceNode(ctx);
    this.secondShifterNode.offset.value = 0;
    this.secondShifterNode.start();
    this.secondShifter = new OverridableAudioParam(ctx, this.secondShifterNode.offset);

    this.uiState = this.maybeDeserialize(params);
    this.updateNodes();

    this.firstShifterNode.connect(scalerNode).connect(this.secondShifterNode.offset);

    this.renderSmallView = mkContainerRenderHelper({
      Comp: ScaleAndShiftSmallView,
      getProps: () => ({
        initialState: this.uiState,
        onChange: async newUIState => {
          const needsConnectablesUpdate =
            !!newUIState.linearToExponentialState?.enabled !==
            !!this.uiState.linearToExponentialState?.enabled;

          this.uiState = newUIState;
          await this.updateNodes();

          if (needsConnectablesUpdate) {
            updateConnectables(this.vcId, this.buildConnectables());
          }
        },
        responsePlot: this.responsePlot,
      }),
    });
    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
  }

  private async maybeInitAWP() {
    if (!this.uiState.linearToExponentialState?.enabled) {
      if (this.awpHandle) {
        try {
          this.firstShifterNode.disconnect(this.awpHandle);
        } catch (_err) {
          // pass
        }
      }
      return;
    }

    if (!this.awpHandle) {
      await ScaleAndShiftAWPRegistered.get();
      this.awpHandle = new AudioWorkletNode(this.ctx, 'scale-and-shift-awp', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelInterpretation: 'discrete',
        channelCountMode: 'explicit',
      });
      this.firstShifterNode.connect(this.awpHandle);
      this.awpHandle.port.onmessage = e => {
        switch (e.data.type) {
          case 'responsePlot':
            this.responsePlot.set(e.data);
            break;
          default:
            console.warn('Unknown message from AWP', e.data);
        }
      };

      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private async updateNodes() {
    await this.maybeInitAWP();

    if (this.uiState.linearToExponentialState?.enabled) {
      // we switch the first offset to passthrough and handle all the scaling in the AWP
      this.firstShifter.manualControl.offset.value = 0;

      if (this.awpHandle && this.uiState.linearToExponentialState?.enabled) {
        this.awpHandle.port.postMessage({
          type: 'setParams',
          linearToExponential:
            this.uiState.linearToExponentialState.direction === 'linearToExponential',
          steepness: this.uiState.linearToExponentialState.steepness,
          inputMin: this.uiState.input_range[0],
          inputMax: this.uiState.input_range[1],
          outputMin: this.uiState.output_range[0],
          outputMax: this.uiState.output_range[1],
        });
      }

      return;
    }

    const { firstOffset, multiplier, secondOffset } = computeScaleAndShift(this.uiState);
    this.firstShifter.manualControl.offset.value = firstOffset;
    this.scaler.manualControl.offset.value = multiplier;
    this.secondShifter.manualControl.offset.value = secondOffset;
  }

  private maybeDeserialize(
    params: { [key: string]: any } | null | undefined
  ): ScaleAndShiftUIState {
    if (!params) {
      return {
        input_range: [-1, 1],
        output_range: [0, 10],
        input_min_max: [-1, 1],
        output_min_max: [-20, 20],
      };
    }

    if (
      !params.input_range ||
      !Array.isArray(params.input_range) ||
      params.input_range.length !== 2
    ) {
      console.warn(
        'Missing or invalid `input_range` on scale and shift params; resetting to defaults.'
      );
      return this.maybeDeserialize(null);
    } else if (
      !params.output_range ||
      !Array.isArray(params.output_range) ||
      params.output_range.length !== 2
    ) {
      console.warn('Missing or invalid `output` on scale and shift params; resetting to defaults.');
      return this.maybeDeserialize(null);
    }

    return {
      input_range: params.input_range as [number, number],
      output_range: params.output_range as [number, number],
      input_min_max: params.input_min_max || params.input_range,
      output_min_max: params.output_min_max || params.output_range,
      linearToExponentialState: params.linearToExponentialState,
    };
  }

  public serialize() {
    return this.uiState;
  }

  public buildConnectables() {
    let inputs = Map<string, ConnectableInput>().set('input', {
      // We expose the param here directly to bypass the overriding.  That's stupidly confusing.
      //
      // Basically, we need to add the input and either the first scaler input or the first scaler
      // manual control.  The Overridable param handles the second part, and we handle the first here.
      node: this.firstShifter.wrappedParam,
      type: 'number',
    });
    inputs = this.uiState.linearToExponentialState?.enabled
      ? inputs
      : inputs
          .set('scale', { node: this.scaler, type: 'number' })
          .set('pre_scale_shift', { type: 'number', node: this.firstShifter })
          .set('post_scale_shift', { type: 'number', node: this.secondShifter });

    return {
      inputs,
      outputs: Map<string, ConnectableOutput>().set('output', {
        node:
          this.awpHandle && this.uiState.linearToExponentialState?.enabled
            ? this.awpHandle
            : this.secondShifterNode,
        type: 'number',
      }),
      vcId: this.vcId,
      node: this,
    };
  }

  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
