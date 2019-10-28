import Synth from 'tone/Tone/instrument/Synth';
import Volume from 'tone/Tone/component/Volume';
import * as R from 'ramda';

import { ADSRValues, defaultAdsrEnvelope } from './controls/adsr';
import { getState, dispatch } from './redux';
import { actionCreators } from './redux';

/**
 * These are manual type definitions for the ToneJS `Synth` class.
 */
export interface ToneSynth {
  envelope: ToneEnvelope;
  triggerAttack: (
    frequency: number | string,
    duration?: number | string,
    velocity?: number
  ) => void;
  triggerRelease: (time?: number | string) => void;
  disconnect: () => void;
  toMaster: () => void;
  connect: (connectTo: AudioNode) => void;
  set: (key: string, val: any) => void;
}

interface ToneEnvelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export class PolySynth {
  /**
   * An array of monophonic synths that make up the poly synth's voices
   */
  public voices: ToneSynth[];
  /**
   * This acts as a bus between all of the inner `voices` and tone's `Master`.  Rather than
   * applying effects to all of the individual voice synths, we chain the effects off of
   * `volume` to make them more efficient.
   */
  public volume: AudioNode & { set: (key: string, val: any) => void };

  public constructor(voiceCount: number, volume = 10.0) {
    this.volume = new Volume(volume).toMaster();

    this.voices = R.times(R.identity, voiceCount).map(() =>
      new Synth({
        envelope: {
          attack: defaultAdsrEnvelope.attack.pos,
          decay: defaultAdsrEnvelope.decay.pos,
          sustain: defaultAdsrEnvelope.decay.magnitude,
          release: defaultAdsrEnvelope.release.pos,
        },
      }).connect(this.volume)
    );
  }

  public setEnvelope(newEnvelope: ADSRValues) {
    const { attack, decay, release } = newEnvelope;
    this.voices.forEach(({ envelope }) => {
      envelope.attack = attack.pos;
      envelope.decay = decay.pos - attack.pos;
      envelope.sustain = decay.magnitude;
      envelope.release = release.pos;
    });
  }

  public connect(to: AudioNode) {
    this.volume.connect(to);
  }

  public disconnect() {
    this.volume.disconnect();
  }
}

const getSynths = (): PolySynth[] => getState().synths.synths;

export const init_synth = (uuid: string, voiceCount: number): number => {
  const synth = new PolySynth(voiceCount);
  synth.volume.set('volume', -16);
  const oldSynthCount = getSynths().length;
  dispatch(actionCreators.synths.SET_SYNTH(uuid, synth));
  return oldSynthCount;
};

export const trigger_attack = (synthIx: number, voiceIx: number, frequency: number) =>
  getSynths()[synthIx].voices[voiceIx].triggerAttack(frequency);

export const trigger_release = (synthIx: number, voiceIx: number) =>
  getSynths()[synthIx].voices[voiceIx].triggerRelease();

export const trigger_attack_release = (
  synthIx: number,
  voiceIx: number,
  frequency: number,
  _duration: number // TODO
) => {
  trigger_attack(synthIx, voiceIx, frequency);
  trigger_release(synthIx, voiceIx);
};

export const schedule_events = (
  synthIx: number,
  scheduledEvents: Uint8ClampedArray,
  frequencies: Float32Array,
  eventTimings: Float32Array
) => {
  const synths = getSynths();
  let consumedFrequencies = 0;

  // JS `Float32Array` doesn't have `.forEach()` and friends :(
  for (let i = 0; i < eventTimings.length; i += 1) {
    const [isAttack, voiceIx] = [scheduledEvents[i * 2] === 1, scheduledEvents[i * 2 + 1]];
    const time = eventTimings[i];
    const voice = synths[synthIx].voices[voiceIx];

    if (isAttack) {
      const frequency = frequencies[consumedFrequencies];
      consumedFrequencies += 1;
      voice.triggerAttack(frequency, '+' + time);
    } else {
      voice.triggerRelease('+' + time);
    }
  }
};
