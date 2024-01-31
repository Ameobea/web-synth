import * as R from 'ramda';
import React, { useCallback, useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';

import type { SerializedBandSplitterNode } from 'src/graphEditor/nodes/CustomAudio/BandSplitter/BandSplitterNode';

export interface BandSplitterSmallViewProps {
  initialState: SerializedBandSplitterNode;
  onChange: (newState: SerializedBandSplitterNode) => void;
}

const BAND_SPLITTER_SETTINGS = ['low', 'mid', 'high'].map(bandName => ({
  type: 'range',
  label: `${bandName} band gain`,
  min: 0,
  max: 2,
  step: 0.01,
}));

const BandSplitterSmallView: React.FC<BandSplitterSmallViewProps> = ({
  initialState,
  onChange,
}) => {
  const [state, setState] = useState(initialState);

  const controlPanelState = useMemo(
    () => ({
      'low band gain': Math.round(state.gains[0] * 1000) / 1000,
      'mid band gain': Math.round(state.gains[1] * 1000) / 1000,
      'high band gain': Math.round(state.gains[2] * 1000) / 1000,
    }),
    [state]
  );

  const handleChange = useCallback(
    (key: string, val: any) => {
      const gainIx = (
        {
          'low band gain': 0,
          'mid band gain': 1,
          'high band gain': 2,
        } as Record<string, number>
      )[key];

      if (!R.isNil(gainIx)) {
        setState(state => {
          const newState: SerializedBandSplitterNode = {
            ...state,
            gains: R.set(R.lensIndex(gainIx), val, state.gains) as [number, number, number],
          };
          onChange(newState);
          return newState;
        });
        return;
      }

      console.error('unknown key in `BandSplitterSmallView`: ', key);
    },
    [onChange]
  );

  return (
    <div className='band-splitter-small-view'>
      <ControlPanel
        width={500}
        settings={BAND_SPLITTER_SETTINGS}
        state={controlPanelState}
        onChange={handleChange}
      />
      <p style={{ paddingLeft: 8, paddingRight: 8 }}>
        This node splits the incoming signal into 3 output bands. The splits are hard-coded at
        0-400hz, 400-3000hz, and 3000-∞hz. This is useful for effects such as multi-band compression
        or multi-band distortion.
      </p>
    </div>
  );
};

export default BandSplitterSmallView;
