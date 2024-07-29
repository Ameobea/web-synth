import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import './DistortionUI.css';

const DistortionUI: React.FC<{ onChange: (newValue: number) => void }> = ({ onChange }) => {
  const settings = useMemo(
    () => [{ type: 'range', label: 'stretch factor', min: 0, max: 1, initial: 0.5 }],
    []
  );

  return (
    <div className='distortion-ui'>
      <div style={{ color: 'red', marginBottom: 10, padding: 4 }}>
        NOTE: This node is incomplete and doesn&apos;t work very well. Recommend that you either use
        the clipper included in the synth designer&apos;s effects or use the code editor to load a
        distortion preset.
      </div>

      <ControlPanel
        style={{ width: 500 }}
        settings={settings}
        onChange={(key: string, val: any) => {
          switch (key) {
            case 'stretch factor': {
              onChange(val);
              break;
            }
            default: {
              console.error('Unhandled key in distortion UI: ', key);
            }
          }
        }}
      />
    </div>
  );
};

export default DistortionUI;
