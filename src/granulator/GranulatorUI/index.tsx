import { UnreachableException } from 'ameo-utils';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';

import { GranulatorInstancesById } from 'src/granulator/granulator';
import SampleEditor from 'src/granulator/GranulatorUI/SampleEditor';
import { getSample, SampleDescriptor } from 'src/sampleLibrary';
import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';
import { delay, retryWithDelay } from 'src/util';
import './Granulator.scss';
import SampleRecorder from 'src/granulator/GranulatorUI/SampleRecorder';
import { WaveformRenderer } from 'src/granulator/GranulatorUI/WaveformRenderer';

export interface GranulatorControlPanelState {
  grain_size: number;
  voice_1_samples_between_grains: number;
  voice_2_samples_between_grains: number;
  sample_speed_ratio: number;
  voice_1_filter_cutoff: number;
  voice_2_filter_cutoff: number;
  linear_slope_length: number;
  slope_linearity: number;
  voice_1_movement_samples_per_sample: number;
  voice_2_movement_samples_per_sample: number;
}

const GRANULATOR_CONTROL_PANEL_STYLE = { marginTop: 20, width: 800 };

const GranularControlPanel: React.FC<{
  vcId: string;
  initialState: GranulatorControlPanelState;
}> = ({ vcId, initialState }) => {
  const onChange = useMemo(
    () => async (key: string, value: any) => {
      const inst = await retryWithDelay(20, 500, async () => {
        const inst = GranulatorInstancesById.get(vcId);
        if (!inst) {
          throw new Error();
        }
        return inst;
      });
      if (!inst) {
        throw new UnreachableException();
      }

      switch (key) {
        case 'grain_size': {
          inst.grainSize.manualControl.offset.value = value;
          break;
        }
        case 'voice_1_samples_between_grains': {
          inst.voice1SamplesBetweenGrains.manualControl.offset.value = value;
          break;
        }
        case 'voice_2_samples_between_grains': {
          inst.voice2SamplesBetweenGrains.manualControl.offset.value = value;
          break;
        }
        case 'sample_speed_ratio': {
          inst.sampleSpeedRatio.manualControl.offset.value = value;
          break;
        }
        case 'voice_1_filter_cutoff': {
          inst.voice1FilterCutoff.manualControl.offset.value = value;
          break;
        }
        case 'voice_2_filter_cutoff': {
          inst.voice2FilterCutoff.manualControl.offset.value = value;
          break;
        }
        case 'linear_slope_length': {
          inst.linearSlopeLength.manualControl.offset.value = value;
          break;
        }
        case 'slope_linearity': {
          inst.slopeLinearity.manualControl.offset.value = value;
          break;
        }
        case 'voice_1_movement_samples_per_sample': {
          inst.voice1MovementSamplesPerSample.manualControl.offset.value = value;
          break;
        }
        case 'voice_2_movement_samples_per_sample': {
          inst.voice2MovementSamplesPerSample.manualControl.offset.value = value;
          break;
        }
        default: {
          console.error(`Unhandled key in granular synth control panel: "${key}"`);
        }
      }
    },
    [vcId]
  );

  useEffect(() => {
    Object.entries(initialState).forEach(([key, val]) => onChange(key, val));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  const settings = useMemo(
    () => [
      {
        label: 'grain_size',
        type: 'range',
        min: 0.1,
        max: 44100,
        scale: 'log',
        initial: initialState.grain_size,
      },
      {
        label: 'voice_1_samples_between_grains',
        type: 'range',
        min: 1,
        max: 20_000,
        scale: 'log',
        initial: initialState.voice_1_samples_between_grains,
      },
      {
        label: 'voice_2_samples_between_grains',
        type: 'range',
        min: 1,
        max: 20_000,
        scale: 'log',
        initial: initialState.voice_2_samples_between_grains,
      },
      {
        label: 'sample_speed_ratio',
        type: 'range',
        min: 0.1,
        max: 10,
        step: 0.1,
        initial: initialState.sample_speed_ratio,
      },
      {
        label: 'voice_1_filter_cutoff',
        type: 'range',
        min: -4000,
        max: 4000,
        initial: initialState.voice_1_filter_cutoff,
        step: 10,
      },
      {
        label: 'voice_2_filter_cutoff',
        type: 'range',
        min: -4000,
        max: 4000,
        initial: initialState.voice_2_filter_cutoff,
        step: 10,
      },
      {
        label: 'linear_slope_length',
        type: 'range',
        min: 0,
        max: 1,
        initial: initialState.linear_slope_length,
        step: 0.01,
      },
      {
        label: 'slope_linearity',
        type: 'range',
        min: 0,
        max: 1,
        initial: initialState.slope_linearity,
        step: 0.01,
      },
      {
        label: 'voice_1_movement_samples_per_sample',
        type: 'range',
        min: 0.0,
        max: 4,
        initial: initialState.voice_1_movement_samples_per_sample,
      },
      {
        label: 'voice_2_movement_samples_per_sample',
        type: 'range',
        min: 0.0,
        max: 4,
        initial: initialState.voice_2_movement_samples_per_sample,
      },
    ],
    [
      initialState.grain_size,
      initialState.linear_slope_length,
      initialState.sample_speed_ratio,
      initialState.slope_linearity,
      initialState.voice_1_filter_cutoff,
      initialState.voice_1_movement_samples_per_sample,
      initialState.voice_1_samples_between_grains,
      initialState.voice_2_filter_cutoff,
      initialState.voice_2_movement_samples_per_sample,
      initialState.voice_2_samples_between_grains,
    ]
  );

  return (
    <ControlPanel style={GRANULATOR_CONTROL_PANEL_STYLE} settings={settings} onChange={onChange} />
  );
};

export const ActiveSamplesByVcId: Map<string, SampleDescriptor[]> = new Map();

const msToSamples = (ms: number | null, sampleRate: number): number | null => {
  if (ms === null) {
    return null;
  }

  return (ms / 1000) * sampleRate;
};

const GranulatorUI: React.FC<{
  vcId: string;
  initialState: GranulatorControlPanelState;
  selectedSample: SampleDescriptor | null;
}> = ({ vcId, initialState, selectedSample }) => {
  const [activeSample, setActiveSample] = useState<{
    descriptor: SampleDescriptor;
    sampleData: AudioBuffer;
  } | null>(null);
  const awpNode = useRef<AudioWorkletNode | null>(null);
  useEffect(() => {
    (async () => {
      function* retries() {
        let attempts = 0;
        while (attempts < 500) {
          yield attempts;
          attempts += 1;
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
      for (const _i of retries()) {
        const inst = GranulatorInstancesById.get(vcId);
        if (!inst) {
          await delay(20);
          continue;
        }
        awpNode.current = inst.node;

        inst.node.port.postMessage({
          type: 'setSamples',
          samples: activeSample?.sampleData.getChannelData(0),
        });
        return;
      }

      console.error('Failed to initialize Granulator instance');
    })();
  }, [activeSample, vcId]);

  const waveformRenderer = useRef(new WaveformRenderer(activeSample?.sampleData));
  useEffect(() => {
    if (activeSample) {
      waveformRenderer.current.setSample(activeSample?.sampleData);
    }
  }, [activeSample]);

  // Load the previously selected sample, if one was provided
  useEffect(() => {
    if (!selectedSample) {
      return;
    }

    (async () => {
      const sampleData = await getSample(selectedSample);
      setActiveSample({ descriptor: selectedSample, sampleData });
    })();
  }, [selectedSample]);

  useEffect(() => {
    if (!activeSample?.descriptor) {
      return;
    }

    ActiveSamplesByVcId.set(vcId, [activeSample.descriptor]);
  }, [activeSample?.descriptor, vcId]);

  useEffect(() => {
    const granulatorInst = GranulatorInstancesById.get(vcId);
    if (!granulatorInst) {
      return;
    }

    const startMarkPosSamples = granulatorInst.startSample.manualControl.offset.value;
    const endMarkPosSamples = granulatorInst.endSample.manualControl.offset.value;
    waveformRenderer.current.setSelection({
      startMarkPosMs:
        startMarkPosSamples < 0
          ? null
          : (startMarkPosSamples / (activeSample?.sampleData.sampleRate ?? 44100)) * 1000,
      endMarkPosMs:
        endMarkPosSamples < 0
          ? null
          : (endMarkPosSamples / (activeSample?.sampleData.sampleRate ?? 44100)) * 1000,
    });
  }, [activeSample?.sampleData.sampleRate, vcId]);

  useEffect(() => {
    const waveformRendererInst = waveformRenderer.current;
    const cb = (newSelection: { startMarkPosMs: number | null; endMarkPosMs: number | null }) => {
      const inst = GranulatorInstancesById.get(vcId);
      if (!inst) {
        return;
      }
      inst.startSample.manualControl.offset.value =
        msToSamples(newSelection.startMarkPosMs, waveformRenderer.current.getSampleRate()) ?? -1;
      inst.endSample.manualControl.offset.value =
        msToSamples(newSelection.endMarkPosMs, waveformRenderer.current.getSampleRate()) ?? -1;
    };
    waveformRendererInst.addEventListener('selectionChange', cb);
    return () => waveformRendererInst.removeEventListener('selectionChange', cb);
  }, [vcId]);

  return (
    <div className='granulator'>
      <div style={{ display: 'flex', flexDirection: 'row' }}>
        <div>
          Selected sample: <b>{activeSample?.descriptor.name ?? 'None'}</b>
        </div>
        <button
          style={{ marginLeft: 20 }}
          onClick={async () => {
            const descriptor = await selectSample();
            const inst = GranulatorInstancesById.get(vcId);
            if (inst) {
              inst.selectedSample = descriptor;
            }
            const sampleData = await getSample(descriptor);
            setActiveSample({ descriptor, sampleData });
          }}
        >
          Select Sample
        </button>
      </div>

      <GranularControlPanel initialState={initialState} vcId={vcId} />

      {activeSample ? <SampleEditor waveformRenderer={waveformRenderer.current} /> : null}

      <hr />
      <SampleRecorder vcId={vcId} awpNode={awpNode} />
    </div>
  );
};

export default GranulatorUI;
