import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import { get, writable, type Writable } from 'svelte/store';

import type { ADSRValues } from 'src/controls/adsr';
import { type AudioThreadData } from 'src/controls/adsr2/adsr2';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import { AdsrLengthMode, type Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import { RegateMode } from 'src/graphEditor/nodes/CustomAudio/MIDIToFrequency/MIDIToFrequencySmallView.svelte';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { MIDINode, type MIDIInputCbs } from 'src/patchNetwork/midiNode';
import { mkContainerCleanupHelper, mkContainerRenderHelper, mkLazyComponent } from 'src/reactUtils';
import { ADSR2Module } from 'src/synthDesigner/ADSRModule';
import { msToSamples, normalizeEnvelope, samplesToMs } from 'src/util';
import { buildDefaultADSR2Envelope } from 'src/controls/adsr2/adsr2Helpers';

export interface EnvelopeGeneratorState {
  envelope: Adsr;
  outputRange: [number, number];
  regateMode: RegateMode;
}

export class EnvelopeGenerator implements ForeignNode {
  private vcId: string;
  private adsrModule: ADSR2Module;
  private adsrOutputNode: AudioNode | null = null;
  private outputRange: [number, number] = [0, 1];
  private regateMode: RegateMode = RegateMode.AnyAttack;
  private state: Writable<EnvelopeGeneratorState>;

  public nodeType = 'customAudio/envelopeGenerator';
  static typeName = 'Envelope Generator';

  private heldNotes: number[] = [];
  private gateMIDINodeInputCBs: MIDIInputCbs = {
    onAttack: (note, _velocity) => {
      const beforeHeldNoteCount = this.heldNotes.length;
      this.heldNotes.push(note);
      switch (this.regateMode) {
        case RegateMode.AnyAttack:
          this.adsrModule.gate(0);
          break;
        case RegateMode.NoNotesHeld:
          if (beforeHeldNoteCount === 0) {
            this.adsrModule.gate(0);
          }
          break;
        default:
          throw new Error(`Unexpected regate mode: ${this.regateMode}`);
      }
    },
    onRelease: (note, _velocity) => {
      const newHeldNotes = this.heldNotes.filter(oNote => note !== oNote);
      switch (this.regateMode) {
        case RegateMode.AnyAttack:
          if (R.last(this.heldNotes) === note) {
            this.adsrModule.ungate(0);
          }
          break;
        case RegateMode.NoNotesHeld:
          if (newHeldNotes.length === 0) {
            this.adsrModule.ungate(0);
          }
          break;
        default:
          throw new Error(`Unexpected regate mode: ${this.regateMode}`);
      }
      this.heldNotes = newHeldNotes;
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
    const audioThreadData: AudioThreadData = {
      phaseIndex: 0,
      debugName: 'EnvelopeGenerator constructor',
    };
    this.adsrModule = new ADSR2Module(
      ctx,
      {
        minValue: params?.outputRange?.[0] ?? 0,
        maxValue: params?.outputRange?.[1] ?? 1,
        length: msToSamples(2000),
        lengthMode: AdsrLengthMode.Samples,
        steps: buildDefaultADSR2Envelope({
          phaseIndex: 0,
          debugName: 'EnvelopeGenerator constructor',
        }).steps,
        releaseStartPhase: 0.978,
        logScale: true,
      },
      1,
      audioThreadData
    );

    this.adsrModule.getOutput().then(output => {
      this.adsrOutputNode = output;
      updateConnectables(vcId, this.buildConnectables());
    });

    if (params) {
      this.deserialize(params as EnvelopeGeneratorState);
    }
    this.state = writable({
      envelope: {
        ...this.adsrModule.serialize(),
        outputRange: this.outputRange,
        audioThreadData,
      },
      outputRange: this.outputRange,
      regateMode: this.regateMode,
    });

    this.renderSmallView = mkContainerRenderHelper({
      Comp: mkLazyComponent(
        () =>
          import('src/graphEditor/nodes/CustomAudio/EnvelopeGenerator/EnvelopeGeneratorSmallView')
      ),
      getProps: () => ({
        onChange: (envelope: Adsr | ADSRValues, lengthMS: number) => {
          this.adsrModule.setState(normalizeEnvelope(envelope));
          this.adsrModule.setLengthMs(lengthMS);
          this.state.update(state => ({
            ...state,
            envelope: {
              ...this.adsrModule.serialize(),
              audioThreadData,
            },
          }));
        },
        setLogScale: (logScale: boolean) => this.adsrModule.setLogScale(logScale),
        setRegateMode: (regateMode: RegateMode) => {
          this.regateMode = regateMode;
          this.state.update(state => ({ ...state, regateMode }));
        },
        store: this.state,
      }),
    });

    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
  }

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  public deserialize(params: EnvelopeGeneratorState) {
    const adsr: Adsr | null = R.isNil(params.envelope) ? null : normalizeEnvelope(params.envelope);
    if (adsr) {
      this.adsrModule.setState(adsr);
      this.adsrModule.setLengthMs(samplesToMs(adsr.lenSamples));
    }
    if (!R.isNil(params.outputRange)) {
      this.outputRange = params.outputRange;
    }
    if (!R.isNil(params.regateMode)) {
      this.regateMode = params.regateMode;
    }
  }

  public serialize(): EnvelopeGeneratorState {
    const state = get(this.state);
    return {
      envelope: this.adsrModule.serialize(),
      outputRange: this.outputRange,
      regateMode: state.regateMode,
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
