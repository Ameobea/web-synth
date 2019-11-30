import { Map } from 'immutable';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkContainerRenderHelper, mkContainerCleanupHelper } from 'src/reactUtils';
import ScaleAndShiftSmallView, {
  ScaleAndShiftUIState,
} from 'src/graphEditor/nodes/CustomAudio/ScaleAndShift/ScaleAndShiftUI';

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
  private firstShifterNode: ConstantSourceNode;
  private scalerNode: GainNode;
  private secondShifterNode: ConstantSourceNode;
  private uiState: ScaleAndShiftUIState;

  public paramOverrides = {}; // TODO

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.scalerNode = new GainNode(ctx);
    this.scalerNode.gain.value = 0;
    this.firstShifterNode = new ConstantSourceNode(ctx);
    this.firstShifterNode.offset.value = 0;
    this.firstShifterNode.start();
    this.secondShifterNode = new ConstantSourceNode(ctx);
    this.secondShifterNode.offset.value = 0;
    this.secondShifterNode.start();

    this.uiState = this.maybeDeserialize(params);
    this.updateNodes();

    this.firstShifterNode.connect(this.scalerNode).connect(this.secondShifterNode.offset);

    this.renderSmallView = mkContainerRenderHelper({
      Comp: ScaleAndShiftSmallView,
      props: {
        initialState: this.uiState,
        onChange: newUIState => {
          this.uiState = newUIState;
          this.updateNodes();
        },
      },
    });
    this.cleanupSmallView = mkContainerCleanupHelper();
  }

  private updateNodes() {
    const { firstOffset, multiplier, secondOffset } = computeScaleAndShift(this.uiState);
    console.log({ firstOffset, multiplier, secondOffset });
    this.firstShifterNode.offset.value = firstOffset;
    this.scalerNode.gain.value = multiplier;
    this.secondShifterNode.offset.value = secondOffset;
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
      inputs: Map<string, ConnectableInput>().set('input', {
        node: this.firstShifterNode.offset,
        type: 'number',
      }),
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
