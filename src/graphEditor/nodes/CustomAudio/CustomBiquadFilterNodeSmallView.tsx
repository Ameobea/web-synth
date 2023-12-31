import React, { useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { FilterType } from 'src/synthDesigner/FilterType';
import { getSettingsForFilterType } from 'src/synthDesigner/filterHelpers';

interface CustomBiquadFilterNodeSmallViewProps {
  node: ForeignNode<BiquadFilterNode>;
}

const CustomBiquadFilterNodeSmallView: React.FC<CustomBiquadFilterNodeSmallViewProps> = ({
  node,
}) => {
  const [renderIx, setRenderIx] = useState(0);
  const params = {
    ...node.serialize(),
    type: (node.node?.type as FilterType) || FilterType.Lowpass,
  };

  const settings = useMemo(
    () =>
      getSettingsForFilterType({ filterType: params.type, includeADSR: false }).map(setting => ({
        ...setting,
        initial: undefined,
      })),
    [params.type]
  );

  return (
    <ControlPanel
      style={{ width: 500 }}
      title='BIQUAD FILTER'
      settings={settings}
      state={params}
      onChange={(key: string, val: any) => {
        if (key === 'type') {
          node.node!.type = val;
        } else {
          node.paramOverrides[key].override.offset.value = val;
        }

        // Force re-render.  This component needs to be stateless (can't even have hooks state)
        // due to the way small view rendering works.
        setRenderIx(renderIx + 1);
      }}
    />
  );
};

export default CustomBiquadFilterNodeSmallView;
