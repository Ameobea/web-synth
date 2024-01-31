<script lang="ts" context="module">
  import {
    MAX_MIXER_TRACK_COUNT,
    type MixerNode,
  } from 'src/graphEditor/nodes/CustomAudio/mixer/mixer';

  const MixerLevelDetectorAWPRegistered = new AsyncOnce(
    () =>
      new AudioContext().audioWorklet.addModule(
        process.env.ASSET_PATH +
          'MixerLevelDetectorAWP.js?cacheBust=' +
          (window.location.href.includes('localhost') ? '' : genRandomStringID())
      ),
    true
  );

  const buildSettings = (
    mixer: MixerNode,
    inputCount: number,
    addInput: () => void,
    removeInput: () => void
  ): ControlPanelSetting[] => {
    let spacerName = '';
    const spacer = (heightPx = 15): ControlPanelSetting => {
      const setting: ControlPanelSetting = {
        type: 'custom' as const,
        label: spacerName,
        Comp: () => React.createElement('div', { style: { height: heightPx } }),
      };
      spacerName = spacerName + ' ';
      return setting;
    };

    const settings: ControlPanelSetting[] = [
      {
        type: 'button',
        label: 'add input',
        action: addInput,
      },
    ];

    if (inputCount > 2) {
      settings.push({
        type: 'button',
        label: 'remove input',
        action: removeInput,
      });
    }

    settings.push(spacer(40));

    mixer.gainParams.forEach((param, i) => {
      settings.push({
        type: 'range',
        label: `input_${i}_gain`,
        min: -1,
        max: 1,
        initial: param.manualControl.offset.value,
      });
      settings.push(spacer());
    });

    return settings;
  };
</script>

<script lang="ts">
  import React from 'react';
  import { onDestroy, onMount } from 'svelte';

  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import { LevelDetectorWasmBytes } from 'src/graphEditor/nodes/CustomAudio/LevelDetectorNode/LevelDetectorNode';
  import type { MixerLevelsViz } from 'src/graphEditor/nodes/CustomAudio/mixer/MixerLevelsViz';
  import { logError } from 'src/sentry';
  import { AsyncOnce, UnreachableError } from 'src/util';

  const ctx = new AudioContext();
  export let mixer: MixerNode;
  let inputCount = mixer.gainParams.length;

  let awpHandle: AudioWorkletNode | null = null;
  let audioThreadBuffer: Float32Array | null = null;
  let vizInst: MixerLevelsViz | null = null;
  $: if (audioThreadBuffer) {
    vizInst?.setAudioThreadBuffer(audioThreadBuffer);
  }
  $: awpHandle?.port.postMessage({ type: 'setActiveTrackCount', activeTrackCount: inputCount });

  const connectTrackToAWP = (awpHandle: AudioWorkletNode, trackIx: number, disconnect: boolean) => {
    const gainInput = mixer.gainParams[trackIx];
    const gainParamName = `track_${trackIx}_gain`;
    const gainParam = (awpHandle.parameters as Map<string, AudioParam>).get(gainParamName);
    if (!gainParam) {
      throw new UnreachableError(`Missing expected gain param "${gainParamName}"`);
    }
    if (disconnect) {
      try {
        gainInput.output.disconnect(gainParam);
      } catch (e) {
        // Ignore
      }
    } else {
      gainInput.output.connect(gainParam);
    }

    const trackInput = mixer.gainNodes[trackIx];
    if (disconnect) {
      try {
        trackInput.disconnect(awpHandle, 0, trackIx);
      } catch (e) {
        // Ignore
      }
    } else {
      trackInput.connect(awpHandle, 0, trackIx);
    }
  };

  onMount(() => {
    Promise.all([MixerLevelDetectorAWPRegistered.get(), LevelDetectorWasmBytes.get()] as const)
      .then(([, wasmBytes]) => {
        awpHandle = new AudioWorkletNode(ctx, 'mixer-level-detector-awp', {
          numberOfInputs: MAX_MIXER_TRACK_COUNT,
          numberOfOutputs: 1, // Need 1 dummy output to drive audio graph
          channelInterpretation: 'discrete',
          channelCountMode: 'explicit',
        });
        awpHandle.connect(ctx.destination);

        for (let i = 0; i < inputCount; i++) {
          connectTrackToAWP(awpHandle, i, false);
        }

        awpHandle.port.onmessage = e => {
          if (e.data.type === 'setAudioThreadDataBuffer') {
            audioThreadBuffer = e.data.audioThreadDataBuffer;
          } else {
            logError('Unknown message from mixer level detector AWP: ' + e.data.type);
          }
        };
        awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes });
      })
      .catch(err => {
        logError('Error initializing mixer level detector', err);
      });
  });

  onDestroy(() => {
    awpHandle?.port.postMessage({ type: 'shutdown' });
    awpHandle?.disconnect();
    vizInst?.destroy();
  });

  const addInput = () => {
    mixer.addInput();
    inputCount = inputCount + 1;

    if (awpHandle) {
      connectTrackToAWP(awpHandle, inputCount - 1, false);
    }
  };
  const removeInput = () => {
    if (awpHandle) {
      connectTrackToAWP(awpHandle, inputCount - 1, true);
    }

    mixer.removeInput();
    inputCount = inputCount - 1;
  };

  $: settings = buildSettings(mixer, inputCount, addInput, removeInput);

  const buildMixerLevelsViz = (
    canvas: HTMLCanvasElement,
    MixerLevelsVizClass: typeof MixerLevelsViz
  ) => {
    if (awpHandle) {
      for (let i = 0; i < inputCount; i++) {
        connectTrackToAWP(awpHandle, i, false);
      }
    }

    vizInst?.destroy();
    vizInst = new MixerLevelsVizClass(canvas, inputCount);
  };

  const handleChange = (key: string, val: number) => {
    if (key.startsWith('input_')) {
      const trackIx = parseInt(key.split('_')[1], 10);
      const gainParam = mixer.gainParams[trackIx];
      gainParam.manualControl.offset.value = val;
      return;
    }

    logError(`Unknown state key in mixer small view: ${key}`);
  };
</script>

<div style="position: relative;">
  {#await import('src/graphEditor/nodes/CustomAudio/mixer/MixerLevelsViz').then(viz => viz.MixerLevelsViz) then MixerLevelsViz}
    <canvas use:buildMixerLevelsViz={MixerLevelsViz} />
  {/await}
  <SvelteControlPanel
    {settings}
    width={500}
    style={{ position: 'absolute', top: 0, left: 0, background: 'transparent' }}
    onChange={handleChange}
  />
</div>
