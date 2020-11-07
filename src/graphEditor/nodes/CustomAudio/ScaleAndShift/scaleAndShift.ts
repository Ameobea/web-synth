import { Map } from 'immutable';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkContainerRenderHelper, mkContainerCleanupHelper } from 'src/reactUtils';
import ScaleAndShiftSmallView, {
  ScaleAndShiftUIState,
} from 'src/graphEditor/nodes/CustomAudio/ScaleAndShift/ScaleAndShiftUI';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';

const computeScaleAndShift = ({
  input_range: inputRange,
  output_range: outputRange,
}: ScaleAndShiftUIState) => {
  const inputRangeSize = inputRange[1] - inputRange[0];
  const firstMultiplier = inputRangeSize === 0 ? 0 : 1 / inputRangeSize;
  const firstOffset = -inputRange[0];
  const secondMultiplier = outputRange[1] - outputRange[0];
  const secondOffset = outputRange[0];

  return { firstOffset, multiplier: firstMultiplier * secondMultiplier, secondOffset };
};

export class ScaleAndShiftNode implements ForeignNode {
  public name = 'Scale + Shift';
  public nodeType = 'customAudio/scaleAndShift';

  private vcId: string;
  private firstShifter: OverridableAudioParam;
  private scaler: OverridableAudioParam;
  private secondShifter: OverridableAudioParam;
  private secondShifterNode: ConstantSourceNode;
  private uiState: ScaleAndShiftUIState;

  public paramOverrides = {}; // TODO

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    const scalerNode = new GainNode(ctx);
    scalerNode.gain.value = 0;
    this.scaler = new OverridableAudioParam(ctx, scalerNode.gain);
    const firstShifterNode = new ConstantSourceNode(ctx);
    firstShifterNode.offset.value = 0;
    firstShifterNode.start();
    this.firstShifter = new OverridableAudioParam(ctx, firstShifterNode.offset);
    this.secondShifterNode = new ConstantSourceNode(ctx);
    this.secondShifterNode.offset.value = 0;
    this.secondShifterNode.start();
    this.secondShifter = new OverridableAudioParam(ctx, this.secondShifterNode.offset);

    this.uiState = this.maybeDeserialize(params);
    this.updateNodes();

    firstShifterNode.connect(scalerNode).connect(this.secondShifterNode.offset);

    this.renderSmallView = mkContainerRenderHelper({
      Comp: ScaleAndShiftSmallView,
      getProps: () => ({
        initialState: this.uiState,
        onChange: newUIState => {
          this.uiState = newUIState;
          this.updateNodes();
        },
      }),
    });
    this.cleanupSmallView = mkContainerCleanupHelper();
  }

  private updateNodes() {
    const { firstOffset, multiplier, secondOffset } = computeScaleAndShift(this.uiState);
    this.firstShifter.manualControl.offset.value = firstOffset;
    this.scaler.manualControl.offset.value = multiplier;
    this.secondShifter.manualControl.offset.value = secondOffset;
  }

  private maybeDeserialize(
    params: { [key: string]: any } | null | undefined
  ): ScaleAndShiftUIState {
    if (!params) {
      return { input_range: [-1, 1], output_range: [0, 10] };
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
    };
  }

  public serialize() {
    return this.uiState;
  }

  public buildConnectables() {
    return {
      inputs: Map<string, ConnectableInput>()
        .set('input', {
          // We expose the param here directly to bypass the overriding.  That's stupidly confusing.
          //
          // Basically, we need to add the input and either the first scaler input or the first scaler
          // manual control.  The Overridable param handles the second part, and we handle the first here.
          node: this.firstShifter.wrappedParam,
          type: 'number',
        })
        .set('scale', { node: this.scaler, type: 'number' })
        .set('pre_scale_shift', { type: 'number', node: this.firstShifter })
        .set('post_scale_shift', { type: 'number', node: this.secondShifter }),
      outputs: Map<string, ConnectableOutput>().set('output', {
        node: this.secondShifterNode,
        type: 'number',
      }),
      vcId: this.vcId,
      node: this,
    };
  }

  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
