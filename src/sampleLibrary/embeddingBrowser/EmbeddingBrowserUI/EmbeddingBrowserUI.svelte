<script lang="ts" context="module">
  const LazyEmbeddingBrowserInst = new AsyncOnce(
    () =>
      import('src/sampleLibrary/embeddingBrowser/EmbeddingBrowserUI/EmbeddingBrowserInst').then(
        mod => mod.EmbeddingBrowserInst
      ),
    true
  );
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';

  import type { EmbeddingBrowserInst } from 'src/sampleLibrary/embeddingBrowser/EmbeddingBrowserUI/EmbeddingBrowserInst';
  import type {
    AudioSampleEmbedding,
    AudioSampleEmbeddingSampleClickData,
  } from 'src/sampleLibrary/embeddingBrowser/EmbeddingBrowserUI/types';
  import type { SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';
  import { PlayingSampleManager } from 'src/sampleLibrary/SampleLibraryUI/PlayingSampleManager';
  import { AsyncOnce } from 'src/util';

  export let embedding: AudioSampleEmbedding;
  export let buildSampleDescriptor: (sampleName: string) => SampleDescriptor;

  let windowHeight = 0;
  let windowWidth = 0;

  let container: HTMLDivElement | null = null;
  let inst: EmbeddingBrowserInst | null = null;

  const playingSampleManager = new PlayingSampleManager((_newPlayingSampleName: string) => {
    // playingSampleName = newPlayingSampleName;
  });

  onDestroy(() => playingSampleManager.dispose());

  const clickHandler = (datum: AudioSampleEmbeddingSampleClickData) => {
    const sampleDescriptor = buildSampleDescriptor(datum.sampleName);
    playingSampleManager.togglePlaying(sampleDescriptor);
  };

  $: height = windowHeight - 220;
  $: width = windowWidth - 500 - 80;

  $: if (!inst && container && height > 0 && width > 0) {
    LazyEmbeddingBrowserInst.get().then(EmbeddingBrowserInst => {
      if (!container) {
        console.error('container is null in EmbeddingBrowserUI');
        return;
      }

      inst?.destroy();
      inst = new EmbeddingBrowserInst({ container, embedding, clickHandler, height, width });
    });
  } else if (inst && !container) {
    inst.destroy();
    inst = null;
  }

  $: if (inst && height > 0 && width > 0) {
    inst.resize(width, height);
  }
</script>

<svelte:window bind:innerHeight={windowHeight} bind:innerWidth={windowWidth} />
<div class="container" bind:this={container} />

<style lang="css">
  .container {
    border: 1px solid #ccc;
    background: #000;
  }
</style>
