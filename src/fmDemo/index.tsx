import { PromiseResolveType, UnreachableException } from 'ameo-utils';
import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import ControlPanel from 'react-control-panel';

import { ConnectedFMSynthUI } from 'src/fmSynth/FMSynthUI';
import FMSynth from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import 'src/index.css';
import { ADSRModule } from 'src/synthDesigner/ADSRModule';
import { AsyncOnce, midiToFrequency } from 'src/util';
import './fmDemo.scss';
import { ControlPanelADSR, defaultAdsrEnvelope } from 'src/controls/adsr';
import { MidiKeyboard } from 'src/midiKeyboard/MidiKeyboard';

const VOICE_COUNT = 16;

const ctx = new AudioContext();
const mainGain = new GainNode(ctx);
mainGain.gain.value = 0.1;
mainGain.connect(ctx.destination);
let polysynthCtxPtr = 0;

export const PolysynthMod = new AsyncOnce(() => import('src/polysynth'));
let polySynthMod: PromiseResolveType<ReturnType<typeof PolysynthMod.get>>;
const MainAdsr = new ADSRModule(ctx, { minValue: 0, maxValue: 1, lengthMs: 1000 });
MainAdsr.start();
MainAdsr.connect(mainGain.gain);

// Start fetching immediately
PolysynthMod.get();

const voiceGains = new Array(VOICE_COUNT).fill(null).map(() => {
  const gain = new GainNode(ctx);
  gain.gain.value = 0;
  gain.connect(mainGain);
  return gain;
});
const adsrs = new Array(VOICE_COUNT).fill(null).map((_i, i) => {
  const adsr = new ADSRModule(ctx, { minValue: 0, maxValue: 1, lengthMs: 1000 });
  adsr.start();
  adsr.connect(voiceGains[i].gain);
  return adsr;
});

window.onbeforeunload = () => {
  const serialized = synth.serialize();
  localStorage.fmSynthDemoState = JSON.stringify(serialized);
};

let serialized = {};
try {
  if (localStorage.fmSynthDemoState) {
    serialized = JSON.parse(localStorage.fmSynthDemoState);
  }
} catch (err) {
  console.error('Error deserializing fm synth');
}
const synth = new FMSynth(ctx, undefined, {
  ...serialized,
  onInitialized: () => {
    const awpNode = synth.getAWPNode()!;
    adsrs.forEach((adsr, voiceIx) => {
      awpNode.connect(voiceGains[voiceIx], voiceIx);
      adsr.connect(mainGain);
    });

    PolysynthMod.get().then(mod => {
      const playNote = (voiceIx: number, note: number, _velocity: number) => {
        const frequency = midiToFrequency(note);
        (awpNode.parameters as Map<string, AudioParam>).get(
          `voice_${voiceIx}_base_frequency`
        )!.value = frequency;

        adsrs[voiceIx].gate();
      };

      const releaseNote = (voiceIx: number, _note: number, _velocity: number) => {
        setTimeout(() => {
          (synth.getAWPNode()!.parameters as Map<string, AudioParam>).get(
            `voice_${voiceIx}_base_frequency`
          )!.value = 0;
        }, adsrs[voiceIx].lengthMs);

        adsrs[voiceIx].ungate();
      };

      polysynthCtxPtr = mod.create_polysynth_context(playNote, releaseNote);
      polySynthMod = mod;
    });
  },
});

const FMSynthDemo: React.FC = () => {
  const [octaveOffset, setOctaveOffset] = useState(1);

  return (
    <div>
      <div className='fm-synth-demo-controls'>
        <ControlPanel
          style={{ width: 380 }}
          settings={[
            {
              type: 'custom',
              label: 'volume envelope',
              initial: defaultAdsrEnvelope,
              Comp: ControlPanelADSR,
            },
          ]}
          onChange={(key: string, val: any) => {
            console.log({ key, val });
            switch (key) {
              case 'volume envelope': {
                MainAdsr.setEnvelope(val);
                break;
              }
              default:
                throw new UnreachableException('Unhandled key: ' + key);
            }
          }}
        />
        <ConnectedFMSynthUI synth={synth} />
      </div>
      <MidiKeyboard
        octaveOffset={octaveOffset}
        onOctaveOffsetChange={setOctaveOffset}
        onAttack={midiNumber => polySynthMod?.handle_note_down(polysynthCtxPtr, midiNumber)}
        onRelease={midiNumber => polySynthMod?.handle_note_up(polysynthCtxPtr, midiNumber)}
      />
    </div>
  );
};

const root = ReactDOM.unstable_createRoot(document.getElementById('root')!);
root.render(<FMSynthDemo />);
