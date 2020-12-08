import React, { useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { FilterParams } from 'src/redux/modules/synthDesigner';
import { FilterType, getSettingsForFilterType } from 'src/synthDesigner/filterHelpers';

const CustomBiquadFilterNodeSmallView: React.FC<{
  node: ForeignNode<BiquadFilterNode>;
}> = ({ node }) => {
  const [params, setParams] = useState<FilterParams>({
    ...node.serialize(),
    type: node.node?.type || FilterType.Lowpass,
  } as FilterParams);

  const settings = useMemo(
    () =>
      getSettingsForFilterType(params.type, false).map(setting => ({
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

        setParams({ ...params, [key]: val });
      }}
    />
  );
};

export default CustomBiquadFilterNodeSmallView;
