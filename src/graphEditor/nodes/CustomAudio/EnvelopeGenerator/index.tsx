import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
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
  public name = 'Envelope Generator';

  private gateMIDINodeInputCBs: MIDIInputCbs = {
    onAttack: (_note, _voiceIx, _velocity, offset) => this.adsrModule.gate(offset),
    onRelease: (_note, _voiceIx, _velocity, offset) => {
      this.adsrModule.ungate(offset);
    },
    onPitchBend: () => {
      /* no-op */
    },
    onClearAll: _stopPlayingNotes => {
      this.adsrModule.ungate();
    },
  };
  private gateMIDINode: MIDINode = buildMIDINode(() => this.gateMIDINodeInputCBs);

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.vcId = vcId;
    this.adsrModule = new ADSRModule(ctx, {});
    this.adsrModule.start();

    if (params) {
      this.deserialize(params);
    } else {
      // TODO: Set defaults?
    }

    this.renderSmallView = mkContainerRenderHelper({
      Comp: EnvelopeGeneratorSmallView,
      getProps: () => ({
        onChange: (envelope: ADSRValues) => this.adsrModule.setEnvelope(envelope),
        initialState: {
          envelope: this.adsrModule.envelope,
        },
      }),
    });

    this.cleanupSmallView = mkContainerCleanupHelper();
  }

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  public deserialize(params: { [key: string]: any }) {
    if (!R.isNil(params.envelope)) {
      this.adsrModule.setEnvelope(params.envelope);
    }
  }

  public serialize(): { [key: string]: any } {
    return { envelope: this.adsrModule.envelope };
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
