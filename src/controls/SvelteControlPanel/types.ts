import type React from 'react';

export type ControlPanelSetting =
  | {
      type: 'range';
      label: string;
      min: number;
      max: number;
      step?: number;
      steps?: number;
      scale?: 'log';
      initial?: number;
    }
  | {
      type: 'interval';
      label: string;
      min: number;
      max: number;
      step?: number;
      initial?: [number, number];
    }
  | {
      type: 'select';
      label: string;
      options: string[] | Record<string, any>;
      initial?: string | number;
    }
  | { type: 'button'; label: string; action: () => void; disabled?: boolean }
  | { type: 'checkbox'; label: string; initial?: boolean }
  | { type: 'text'; label: string; initial?: string }
  | { type: 'custom'; label: string; Comp: React.FC<any>; initial?: any };

export interface ControlPanelTheme {
  background1: string;
  background2: string;
  background2hover: string;
  foreground1: string;
  text1: string;
  text2: string;
}
