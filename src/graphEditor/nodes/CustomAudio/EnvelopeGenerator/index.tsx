import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';

import type { ADSRValues } from 'src/controls/adsr';
import { buildDefaultADSR2Envelope } from 'src/controls/adsr2/adsr2';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import EnvelopeGeneratorSmallView from 'src/graphEditor/nodes/CustomAudio/EnvelopeGenerator/EnvelopeGeneratorSmallView';
import type { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { MIDINode, type MIDIInputCbs } from 'src/patchNetwork/midiNode';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { ADSR2Module } from 'src/synthDesigner/ADSRModule';
import { normalizeEnvelope } from 'src/util';

interface SerializedState {
  envelope: Adsr;
  outputRange: [number, number];
}

export class EnvelopeGenerator implements ForeignNode {
  private vcId: string;
  private adsrModule: ADSR2Module;
  private adsrOutputNode: AudioNode | null = null;
  private outputRange: [number, number] = [0, 1];
  public nodeType = 'customAudio/envelopeGenerator';
  static typeName = 'Envelope Generator';

  private heldNotes: number[] = [];
  private gateMIDINodeInputCBs: MIDIInputCbs = {
    onAttack: (note, _velocity) => {
      this.heldNotes.push(note);
      this.adsrModule.gate(0);
    },
    onRelease: (note, _velocity) => {
      if (R.last(this.heldNotes) === note) {
        this.adsrModule.ungate(0);
      }
      this.heldNotes = this.heldNotes.filter(oNote => note !== oNote);
    },
    onPitchBend: () => {
      /* no-op */
    },
    onClearAll: () => {
      this.adsrModule.ungate(0);
    },
  };
  private gateMIDINode: MIDINode = new MIDINode(() => this.gateMIDINodeInputCBs);

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.adsrModule = new ADSR2Module(
      ctx,
      {
        minValue: params?.outputRange?.[0] ?? 0,
        maxValue: params?.outputRange?.[1] ?? 1,
        lengthMs: 2000,
        steps: buildDefaultADSR2Envelope({
          phaseIndex: 0,
          debugName: 'EnvelopeGenerator constructor',
        }).steps,
        releaseStartPhase: 0.978,
      },
      1
    );

    this.adsrModule.getOutput().then(output => {
      this.adsrOutputNode = output;
      updateConnectables(vcId, this.buildConnectables());
    });

    if (params) {
      this.deserialize(params as SerializedState);
    } else {
      // TODO: Set defaults?
    }

    this.renderSmallView = mkContainerRenderHelper({
      Comp: EnvelopeGeneratorSmallView,
      getProps: () => ({
        onChange: (envelope: Adsr | ADSRValues, lengthMS: number) => {
          this.adsrModule.setState(normalizeEnvelope(envelope));
          this.adsrModule.setLengthMs(lengthMS);
        },
        setLogScale: (logScale: boolean) => this.adsrModule.setLogScale(logScale),
        initialState: {
          envelope: { ...this.adsrModule.serialize(), outputRange: this.outputRange },
          lengthMS: this.adsrModule.getLengthMs(),
        },
      }),
    });

    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
  }

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  public deserialize(params: SerializedState) {
    if (!R.isNil(params.envelope)) {
      const serialized: Adsr = params.envelope;
      this.adsrModule.setState(normalizeEnvelope(serialized));
    }
    if (!R.isNil(params.outputRange)) {
      this.outputRange = params.outputRange;
    }
  }

  public serialize(): SerializedState {
    return {
      envelope: this.adsrModule.serialize(),
      outputRange: this.outputRange,
    };
  }

  public buildConnectables(): AudioConnectables & { node: ForeignNode } {
    return {
      vcId: this.vcId,
      inputs: ImmMap<string, ConnectableInput>().set('gate', {
        type: 'midi',
        node: this.gateMIDINode,
      }),
      outputs: ImmMap<string, ConnectableOutput>().set('envelope', {
        type: 'number',
        node: this.adsrOutputNode ?? new DummyNode(),
      }),
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
