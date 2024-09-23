<script lang="ts">
  import { Moon } from 'svelte-loading-spinners';

  import { getLoadedComposition } from 'src/api';
  import { reinitializeWithComposition } from 'src/persistance';
  import { getState } from 'src/redux';
  import { getSentry } from 'src/sentry';
  import { getEngine } from 'src/util';
  import { setGlobalVolume } from '../ViewContextManager/GlobalVolumeSlider';

  export let title: string;
  export let description: string;
  export let compositionID: string;
  export let image: string;
  export let imageWidth: number;
  export let imageHeight: number;
  export let imageAlt: string;
  export let isLoadingComposition: boolean;

  let thisCompositionLoading = false;

  const loadComposition = async () => {
    if (isLoadingComposition) {
      return;
    }
    isLoadingComposition = true;
    thisCompositionLoading = true;
    getSentry()?.captureMessage(`Welcome page demo tile clicked: ${title}`);

    try {
      const composition = await getLoadedComposition(compositionID);
      if (!composition) {
        return;
      }
      const allViewContextIds = getState().viewContextManager.activeViewContexts.map(c => c.uuid);
      reinitializeWithComposition(
        { type: 'serialized', value: composition.content },
        getEngine()!,
        allViewContextIds
      );
      setGlobalVolume(20);
    } catch (err) {
      isLoadingComposition = false;
      thisCompositionLoading = false;
    }
  };
</script>

<div
  class="root"
  role="link"
  on:click={loadComposition}
  tabindex="0"
  on:keydown={e => {
    if (e.key === 'Enter') {
      loadComposition();
    }
  }}
>
  <div class="image">
    <img src={image} alt={imageAlt} width={imageWidth} height={imageHeight} />
  </div>
  <div class="title">
    <h2>{title}</h2>
  </div>
  <div class="description">
    <p>{description}</p>
  </div>

  {#if thisCompositionLoading}
    <div class="loading">
      <Moon size="60" color="#14ffe8" unit="px" duration="1200ms" />
    </div>
  {/if}
</div>

<style lang="css">
  .root {
    display: flex;
    position: relative;
    flex-direction: column;
    width: 300px;
    height: 300px;
    margin: 10px;
    background-color: #333;
    cursor: pointer;
  }

  .image {
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    z-index: 0;
  }

  .image img {
    width: 100%;
    height: 100%;
  }

  .title {
    width: 100%;
    text-align: center;
    z-index: 1;
  }

  .title h2 {
    margin: 0;
    padding: 6px;
    color: white;
    font-size: 22px;
    background-color: rgba(0, 0, 0, 0.75);
  }

  .description {
    display: flex;
    flex: 1;
    align-items: flex-end;
    z-index: 1;
  }

  .description p {
    box-sizing: border-box;
    padding-top: 0;
    padding-left: 4px;
    padding-right: 4px;
    padding-bottom: 2px;
    margin: 0;
    font-size: 15px;
    background-color: rgba(0, 0, 0, 0.8);
  }

  .loading {
    z-index: 2;
    position: absolute;
    height: 100%;
    width: 100%;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.5);
  }
</style>
