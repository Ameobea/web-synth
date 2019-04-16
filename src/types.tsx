import React from 'react';

export interface ControlPanelCustomComponentProps<T> {
  value: T;
  onChange: (newVal: T) => void;
  theme: { [key: string]: React.CSSProperties };
}

// Taken from: https://stackoverflow.com/a/50918777/3833068
export type Without<T, K> = Pick<T, Exclude<keyof T, K>>;
