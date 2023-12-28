<script context="module" lang="ts">
  import {
    QuantizeMode,
    tryParseCustomQuantizationIntervalValue,
  } from 'src/graphEditor/nodes/CustomAudio/Quantizer/types';

  const PRESET_INTERVALS: { name: string; interval: number }[] = [
    { name: '1', interval: 1 },
    { name: '1/2 | 0.5', interval: 0.5 },
    { name: '2/5 | 0.4', interval: 2 / 5 },
    { name: '1/3 | 0.3333333', interval: 1 / 3 },
    { name: '1/4 | 0.25', interval: 1 / 4 },
    { name: '1/5 | 0.2', interval: 1 / 5 },
    { name: '1/6 | 0.1666667', interval: 1 / 6 },
    { name: '1/8 | 0.125', interval: 1 / 8 },
    { name: '1/10 | 0.1', interval: 1 / 10 },
    { name: '1/16 | 0.0625', interval: 1 / 16 },
  ];
  const QUANTIZE_MODES: { mode: QuantizeMode; name: string }[] = [
    { mode: QuantizeMode.Round, name: 'Round' },
    { mode: QuantizeMode.Floor, name: 'Floor' },
    { mode: QuantizeMode.Ceil, name: 'Ceil' },
    { mode: QuantizeMode.Trunc, name: 'Trunc' },
  ];
</script>

<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { QuantizerNodeUIState } from 'src/graphEditor/nodes/CustomAudio/Quantizer/types';

  export let store: Writable<QuantizerNodeUIState>;

  const uniqueID = genRandomStringID();
  let parseErrorMessage: string | null;

  const handleQuantizationIntervalTypeChange = (evt: { currentTarget: HTMLSelectElement }) => {
    const newInterval = evt.currentTarget.value;
    if (newInterval === 'custom') {
      const parsed = tryParseCustomQuantizationIntervalValue($store.customValueEntry);
      parseErrorMessage = parsed.type === 'error' ? parsed.message : null;
      $store.quantizationInterval = {
        type: 'custom',
        value: parsed.type === 'error' ? 0 : parsed.value,
      };
    } else {
      $store.quantizationInterval = {
        type: 'preset',
        value: +newInterval,
      };
    }
  };

  const commitCustomIntervalValue = () => {
    const parsed = tryParseCustomQuantizationIntervalValue($store.customValueEntry);
    parseErrorMessage = parsed.type === 'error' ? parsed.message : null;
    if (parsed.type === 'success') {
      $store.quantizationInterval = { type: 'custom', value: parsed.value };
    }
  };
</script>

<div class="root">
  <h2>Quantizer</h2>
  <p class="info">This node quantizes input signals, rounding to a configurable degree.</p>
  <hr />

  <div class="select-wrapper">
    <label for={`${uniqueID}-quantization-mode-select`}>Mode</label>
    <select id={`${uniqueID}-quantization-mode-select`} bind:value={$store.mode}>
      {#each QUANTIZE_MODES as { mode, name }}
        <option value={mode}>{name}</option>
      {/each}
    </select>
  </div>
  <div class="quantization-interval-wrapper">
    <div class="select-wrapper">
      <label for={`${uniqueID}-quantization-interval-select`}>Quantization Interval</label>
      <select
        id={`${uniqueID}-quantization-interval-select`}
        value={$store.quantizationInterval.type === 'custom'
          ? 'custom'
          : $store.quantizationInterval.value}
        on:change={handleQuantizationIntervalTypeChange}
      >
        <option value="custom">Custom</option>
        {#each PRESET_INTERVALS as { name, interval }}
          <option value={interval}>{name}</option>
        {/each}
      </select>
    </div>

    {#if $store.quantizationInterval.type === 'custom'}
      <div class="custom-quantization-interval">
        <div class="custom-interval-display">{$store.quantizationInterval.value}</div>
        <input
          type="text"
          bind:value={$store.customValueEntry}
          on:keypress={evt => {
            if (evt.key === 'Enter') {
              commitCustomIntervalValue();
            }
          }}
        />
        <button on:click={commitCustomIntervalValue}>Submit</button>
      </div>
      {#if parseErrorMessage}
        <p class="parse-error-message">{parseErrorMessage}</p>
      {/if}
      <p class="info" style="font-size: 14.5px">
        Intervals can be provided either as a plain number like <code>0.4</code> or as a fraction of
        two numbers like <code>1/25</code>.
      </p>
    {/if}
  </div>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    padding: 8px;
  }

  h2 {
    text-align: center;
    margin-top: 2px;
    margin-bottom: 6px;
  }

  .quantization-interval-wrapper {
    display: flex;
    flex-direction: column;
    background-color: #121212;
  }

  .select-wrapper {
    display: flex;
    flex-direction: row;
    margin-bottom: 6px;
  }

  .select-wrapper label {
    display: flex;
    flex-basis: 150px;
  }

  .select-wrapper select {
    margin-left: 12px;
    display: flex;
    flex: 1;
  }

  .parse-error-message {
    color: red;
    margin-bottom: 2px;
    font-size: 14.5px;
  }

  .custom-quantization-interval {
    display: flex;
    flex-direction: row;
    margin-top: 8px;
  }

  .custom-quantization-interval .custom-interval-display {
    border: 1px solid #888;
    padding: 2px 4px;
    margin-right: 8px;
    font-size: 15px;
    font-weight: bold;
    flex-basis: 80px;
    text-align: center;
  }

  .custom-quantization-interval input[type='text'] {
    margin-right: 8px;
  }

  select {
    width: 200px;
  }

  hr {
    margin-top: 0px;
    margin-bottom: 16px;
  }

  p {
    margin-top: 6px;
    margin-bottom: 12px;
  }
</style>
