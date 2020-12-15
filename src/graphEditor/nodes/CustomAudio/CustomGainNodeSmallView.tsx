import React from 'react';
import ControlPanel from 'react-control-panel';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';

const CustomGainNodeSmallView: React.FC<{ node: ForeignNode<BiquadFilterNode> }> = ({ node }) => (
  <ControlPanel
    settings={[
      {
        type: 'range',
        label: 'gain',
        min: -1,
        max: 5,
        initial: node.paramOverrides.gain.override.offset.value,
      },
    ]}
    onChange={(_key: string, val: number) => {
      node.paramOverrides.gain.override.offset.value = val;
    }}
    style={{ width: 500 }}
  />
);

export default CustomGainNodeSmallView;
