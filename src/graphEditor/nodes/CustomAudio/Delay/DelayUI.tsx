import React, { useCallback, useMemo } from 'react';
import ControlPanel from 'react-control-panel';

const buildDelaySettings = (initialParams: {
  delayMs: number;
  delayGain: number;
  feedback: number;
}) => [
  {
    type: 'range',
    label: 'delay ms',
    min: 1,
    max: 60 * 1000,
    scale: 'log',
    initial: initialParams.delayMs,
  },
  { type: 'range', label: 'delay gain', min: 0, max: 1, initial: initialParams.delayGain },
  { type: 'range', label: 'feedback', min: 0, max: 1, initial: initialParams.feedback },
];

interface DelaySmallViewProps {
  getInitialParams: () => {
    delayMs: number;
    delayGain: number;
    feedback: number;
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
