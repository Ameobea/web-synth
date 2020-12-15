import { UnreachableException } from 'ameo-utils';
import React, { useEffect, useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { Option } from 'funfix-core';

import { GranulatorInstancesById } from 'src/granulator/granulator';
import SampleEditor from 'src/granulator/GranulatorUI/SampleEditor';
import { getSample, SampleDescriptor } from 'src/sampleLibrary';
import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';
import { delay, retryWithDelay } from 'src/util';
import './Granulator.scss';

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

  return (
    <ControlPanel
      style={{ marginTop: 20, width: 800 }}
      settings={[
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
          min: 0.01,
          max: 10,
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
      ]}
      onChange={onChange}
    />
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
  useEffect(() => {
    if (!activeSample) {
      return;
    }

    (async () => {
      function* retries() {
        let attempts = 0;
        while (attempts < 500) {
          yield attempts;
          attempts += 1;
        }
      }

      for (const _i of retries()) {
        const inst = GranulatorInstancesById.get(vcId);
        if (!inst) {
          await delay(20);
          continue;
        }

        inst.node.port.postMessage({
          type: 'setSamples',
          samples: activeSample.sampleData.getChannelData(0),
        });
        return;
      }

      console.error('Failed to initialize Granulator instance');
    })();
  }, [activeSample, vcId]);

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

  const [{ startMarkPosMs, endMarkPosMs }, setMarkPositions] = useState<{
    startMarkPosMs: number | null;
    endMarkPosMs: number | null;
  }>({
    startMarkPosMs: Option.of(
      GranulatorInstancesById.get(vcId)?.startSample.manualControl.offset.value
    )
      .map(
        initialStartMarkPosSamples =>
          (initialStartMarkPosSamples / (activeSample?.sampleData.sampleRate ?? 44100)) * 1000
      )
      .orNull(),
    endMarkPosMs: Option.of(GranulatorInstancesById.get(vcId)?.endSample.manualControl.offset.value)
      .map(
        initialEndMarkPosSamples =>
          (initialEndMarkPosSamples / (activeSample?.sampleData.sampleRate ?? 44100)) * 1000
      )
      .orNull(),
  });

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

      {activeSample ? (
        <SampleEditor
          sample={activeSample.sampleData}
          startMarkPosMs={startMarkPosMs}
          endMarkPosMs={endMarkPosMs}
          onMarkPositionsChanged={({ startMarkPosMs, endMarkPosMs }) => {
            setMarkPositions({ startMarkPosMs, endMarkPosMs });

            const inst = GranulatorInstancesById.get(vcId);
            if (!inst) {
              return;
            }

            if (startMarkPosMs !== null) {
              inst.startSample.manualControl.offset.value = msToSamples(
                startMarkPosMs,
                activeSample.sampleData.sampleRate
              )!;
            }
            if (endMarkPosMs !== null) {
              inst.endSample.manualControl.offset.value = msToSamples(
                endMarkPosMs,
                activeSample.sampleData.sampleRate
              )!;
            }
          }}
        />
      ) : null}
    </div>
  );
};

export default GranulatorUI;
