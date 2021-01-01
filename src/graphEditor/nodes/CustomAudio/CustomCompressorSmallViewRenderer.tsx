import React, { useState } from 'react';
import ControlPanel from 'react-control-panel';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';

interface DynamicsCompressorUIState {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
}

const deriveInitialState = (node: ForeignNode<DynamicsCompressorNode>) => ({
  threshold: node.paramOverrides.threshold.override.offset.value,
  knee: node.paramOverrides.knee.override.offset.value,
  ratio: node.paramOverrides.ratio.override.offset.value,
  attack: node.paramOverrides.attack.override.offset.value,
  release: node.paramOverrides.release.override.offset.value,
});

const SETTINGS = [
  { type: 'range', label: 'threshold', min: -100, max: 0 },
  { type: 'range', label: 'knee', min: 0, max: 40 },
  { type: 'range', label: 'ratio', min: 1, max: 20 },
  { type: 'range', label: 'attack', min: 0, max: 1 },
  { type: 'range', label: 'release', min: 0, max: 1 },
];

const CustomCompressorSmallViewRenderer: React.FC<{
  node: ForeignNode<DynamicsCompressorNode>;
}> = ({ node }) => {
  const [state, setState] = useState<DynamicsCompressorUIState>(deriveInitialState(node));

  return (
    <ControlPanel
      style={{ width: 500 }}
      state={state}
      settings={SETTINGS}
      onChange={(key: string, val: any) => {
        node.paramOverrides[key].override.offset.value = val;
        setState({ ...state, [key]: val });
      }}
    />
  );
};

export default CustomCompressorSmallViewRenderer;
