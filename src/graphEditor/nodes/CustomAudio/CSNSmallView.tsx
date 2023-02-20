import React, { useState } from 'react';
import ControlPanel from 'react-control-panel';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';

interface CSNSmallViewProps {
  node: ForeignNode<ConstantSourceNode>;
}

export const CSNSmallView: React.FC<CSNSmallViewProps> = ({ node }) => {
  const [isInvalid, setIsInvalid] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {isInvalid ? "Invalid input; can't parse as number" : null}
      <ControlPanel
        settings={[
          {
            label: 'offset',
            type: 'text',
            initial: node.paramOverrides.offset.override.offset.value.toString(),
          },
        ]}
        onChange={(_key: string, val: string) => {
          const parsed = +val;
          if (Number.isNaN(parsed)) {
            setIsInvalid(true);
            return;
          } else if (isInvalid) {
            setIsInvalid(false);
          }

          node.paramOverrides.offset.override.offset.value = parsed;
        }}
      />
    </div>
  );
};
