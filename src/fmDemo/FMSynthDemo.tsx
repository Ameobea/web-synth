// get the ball rolling on this ASAP in the loading process
import 'src/eventScheduler/eventScheduler';

import * as R from 'ramda';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { createRoot } from 'react-dom/client';

import './fmDemo.css';
import { mkControlPanelADSR2WithSize } from 'src/controls/adsr2/ControlPanelADSR2';
import FilterConfig from 'src/fmDemo/FilterConfig';
import { Presets, type SerializedFMSynthDemoState } from 'src/fmDemo/presets';
import { ConnectedFMSynthUI } from 'src/fmSynth/FMSynthUI';
import FMSynth, {
  FilterParamControlSource,
  type Adsr,
} from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import 'src/index.css';
import 'src/colors.css';
import { MIDIInput } from 'src/midiKeyboard/midiInput';
import { MidiKeyboard } from 'src/midiKeyboard/MidiKeyboard';
import BrowserNotSupported from 'src/misc/BrowserNotSupported';
import { MIDINode } from 'src/patchNetwork/midiNode';
import { useWindowSize } from 'src/reactUtils';
import type { FilterParams } from 'src/redux/modules/synthDesigner';
import { getSentry } from 'src/sentry';
import { getDefaultFilterParams } from 'src/synthDesigner/filterHelpers';
import {
  UnreachableError,
  filterNils,
  initGlobals,
  msToSamples,
  normalizeEnvelope,
  samplesToMs,
} from 'src/util';
import { SpectrumVisualization } from 'src/visualizations/spectrum';
import { FilterType } from 'src/synthDesigner/FilterType';
import { SafariNotification } from 'src/misc/SafariNotification';

initGlobals();

const GlobalState: {
  octaveOffset: number;
  globalVolume: number;
  filterParams: FilterParams;
  filterBypassed: boolean;
  filterADSREnabled: boolean;
  selectedMIDIInputName?: string | undefined;
  lastLoadedPreset?: string | undefined;
} = {
  octaveOffset: 1,
  globalVolume: 0.2,
  filterParams: getDefaultFilterParams(FilterType.Lowpass),
  filterBypassed: false,
  filterADSREnabled: true,
  selectedMIDIInputName: undefined,
  lastLoadedPreset: undefined,
};

const root = createRoot(document.getElementById('root')!);

const environmentIsValid =
  typeof AudioWorkletNode !== 'undefined' && typeof ConstantSourceNode !== 'undefined';
if (!environmentIsValid) {
  getSentry()?.captureException(
    new Error('Browser does not support `AudioWorkletNode`; displaying not supported message')
  );
  root.render(
    <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
      <BrowserNotSupported />
    </div>
  );
}

const ctx = new AudioContext();
const mainGain = new GainNode(ctx);
mainGain.gain.value = 0.1;

// Disable context menu on mobile that can be caused by long holds on keys
if (window.screen.width < 1000) {
  window.oncontextmenu = function (event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return false;
  };
}

const analyzerNode = new AnalyserNode(ctx);
mainGain.connect(analyzerNode);
// We connect it but pass through no audio, just keep it driven as a part of the
// audio graph.
const muter = new GainNode(ctx);
muter.gain.value = 0;
muter.connect(ctx.destination);

// Web browsers like to disable audio contexts when they first exist to prevent auto-play video/audio ads.
//
// We explicitly re-enable it whenever the user does something on the page.
document.addEventListener('keydown', () => ctx.resume(), { once: true });
document.addEventListener('mousedown', () => ctx.resume(), { once: true });
document.addEventListener('touchstart', () => ctx.resume(), { once: true });
document.addEventListener('touchend', () => ctx.resume(), { once: true });

const sentryRecord = (msg: string, extra: Record<string, any> = {}) => {
  const sentry = getSentry();
  if (!sentry) {
    return;
  }
  sentry.captureMessage(msg, { tags: { fmSynthDemo: true }, extra });
};

getSentry()?.setContext('fmSynthDemo', { fmSynthDemo: true });

// Add a limiter in between the main output and the destination to avoid super loud noises
// and extra volume caused by combining multiple voices
const limiter = new DynamicsCompressorNode(ctx);
limiter.connect(ctx.destination);

mainGain.connect(limiter);

const serializeState = () => {
  const serializedSynth = synth.serialize();
  const serialized: SerializedFMSynthDemoState = {
    synth: serializedSynth,
    octaveOffset: GlobalState.octaveOffset,
    globalVolume: GlobalState.globalVolume,
    filterParams: GlobalState.filterParams,
    filterBypassed: GlobalState.filterBypassed,
    filterADSREnabled: GlobalState.filterADSREnabled,
    selectedMIDIInputName: GlobalState.selectedMIDIInputName,
    lastLoadedPreset: GlobalState.lastLoadedPreset,
  };
  return JSON.stringify(serialized);
};

window.onbeforeunload = () => {
  if (localStorage) {
    localStorage.fmSynthDemoState = serializeState();
  }
};

let serialized: SerializedFMSynthDemoState | null = null;
try {
  if (localStorage?.fmSynthDemoState) {
    serialized = JSON.parse(localStorage.fmSynthDemoState);
  } else {
    serialized = Presets['pluck'];
    GlobalState.lastLoadedPreset = 'pluck';
  }
} catch (err) {
  getSentry()?.captureException(err, {
    extra: { localStorage__fmSynthDemoState: localStorage?.fmSynthDemoState },
  });
  console.error('Error deserializing fm synth');
  serialized = Presets['pluck'];
  GlobalState.lastLoadedPreset = 'pluck';
}
if (!R.isNil(serialized?.globalVolume)) {
  console.log('Setting global volume', serialized!.globalVolume);
  mainGain.gain.value = serialized!.globalVolume;
  GlobalState.globalVolume = serialized!.globalVolume;
}
if (!R.isNil(serialized?.octaveOffset)) {
  GlobalState.octaveOffset = serialized!.octaveOffset;
}
if (!R.isNil(serialized?.filterBypassed)) {
  GlobalState.filterBypassed = serialized!.filterBypassed;
}
GlobalState.filterADSREnabled = serialized!.filterADSREnabled ?? true;
GlobalState.selectedMIDIInputName = serialized!.selectedMIDIInputName;
GlobalState.lastLoadedPreset = serialized!.lastLoadedPreset;

if (!R.isNil(serialized?.filterParams)) {
  GlobalState.filterParams = serialized!.filterParams;
}

const baseTheme = {
  background1: 'rgb(35,35,35)',
  background2: 'rgb(54,54,54)',
  background2hover: 'rgb(58,58,58)',
  foreground1: 'rgb(112,112,112)',
  text1: 'rgb(235,235,235)',
  text2: 'rgb(161,161,161)',
};

const midiInputNode = new MIDINode();
const midiInput = new MIDIInput(ctx, midiInputNode, GlobalState.selectedMIDIInputName);
const midiOutput = new MIDINode(() => ({
  enableRxAudioThreadScheduling: { mailboxIDs: ['fm-synth-demo-fm-synth'] },
  onAttack: (_note, _velocity) => {
    throw new UnreachableError();
  },
  onRelease: (_note, _velocity) => {
    throw new UnreachableError();
  },
  onClearAll: () => {
    // no-op; this will never get sent directly from user MIDI devices and only exists
    // for internal web-synth use cases that aren't part of this demo
  },
  onPitchBend: () => {
    // not implemented
  },
}));
midiInputNode.connect(midiOutput);

const synth = new FMSynth(ctx, undefined, {
  ...(serialized?.synth ?? {}),
  audioThreadMIDIEventMailboxID: 'fm-synth-demo-fm-synth',
  midiNode: midiInputNode,
  onInitialized: () => {
    const awpNode = synth.getAWPNode()!;
    awpNode.connect(mainGain);

    synth.setFilterParams(GlobalState.filterParams);
    synth.setFilterBypassed(GlobalState.filterBypassed);
    synth.handleFilterFrequencyChange(
      GlobalState.filterParams.frequency,
      GlobalState.filterADSREnabled
        ? FilterParamControlSource.Envelope
        : FilterParamControlSource.Manual
    );
  },
});

const playNote = (midiNumber: number) => {
  midiInputNode.onAttack(midiNumber, 255);
};

const releaseNote = (midiNumber: number) => {
  midiInputNode.onRelease(midiNumber, 255);
};

const MainControlPanel: React.FC = () => {
  const [mainControlPanelState, setMainControlPanelState] = useState({
    'MAIN VOLUME': GlobalState.globalVolume,
    'volume envelope length ms': samplesToMs(synth.gainEnvelope.lenSamples.value),
    'volume envelope': {
      ...synth.gainEnvelope,
      lenSamples: synth.gainEnvelope.lenSamples.value,
      outputRange: [0, 1],
    },
  });

  const SizedControlPanelADSR2 = useMemo(
    () => mkControlPanelADSR2WithSize(360, 200, undefined, 'fmSynthDemoVolumeEnvelope'),
    []
  );
  const settings = useMemo(
    () =>
      filterNils([
        {
          type: 'range',
          label: 'MAIN VOLUME',
          min: 0,
          max: 1,
        },
        window.screen.width < 1000
          ? null
          : {
              type: 'range',
              label: 'volume envelope length ms',
              min: 10,
              max: 10_000,
            },
        window.screen.width < 1000
          ? null
          : {
              type: 'custom',
              label: 'volume envelope',
              Comp: SizedControlPanelADSR2,
            },
      ]),
    [SizedControlPanelADSR2]
  );

  return (
    <ControlPanel
      style={{ width: window.screen.width < 1000 ? '100%' : 379 }}
      settings={settings}
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
            const adsr: Adsr = val;
            synth.handleAdsrChange(-1, {
              ...adsr,
              lenSamples: { type: 'constant', value: adsr.lenSamples },
            });
            setMainControlPanelState({ ...mainControlPanelState, 'volume envelope': val });
            break;
          }
          case 'volume envelope length ms': {
            synth.handleAdsrChange(-1, {
              ...synth.gainEnvelope,
              lenSamples: { type: 'constant', value: msToSamples(val) },
            });
            setMainControlPanelState({
              ...mainControlPanelState,
              'volume envelope': {
                ...mainControlPanelState['volume envelope'],
                lenSamples: msToSamples(val),
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

const bypassFilter = () => synth.setFilterBypassed(true);

const unBypassFilter = () => synth.setFilterBypassed(false);

interface PresetsControlPanelProps {
  setOctaveOffset: (newOctaveOffset: number) => void;
  reRenderAll: () => void;
}

const PresetsControlPanel: React.FC<PresetsControlPanelProps> = ({
  setOctaveOffset,
  reRenderAll,
}) => {
  const isLoadingPreset = useRef(false);
  const loadPreset = useCallback(
    (presetName: string) => {
      if (isLoadingPreset.current) {
        return;
      }

      GlobalState.lastLoadedPreset = presetName;
      const preset = R.clone(Presets[presetName]);
      serialized = preset;
      const oldGainEnvelopeAudioThreadData = synth.gainEnvelope.audioThreadData;
      synth.deserialize(preset.synth);

      // Gain ADSRs
      const gainEnvelope: Adsr = {
        ...normalizeEnvelope(
          preset.gainEnvelope ?? {
            ...preset.synth.gainEnvelope,
            lenSamples: preset.synth.gainEnvelope.lenSamples.value,
          }
        ),
        audioThreadData: oldGainEnvelopeAudioThreadData,
      };
      synth.handleAdsrChange(-1, {
        ...gainEnvelope,
        audioThreadData: synth.gainEnvelope.audioThreadData,
        lenSamples: { type: 'constant', value: gainEnvelope.lenSamples },
      });
      // Octave offset
      setOctaveOffset(preset.octaveOffset);
      GlobalState.octaveOffset = preset.octaveOffset;
      // Filters
      const filterEnvelope = {
        ...normalizeEnvelope(
          preset.filterEnvelope ?? {
            ...preset.synth.filterEnvelope,
            lenSamples: preset.synth.filterEnvelope.lenSamples.value,
          }
        ),
        audioThreadData: synth.filterEnvelope.audioThreadData,
      };
      // Filter envelope
      synth.handleAdsrChange(-2, {
        ...filterEnvelope,
        lenSamples: { type: 'constant', value: filterEnvelope.lenSamples },
      });
      GlobalState.filterParams = preset.filterParams;
      synth.setFilterParams(GlobalState.filterParams);
      if (preset.filterBypassed !== GlobalState.filterBypassed) {
        if (preset.filterBypassed) {
          bypassFilter();
        } else {
          unBypassFilter();
        }
      }
      GlobalState.filterBypassed = preset.filterBypassed;
      synth.handleFilterFrequencyChange(
        preset.filterParams.frequency,
        preset.filterADSREnabled
          ? FilterParamControlSource.Envelope
          : FilterParamControlSource.Manual
      );
      GlobalState.filterADSREnabled = preset.filterADSREnabled ?? false;

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

      setTimeout(() => {
        mainGain.connect(limiter);
        isLoadingPreset.current = false;
      }, 200);
    },
    [reRenderAll, setOctaveOffset]
  );
  const controlPanelCtx = useRef<any>(null);

  const settings = useMemo(
    () =>
      filterNils([
        {
          type: 'select',
          label: 'select preset',
          options: Object.keys(Presets),
          initial: GlobalState.lastLoadedPreset ?? 'pluck',
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
            sentryRecord('Load preset', { presetName });
            loadPreset(presetName);
          },
        },
        window.screen.width < 1000
          ? null
          : {
              type: 'button',
              label: 'copy preset to clipboard',
              action: async () => {
                const serialized = serializeState();
                sentryRecord('Copy preset to keyboard', { serialized });
                try {
                  navigator.clipboard.writeText(serialized);
                  alert('Successfully copied to clipboard');
                } catch (err) {
                  alert('Error copying text to clipboard: ' + err);
                }
              },
            },
      ]),
    [loadPreset]
  );

  return (
    <ControlPanel
      title='choose preset'
      contextCb={(ctx: any) => {
        controlPanelCtx.current = ctx;
      }}
      style={{ width: window.screen.width < 1000 ? '100%' : 379 }}
      settings={settings}
      theme={{
        ...baseTheme,
        background1: 'rgb(14 149 102 / 80%)',
        text1: 'rgb(255 255 255)',
      }}
    />
  );
};

const MIDIInputControlPanel: React.FC = () => {
  const [availableMIDIInputs, setAvailableMIDIInputs] = useState<string[]>([]);
  const [selectedMIDIInputName, setSelectedMIDIInputNameInner] = useState<string>(
    GlobalState.selectedMIDIInputName ?? ''
  );
  const setSelectedMIDIInputName = (newMIDIInputName: string) => {
    GlobalState.selectedMIDIInputName = newMIDIInputName ? newMIDIInputName : undefined;
    setSelectedMIDIInputNameInner(newMIDIInputName);
    midiInput.handleSelectedInputName(newMIDIInputName ? newMIDIInputName : undefined);
  };

  useEffect(() => {
    midiInput.getMidiInputNames().then(availableMIDIInputNames => {
      setAvailableMIDIInputs(['', ...availableMIDIInputNames]);
      if (
        GlobalState.selectedMIDIInputName &&
        availableMIDIInputNames.includes(GlobalState.selectedMIDIInputName)
      ) {
        setSelectedMIDIInputName(GlobalState.selectedMIDIInputName);
      }
    });
  }, []);

  const settings = useMemo(
    () => [
      { label: 'midi device', type: 'select', options: availableMIDIInputs },
      {
        label: 'refresh midi device list',
        type: 'button',
        action: () =>
          midiInput.getMidiInputNames().then(availableMIDIInputNames => {
            sentryRecord('Refreshed FM synth demo MIDI device list', { availableMIDIInputNames });
            setAvailableMIDIInputs(['', ...availableMIDIInputNames]);
          }),
      },
    ],
    [availableMIDIInputs]
  );
  const state = useMemo(() => ({ 'midi device': selectedMIDIInputName }), [selectedMIDIInputName]);

  return (
    <ControlPanel
      settings={settings}
      style={{ width: window.screen.width < 1000 ? '100%' : 379 }}
      state={state}
      onChange={(key: string, val: any) => {
        switch (key) {
          case 'midi device': {
            sentryRecord('Selected MIDI device', { midiInputName: val });
            setSelectedMIDIInputName(val);
            break;
          }
          default: {
            console.error('Unhandled key in MIDI input control panel: ', key);
          }
        }
      }}
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
  const [showViz, setShowViz] = useState(false);
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

  if (window.screen.width < 1000) {
    return (
      <>
        <div className='fm-synth-main-control-panel'>
          <MainControlPanel />
          <PresetsControlPanel setOctaveOffset={setOctaveOffset} reRenderAll={reRenderAll} />
        </div>

        <div className='fm-synth-demo-mobile-text'>
          <p>
            This is a trimmed-down version for mobile; visit the site on desktop for the full
            experience!{' '}
            {window.screen.width < window.screen.height
              ? 'Try turning your phone sideways as well.'
              : null}
          </p>
        </div>

        <div className='fm-synth-mobile-links'>
          <a href='/blog/fm-synth-rust-wasm-simd/'>Blog post</a>
          <br />
          <a href='/docs/fm-synth'>Docs</a>
          <br />
          <a href='https://www.youtube.com/watch?v=N4mZn9ZczDM'>Demo video + walkthrough</a>
        </div>

        <div className='midi-keyboard-wrapper' style={{ bottom: 0, position: 'absolute' }}>
          <MidiKeyboard
            octaveOffset={octaveOffset}
            onOctaveOffsetChange={setOctaveOffset}
            onAttack={midiNumber => playNote(midiNumber)}
            onRelease={midiNumber => releaseNote(midiNumber)}
            style={{ height: 180 }}
          />
        </div>
      </>
    );
  }

  return (
    <div className='fm-synth-demo'>
      <SafariNotification />
      <div className='fm-synth-demo-controls' style={{ height }}>
        <div className='fm-synth-main-control-panel'>
          <MainControlPanel />
          <PresetsControlPanel setOctaveOffset={setOctaveOffset} reRenderAll={reRenderAll} />
          <MIDIInputControlPanel />
          <ControlPanel
            settings={[
              {
                type: 'button',
                label: showViz ? 'hide spectrogram' : 'show spectrogram',
                action: () => {
                  sentryRecord('toggle fm synth demo visualization', { wasVisible: showViz });
                  setShowViz(!showViz);
                },
              },
            ]}
            style={{ width: 379 }}
          />
        </div>

        {showViz ? (
          <SpectrumVisualization
            paused={false}
            analyzerNode={analyzerNode}
            initialConf={{ color_fn: 2, scaler_fn: 0 }}
            height={800}
          />
        ) : (
          <>
            <ConnectedFMSynthUI
              synth={synth}
              getFMSynthOutput={async () => mainGain}
              midiNode={midiInputNode}
              synthID='demo'
              vcId={undefined}
              isHidden={false}
            />
            <FilterConfig
              initialState={{
                params: GlobalState.filterParams,
                envelope: normalizeEnvelope({
                  ...synth.filterEnvelope,
                  lenSamples: synth.filterEnvelope.lenSamples.value,
                }),
                bypass: GlobalState.filterBypassed,
                enableADSR: GlobalState.filterADSREnabled,
              }}
              onChange={(
                params: FilterParams,
                envelope: Adsr,
                bypass: boolean,
                enableADSR: boolean
              ) => {
                GlobalState.filterParams = params;
                synth.handleAdsrChange(-2, {
                  ...envelope,
                  lenSamples: { type: 'constant', value: envelope.lenSamples },
                });
                if (GlobalState.filterADSREnabled !== enableADSR) {
                  synth.handleFilterFrequencyChange(
                    params.frequency,
                    enableADSR ? FilterParamControlSource.Envelope : FilterParamControlSource.Manual
                  );
                }
                GlobalState.filterADSREnabled = enableADSR;

                if (bypass && !GlobalState.filterBypassed) {
                  bypassFilter();
                } else if (!bypass && GlobalState.filterBypassed) {
                  unBypassFilter();
                }
                GlobalState.filterBypassed = bypass;
              }}
              vcId={undefined}
              adsrDebugName='fmSynthDemoFilter'
              synth={synth}
            />
          </>
        )}
      </div>
      <div className='midi-keyboard-wrapper'>
        <MidiKeyboard
          octaveOffset={octaveOffset}
          onOctaveOffsetChange={newOctaveOffset => {
            setOctaveOffset(newOctaveOffset);
            sentryRecord('Octave offset change', { newOctaveOffset });
          }}
          onAttack={midiNumber => playNote(midiNumber)}
          onRelease={midiNumber => releaseNote(midiNumber)}
        />
      </div>
    </div>
  );
};

setTimeout(() => {
  const elem = document.getElementById('simd-status');

  if (!navigator.requestMIDIAccess) {
    elem!.innerHTML +=
      '<br /><br/><span style="color: rgb(233,142,24);">Web MIDI support not detected; external MIDI device support not available</span>';
  } else {
    elem!.innerHTML += '<br/><br/><span>Web MIDI support detected</span>';
  }
  getSentry()?.setContext('hasWebMIDISupport', {
    hasWebMIDISupport: !!navigator.requestMIDIAccess,
    hasSharedArrayBufferSupport: typeof SharedArrayBuffer !== 'undefined',
  });

  if (typeof SharedArrayBuffer === 'undefined') {
    elem!.innerHTML +=
      '<br /><br/><span style="color: rgb(233,142,24);"><code>SharedArrayBuffer</code> support not detected; some visualizations and other features are not available.</span>';
  }
}, 1000);

if (environmentIsValid) {
  root.render(<FMSynthDemo />);
}
