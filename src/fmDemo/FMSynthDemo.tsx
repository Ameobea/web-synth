import { PromiseResolveType } from 'ameo-utils';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import ControlPanel from 'react-control-panel';
import * as R from 'ramda';
import { Option } from 'funfix-core';

import { ConnectedFMSynthUI } from 'src/fmSynth/FMSynthUI';
import FMSynth, { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import 'src/index.scss';
import { ADSR2Module } from 'src/synthDesigner/ADSRModule';
import { AsyncOnce, midiToFrequency, msToSamples, samplesToMs } from 'src/util';
import './fmDemo.scss';
import { ADSRValues } from 'src/controls/adsr';
import { MidiKeyboard } from 'src/midiKeyboard/MidiKeyboard';
import FilterConfig, { FilterContainer } from 'src/fmDemo/FilterConfig';
import { normalizeEnvelope, FilterParams } from 'src/redux/modules/synthDesigner';
import { FilterType, getDefaultFilterParams } from 'src/synthDesigner/filterHelpers';
import { initSentry } from 'src/sentry';
import { Presets } from 'src/fmDemo/presets';
import BrowserNotSupported from 'src/misc/BrowserNotSupported';
import { useWindowSize } from 'src/reactUtils';
import { mkControlPanelADSR2WithSize } from 'src/controls/adsr2/ControlPanelADSR2';

const _getSerializeType = (synth: FMSynth) => synth.serialize();

export interface SerializedFMSynthDemoState {
  synth: ReturnType<typeof _getSerializeType>;
  octaveOffset: number;
  globalVolume: number;
  gainEnvelope: ADSRValues | Adsr;
  filterParams: FilterParams;
  filterEnvelope: ADSRValues | Adsr;
  filterBypassed: boolean;
}

const VOICE_COUNT = 10;
const SAMPLE_RATE = 44_100;

const buildDefaultGainADSR = (): Adsr => ({
  steps: [
    { x: 0, y: 0, ramper: { type: 'exponential', exponent: 0.5 } },
    { x: 0.04, y: 0.8, ramper: { type: 'exponential', exponent: 0.5 } },
    { x: 0.7, y: 0.8, ramper: { type: 'exponential', exponent: 0.5 } },
    { x: 1, y: 0, ramper: { type: 'exponential', exponent: 0.5 } },
  ],
  lenSamples: SAMPLE_RATE,
  loopPoint: null,
  releasePoint: 0.7,
  audioThreadData: { phaseIndex: 0 },
});

const buildDefaultFilterEnvelope = (): Adsr => ({
  steps: [
    { x: 0, y: 0.8, ramper: { type: 'exponential', exponent: 0.5 } },
    { x: 0.04, y: 0.5, ramper: { type: 'exponential', exponent: 0.5 } },
    { x: 1, y: 0.5, ramper: { type: 'exponential', exponent: 0.5 } },
  ],
  lenSamples: SAMPLE_RATE,
  loopPoint: null,
  releasePoint: 0.7,
  audioThreadData: { phaseIndex: 0 },
});

const GlobalState: {
  octaveOffset: number;
  globalVolume: number;
  filterParams: FilterParams;
  filterEnvelope: ADSRValues | Adsr;
  filterBypassed: boolean;
} = {
  octaveOffset: 1,
  globalVolume: 0.2,
  filterParams: getDefaultFilterParams(FilterType.Lowpass),
  filterEnvelope: buildDefaultFilterEnvelope(),
  filterBypassed: false,
};

const ctx = new AudioContext();
const mainGain = new GainNode(ctx);
mainGain.gain.value = 0.1;
const filters = new Array(VOICE_COUNT).fill(null).map(() => {
  const filter = new FilterContainer(ctx, GlobalState.filterParams);
  filter.getOutput().connect(mainGain);
  return filter;
});

document.addEventListener('keydown', () => ctx.resume(), { once: true });
document.addEventListener('mousedown', () => ctx.resume(), { once: true });

// Add a limiter in between the main output and the destination to avoid super loud noises
// and extra volume caused by combining multiple voices
const limiter = new DynamicsCompressorNode(ctx);
limiter.connect(ctx.destination);

mainGain.connect(limiter);

let polysynthCtxPtr = 0;

export const PolysynthMod = new AsyncOnce(() => import('src/polysynth'));
let polySynthMod: PromiseResolveType<ReturnType<typeof PolysynthMod.get>>;

// Start fetching immediately
PolysynthMod.get();

const serializeState = () => {
  const serialized: SerializedFMSynthDemoState = {
    synth: synth.serialize(),
    octaveOffset: GlobalState.octaveOffset,
    globalVolume: GlobalState.globalVolume,
    gainEnvelope: adsrs[0].serialize(),
    filterParams: GlobalState.filterParams,
    filterEnvelope: GlobalState.filterEnvelope,
    filterBypassed: GlobalState.filterBypassed,
  };
  return JSON.stringify(serialized);
};

window.onbeforeunload = () => {
  localStorage.fmSynthDemoState = serializeState();
};

const LastGateTimeByVoice = new Array(10).fill(0);

let serialized: SerializedFMSynthDemoState | null = null;
try {
  if (localStorage.fmSynthDemoState) {
    serialized = JSON.parse(localStorage.fmSynthDemoState);
  } else {
    serialized = Presets['bass guitar'];
  }
} catch (err) {
  console.error('Error deserializing fm synth');
}
if (!R.isNil(serialized?.globalVolume)) {
  mainGain.gain.value = serialized!.globalVolume;
  GlobalState.globalVolume = serialized!.globalVolume;
}
if (!R.isNil(serialized?.octaveOffset)) {
  GlobalState.octaveOffset = serialized!.octaveOffset;
}
if (!R.isNil(serialized?.filterBypassed)) {
  GlobalState.filterBypassed = serialized!.filterBypassed;
}

const voiceGains = new Array(VOICE_COUNT).fill(null).map((_i, voiceIx) => {
  const gain = new GainNode(ctx);
  gain.gain.value = 0;
  const filterBypassed = serialized?.filterBypassed ?? false;
  if (filterBypassed) {
    gain.connect(mainGain);
  } else {
    gain.connect(filters[voiceIx].getInput());
  }
  return gain;
});
const adsrs = new Array(VOICE_COUNT).fill(null).map((_i, i) => {
  const base = Option.of(serialized?.gainEnvelope)
    .map(normalizeEnvelope)
    .getOrElseL(buildDefaultGainADSR);
  const adsr = new ADSR2Module(ctx, {
    minValue: 0,
    maxValue: 1,
    lengthMs: samplesToMs(base.lenSamples),
    loopPoint: base.loopPoint,
    releaseStartPhase: base.releasePoint,
    steps: base.steps,
  });
  adsr.getOutput().connect(voiceGains[i].gain);
  return adsr;
});
const filterAdsrs = new Array(VOICE_COUNT).fill(null).map((_i, voiceIx) => {
  const base = Option.of(serialized?.filterEnvelope)
    .map(normalizeEnvelope)
    .getOrElseL(buildDefaultFilterEnvelope);
  const adsr = new ADSR2Module(ctx, {
    minValue: 0,
    maxValue: 1,
    lengthMs: samplesToMs(base.lenSamples),
    loopPoint: base.loopPoint,
    releaseStartPhase: base.releasePoint,
    steps: base.steps,
  });
  adsr.getOutput().connect(filters[voiceIx].csns.frequency.manualControl.offset);
  return adsr;
});

if (!R.isNil(serialized?.filterParams)) {
  GlobalState.filterParams = serialized!.filterParams;
  filters.forEach(filter => filter.setAll(GlobalState.filterParams));
}

const baseTheme = {
  background1: 'rgb(35,35,35)',
  background2: 'rgb(54,54,54)',
  background2hover: 'rgb(58,58,58)',
  foreground1: 'rgb(112,112,112)',
  text1: 'rgb(235,235,235)',
  text2: 'rgb(161,161,161)',
};

const synth = new FMSynth(ctx, undefined, {
  ...(serialized?.synth ?? {}),
  onInitialized: (inst: FMSynth) => {
    const awpNode = synth.getAWPNode()!;
    voiceGains.forEach((voiceGain, voiceIx) => awpNode.connect(voiceGain, voiceIx));

    PolysynthMod.get().then(mod => {
      const playNote = (voiceIx: number, note: number, _velocity: number) => {
        const frequency = midiToFrequency(note);
        (awpNode.parameters as Map<string, AudioParam>).get(
          `voice_${voiceIx}_base_frequency`
        )!.value = frequency;

        adsrs[voiceIx].gate();
        filterAdsrs[voiceIx].gate();
        inst.onGate(voiceIx);
        LastGateTimeByVoice[voiceIx] = ctx.currentTime;
      };

      const releaseNote = (voiceIx: number, _note: number, _velocity: number) => {
        const expectedLastGateTime = LastGateTimeByVoice[voiceIx];
        const releaseLengthMs =
          (1 - adsrs[voiceIx].getReleaseStartPhase()) * adsrs[voiceIx].getLengthMs();
        setTimeout(() => {
          // If the voice has been re-gated since releasing, don't disconnect
          if (LastGateTimeByVoice[voiceIx] !== expectedLastGateTime) {
            return;
          }

          const freqParam = (synth.getAWPNode()!.parameters as Map<string, AudioParam>).get(
            `voice_${voiceIx}_base_frequency`
          )!;
          freqParam.value = 0;
        }, releaseLengthMs);

        adsrs[voiceIx].ungate();
        filterAdsrs[voiceIx].ungate();
        inst.onUnGate(voiceIx);
      };

      polysynthCtxPtr = mod.create_polysynth_context(playNote, releaseNote);
      polySynthMod = mod;
    });
  },
});

const MainControlPanel: React.FC = ({}) => {
  const gainEnvelope = useMemo(
    () =>
      Option.of(serialized?.gainEnvelope).map(normalizeEnvelope).getOrElseL(buildDefaultGainADSR),
    []
  );

  const [mainControlPanelState, setMainControlPanelState] = useState({
    'MAIN VOLUME': serialized?.globalVolume ?? 0.1,
    'volume envelope length ms': samplesToMs(gainEnvelope.lenSamples),
    'volume envelope': {
      ...gainEnvelope,
      outputRange: [0, 1],
    },
  });

  const SizedControlPanelADSR2 = useMemo(() => mkControlPanelADSR2WithSize(360, 200), []);

  return (
    <ControlPanel
      style={{ width: 379 }}
      settings={[
        {
          type: 'range',
          label: 'MAIN VOLUME',
          min: 0,
          max: 1,
        },
        {
          type: 'range',
          label: 'volume envelope length ms',
          min: 10,
          max: 10_000,
        },
        {
          type: 'custom',
          label: 'volume envelope',
          Comp: SizedControlPanelADSR2,
        },
      ]}
      state={mainControlPanelState}
      onChange={(key: string, val: any) => {
        switch (key) {
          case 'MAIN VOLUME': {
            GlobalState.globalVolume = val;
            mainGain.gain.value = val;
            setMainControlPanelState({ ...mainControlPanelState, 'MAIN VOLUME': val });
            break;
          }
          case 'volume envelope': {
            adsrs.forEach(adsr =>
              adsr.setState({
                ...val,
                lenSamples: msToSamples(adsr.getLengthMs()),
              })
            );
            setMainControlPanelState({
              ...mainControlPanelState,
              'volume envelope': {
                ...val,
                lenSamples: msToSamples(adsrs[0].getLengthMs()),
              },
            });
            break;
          }
          case 'volume envelope length ms': {
            adsrs.forEach(adsr => adsr.setLengthMs(val));
            setMainControlPanelState({
              ...mainControlPanelState,
              'volume envelope': {
                ...mainControlPanelState['volume envelope'],
                lenSamples: msToSamples(adsrs[0].getLengthMs()),
              },
              'volume envelope length ms': val,
            });
            break;
          }
          default: {
            console.error('Unhandled key: ' + key);
          }
        }
      }}
    />
  );
};

const PresetsControlPanel: React.FC<{
  setOctaveOffset: (newOctaveOffset: number) => void;
  reRenderAll: () => void;
}> = ({ setOctaveOffset, reRenderAll }) => {
  const loadedPreset = useRef<keyof typeof Presets | null>(null);

  const loadPreset = useCallback((presetName: keyof typeof Presets) => {
    loadedPreset.current = presetName;
    const preset = R.clone(Presets[presetName]);
    const oldGlobalVolume = serialized?.globalVolume;
    serialized = preset;
    serialized.globalVolume = oldGlobalVolume ?? serialized.globalVolume;
    synth.deserialize(preset.synth);

    // Gain ADSRs
    adsrs.forEach(adsr => adsr.setState(normalizeEnvelope(preset.gainEnvelope)));
    // Filter ADSRs
    filterAdsrs.forEach(adsr => adsr.setState(normalizeEnvelope(preset.filterEnvelope)));
    // Octave offset
    setOctaveOffset(preset.octaveOffset);
    GlobalState.octaveOffset = preset.octaveOffset;
    // Filters
    GlobalState.filterEnvelope = preset.filterEnvelope;
    GlobalState.filterParams = preset.filterParams;
    filters.forEach(filter => filter.setAll(GlobalState.filterParams));

    // Disconnect main output to avoid any horrific artifacts while we're switching
    mainGain.disconnect(limiter);

    // FM synth ADSRs
    preset.synth.adsrs.forEach((adsr, adsrIx) => synth.handleAdsrChange(adsrIx, adsr));
    // FM synth modulation matrix
    preset.synth.modulationMatrix.forEach((row, srcOperatorIx) => {
      row.forEach((modIx, dstOperatorIx) => {
        synth.handleModulationIndexChange(srcOperatorIx, dstOperatorIx, modIx);
      });
    });
    // FM synth output weights
    preset.synth.outputWeights.forEach((outputWeight, operatorIx) =>
      synth.handleOutputWeightChange(operatorIx, outputWeight)
    );
    // FM synth operator configs
    preset.synth.operatorConfigs.forEach((config, opIx) =>
      synth.handleOperatorConfigChange(opIx, config)
    );
    // FM synth operator effects
    preset.synth.operatorEffects.forEach((effectsForOp, opIx) => {
      // Reverse order so that they hopefully get removed in descending order
      [...effectsForOp].reverse().forEach((effect, effectIx) => {
        synth.setEffect(opIx, 15 - effectIx, effect);
      });
    });
    // FM synth main effects
    [...preset.synth.mainEffectChain]
      // Reverse order so that they hopefully get removed in descending order
      .reverse()
      .forEach((effect, effectIx) => synth.setEffect(null, 15 - effectIx, effect));
    // FM synth selected UI
    synth.selectedUI = preset.synth.selectedUI;
    // FM synth detune
    synth.handleDetuneChange(preset.synth.detune);

    // Clear all UI and trigger it to re-initialize internal state from scratch
    reRenderAll();

    setTimeout(() => mainGain.connect(limiter), 200);
  }, []);
  const controlPanelCtx = useRef<any>(null);

  return (
    <ControlPanel
      title='presets'
      contextCb={(ctx: any) => {
        controlPanelCtx.current = ctx;
      }}
      style={{ width: 379 }}
      settings={[
        {
          type: 'select',
          label: 'select preset',
          options: Object.keys(Presets),
          initial: loadedPreset.current ?? 'el. piano 1',
        },
        {
          type: 'button',
          label: 'load preset',
          action: () => {
            if (!controlPanelCtx) {
              console.error('Tried to load preset, but control panel context not ready');
              return;
            }

            const presetName = controlPanelCtx.current['select preset'];
            loadPreset(presetName);
          },
        },
        {
          type: 'button',
          label: 'copy preset to clipboard',
          action: async () => {
            const serialized = serializeState();
            try {
              navigator.clipboard.writeText(serialized);
              alert('Successfully copied to clipboard');
            } catch (err) {
              alert('Error copying text to clipboard: ' + err);
            }
          },
        },
      ]}
      theme={{ ...baseTheme, text1: 'rgb(75 255 89)' }}
    />
  );
};

const FMSynthDemo: React.FC = () => {
  const [octaveOffset, setOctaveOffsetInner] = useState(serialized?.octaveOffset ?? 1);
  const setOctaveOffset = (newOctaveOffset: number) => {
    GlobalState.octaveOffset = newOctaveOffset;
    setOctaveOffsetInner(newOctaveOffset);
  };
  const [renderUI, setRenderUI] = useState(true);
  const reRenderAll = () => setRenderUI(false);
  useEffect(() => {
    if (!renderUI) {
      setRenderUI(true);
    }
  }, [renderUI]);

  const windowSize = useWindowSize();
  // subtract the keyboard's height
  const height = windowSize.height - 228;

  if (!renderUI) {
    return null;
  }

  return (
    <div className='fm-synth-demo'>
      <div className='fm-synth-demo-controls' style={{ height }}>
        <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'rgb(35,35,35)' }}>
          <MainControlPanel />
          <PresetsControlPanel setOctaveOffset={setOctaveOffset} reRenderAll={reRenderAll} />
        </div>

        <ConnectedFMSynthUI synth={synth} />
        <FilterConfig
          filters={filters}
          adsrs={filterAdsrs}
          initialState={{
            params: GlobalState.filterParams,
            envelope: normalizeEnvelope(GlobalState.filterEnvelope),
            bypass: GlobalState.filterBypassed,
          }}
          onChange={(params: FilterParams, envelope: Adsr, bypass: boolean) => {
            GlobalState.filterParams = params;
            GlobalState.filterEnvelope = envelope;

            if (bypass && !GlobalState.filterBypassed) {
              voiceGains.forEach((node, voiceIx) => {
                node.disconnect(filters[voiceIx].getInput());
                node.connect(mainGain);
              });
            } else if (!bypass && GlobalState.filterBypassed) {
              voiceGains.forEach((node, voiceIx) => {
                node.disconnect(mainGain);
                node.connect(filters[voiceIx].getInput());
              });
            }
            GlobalState.filterBypassed = bypass;
          }}
        />
      </div>
      <div className='midi-keyboard-wrapper'>
        <MidiKeyboard
          octaveOffset={octaveOffset}
          onOctaveOffsetChange={setOctaveOffset}
          onAttack={midiNumber => polySynthMod?.handle_note_down(polysynthCtxPtr, midiNumber)}
          onRelease={midiNumber => polySynthMod?.handle_note_up(polysynthCtxPtr, midiNumber)}
        />
      </div>
    </div>
  );
};

initSentry();
const root = (ReactDOM as any).unstable_createRoot(document.getElementById('root')!);

setTimeout(() => {
  const elem = document.getElementById('simd-status');
  if (navigator.userAgent.includes('Firefox/')) {
    elem!.innerHTML +=
      '<br /><br/><span style="color: rgb(233,142,24);">Firefox has <a href="https://bugzilla.mozilla.org/show_bug.cgi?id=1171438">several</a> <a href="https://bugzilla.mozilla.org/show_bug.cgi?id=1567777">bugs</a> in its WebAudio implementation; Chrome will give a better experience</span>';
  }

  if (typeof SharedArrayBuffer === 'undefined') {
    elem!.innerHTML +=
      '<br /><br/><span style="color: rgb(233,142,24);"><code>SharedArrayBuffer</code> support not detected; some visualizations and other features are not available.</span>';
  }
}, 1000);

if (typeof AudioWorkletNode === 'undefined') {
  root.render(
    <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
      <BrowserNotSupported />
    </div>
  );
} else {
  root.render(<FMSynthDemo />);
}
