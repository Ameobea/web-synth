<script lang="ts" context="module">
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
        options: string[] | Record<any, any>;
        initial?: string | number;
      }
    | {
        type: 'interval';
        label: string;
        min: number;
        max: number;
        step?: number;
        initial?: [number, number];
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

  const BaseTheme: ControlPanelTheme = {
    background1: 'rgb(35,35,35)',
    background2: 'rgb(54,54,54)',
    background2hover: 'rgb(58,58,58)',
    foreground1: 'rgb(112,112,112)',
    text1: 'rgb(235,235,235)',
    text2: 'rgb(161,161,161)',
  };
</script>

<script lang="ts">
  import type { CSSProperties } from 'react';
  import React from 'react';
  import ControlPanel from 'react-control-panel';

  import ReactShim from 'src/misc/ReactShim.svelte';

  export let settings: ControlPanelSetting[];
  export let state: Record<string, any> | undefined = undefined;
  export let onChange:
    | ((key: string, value: any, newState: Record<string, any>) => void)
    | undefined = undefined;
  export let style: CSSProperties | undefined = undefined;
  export let theme: Partial<ControlPanelTheme> | undefined = undefined;
  export let width: number | undefined = undefined;
  export let title: string | undefined = undefined;
</script>

<ReactShim
  Component={ControlPanel}
  props={{
    settings,
    state,
    onChange,
    style,
    theme: theme ? { ...BaseTheme, ...theme } : undefined,
    width,
    title,
  }}
/>
