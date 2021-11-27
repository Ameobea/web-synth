import React from 'react';

import type { ControlPanelCustomComponentProps } from '../types';
import EffectPicker from './EffectPicker';

/**
 * This is an `EffectPicker` wrapped in an API such that it can be used as a custom component for
 * `react-control-panel`.
 */
export const EffectPickerCustomInput: React.FC<ControlPanelCustomComponentProps<number>> = ({
  value,
  onChange,
}) => (
  <div style={{ marginBottom: 8, display: 'inline-block' }}>
    <EffectPicker value={value} onChange={onChange} />
  </div>
);
