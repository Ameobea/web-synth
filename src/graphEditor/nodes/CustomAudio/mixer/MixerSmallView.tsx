import { filterNils } from 'ameo-utils';
import React, { useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';

import type { MixerNode } from 'src/graphEditor/nodes/CustomAudio/mixer/mixer';

interface MixerSmallViewProps {
  mixer: MixerNode;
}

const buildSettings = (
  mixer: MixerNode,
  inputCount: number,
  setInputCount: (newInputCount: number) => void
) =>
  filterNils([
    {
      type: 'button',
      label: 'add input',
      action: () => {
        mixer.addInput();
        setInputCount(inputCount + 1);
      },
    },
    inputCount > 2
      ? {
          type: 'button',
          label: 'remove input',
          action: () => {
            mixer.removeInput();
            setInputCount(inputCount - 1);
          },
        }
      : null,
    ...mixer.gainParams.map((param, i) => ({
      type: 'range',
      label: `input_${i}_gain`,
      min: -1,
      max: 1,
      initial: param.manualControl.offset.value,
    })),
  ]);

const MixerSmallView: React.FC<MixerSmallViewProps> = ({ mixer }) => {
  const [inputCount, setInputCount] = useState(mixer.gainParams.length);
  const settings = useMemo(() => buildSettings(mixer, inputCount, setInputCount), [
    mixer,
    inputCount,
  ]);

  return (
    <ControlPanel
      settings={settings}
      style={{ width: 500 }}
      onChange={(key: string, val: number) => {
        const inputIx = +key.split('_')[1];
        console.log(inputIx);
        mixer.gainParams[inputIx].manualControl.offset.value = val;
      }}
    />
  );
};

export default MixerSmallView;
