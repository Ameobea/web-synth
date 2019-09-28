import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import { FilterType, FilterParams } from 'src/redux/modules/synthDesigner';

const settings = {
  frequency: { type: 'range', label: 'frequency', min: 10, max: 80000, initial: 4400, stepSize: 5 },
};

const getSettingsForFilterType = (filterType: FilterType) =>
  ({
    [FilterType.Lowpass]: [settings.frequency],
    [FilterType.Highpass]: [settings.frequency],
    [FilterType.Bandpass]: [settings.frequency],
    [FilterType.Lowshelf]: [settings.frequency],
    [FilterType.Highshelf]: [settings.frequency],
    [FilterType.Peaking]: [settings.frequency],
    [FilterType.Notch]: [settings.frequency],
    [FilterType.Allpass]: [settings.frequency],
  }[filterType]);

const Filter: React.FC<{ node: BiquadFilterNode; params: FilterParams }> = ({ node, params }) => {
  const settings = useMemo(() => getSettingsForFilterType(params.type), [params.type]);

  return (
    <div className='filter-module'>
      <ControlPanel
        title='FILTER'
        settings={settings}
        state={params}
        onChange={(key: string, val: any) => {
          switch (key) {
            default: {
              // TODO
            }
          }
        }}
      />
    </div>
  );
};

export default Filter;
