import React, { useState } from 'react';
import SampleEditor from 'src/granulator/GranulatorUI/SampleEditor';

import { getSample, SampleDescriptor } from 'src/sampleLibrary';
import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';
import './Granulator.scss';

const GranulatorUI: React.FC<{ vcId: string }> = ({ vcId }) => {
  const [activeSample, setActiveSample] = useState<{
    descriptor: SampleDescriptor;
    sampleData: AudioBuffer;
  } | null>(null);

  return (
    <div className='granulator'>
      <div style={{ display: 'flex', flexDirection: 'row' }}>
        <div>
          Selected sample: <b>{activeSample?.descriptor.name ?? 'None'}</b>
        </div>
        <button
          onClick={async () => {
            const descriptor = await selectSample();
            const sampleData = await getSample(descriptor);
            setActiveSample({ descriptor, sampleData });
          }}
        >
          Select Sample
        </button>
      </div>

      {activeSample ? <SampleEditor sample={activeSample.sampleData} /> : null}
    </div>
  );
};

export default GranulatorUI;
