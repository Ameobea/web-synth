import React, { useEffect, useState } from 'react';
import { GranulatorInstancesById } from 'src/granulator/granulator';
import SampleEditor from 'src/granulator/GranulatorUI/SampleEditor';

import { getSample, SampleDescriptor } from 'src/sampleLibrary';
import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';
import { delay } from 'src/util';
import './Granulator.scss';

const GranulatorUI: React.FC<{ vcId: string }> = ({ vcId }) => {
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

      {activeSample ? <SampleEditor sample={activeSample.sampleData} vcId={vcId} /> : null}
    </div>
  );
};

export default GranulatorUI;
