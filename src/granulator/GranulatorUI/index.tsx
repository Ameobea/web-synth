import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';

import './Granulator.css';

import { type GranulatorInstance, GranulatorInstancesById } from 'src/granulator/granulator';
import SampleEditor from 'src/granulator/GranulatorUI/SampleEditor';
import SampleRecorder from 'src/granulator/GranulatorUI/SampleRecorder';
import type { WaveformRenderer } from 'src/granulator/GranulatorUI/WaveformRenderer';
import { getSample, type SampleDescriptor } from 'src/sampleLibrary';
import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';
import { useMappedWritableValue } from 'src/reactUtils';

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

interface GranularControlPanelProps {
  initialState: GranulatorControlPanelState;
  inst: GranulatorInstance | null | undefined;
}

const GranularControlPanel: React.FC<GranularControlPanelProps> = ({ initialState, inst }) => {
  const onChange = useCallback(
    async (key: string, value: any) => {
      if (!inst) {
        return;
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
    [inst]
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
    [initialState]
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

export interface GranulatorUIProps {
  vcId: string;
  initialState: GranulatorControlPanelState;
  selectedSample: SampleDescriptor | null;
  waveformRenderer: WaveformRenderer;
}

interface ActiveSample {
  descriptor: SampleDescriptor;
  sampleData: AudioBuffer;
}

const GranulatorUI: React.FC<GranulatorUIProps> = ({
  vcId,
  initialState,
  selectedSample,
  waveformRenderer,
}) => {
  const [activeSample, setActiveSample] = useState<ActiveSample | null>(null);
  const inst = useMappedWritableValue(GranulatorInstancesById, map => map.get(vcId));
  useEffect(
    () =>
      void inst?.node.port.postMessage({
        type: 'setSamples',
        samples: activeSample?.sampleData.getChannelData(0),
      }),
    [inst, activeSample, vcId]
  );

  useEffect(() => {
    if (activeSample) {
      waveformRenderer.setSample(activeSample.sampleData);
    }
  }, [activeSample, waveformRenderer]);

  // Load the previously selected sample, if one was provided
  useEffect(() => {
    if (selectedSample) {
      getSample(selectedSample).then(sampleData =>
        setActiveSample({ descriptor: selectedSample, sampleData })
      );
    }
  }, [selectedSample]);

  useEffect(() => {
    if (activeSample?.descriptor) {
      ActiveSamplesByVcId.set(vcId, [activeSample.descriptor]);
    }
  }, [activeSample?.descriptor, vcId]);

  useEffect(() => {
    if (!inst) {
      return;
    }

    const startMarkPosSamples = inst.startSample.manualControl.offset.value;
    const endMarkPosSamples = inst.endSample.manualControl.offset.value;
    waveformRenderer.setSelection({
      startMarkPosMs:
        startMarkPosSamples < 0
          ? null
          : (startMarkPosSamples / (activeSample?.sampleData.sampleRate ?? 44100)) * 1000,
      endMarkPosMs:
        endMarkPosSamples < 0
          ? null
          : (endMarkPosSamples / (activeSample?.sampleData.sampleRate ?? 44100)) * 1000,
    });
  }, [activeSample?.sampleData.sampleRate, inst, vcId, waveformRenderer]);

  useEffect(() => {
    const waveformRendererInst = waveformRenderer;
    const cb = (newSelection: { startMarkPosMs: number | null; endMarkPosMs: number | null }) => {
      if (!inst) {
        return;
      }
      inst.startSample.manualControl.offset.value =
        msToSamples(newSelection.startMarkPosMs, waveformRenderer.getSampleRate()) ?? -1;
      inst.endSample.manualControl.offset.value =
        msToSamples(newSelection.endMarkPosMs, waveformRenderer.getSampleRate()) ?? -1;
    };
    waveformRendererInst.addEventListener('selectionChange', cb);
    return () => waveformRendererInst.removeEventListener('selectionChange', cb);
  }, [inst, waveformRenderer]);

  const [isLoadingSample, setIsLoadingSample] = useState(false);

  return (
    <div className='granulator'>
      <div style={{ display: 'flex', flexDirection: 'row' }}>
        <div>
          Selected sample: <b>{activeSample?.descriptor.name ?? 'None'}</b>
        </div>
        <button
          style={{ marginLeft: 20 }}
          disabled={isLoadingSample}
          onClick={async () => {
            if (isLoadingSample) {
              return;
            }
            setIsLoadingSample(true);

            try {
              const descriptor = await selectSample();
              if (inst) {
                inst.selectedSample = descriptor;
              }
              const sampleData = await getSample(descriptor);
              setActiveSample({ descriptor, sampleData });
            } finally {
              setIsLoadingSample(false);
            }
          }}
        >
          Select Sample
        </button>
      </div>

      <GranularControlPanel initialState={initialState} inst={inst} />

      {activeSample ? <SampleEditor waveformRenderer={waveformRenderer} /> : null}

      <hr />
      <SampleRecorder vcId={vcId} awpNode={inst?.node ?? null} />
    </div>
  );
};

export default GranulatorUI;
