import React, { useEffect, useState } from 'react';
import ControlPanel from 'react-control-panel';

import { GranulatorInstancesById } from 'src/granulator/granulator';
import SampleEditor from 'src/granulator/GranulatorUI/SampleEditor';
import { getSample, SampleDescriptor } from 'src/sampleLibrary';
import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';
import { delay } from 'src/util';
import './Granulator.scss';

export interface GranulatorControlPanelState {
  grain_size: number;
  grain_speed_ratio: number;
  sample_speed_ratio: number;
}

const GranularControlPanel: React.FC<{
  vcId: string;
  initialState: GranulatorControlPanelState;
}> = ({ vcId, initialState }) => (
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
        label: 'grain_speed_ratio',
        type: 'range',
        min: 0.01,
        max: 20,
        scale: 'log',
        initial: initialState.grain_speed_ratio,
      },
      {
        label: 'sample_speed_ratio',
        type: 'range',
        min: 0.01,
        max: 20,
        scale: 'log',
        initial: initialState.sample_speed_ratio,
      },
    ]}
    onChange={(key: string, value: any, _state: any) => {
      const inst = GranulatorInstancesById.get(vcId);
      if (!inst) {
        return;
      }

      switch (key) {
        case 'grain_size': {
          inst.grainSize.manualControl.offset.value = value;
          break;
        }
        case 'grain_speed_ratio': {
          inst.grainSpeedRatio.manualControl.offset.value = value;
          break;
        }
        case 'sample_speed_ratio': {
          inst.sampleSpeedRatio.manualControl.offset.value = value;
          break;
        }
        default: {
          console.error('Unhandled key in granular synth control panel: ', key);
        }
      }
    }}
  />
);

const GranulatorUI: React.FC<{
  vcId: string;
  initialState: GranulatorControlPanelState;
}> = ({ vcId, initialState }) => {
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

  // Debug
  useEffect(() => {
    (async () => {
      const descriptor: SampleDescriptor = { name: 'cold - crash.wav', isLocal: true };
      const sampleData = await getSample(descriptor);
      setActiveSample({ descriptor, sampleData });
    })();
  }, []);

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
            const sampleData = await getSample(descriptor);
            setActiveSample({ descriptor, sampleData });
          }}
        >
          Select Sample
        </button>
      </div>

      <GranularControlPanel initialState={initialState} vcId={vcId} />

      {activeSample ? <SampleEditor sample={activeSample.sampleData} vcId={vcId} /> : null}
    </div>
  );
};

export default GranulatorUI;
