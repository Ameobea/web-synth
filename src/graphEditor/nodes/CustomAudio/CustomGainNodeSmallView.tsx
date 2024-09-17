import React, { useCallback, useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';

interface CustomGainNodeSmallViewProps {
  node: ForeignNode<BiquadFilterNode>;
}

const CustomGainNodeSmallView: React.FC<CustomGainNodeSmallViewProps> = ({ node }) => (
  <ControlPanel
    settings={useMemo(
      () => [
        {
          type: 'range',
          label: 'gain',
          min: -1,
          max: 5,
          initial: node.paramOverrides.gain.override.offset.value,
        },
      ],
      [node.paramOverrides.gain.override.offset.value]
    )}
    onChange={useCallback(
      (_key: string, val: number) => {
        node.paramOverrides.gain.override.offset.value = val;
      },
      [node.paramOverrides.gain.override.offset]
    )}
    style={{ width: 500 }}
  />
);

export default CustomGainNodeSmallView;
