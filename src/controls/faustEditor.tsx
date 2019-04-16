import React from 'react';

import { ControlPanelCustomComponentProps } from '../types';
import EffectPicker from './EffectPicker';

/**
 * This is an `EffectPicker` wrapped in an API such that it can be used as a custom component for
 * `react-control-panel`.
 */
export const EffectPickerCustomInput: React.FunctionComponent<
  ControlPanelCustomComponentProps<number>
> = ({ value, onChange, theme }) => (
  <div style={{ marginBottom: 8, display: 'inline-block' }}>
    <EffectPicker value={value} onChange={onChange} />
  </div>
);
