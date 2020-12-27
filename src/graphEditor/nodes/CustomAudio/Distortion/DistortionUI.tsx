import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import './DistortionUI.scss';

const DistortionUI: React.FC<{ onChange: (newValue: number) => void }> = ({ onChange }) => {
  const settings = useMemo(
    () => [{ type: 'range', label: 'stretch factor', min: 0, max: 1, initial: 0.5 }],
    []
  );

  return (
    <div className='distortion-ui'>
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
