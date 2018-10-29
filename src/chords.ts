import * as R from 'ramda';
import Master from 'tone/Tone/core/Master';
import Synth from 'tone/Tone/instrument/Synth';
import PolySynth from 'tone/Tone/instrument/PolySynth';
import MonoSynth from 'tone/Tone/instrument/MonoSynth';
import BitCrusher from 'tone/Tone/effect/BitCrusher';
import * as tonal from 'tonal';
import { transpose } from 'tonal-distance';

const bitcrusher = new BitCrusher(5).toMaster();
export const synth = new PolySynth(50, Synth).connect(bitcrusher).toMaster();
synth.set('detune', -1200);
(window as any).SYNTH = synth;
(window as any).tonal = tonal;
(window as any).BITCRUSHER = bitcrusher;

Master.volume.value = -24;
