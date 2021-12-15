import React, { useCallback, useMemo } from 'react';
import ControlPanel from 'react-control-panel';

const buildDelaySettings = (initialParams: {
  delayMs: number;
  delayGain: number;
  feedback: number;
  highpassCutoff: number;
}) => [
  {
    type: 'range',
    label: 'delay ms',
    min: 1,
    max: 60 * 1000,
    scale: 'log',
    initial: initialParams.delayMs,
    steps: 1000,
  },
  {
    type: 'range',
    label: 'delay gain',
    min: 0,
    max: 1,
    initial: initialParams.delayGain,
    steps: 1000,
  },
  {
    type: 'range',
    label: 'feedback',
    min: 0,
    max: 1,
    initial: initialParams.feedback,
    steps: 1000,
  },
  {
    type: 'range',
    label: 'highpass cutoff freq',
    min: 10,
    max: 18_000,
    initial: initialParams.highpassCutoff,
    scale: 'log',
  },
];

interface DelaySmallViewProps {
  getInitialParams: () => {
    delayMs: number;
    delayGain: number;
    feedback: number;
    highpassCutoff: number;
  };
  onChange: (key: 'delay ms' | 'delay gain' | 'feedback', value: number) => void;
}

export const DelaySmallView: React.FC<DelaySmallViewProps> = ({ getInitialParams, onChange }) => {
  const settings = useMemo(() => buildDelaySettings(getInitialParams()), [getInitialParams]);

  const handleChange = useCallback(
    (key: 'delay ms' | 'delay gain' | 'feedback', val: number) => onChange(key, val),
    [onChange]
  );

  return <ControlPanel width={500} settings={settings} onChange={handleChange} />;
};
