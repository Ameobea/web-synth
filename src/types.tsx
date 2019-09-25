import React from 'react';

export interface ControlPanelCustomComponentProps<T> {
  value: T;
  onChange: (newVal: T) => void;
  theme: { [key: string]: React.CSSProperties };
}
