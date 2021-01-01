import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { ADSRValues } from 'src/controls/adsr';
import EnvelopeGeneratorSmallView from 'src/graphEditor/nodes/CustomAudio/EnvelopeGenerator/EnvelopeGeneratorSmallView';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { ADSRModule } from 'src/synthDesigner/ADSRModule';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { buildMIDINode, MIDIInputCbs, MIDINode } from 'src/patchNetwork/midiNode';

export class EnvelopeGenerator implements ForeignNode {
  private vcId: string;
  private adsrModule: ADSRModule;
  public nodeType = 'customAudio/envelopeGenerator';
  static typeName = 'Envelope Generator';

  private heldNotes: number[] = [];
  private gateMIDINodeInputCBs: MIDIInputCbs = {
    onAttack: (note, _velocity) => {
      this.heldNotes.push(note);
      this.adsrModule.gate();
    },
    onRelease: (note, _velocity) => {
      if (R.last(this.heldNotes) === note) {
        this.adsrModule.ungate();
      }
      this.heldNotes = this.heldNotes.filter(oNote => note !== oNote);
    },
    onPitchBend: () => {
      /* no-op */
    },
    onClearAll: () => {
      this.adsrModule.ungate();
    },
  };
  private gateMIDINode: MIDINode = buildMIDINode(() => this.gateMIDINodeInputCBs);

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.adsrModule = new ADSRModule(ctx, { lengthMs: 0 });
    this.adsrModule.start();

    if (params) {
      this.deserialize(params);
    } else {
      // TODO: Set defaults?
    }

    this.renderSmallView = mkContainerRenderHelper({
      Comp: EnvelopeGeneratorSmallView,
      getProps: () => ({
        onChange: (envelope: ADSRValues, lengthMS: number) => {
          this.adsrModule.setEnvelope(envelope);
          this.adsrModule.setLengthMs(lengthMS);
        },
        initialState: {
          envelope: this.adsrModule.envelope,
          lengthMS: this.adsrModule.lengthMs,
        },
      }),
    });

    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
  }

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  public deserialize(params: { [key: string]: any }) {
    if (!R.isNil(params.envelope)) {
      this.adsrModule.setEnvelope(params.envelope);
    }
    if (!R.isNil(params.lengthMS)) {
      this.adsrModule.setLengthMs(params.lengthMS);
    }
  }

  public serialize(): { [key: string]: any } {
    return {
      envelope: this.adsrModule.envelope,
      lengthMS: this.adsrModule.lengthMs,
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
        node: this.adsrModule,
      }),
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
