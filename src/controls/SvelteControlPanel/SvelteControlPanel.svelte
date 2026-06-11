<script lang="ts" module>
  import type {
    ControlPanelSetting,
    ControlPanelTheme,
  } from 'src/controls/SvelteControlPanel/types';
  export type { ControlPanelSetting, ControlPanelTheme };

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

  import ReactShim from 'src/misc/ReactShim.svelte';

  const ControlPanelPromise = import('react-control-panel').then(m => m.default);

  interface Props {
    settings: ControlPanelSetting[];
    state?: Record<string, any> | undefined;
    onChange?:
      | ((key: string, value: any, newState: Record<string, any>) => void)
      | undefined;
    style?: CSSProperties | undefined;
    theme?: Partial<ControlPanelTheme> | undefined;
    width?: number | undefined;
    title?: string | undefined;
  }

  let {
    settings,
    state = undefined,
    onChange = undefined,
    style = undefined,
    theme = undefined,
    width = undefined,
    title = undefined
  }: Props = $props();
</script>

{#await ControlPanelPromise then ControlPanel}
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
{/await}
